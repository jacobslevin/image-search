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
const defaultBackupPath = path.join(rootDir, "data", "image-index.pre-base-finish-reextract-backup.json");

const args = new Set(process.argv.slice(2));
const argList = process.argv.slice(2);

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

function getRecordSeatingType(record = {}) {
  return String(record?.stage1?.seating_type || record?.seating_type || "").trim();
}

function getBaseFinishValue(record = {}) {
  return String(record?.enum_fields?.base_finish || "").trim();
}

function isBlankBaseFinish(record = {}) {
  const value = getBaseFinishValue(record).toLowerCase();
  return !value || value === "unknown";
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

async function ensureBackupExists(filePath) {
  await fs.access(filePath);
}

function getArgValue(flag, fallback = "") {
  const index = argList.indexOf(flag);
  if (index === -1) {
    return fallback;
  }
  return String(argList[index + 1] || fallback).trim();
}

function pickRepresentativeSample(records = [], limit = 0) {
  if (!limit || records.length <= limit) {
    return records;
  }

  const woodRecords = [];
  const metalRecords = [];
  const lowSignalRecords = [];
  const remainder = [];

  for (const record of records) {
    const visualSummary = String(record.visual_summary || "").trim();
    const normalizedSummary = visualSummary.toLowerCase();
    if (!visualSummary || visualSummary.length < 20) {
      lowSignalRecords.push(record);
      continue;
    }
    if (/\bwood|wooden|natural wood|oak|walnut|ash|maple|reclaimed\b/.test(normalizedSummary)) {
      woodRecords.push(record);
      continue;
    }
    if (/\bmetal|chrome|polished|aluminum|aluminium|black\b/.test(normalizedSummary)) {
      metalRecords.push(record);
      continue;
    }
    remainder.push(record);
  }

  const selected = [];
  const seen = new Set();
  const pushFrom = (pool = [], count = Infinity) => {
    for (const record of pool) {
      if (selected.length >= limit || count <= 0) {
        break;
      }
      if (seen.has(record.image_id)) {
        continue;
      }
      selected.push(record);
      seen.add(record.image_id);
      count -= 1;
    }
  };

  pushFrom(woodRecords, 30);
  pushFrom(metalRecords, 10);
  pushFrom(lowSignalRecords, 10);
  pushFrom(remainder, limit - selected.length);
  pushFrom(woodRecords, limit - selected.length);
  pushFrom(metalRecords, limit - selected.length);
  pushFrom(lowSignalRecords, limit - selected.length);

  return selected.slice(0, limit);
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required.");
  }

  const originalIndex = JSON.parse(await fs.readFile(indexPath, "utf8"));
  const allTargetEntries = (originalIndex.images || []).filter((record) => (
    getRecordSeatingType(record) === "guest_chair" && isBlankBaseFinish(record)
  ));

  const limit = Number.parseInt(getArgValue("--limit", ""), 10);
  const useRepresentativeSample = args.has("--representative-sample");
  const backupPath = getArgValue("--backup-path", defaultBackupPath) || defaultBackupPath;
  const targetEntries = useRepresentativeSample && Number.isFinite(limit) && limit > 0
    ? pickRepresentativeSample(allTargetEntries, limit)
    : Number.isFinite(limit) && limit > 0
      ? allTargetEntries.slice(0, limit)
      : allTargetEntries;

  if (!targetEntries.length) {
    console.log("No guest_chair records with blank base_finish found. No files changed.");
    return;
  }

  if (args.has("--use-existing-backup")) {
    await ensureBackupExists(backupPath);
  } else {
    await ensureBackupDoesNotExist(backupPath);
    await fs.writeFile(backupPath, `${JSON.stringify(originalIndex, null, 2)}\n`);
  }

  const targetByImageId = new Map(targetEntries.map((record) => [record.image_id, record]));
  const nextImages = [];
  const valueCounts = new Map();
  const failures = [];
  let processed = 0;
  let apiCalls = 0;
  let totalCostUsd = 0;

  for (const existingRecord of originalIndex.images || []) {
    const targetRecord = targetByImageId.get(existingRecord.image_id);
    if (!targetRecord) {
      nextImages.push(existingRecord);
      continue;
    }

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

      const nextValue = getBaseFinishValue(nextRecord) || "";
      const summaryKey = nextValue || "still blank";
      valueCounts.set(summaryKey, (valueCounts.get(summaryKey) || 0) + 1);
      console.log(
        `${existingRecord.image_id} | ${existingRecord.product_name || existingRecord.name || ""} | base_finish: "" -> "${nextValue}"`
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
    ...originalIndex,
    generated_at: new Date().toISOString(),
    images: nextImages,
    products: buildProductRecords(nextImages)
  };

  await fs.writeFile(indexPath, `${JSON.stringify(nextIndex, null, 2)}\n`);

  console.log(JSON.stringify({
    records_identified: allTargetEntries.length,
    records_selected_for_run: targetEntries.length,
    records_processed: processed,
    api_calls_made: apiCalls,
    backup_path: backupPath,
    total_cost_estimate_usd: Number(totalCostUsd.toFixed(6)),
    new_value_distribution: Object.fromEntries([...valueCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    failures
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
