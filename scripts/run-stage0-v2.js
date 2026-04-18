#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

import { classifyImageStage0Only } from "../src/captioning.js";
import { DATA_DIR, ensureDir, normalizeWhitespace } from "../src/utils.js";

const indexPath = path.join(DATA_DIR, "image-index.json");
const backupPath = path.join(DATA_DIR, "image-index.pre-stage0-v2-backup.json");
const resultsPath = path.join(DATA_DIR, "stage0-v2-results.json");
const envPath = path.resolve(".env.local");

function parseEnv(content = "") {
  const env = {};
  for (const rawLine of String(content || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

async function loadLocalEnv(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    const parsed = parseEnv(content);
    for (const [key, value] of Object.entries(parsed)) {
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

function hasExistingAiData(image = {}) {
  const hasStage1 = image.stage1 && typeof image.stage1 === "object" && Object.keys(image.stage1).length > 0;
  const hasStage2 = image.stage2 && typeof image.stage2 === "object" && Object.keys(image.stage2).length > 0;
  const hasFreeText = image.free_text && typeof image.free_text === "object" && Object.values(image.free_text).some((value) => {
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    return typeof value === "string" ? value.trim().length > 0 : Boolean(value);
  });
  const hasVisualSummary = typeof image.visual_summary === "string" && image.visual_summary.trim().length > 0;
  return hasStage1 || hasStage2 || hasFreeText || hasVisualSummary;
}

function buildScope(images = []) {
  return images.filter((image) => image.excluded !== true && hasExistingAiData(image));
}

function increment(map, key) {
  map[key] = Number(map[key] || 0) + 1;
}

function buildFlipBuckets(results = []) {
  const buckets = new Map();
  for (const record of results) {
    if (!record.changed) {
      continue;
    }
    const key = `${record.old_stage_0_result} -> ${record.new_stage_0_result}`;
    if (!buckets.has(key)) {
      buckets.set(key, []);
    }
    buckets.get(key).push(record);
  }
  return buckets;
}

function summarize(results = [], startedAt = 0, errors = []) {
  const oldDistribution = { product: 0, product_detail: 0, scene: 0 };
  const newDistribution = { product: 0, product_detail: 0, scene: 0 };
  let totalCost = 0;

  for (const record of results) {
    increment(oldDistribution, record.old_stage_0_result);
    increment(newDistribution, record.new_stage_0_result);
    totalCost = Number((totalCost + Number(record.estimated_cost_usd || 0)).toFixed(6));
  }

  const flipBuckets = buildFlipBuckets(results);
  const flipCounts = Object.fromEntries(
    [...flipBuckets.entries()].map(([key, value]) => [key, value.length]).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
  );

  return {
    processed_images: results.length,
    runtime_seconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
    total_cost_usd: totalCost,
    old_distribution: oldDistribution,
    new_distribution: newDistribution,
    flip_counts: flipCounts,
    errors
  };
}

async function writeCheckpoint(payload) {
  await ensureDir(path.dirname(resultsPath));
  await fs.writeFile(resultsPath, JSON.stringify(payload, null, 2));
}

await loadLocalEnv(envPath);

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required. Put it in .env.local or the environment before running.");
}

const rawIndex = await fs.readFile(indexPath, "utf8");
await fs.writeFile(backupPath, rawIndex);

const index = JSON.parse(rawIndex);
const images = Array.isArray(index.images) ? index.images : [];
const scope = buildScope(images);
const startedAt = Date.now();
const results = [];
const errors = [];

for (let i = 0; i < scope.length; i += 1) {
  const image = scope[i];
  try {
    const outcome = await classifyImageStage0Only(image, {
      apiKey: process.env.OPENAI_API_KEY,
      stage0Model: process.env.STAGE0_MODEL || process.env.VISION_MODEL || "gpt-4.1-nano"
    });
    results.push({
      image_id: image.image_id,
      product_id: image.product_id,
      product_name: image.product_name || image.name || "",
      image_url: image.image_url,
      old_stage_0_result: String(image.stage_0_result || "").trim().toLowerCase() || "product",
      new_stage_0_result: outcome.stage0_result,
      changed: outcome.stage0_result !== (String(image.stage_0_result || "").trim().toLowerCase() || "product"),
      estimated_cost_usd: Number(outcome.estimated_cost_usd || 0),
      usage: outcome.usage,
      image_width: Number(outcome.image_dimensions?.width || image.image_width || 0) || null,
      image_height: Number(outcome.image_dimensions?.height || image.image_height || 0) || null,
      image_short_side: Number(Math.min(outcome.image_dimensions?.width || 0, outcome.image_dimensions?.height || 0) || image.image_short_side || 0) || null
    });
  } catch (error) {
    errors.push({
      image_id: image.image_id,
      product_id: image.product_id,
      product_name: image.product_name || image.name || "",
      image_url: image.image_url,
      error: normalizeWhitespace(error.message || "Stage 0 rerun failed.")
    });
  }

  if ((i + 1) % 25 === 0 || i === scope.length - 1) {
    const summary = summarize(results, startedAt, errors);
    await writeCheckpoint({
      generated_at: new Date().toISOString(),
      backup_path: backupPath,
      total_scope_images: scope.length,
      processed_so_far: i + 1,
      summary,
      results,
      errors
    });
    console.log(`Processed ${i + 1}/${scope.length}`);
  }
}

const finalSummary = summarize(results, startedAt, errors);
await writeCheckpoint({
  generated_at: new Date().toISOString(),
  backup_path: backupPath,
  total_scope_images: scope.length,
  processed_so_far: scope.length,
  summary: finalSummary,
  results,
  errors
});

console.log(JSON.stringify(finalSummary, null, 2));
