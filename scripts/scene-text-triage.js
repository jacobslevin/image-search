#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const INDEX_PATH = path.join(ROOT_DIR, "data", "image-index.json");
const OUTPUT_PATH = path.join(ROOT_DIR, "tmp", "scene-triage-candidates.json");
const TOP_N = 200;
const TERMINAL_PREVIEW_COUNT = 20;
const SUMMARY_LIMIT = 200;

const PARENT_CATEGORY_RULES = [
  {
    label: "Lounge Seating",
    match: (levels) => levels.includes("Lounge Seating"),
    allowed: new Set(["lounge_chair", "ottoman", "bench"])
  },
  {
    label: "Outdoor Seating",
    match: (levels) => levels.includes("Outdoor Seating"),
    allowed: new Set(["lounge_chair", "guest_chair", "bench", "ottoman", "outdoor_seating"])
  },
  {
    label: "Executive Chairs",
    match: (levels) => levels.includes("Executive Chairs"),
    allowed: new Set(["task_collab_chair"])
  },
  {
    label: "Task Seating",
    match: (levels) => levels.includes("Task Seating"),
    allowed: new Set(["task_collab_chair"])
  },
  {
    label: "Multi-use Guest Chairs",
    match: (levels) => levels.includes("Multi-use Guest Chairs"),
    allowed: new Set(["guest_chair"])
  },
  {
    label: "Bench Seating",
    match: (levels) => levels.includes("Bench Seating"),
    allowed: new Set(["bench"])
  },
  {
    label: "Fixed-height Stools",
    match: (levels) => levels.includes("Fixed-height Stools"),
    allowed: new Set(["stool"])
  }
];

const SIGNAL_RULES = [
  {
    key: "plural_seating_group",
    weight: 4,
    description: "Multiple seating products / arrangement language",
    test: (text) => /\b(chairs|stools|benches|ottomans|sofas|lounge chairs|seating arrangement|group of seating|group of chairs|arrangement of chairs|arrangement of seating|cluster of chairs|series of chairs|multiple chairs|multiple seating)\b/i.test(text)
  },
  {
    key: "conference_room_context",
    weight: 4,
    description: "Conference / meeting room language",
    test: (text) => /\b(conference room|meeting room|boardroom|conference table|meeting table|around a table|around the table)\b/i.test(text)
  },
  {
    key: "showroom_installation_context",
    weight: 4,
    description: "Showroom / lobby / installation language",
    test: (text) => /\b(showroom|lobby|installation|lounge area|waiting area|reception area)\b/i.test(text)
  },
  {
    key: "non_seating_cosubject",
    weight: 3,
    description: "Non-seating furniture as co-subject",
    test: (text) => /(\bchair|\bchairs|\bseating|\bsofa|\bstool|\bbench|\bottoman).{0,80}\b(table|coffee table|side table|desk|worksurface)\b|\b(table|coffee table|side table|desk|worksurface)\b.{0,80}(\bchair|\bchairs|\bseating|\bsofa|\bstool|\bbench|\bottoman)/i.test(text)
  },
  {
    key: "environment_plural_context",
    weight: 2,
    description: "Office / interior / environment language with plural furniture",
    test: (text) => /\b(office|workspace|interior|environment|setting)\b/i.test(text)
      && /\b(chairs|stools|benches|ottomans|sofas|tables|desks|seating)\b/i.test(text)
  },
  {
    key: "lifestyle_styling_language",
    weight: 2,
    description: "Lifestyle / styling language",
    test: (text) => /\b(styled|arranged|in a setting|installation view|scene|setting)\b/i.test(text)
  },
  {
    key: "room_alone",
    weight: 1,
    description: "Single room mention",
    test: (text) => /\broom\b/i.test(text)
  },
  {
    key: "office_alone",
    weight: 1,
    description: "Single office mention",
    test: (text) => /\boffice\b/i.test(text)
  },
  {
    key: "table_alone",
    weight: 1,
    description: "Single table mention",
    test: (text) => /\btable\b/i.test(text)
  }
];

