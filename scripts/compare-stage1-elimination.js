#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { DATA_DIR, ensureDir, normalizeWhitespace } from "../src/utils.js";

const execFileAsync = promisify(execFile);
const indexPath = path.join(DATA_DIR, "image-index.json");
const backupPath = path.join(DATA_DIR, "image-index.pre-stage1-test-backup.json");
const resultsPath = path.join(DATA_DIR, "stage1-elimination-comparison.json");
const envPath = path.resolve(".env.local");
const TARGET_TYPES = [
  "Lounge Seating",
  "Multi-Use / Guest Chairs",
  "Work Chairs",
  "Stools",
  "Benches"
];
const SAMPLES_PER_TYPE = 2;

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

function hasPopulatedOldExtraction(record = {}) {
  return Boolean(
    record.pixelseek_type &&
    record.excluded !== true &&
    record.stage_0_result === "product" &&
    record.stage2 &&
    typeof record.stage2 === "object" &&
    Object.keys(record.stage2).length > 0 &&
    record.free_text &&
    typeof record.free_text === "object" &&
    Object.keys(record.free_text).length > 0 &&
    String(record.visual_summary || "").trim() &&
    Array.isArray(record.visual_summary_embedding) &&
    record.visual_summary_embedding.length > 0 &&
    Array.isArray(record.search_text_embedding) &&
    record.search_text_embedding.length > 0
  );
}

function pickSamples(images = []) {
  const byType = new Map(TARGET_TYPES.map((type) => [type, []]));
  for (const image of images) {
    if (!hasPopulatedOldExtraction(image)) {
      continue;
    }
    if (!byType.has(image.pixelseek_type)) {
      continue;
    }
    byType.get(image.pixelseek_type).push(image);
  }

  const selected = [];
  for (const type of TARGET_TYPES) {
    const pool = (byType.get(type) || [])
      .slice()
      .sort((left, right) => {
        const leftKey = `${left.product_name || left.name || ""}::${left.image_id || ""}`;
        const rightKey = `${right.product_name || right.name || ""}::${right.image_id || ""}`;
        return leftKey.localeCompare(rightKey);
      })
      .slice(0, SAMPLES_PER_TYPE);
    if (pool.length < SAMPLES_PER_TYPE) {
      throw new Error(`Need ${SAMPLES_PER_TYPE} samples for ${type}, found ${pool.length}.`);
    }
    selected.push(...pool);
  }
  return selected;
}

function normalizeTokenSet(value = "") {
  return new Set(
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, " ")
      .split(/\s+/)
      .filter(Boolean)
  );
}

function jaccardSimilarity(left = "", right = "") {
  const a = normalizeTokenSet(left);
  const b = normalizeTokenSet(right);
  if (!a.size && !b.size) {
    return 1;
  }
  const union = new Set([...a, ...b]);
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) {
      intersection += 1;
    }
  }
  return union.size ? intersection / union.size : 0;
}

function summarizeEnumOverlap(oldEnum = {}, nextEnum = {}) {
  const oldKeys = Object.keys(oldEnum || {});
  const nextKeys = Object.keys(nextEnum || {});
  const union = new Set([...oldKeys, ...nextKeys]);
  let exactMatches = 0;
  for (const key of union) {
    if (JSON.stringify(oldEnum?.[key]) === JSON.stringify(nextEnum?.[key])) {
      exactMatches += 1;
    }
  }
  return {
    old_keys: oldKeys.length,
    new_keys: nextKeys.length,
    shared_exact: exactMatches,
    union_keys: union.size
  };
}

function similarityLabel(score = 0) {
  if (score >= 0.8) return "close";
  if (score >= 0.5) return "partial";
  return "materially different";
}

function extractOldComparison(record = {}) {
  return {
    pixelseek_type: record.pixelseek_type || null,
    seating_type: record.seating_type || "",
    stage1: record.stage1 || null,
    stage2: record.stage2 || null,
    enum_fields: record.enum_fields || {},
    free_text: record.free_text || {},
    visual_summary: record.visual_summary || "",
    structured_caption: record.structured_caption || "",
    embedding_dimensions: {
      visual_summary_embedding: Array.isArray(record.visual_summary_embedding) ? record.visual_summary_embedding.length : 0,
      search_text_embedding: Array.isArray(record.search_text_embedding) ? record.search_text_embedding.length : 0
    },
    cost: record.cost || null
  };
}

function extractNewComparison(record = {}, runtimeMs = 0) {
  return {
    pixelseek_type: record.pixelseek_type || null,
    seating_type: record.seating_type || "",
    stage1: record.stage1 || null,
    stage_1_override: record.stage_1_override,
    stage_1_override_result: record.stage_1_override_result ?? null,
    stage_1_override_reason: record.stage_1_override_reason ?? null,
    type_routing_source: record.type_routing_source || null,
    stage2: record.stage2 || null,
    enum_fields: record.enum_fields || {},
    free_text: record.free_text || {},
    visual_summary: record.visual_summary || "",
    structured_caption: record.structured_caption || "",
    embedding_dimensions: {
      visual_summary_embedding: Array.isArray(record.visual_summary_embedding) ? record.visual_summary_embedding.length : 0,
      search_text_embedding: Array.isArray(record.search_text_embedding) ? record.search_text_embedding.length : 0
    },
    cost: record.cost || null,
    runtime_ms: runtimeMs
  };
}

