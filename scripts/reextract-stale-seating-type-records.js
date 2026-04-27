#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { generateImageExtractionRecord } from "../src/captioning.js";
import { getEffectiveClassification, getPixelSeekType } from "../src/utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
const indexPath = path.join(rootDir, "data", "image-index.json");
const catalogPath = path.join(rootDir, "data", "normalized-catalog.json");
const backupPath = path.join(rootDir, "data", "image-index.pre-reextract-stale-seating-type-backup.json");

const PIXELSEEK_TYPE_TO_ROUTING_KEY = Object.freeze({
  "Work Chairs": "task_collab_chair",
  "Multi-Use / Guest Chairs": "guest_chair",
  "Lounge Seating": "lounge_chair",
  "Stools": "stool",
  "Benches": "bench"
});

function uniqueStrings(values = []) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function buildProductRecords(images = []) {
  const productMap = new Map();

  for (const image of images) {
    const productId = String(image.product_id || "").trim();
    if (!productId) {
      continue;
    }

    const existing = productMap.get(productId) || {
      product_id: productId,
      product_name: String(image.product_name || image.name || "").trim(),
      brand: String(image.brand || "").trim(),
      a_level: [],
      b_level: [],
      c_level: [],
      image_urls: [],
      passing_image_count: 0
    };

    existing.product_name = existing.product_name || String(image.product_name || image.name || "").trim();
    existing.brand = existing.brand || String(image.brand || "").trim();
    existing.a_level.push(...(image.a_level || []));
    existing.b_level.push(...(image.b_level || []));
    existing.c_level.push(...(image.c_level || []));
    existing.image_urls.push(String(image.image_url || "").trim());
    if (getEffectiveClassification(image) === "product" && !image.excluded) {
      existing.passing_image_count += 1;
    }

    productMap.set(productId, existing);
  }

  return [...productMap.values()]
    .map((product) => ({
      ...product,
      a_level: uniqueStrings(product.a_level),
      b_level: uniqueStrings(product.b_level),
      c_level: uniqueStrings(product.c_level),
      image_urls: uniqueStrings(product.image_urls)
    }))
    .sort((a, b) => a.product_name.localeCompare(b.product_name) || a.product_id.localeCompare(b.product_id));
}

function resolveMappedSeatingType(product = null) {
  if (!product || typeof product !== "object") {
    return "";
  }
  const pixelSeekType = getPixelSeekType(product);
  return PIXELSEEK_TYPE_TO_ROUTING_KEY[pixelSeekType] || "";
}

function getRecordSeatingType(record = {}) {
  return String(record?.stage1?.seating_type || record?.seating_type || "").trim();
}

function buildStaleRecordList(index = {}, catalog = {}) {
  const productsById = new Map((catalog.products || []).map((product) => [product.product_id, product]));

  return (index.images || []).filter((record) => {
    const existingType = getRecordSeatingType(record);
    if (!existingType) {
      return false;
    }
    const product = productsById.get(record.product_id);
    const mappedType = resolveMappedSeatingType(product);
    if (!mappedType) {
      return false;
    }
    return existingType !== mappedType;
  }).map((record) => {
    const product = productsById.get(record.product_id);
    return {
      record,
      product,
      oldType: getRecordSeatingType(record),
      expectedType: resolveMappedSeatingType(product)
    };
  });
}

async function ensureBackupDoesNotExist(filePath) {
  try {
    await fs.access(filePath);
    throw new Error(`Backup already exists at ${filePath}. Aborting to avoid overwrite.`);
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required.");
  }

  const originalIndex = JSON.parse(await fs.readFile(indexPath, "utf8"));
  const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
  const staleEntries = buildStaleRecordList(originalIndex, catalog);

  if (!staleEntries.length) {
    console.log("No stale seating_type records found. No files changed.");
    return;
  }

  await ensureBackupDoesNotExist(backupPath);
  await fs.writeFile(backupPath, `${JSON.stringify(originalIndex, null, 2)}\n`);

  const staleByImageId = new Map(staleEntries.map((entry) => [entry.record.image_id, entry]));
  const failures = [];
  const nextImages = [];
  const mappingCounts = new Map();
  let totalCostUsd = 0;
  let apiCalls = 0;
  let processed = 0;

  for (const existingRecord of originalIndex.images || []) {
    const staleEntry = staleByImageId.get(existingRecord.image_id);
    if (!staleEntry) {
      nextImages.push(existingRecord);
      continue;
    }

    const imageRecord = {
      image_id: existingRecord.image_id,
      image_url: existingRecord.image_url,
      product_id: existingRecord.product_id,
      product_name: existingRecord.product_name || existingRecord.name || "",
      name: existingRecord.product_name || existingRecord.name || "",
      brand: existingRecord.brand || "",
      a_level: staleEntry.product?.a_level || existingRecord.a_level || [],
      b_level: staleEntry.product?.b_level || existingRecord.b_level || [],
      c_level: staleEntry.product?.c_level || existingRecord.c_level || [],
      stage_0_result: existingRecord.stage_0_result
    };

    try {
      const nextRecord = await generateImageExtractionRecord(imageRecord, {
        apiKey: process.env.OPENAI_API_KEY,
        provider: "openai",
        visionModel: process.env.VISION_MODEL || "gpt-4.1",
        embeddingModel: process.env.EMBEDDING_MODEL
      });

      processed += 1;
      apiCalls += 1 + (Array.isArray(nextRecord?.cost?.runs) ? nextRecord.cost.runs.length : 0);
      totalCostUsd += Number(nextRecord?.cost?.total_usd || 0);
      nextImages.push(nextRecord);

      const newType = getRecordSeatingType(nextRecord);
      const mappingKey = `${staleEntry.oldType} -> ${newType}`;
      mappingCounts.set(mappingKey, (mappingCounts.get(mappingKey) || 0) + 1);
      console.log(
        `${existingRecord.image_id} | ${imageRecord.product_name} | seating_type: "${staleEntry.oldType}" -> "${newType}"`
      );
    } catch (error) {
      failures.push({
        image_id: existingRecord.image_id,
        product_id: existingRecord.product_id,
        product_name: imageRecord.product_name,
        image_url: existingRecord.image_url,
        old_seating_type: staleEntry.oldType,
        expected_seating_type: staleEntry.expectedType,
        error: String(error?.message || error || "Unknown re-extraction error.")
      });
      nextImages.push(existingRecord);
      console.error(`FAILED ${existingRecord.image_id} | ${imageRecord.product_name} | ${failures.at(-1).error}`);
    }
  }

  const nextIndex = {
    ...originalIndex,
    generated_at: new Date().toISOString(),
    images: nextImages,
    products: buildProductRecords(nextImages)
  };

  await fs.writeFile(indexPath, `${JSON.stringify(nextIndex, null, 2)}\n`);

  const summary = {
    records_identified: staleEntries.length,
    records_processed: processed,
    api_calls_made: apiCalls,
    total_cost_estimate_usd: Number(totalCostUsd.toFixed(6)),
    failures
  };

  console.log(JSON.stringify({
    ...summary,
    mappings: Object.fromEntries([...mappingCounts.entries()].sort((a, b) => a[0].localeCompare(b[0])))
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