function normalizeWhitespace(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncateText(value = "", limit = SUMMARY_LIMIT) {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 1).trimEnd()}...`;
}

function collectText(record = {}) {
  const parts = [
    record.stage2?.visual_summary,
    record.stage2?.structured_caption,
    record.visual_summary,
    record.structured_caption,
    record.free_text?.visual_summary,
    record.free_text?.structured_caption
  ];

  return normalizeWhitespace(parts.filter(Boolean).join(" "));
}

function detectCategoryMismatch(record = {}) {
  const levels = [...(record.a_level || []), ...(record.b_level || []), ...(record.c_level || [])];
  const seatingType = String(record.seating_type || record.stage1?.seating_type || "").trim();
  if (!seatingType) {
    return null;
  }

  for (const rule of PARENT_CATEGORY_RULES) {
    if (!rule.match(levels)) {
      continue;
    }
    if (!rule.allowed.has(seatingType)) {
      return {
        key: "parent_category_mismatch",
        weight: 4,
        description: `Parent category mismatch: ${rule.label} vs ${seatingType}`,
        detail: `${rule.label} vs ${seatingType}`
      };
    }
  }

  return null;
}

function scoreRecord(record = {}) {
  const text = collectText(record);
  const firedSignals = [];
  let score = 0;

  for (const rule of SIGNAL_RULES) {
    if (!rule.test(text)) {
      continue;
    }
    firedSignals.push({
      key: rule.key,
      weight: rule.weight,
      description: rule.description
    });
    score += rule.weight;
  }

  const mismatchSignal = detectCategoryMismatch(record);
  if (mismatchSignal) {
    firedSignals.push(mismatchSignal);
    score += mismatchSignal.weight;
  }

  const primarySummary = normalizeWhitespace(
    record.stage2?.visual_summary ||
    record.free_text?.visual_summary ||
    record.visual_summary ||
    ""
  );

  return {
    image_id: record.image_id,
    product_id: record.product_id,
    product_name: record.product_name || record.name || "",
    parent_category: (record.b_level || []).join(" | "),
    seating_type: String(record.seating_type || record.stage1?.seating_type || "").trim(),
    score,
    signals: firedSignals,
    signal_keys: firedSignals.map((signal) => signal.key),
    summary: truncateText(primarySummary)
  };
}

function buildHistogram(scored = []) {
  const buckets = {
    "0": 0,
    "1-2": 0,
    "3-4": 0,
    "5+": 0
  };

  for (const entry of scored) {
    if (entry.score === 0) buckets["0"] += 1;
    else if (entry.score <= 2) buckets["1-2"] += 1;
    else if (entry.score <= 4) buckets["3-4"] += 1;
    else buckets["5+"] += 1;
  }

  return buckets;
}

function printTopCandidates(candidates = []) {
  const preview = candidates.slice(0, TERMINAL_PREVIEW_COUNT).map((entry, index) => ({
    rank: index + 1,
    image_id: entry.image_id,
    product_name: entry.product_name,
    parent_category: entry.parent_category,
    seating_type: entry.seating_type,
    score: entry.score,
    signals: entry.signals.map((signal) => `${signal.key}(+${signal.weight})`),
    summary: entry.summary
  }));

  console.log(JSON.stringify(preview, null, 2));
}

async function main() {
  const index = JSON.parse(await fs.readFile(INDEX_PATH, "utf8"));
  const scanned = (index.images || []).filter((record) =>
    String(record.stage_0_result || "").trim() === "product" && record.excluded !== true
  );

  const scored = scanned
    .map(scoreRecord)
    .sort((a, b) => b.score - a.score || a.image_id.localeCompare(b.image_id));

  const histogram = buildHistogram(scored);
  const topCandidates = scored.slice(0, TOP_N);

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify({
    generated_at: new Date().toISOString(),
    image_index_path: INDEX_PATH,
    total_product_images_scanned: scanned.length,
    histogram,
    top_candidates: topCandidates
  }, null, 2)}\n`);

  console.log(`Scanned product images: ${scanned.length}`);
  console.log("Histogram:");
  console.log(JSON.stringify(histogram, null, 2));
  console.log(`Top ${Math.min(TERMINAL_PREVIEW_COUNT, topCandidates.length)} candidates:`);
  printTopCandidates(topCandidates);
  console.log(`Saved full ranked list to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