function buildComparisonEntry(oldRecord = {}, newRecord = {}, runtimeMs = 0) {
  const oldView = extractOldComparison(oldRecord);
  const newView = extractNewComparison(newRecord, runtimeMs);
  const summarySimilarity = jaccardSimilarity(oldView.visual_summary, newView.visual_summary);
  const captionSimilarity = jaccardSimilarity(oldView.structured_caption, newView.structured_caption);
  const enumOverlap = summarizeEnumOverlap(oldView.enum_fields, newView.enum_fields);
  const oldCost = Number(oldView.cost?.total_usd || 0);
  const newCost = Number(newView.cost?.total_usd || 0);
  return {
    image_id: oldRecord.image_id,
    product_id: oldRecord.product_id,
    product_name: oldRecord.product_name || oldRecord.name || "",
    image_url: oldRecord.image_url,
    target_type: oldRecord.pixelseek_type || null,
    type_agreement: (newView.seating_type || "") === String(oldView.seating_type || ""),
    old_seating_type: oldView.seating_type || "",
    new_seating_type: newView.seating_type || "",
    new_pixelseek_type: newView.pixelseek_type || "",
    old_cost_usd: oldCost,
    new_cost_usd: newCost,
    cost_delta_usd: Number((newCost - oldCost).toFixed(6)),
    summary_similarity: Number(summarySimilarity.toFixed(4)),
    summary_similarity_label: similarityLabel(summarySimilarity),
    caption_similarity: Number(captionSimilarity.toFixed(4)),
    caption_similarity_label: similarityLabel(captionSimilarity),
    enum_overlap: enumOverlap,
    old: oldView,
    new: newView
  };
}

function summarizeResults(entries = [], startedAt = 0, errors = []) {
  const aggregate = {
    processed_images: entries.length,
    runtime_seconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
    old_total_cost_usd: 0,
    new_total_cost_usd: 0,
    type_agreement_matches: 0,
    type_agreement_mismatches: 0,
    errors
  };

  for (const entry of entries) {
    aggregate.old_total_cost_usd = Number((aggregate.old_total_cost_usd + Number(entry.old_cost_usd || 0)).toFixed(6));
    aggregate.new_total_cost_usd = Number((aggregate.new_total_cost_usd + Number(entry.new_cost_usd || 0)).toFixed(6));
    if (entry.type_agreement) {
      aggregate.type_agreement_matches += 1;
    } else {
      aggregate.type_agreement_mismatches += 1;
    }
  }

  aggregate.absolute_savings_usd = Number((aggregate.old_total_cost_usd - aggregate.new_total_cost_usd).toFixed(6));
  aggregate.percent_savings = aggregate.old_total_cost_usd
    ? Number((((aggregate.old_total_cost_usd - aggregate.new_total_cost_usd) / aggregate.old_total_cost_usd) * 100).toFixed(2))
    : 0;
  aggregate.projected_250k_savings_usd = Number((((aggregate.old_total_cost_usd - aggregate.new_total_cost_usd) / Math.max(entries.length, 1)) * 250000).toFixed(2));

  return aggregate;
}

const rawIndex = await fs.readFile(indexPath, "utf8");
await fs.writeFile(backupPath, rawIndex);

const index = JSON.parse(rawIndex);
const images = Array.isArray(index.images) ? index.images : [];
const selected = pickSamples(images);
const startedAt = Date.now();
const comparisons = [];
const errors = [];

for (const record of selected) {
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      ["scripts/run-single-stage1-elimination-case.js", record.image_id],
      {
        cwd: process.cwd(),
        timeout: 180000,
        maxBuffer: 20 * 1024 * 1024
      }
    );
    const parsed = JSON.parse(stdout);
    comparisons.push(buildComparisonEntry(record, parsed.regenerated, Number(parsed.runtime_ms || 0)));
  } catch (error) {
    errors.push({
      image_id: record.image_id,
      product_id: record.product_id,
      product_name: record.product_name || record.name || "",
      image_url: record.image_url,
      error: normalizeWhitespace(
        error.stderr ||
        error.stdout ||
        error.message ||
        "Comparison rerun failed."
      )
    });
  }
}

const payload = {
  generated_at: new Date().toISOString(),
  backup_path: backupPath,
  selection: selected.map((record) => ({
    image_id: record.image_id,
    product_id: record.product_id,
    product_name: record.product_name || record.name || "",
    image_url: record.image_url,
    target_type: record.pixelseek_type || null
  })),
  summary: summarizeResults(comparisons, startedAt, errors),
  comparisons,
  errors
};

await ensureDir(path.dirname(resultsPath));
await fs.writeFile(resultsPath, JSON.stringify(payload, null, 2));

console.log(JSON.stringify(payload.summary, null, 2));
