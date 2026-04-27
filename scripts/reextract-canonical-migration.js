#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { regenerateImageExtractionRecordWithExistingStage0 } from "../src/captioning.js";
import { getEffectiveClassification } from "../src/utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");

const indexPath = path.join(rootDir, "data", "image-index.json");
const phase2BackupPath = path.join(rootDir, "data", "image-index.pre-canonical-migration-backup.json");
const defaultBackupPath = path.join(rootDir, "data", "image-index.pre-canonical-reextraction-backup.json");

const args = new Set(process.argv.slice(2));
const argList = process.argv.slice(2);

function uniqueStrings(values = []) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function getArgValue(flag, fallback = "") {
  const index = argList.indexOf(flag);
  if (index === -1) {
    return fallback;
  }
  return String(argList[index + 1] || fallback).trim();
}

function readSeatingType(record = {}) {
  return String(record?.stage1?.seating_type || record?.seating_type || "").trim();
}

function readSeatFinish(record = {}) {
  return String(record?.enum_fields?.seat_finish || "").trim();
}

function isBlankLike(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return !normalized || normalized === "unknown";
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

function buildImageRecord(existingRecord = {}) {
  return {
    image_id: existingRecord.image_id,
    image_url: existingRecord.image_url,
    product_id: existingRecord.product_id,
    product_name: existingRecord.product_name || existingRecord.name || "",
    name: existingRecord.product_name || existingRecord.name || "",
    brand: existingRecord.brand || "",
    a_level: existingRecord.a_level || [],
    b_level: existingRecord.b_level || [],
    c_level: existingRecord.c_level || [],
    stage_0_result: existingRecord.stage_0_result
  };
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

function selectTargets(batchName, currentIndex, backupIndex) {
  if (batchName !== "stool-seat-finish") {
    throw new Error(`Unsupported batch "${batchName}".`);
  }

  const currentByImageId = new Map((currentIndex.images || []).map((record) => [record.image_id, record]));
  return (backupIndex.images || [])
    .filter((previousRecord) => (
      readSeatingType(previousRecord) === "stool" &&
      String(previousRecord?.enum_fields?.seat_material || "").trim().toLowerCase() === "upholstered"
    ))
    .map((previousRecord) => ({
      previousRecord,
      currentRecord: currentByImageId.get(previousRecord.image_id) || null
    }))
    .filter(({ currentRecord }) => currentRecord && isBlankLike(readSeatFinish(currentRecord)));
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required.");
  }

  const batch = getArgValue("--batch", "");
  if (!batch) {
    throw new Error('Missing required flag: --batch stool-seat-finish');
  }

  const limit = Number.parseInt(getArgValue("--limit", ""), 10);
  const backupPath = getArgValue("--backup-path", defaultBackupPath) || defaultBackupPath;

  const currentIndex = JSON.parse(await fs.readFile(indexPath, "utf8"));
  const phase2BackupIndex = JSON.parse(await fs.readFile(phase2BackupPath, "utf8"));

  const candidateTargets = selectTargets(batch, currentIndex, phase2BackupIndex);
  const targets = Number.isFinite(limit) && limit > 0
    ? candidateTargets.slice(0, limit)
    : candidateTargets;

  if (!targets.length) {
    console.log(`No records found for batch ${batch}. No files changed.`);
    return;
  }

  if (!args.has("--use-existing-backup")) {
    await ensureBackupDoesNotExist(backupPath);
    await fs.writeFile(backupPath, `${JSON.stringify(currentIndex, null, 2)}\n`);
  }

  const targetImageIds = new Set(targets.map(({ currentRecord }) => currentRecord.image_id));
  const targetByImageId = new Map(targets.map(({ previousRecord, currentRecord }) => [currentRecord.image_id, { previousRecord, currentRecord }]));

  const nextImages = [];
  const valueCounts = new Map();
  const failures = [];
  let processed = 0;
  let apiCalls = 0;
  let totalCostUsd = 0;

  for (const existingRecord of currentIndex.images || []) {
    if (!targetImageIds.has(existingRecord.image_id)) {
      nextImages.push(existingRecord);
      continue;
    }

    const { previousRecord } = targetByImageId.get(existingRecord.image_id);

    try {
      const nextRecord = await regenerateImageExtractionRecordWithExistingStage0(
        buildImageRecord(existingRecord),
        existingRecord,
        {
          apiKey: process.env.OPENAI_API_KEY,
          provider: "openai",
          visionModel: process.env.VISION_MODEL || "gpt-4.1",
          embeddingModel: process.env.EMBEDDING_MODEL
        }
      );

      processed += 1;
      apiCalls += Array.isArray(nextRecord?.cost?.runs) ? nextRecord.cost.runs.length : 0;
      totalCostUsd += Number(nextRecord?.cost?.total_usd || 0);
      nextImages.push(nextRecord);

      const nextValue = readSeatFinish(nextRecord);
      const summaryKey = nextValue || "still blank";
      valueCounts.set(summaryKey, (valueCounts.get(summaryKey) || 0) + 1);

      console.log(
        `${existingRecord.image_id} | ${existingRecord.product_name || existingRecord.name || ""} | seat_material: "${String(previousRecord?.enum_fields?.seat_material || "").trim()}" | seat_finish: "${readSeatFinish(existingRecord)}" -> "${nextValue}"`
      );
    } catch (error) {
      failures.push({
        image_id: existingRecord.image_id,
        product_id: existingRecord.product_id,
        product_name: existingRecord.product_name || existingRecord.name || "",
        image_url: existingRecord.image_url,
        error: String(error?.message || error || "Unknown re-extraction error.")
      });
      nextImages.push(existingRecord);
      valueCounts.set("still blank", (valueCounts.get("still blank") || 0) + 1);
      console.error(`FAILED ${existingRecord.image_id} | ${existingRecord.product_name || existingRecord.name || ""} | ${failures.at(-1).error}`);
    }
  }

  const nextIndex = {
    ...currentIndex,
    generated_at: new Date().toISOString(),
    images: nextImages,
    products: buildProductRecords(nextImages)
  };

  await fs.writeFile(indexPath, `${JSON.stringify(nextIndex, null, 2)}\n`);

  console.log(JSON.stringify({
    status: "ok",
    batch,
    backup_path: backupPath,
    candidates_found: candidateTargets.length,
    processed,
    api_calls: apiCalls,
    total_cost_usd: Number(totalCostUsd.toFixed(6)),
    value_distribution: Object.fromEntries([...valueCounts.entries()].sort(([left], [right]) => left.localeCompare(right))),
    failures
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
