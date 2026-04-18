#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const INDEX_PATH = path.join(ROOT_DIR, "data", "image-index.json");
const OUTPUT_PATH = path.join(ROOT_DIR, "tmp", "category-mismatch-scan.json");

const CATEGORY_RULES = [
  {
    categories: ["Lounge Seating"],
    allowed: new Set(["lounge_chair", "sofa", "outdoor_lounge", "ottoman", "bench"])
  },
  {
    categories: ["Guest Seating", "Multi-use Seating", "Multi-use Guest Chairs"],
    allowed: new Set(["guest_chair", "stacking_nesting", "folding"])
  },
  {
    categories: ["Task Seating", "Office Chairs", "Executive Seating", "Executive Chairs", "Workplace"],
    allowed: new Set(["task_collab_chair"])
  },
  {
    categories: ["Stools", "Fixed-height Stools"],
    allowed: new Set(["stool"])
  },
  {
    categories: ["Benches", "Bench Seating"],
    allowed: new Set(["bench"])
  },
  {
    categories: ["Ottomans"],
    allowed: new Set(["ottoman"])
  },
  {
    categories: ["Outdoor Seating"],
    allowed: new Set(["lounge_chair", "guest_chair", "bench", "ottoman", "outdoor_lounge"])
  }
];

const CATEGORY_LOOKUP = new Map(
  CATEGORY_RULES.flatMap((rule) => rule.categories.map((category) => [category, rule.allowed]))
);

function normalizeWhitespace(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getPrimaryCategory(record = {}) {
  const bLevel = Array.isArray(record.b_level) ? record.b_level.map((value) => normalizeWhitespace(value)).filter(Boolean) : [];
  if (bLevel.length) {
    return bLevel[0];
  }
  const aLevel = Array.isArray(record.a_level) ? record.a_level.map((value) => normalizeWhitespace(value)).filter(Boolean) : [];
  return aLevel[0] || "";
}

function getSeatingType(record = {}) {
  return normalizeWhitespace(record.stage1?.seating_type || record.seating_type || "");
}

function createPairKey(category = "", seatingType = "") {
  return `${category} -> ${seatingType}`;
}

async function main() {
  const index = JSON.parse(await fs.readFile(INDEX_PATH, "utf8"));
  const scanned = (index.images || []).filter((record) =>
    String(record.stage_0_result || "").trim() === "product" && record.excluded !== true
  );

  let matches = 0;
  let mismatches = 0;
  let unmappedCategoryCount = 0;

  const mismatchEntries = [];
  const mismatchBreakdown = new Map();
  const topExamples = new Map();

  for (const record of scanned) {
    const primaryCategory = getPrimaryCategory(record);
    const seatingType = getSeatingType(record);

    if (!primaryCategory || !CATEGORY_LOOKUP.has(primaryCategory)) {
      unmappedCategoryCount += 1;
      continue;
    }

    if (!seatingType || seatingType === "other_seating") {
      matches += 1;
      continue;
    }

    const allowed = CATEGORY_LOOKUP.get(primaryCategory);
    if (allowed.has(seatingType)) {
      matches += 1;
      continue;
    }

    mismatches += 1;
    const pairKey = createPairKey(primaryCategory, seatingType);
    mismatchBreakdown.set(pairKey, (mismatchBreakdown.get(pairKey) || 0) + 1);

    if (!topExamples.has(pairKey)) {
      topExamples.set(pairKey, []);
    }
    if (topExamples.get(pairKey).length < 5) {
      topExamples.get(pairKey).push({
        image_id: record.image_id,
        product_name: record.product_name || record.name || ""
      });
    }

    mismatchEntries.push({
      image_id: record.image_id,
      product_id: record.product_id,
      product_name: record.product_name || record.name || "",
      b_level: record.b_level || [],
      seating_type: seatingType,
      image_url: record.image_url
    });
  }

  const sortedBreakdown = [...mismatchBreakdown.entries()]
    .map(([pair, count]) => ({ pair, count }))
    .sort((a, b) => b.count - a.count || a.pair.localeCompare(b.pair));

  const top15 = sortedBreakdown.slice(0, 15);
  const top3Examples = top15.slice(0, 3).map((entry) => ({
    pair: entry.pair,
    count: entry.count,
    examples: topExamples.get(entry.pair) || []
  }));

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify({
    generated_at: new Date().toISOString(),
    image_index_path: INDEX_PATH,
    total_product_images_scanned: scanned.length,
    total_matches: matches,
    total_mismatches: mismatches,
    total_unmapped_categories: unmappedCategoryCount,
    mismatch_breakdown: sortedBreakdown,
    mismatches: mismatchEntries
  }, null, 2)}\n`);

  console.log(`Total product images scanned: ${scanned.length}`);
  console.log(`Total matches: ${matches}`);
  console.log(`Total mismatches: ${mismatches}`);
  console.log(`Total with unmapped DP categories: ${unmappedCategoryCount}`);
  console.log("Top 15 mismatch pairs:");
  console.log(JSON.stringify(top15, null, 2));
  console.log("Examples for top 3 mismatch pairs:");
  console.log(JSON.stringify(top3Examples, null, 2));
  console.log(`Saved full mismatch list to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
