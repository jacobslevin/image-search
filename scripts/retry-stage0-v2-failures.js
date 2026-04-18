#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

import { classifyImageStage0Only } from "../src/captioning.js";
import { DATA_DIR, ensureDir, normalizeWhitespace } from "../src/utils.js";

const indexPath = path.join(DATA_DIR, "image-index.json");
const sourceResultsPath = path.join(DATA_DIR, "stage0-v2-results.json");
const retryResultsPath = path.join(DATA_DIR, "stage0-v2-retry-results.json");
const envPath = path.resolve(".env.local");

function parseEnv(content = "") {
  const env = {};
  for (const rawLine of String(content || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;
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

function increment(map, key) {
  map[key] = Number(map[key] || 0) + 1;
}

function buildFlipBuckets(results = []) {
  const buckets = new Map();
  for (const record of results) {
    if (!record.changed) continue;
    const key = `${record.old_stage_0_result} -> ${record.new_stage_0_result}`;
    if (!buckets.has(key)) buckets.set(key, []);
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
    [...flipBuckets.entries()].map(([key, value]) => [key, value.length]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
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
  await ensureDir(path.dirname(retryResultsPath));
  await fs.writeFile(retryResultsPath, JSON.stringify(payload, null, 2));
}

await loadLocalEnv(envPath);

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required. Put it in .env.local or the environment before running.");
}

const [rawIndex, rawSourceResults] = await Promise.all([
  fs.readFile(indexPath, "utf8"),
  fs.readFile(sourceResultsPath, "utf8")
]);

const index = JSON.parse(rawIndex);
const sourceResults = JSON.parse(rawSourceResults);
const images = Array.isArray(index.images) ? index.images : [];
const imageById = new Map(images.map((image) => [image.image_id, image]));
const retryScope = (Array.isArray(sourceResults.errors) ? sourceResults.errors : [])
  .map((error) => imageById.get(error.image_id))
  .filter(Boolean);

const startedAt = Date.now();
const results = [];
const errors = [];

for (let i = 0; i < retryScope.length; i += 1) {
  const image = retryScope[i];
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
      error: normalizeWhitespace(error.message || "Stage 0 retry failed.")
    });
  }

  if ((i + 1) % 25 === 0 || i === retryScope.length - 1) {
    const summary = summarize(results, startedAt, errors);
    await writeCheckpoint({
      generated_at: new Date().toISOString(),
      source_results_path: sourceResultsPath,
      total_retry_images: retryScope.length,
      processed_so_far: i + 1,
      summary,
      results,
      errors
    });
    console.log(`Retried ${i + 1}/${retryScope.length}`);
  }
}

const finalSummary = summarize(results, startedAt, errors);
await writeCheckpoint({
  generated_at: new Date().toISOString(),
  source_results_path: sourceResultsPath,
  total_retry_images: retryScope.length,
  processed_so_far: retryScope.length,
  summary: finalSummary,
  results,
  errors
});

console.log(JSON.stringify(finalSummary, null, 2));
