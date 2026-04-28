#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

import { classifyImageStage0Only, extractStage23CombinedOpenAi } from "../src/captioning.js";
import { getEffectiveExtractionImageCap, getPixelSeekType } from "../src/utils.js";

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const INDEX_PATH = path.join(ROOT_DIR, "data", "image-index.json");
const CATALOG_PATH = path.join(ROOT_DIR, "data", "normalized-catalog.json");
const SEATING_TYPES_PATH = path.join(ROOT_DIR, "data", "seating-types.json");
const OUTPUT_PATH = path.join(ROOT_DIR, "data", "stability-test-results.json");

const TYPE_KEYS = ["lounge_chair", "task_collab_chair", "guest_chair", "stool", "bench"];
const SAMPLE_SIZE_PER_TYPE = 8;
const DEFAULT_SEED = Number(process.env.STABILITY_SEED || 20260427);
const PIXELSEEK_TYPE_TO_ROUTING_KEY = Object.freeze({
  "Lounge Seating": "lounge_chair",
  "Multi-Use / Guest Chairs": "guest_chair",
  "Work Chairs": "task_collab_chair",
  "Stools": "stool",
  "Benches": "bench"
});

const CASCADE_TRAITS_BY_TYPE = {
  lounge_chair: ["configuration", "back_height", "arm_option"],
  task_collab_chair: ["base_type"],
  guest_chair: ["base_type"],
  stool: ["seat_geometry", "back", "base_type"],
  bench: ["configuration", "back_height"]
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeWhitespace(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeForCompare(value = "") {
  return normalizeWhitespace(value).toLowerCase();
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function rand() {
    t += 0x6d2b79f5;
    let result = Math.imul(t ^ (t >>> 15), 1 | t);
    result ^= result + Math.imul(result ^ (result >>> 7), 61 | result);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, seed) {
  const items = [...list];
  const rand = mulberry32(seed);
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rand() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

function tokenize(value = "") {
  return normalizeForCompare(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function tokenJaccard(a = "", b = "") {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (!setA.size && !setB.size) return 1;
  const intersection = [...setA].filter((token) => setB.has(token)).length;
  const union = new Set([...setA, ...setB]).size || 1;
  return Number((intersection / union).toFixed(4));
}

function extractCategoryNoun(visualSummary = "", categories = []) {
  const normalizedSummary = normalizeForCompare(visualSummary);
  const firstSentence = normalizedSummary.split(/\.(?:\s|$)/)[0] || normalizedSummary;
  const leadWindow = firstSentence.split(/\s+/).slice(0, 10).join(" ");
  const orderedCategories = [...categories]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (const category of orderedCategories) {
    const normalizedCategory = normalizeForCompare(category);
    const leadPattern = new RegExp(`\\b${escapeRegExp(normalizedCategory)}\\b`, "i");
    if (leadPattern.test(leadWindow)) {
      return category;
    }
  }

  return "";
}

function escapeRegExp(value = "") {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function summarizeTraitMatches(run1Traits = {}, run2Traits = {}, relevantTraits = []) {
  const comparisons = relevantTraits.map((field) => {
    const run1Value = String(run1Traits?.[field] || "unknown");
    const run2Value = String(run2Traits?.[field] || "unknown");
    return {
      field,
      run_1: run1Value,
      run_2: run2Value,
      match: run1Value === run2Value
    };
  });
  const matched = comparisons.filter((entry) => entry.match).length;
  return {
    comparisons,
    matched,
    total: comparisons.length
  };
}

function assessProseSimilarity({
  categoryMatch = false,
  traitMatchCount = 0,
  traitCount = 0,
  run1Summary = "",
  run2Summary = ""
} = {}) {
  const similarity = tokenJaccard(run1Summary, run2Summary);
  const allTraitsMatch = traitCount > 0 && traitMatchCount === traitCount;

  if (!categoryMatch || (traitCount > 0 && traitMatchCount / traitCount < 0.6)) {
    return {
      rating: "meaningful divergence",
      reason: `Category or cascade traits diverged; token overlap ${similarity}.`
    };
  }

  if (allTraitsMatch && similarity >= 0.45) {
    return {
      rating: "stable",
      reason: `Category and cascade traits matched; wording stayed closely aligned (token overlap ${similarity}).`
    };
  }

  return {
    rating: "minor variation",
    reason: `Category stayed fixed but phrasing or a lower-signal trait shifted slightly (token overlap ${similarity}).`
  };
}

function buildCatalogContext(record = {}) {
  const categories = [
    ...(Array.isArray(record.a_level) ? record.a_level : []),
    ...(Array.isArray(record.b_level) ? record.b_level : []),
    ...(Array.isArray(record.c_level) ? record.c_level : [])
  ];

  return `Catalog context: name="${record.product_name || record.name || ""}", brand="${record.brand || ""}", categories="${categories.join(" | ")}".`;
}

function buildSamplePool(index) {
  const pool = new Map();
  for (const image of index.images || []) {
    if (image.excluded) continue;
    const stage0Result = String(image.stage_0_result || "").trim().toLowerCase();
    const effectiveClassification = String(image.effective_classification || "").trim().toLowerCase();
    if (effectiveClassification !== "product" && stage0Result !== "product") continue;

    const typeKey = String(image.seating_type || "").trim();
    const productId = String(image.product_id || "").trim();
    if (!TYPE_KEYS.includes(typeKey) || !productId) continue;

    const key = `${typeKey}::${productId}`;
    if (!pool.has(key)) {
      pool.set(key, {
        type_key: typeKey,
        product_id: productId,
        product_name: image.product_name || image.name || "",
        brand: image.brand || "",
        source_record: image
      });
    }
  }
  return [...pool.values()];
}

function pickSamples(index, seed) {
  const pool = buildSamplePool(index);
  const selected = [];

  for (const [typeIndex, typeKey] of TYPE_KEYS.entries()) {
    const candidates = pool.filter((entry) => entry.type_key === typeKey);
    const shuffled = shuffle(candidates, seed + typeIndex);
    const slice = shuffled.slice(0, SAMPLE_SIZE_PER_TYPE);
    if (slice.length !== SAMPLE_SIZE_PER_TYPE) {
      throw new Error(`Expected ${SAMPLE_SIZE_PER_TYPE} products for ${typeKey}, found ${slice.length}.`);
    }
    selected.push(...slice);
  }

  return selected;
}

function buildTypeSummary(typeKey, records) {
  const categoryMatches = records.filter((entry) => entry.stability.category_noun_match).length;
  const traitMatches = records.reduce((sum, entry) => sum + entry.stability.structured_trait_match.matched, 0);
  const traitTotal = records.reduce((sum, entry) => sum + entry.stability.structured_trait_match.total, 0);
  const proseCounts = {
    stable: 0,
    minor_variation: 0,
    meaningful_divergence: 0
  };

  for (const entry of records) {
    if (entry.stability.prose_similarity.rating === "stable") proseCounts.stable += 1;
    else if (entry.stability.prose_similarity.rating === "minor variation") proseCounts.minor_variation += 1;
    else proseCounts.meaningful_divergence += 1;
  }

  const instabilityPatterns = [];
  const categoryDrift = records.filter((entry) => !entry.stability.category_noun_match);
  if (categoryDrift.length) {
    instabilityPatterns.push(`${categoryDrift.length} products changed category noun across runs.`);
  }
  const traitDrift = records.filter((entry) => entry.stability.structured_trait_match.matched !== entry.stability.structured_trait_match.total);
  if (traitDrift.length) {
    const fields = new Map();
    for (const entry of traitDrift) {
      for (const comparison of entry.stability.structured_trait_match.comparisons) {
        if (!comparison.match) {
          fields.set(comparison.field, (fields.get(comparison.field) || 0) + 1);
        }
      }
    }
    const topFields = [...fields.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([field, count]) => `${field} (${count})`)
      .slice(0, 3);
    if (topFields.length) {
      instabilityPatterns.push(`Most trait drift was in ${topFields.join(", ")}.`);
    }
  }

  return {
    type_key: typeKey,
    sample_size: records.length,
    category_noun_stability: {
      matched_products: categoryMatches,
      total_products: records.length
    },
    trait_stability: {
      matched_fields: traitMatches,
      total_fields: traitTotal,
      match_rate: traitTotal ? Number((traitMatches / traitTotal).toFixed(4)) : 0
    },
    prose_stability: proseCounts,
    instability_patterns: instabilityPatterns
  };
}

function buildCrossTypeSummary(typeSummaries = []) {
  const rankedByCategory = [...typeSummaries].sort((a, b) => {
    const aRate = a.category_noun_stability.total_products
      ? a.category_noun_stability.matched_products / a.category_noun_stability.total_products
      : 0;
    const bRate = b.category_noun_stability.total_products
      ? b.category_noun_stability.matched_products / b.category_noun_stability.total_products
      : 0;
    if (bRate !== aRate) return bRate - aRate;
    return b.trait_stability.match_rate - a.trait_stability.match_rate;
  });

  return {
    most_stable_type: rankedByCategory[0]?.type_key || "",
    most_drift_type: rankedByCategory[rankedByCategory.length - 1]?.type_key || ""
  };
}

async function withRetries(task, label, attempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) {
        break;
      }
      console.warn(`[retry] ${label} failed on attempt ${attempt}/${attempts}: ${error?.message || error}`);
      await sleep(attempt * 2000);
    }
  }
  throw lastError;
}

function buildCatalogMaps(catalog) {
  const productsById = new Map();
  const imagesByProductId = new Map();

  for (const product of catalog.products || []) {
    productsById.set(String(product.product_id || ""), product);
  }

  for (const image of catalog.images || []) {
    const productId = String(image.product_id || "");
    if (!imagesByProductId.has(productId)) {
      imagesByProductId.set(productId, []);
    }
    imagesByProductId.get(productId).push(image);
  }

  return { productsById, imagesByProductId };
}

async function selectPrimaryImage(sample, catalogMaps, options) {
  const catalogProduct = catalogMaps.productsById.get(sample.product_id);
  const productImages = catalogMaps.imagesByProductId.get(sample.product_id) || [];

  if (!catalogProduct || !productImages.length) {
    throw new Error(`Missing normalized-catalog images for ${sample.product_id} (${sample.product_name}).`);
  }

  const classificationEntries = [];
  let stage0CostUsd = 0;
  const skippedImageIds = [];
  for (const image of productImages) {
    const imageRecord = {
      ...image,
      product_name: catalogProduct.name || image.name || sample.product_name,
      name: catalogProduct.name || image.name || sample.product_name,
      brand: catalogProduct.brand || image.brand || sample.brand || "",
      a_level: catalogProduct.a_level || image.a_level || [],
      b_level: catalogProduct.b_level || image.b_level || [],
      c_level: catalogProduct.c_level || image.c_level || []
    };
    try {
      const stage0Payload = await withRetries(
        () => classifyImageStage0Only(imageRecord, options),
        `stage0 selection for ${sample.product_name} ${imageRecord.image_id || imageRecord.image_url}`,
        3
      );
      stage0CostUsd += Number(stage0Payload.estimated_cost_usd || 0);
      classificationEntries.push({
        image: imageRecord,
        stage0: stage0Payload
      });
    } catch (error) {
      skippedImageIds.push(imageRecord.image_id || imageRecord.image_url || "");
      console.warn(`[skip-image] ${sample.product_name} | ${imageRecord.image_id || imageRecord.image_url} | ${error?.message || error}`);
    }
  }

  const stage0PassingEntries = classificationEntries.filter(
    (entry) => String(entry.stage0?.stage0_result || "").trim().toLowerCase() === "product"
  );
  const pixelSeekType = getPixelSeekType(productImages[0]) || "";
  const routingType = PIXELSEEK_TYPE_TO_ROUTING_KEY[pixelSeekType] || sample.type_key;
  const effectiveCap = getEffectiveExtractionImageCap(routingType || sample.type_key);
  const selectedEntries = stage0PassingEntries.slice(0, effectiveCap);
  const primaryEntry = selectedEntries[0];

  if (!primaryEntry) {
    throw new Error(`No stage0-passing primary image found for ${sample.product_id} (${sample.product_name}).`);
  }

  return {
    primaryImage: primaryEntry.image,
    selection: {
      total_catalog_images: productImages.length,
      stage0_passing_images: stage0PassingEntries.length,
      effective_cap: effectiveCap,
      selected_image_ids: selectedEntries.map((entry) => entry.image.image_id || entry.image.image_url),
      skipped_image_ids: skippedImageIds,
      stage0_estimated_cost_usd: Number(stage0CostUsd.toFixed(6))
    }
  };
}

async function runSingleExtraction(imageRecord, sample, options) {
  return withRetries(
    () => extractStage23CombinedOpenAi(
      {
        image_url: imageRecord.image_url,
        catalogContext: buildCatalogContext(imageRecord)
      },
      sample.type_key,
      { result: "product", seating_type: sample.type_key, override_reason: null },
      options
    ),
    `stage23 extraction for ${sample.product_name} ${imageRecord.image_id || imageRecord.image_url}`,
    3
  );
}

function buildArtifact({
  seed,
  results,
  completedRuns,
  stage0SelectionCalls,
  estimatedCostUsd,
  stage0SelectionCostUsd
}) {
  const byType = Object.fromEntries(
    TYPE_KEYS.map((typeKey) => [
      typeKey,
      buildTypeSummary(typeKey, results.filter((entry) => entry.seating_type === typeKey))
    ])
  );

  return {
    generated_at: new Date().toISOString(),
    branch: process.env.GIT_BRANCH || "",
    seed,
    sample_size_per_type: SAMPLE_SIZE_PER_TYPE,
    total_products: results.length,
    total_stage23_extractions: completedRuns,
    total_stage0_selection_calls: stage0SelectionCalls,
    tiebreaker_bypassed: true,
    prompt_path: "normalized-catalog product path -> cap-aware stage0 selection -> extractStage23CombinedOpenAi -> combinedStage23Prompt(typeKey)",
    estimated_stage23_cost_usd: Number(estimatedCostUsd.toFixed(6)),
    estimated_stage0_selection_cost_usd: Number(stage0SelectionCostUsd.toFixed(6)),
    results,
    summary: {
      per_type: byType,
      cross_type: buildCrossTypeSummary(Object.values(byType))
    }
  };
}

async function run() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required.");
  }

  const index = readJson(INDEX_PATH);
  const catalog = readJson(CATALOG_PATH);
  const catalogMaps = buildCatalogMaps(catalog);
  const seatingTypes = readJson(SEATING_TYPES_PATH).types || {};
  const selectedSamples = pickSamples(index, DEFAULT_SEED);
  const existingArtifact = fs.existsSync(OUTPUT_PATH) ? readJson(OUTPUT_PATH) : null;
  const results = Array.isArray(existingArtifact?.results) ? [...existingArtifact.results] : [];
  let completedRuns = Number(existingArtifact?.total_stage23_extractions || 0);
  let estimatedCostUsd = Number(existingArtifact?.estimated_stage23_cost_usd || 0);
  let stage0SelectionCalls = Number(existingArtifact?.total_stage0_selection_calls || 0);
  let stage0SelectionCostUsd = Number(existingArtifact?.estimated_stage0_selection_cost_usd || 0);
  const completedProductIds = new Set(results.map((entry) => String(entry.product_id || "")));

  for (const [sampleIndex, sample] of selectedSamples.entries()) {
    if (completedProductIds.has(sample.product_id)) {
      console.log(`[resume-skip] ${sampleIndex + 1}/${selectedSamples.length} ${sample.type_key} | ${sample.product_name}`);
      continue;
    }

    const typeConfig = seatingTypes[sample.type_key] || {};
    const categories = Array.isArray(typeConfig.visual_summary_categories)
      ? typeConfig.visual_summary_categories
      : [];
    const relevantTraits = CASCADE_TRAITS_BY_TYPE[sample.type_key] || [];

    console.log(
      `[${sampleIndex + 1}/${selectedSamples.length}] ${sample.type_key} | ${sample.product_name}`
    );

    const selectionOptions = {
      apiKey,
      provider: "openai",
      visionModel: process.env.VISION_MODEL
    };
    const { primaryImage, selection } = await selectPrimaryImage(sample, catalogMaps, selectionOptions);
    stage0SelectionCalls += selection.total_catalog_images;
    stage0SelectionCostUsd += Number(selection.stage0_estimated_cost_usd || 0);

    const sharedOptions = {
      apiKey,
      provider: "openai",
      visionModel: process.env.VISION_MODEL,
      typeRoutingSource: "mapping_v1"
    };

    const run1 = await runSingleExtraction(primaryImage, sample, sharedOptions);
    completedRuns += 1;
    estimatedCostUsd += Number(run1.usage?.estimated_cost_usd || 0);
    const run2 = await runSingleExtraction(primaryImage, sample, sharedOptions);
    completedRuns += 1;
    estimatedCostUsd += Number(run2.usage?.estimated_cost_usd || 0);

    const run1Traits = run1.stage3?.image_traits || {};
    const run2Traits = run2.stage3?.image_traits || {};
    const run1Summary = String(run1.stage2?.visual_summary || "").trim();
    const run2Summary = String(run2.stage2?.visual_summary || "").trim();
    const run1Category = extractCategoryNoun(run1Summary, categories);
    const run2Category = extractCategoryNoun(run2Summary, categories);
    const traitSummary = summarizeTraitMatches(run1Traits, run2Traits, relevantTraits);
    const proseSimilarity = assessProseSimilarity({
      categoryMatch: Boolean(run1Category && run1Category === run2Category),
      traitMatchCount: traitSummary.matched,
      traitCount: traitSummary.total,
      run1Summary,
      run2Summary
    });

    results.push({
      product_id: sample.product_id,
      product_name: sample.product_name,
      seating_type: sample.type_key,
      image_reference: {
        image_id: primaryImage.image_id || "",
        image_url: primaryImage.image_url || ""
      },
      selection_path: {
        source: "normalized-catalog product path with cap-aware stage0 selection",
        ...selection
      },
      cascade_relevant_traits: relevantTraits,
      run_1: {
        visual_summary: run1Summary,
        category_noun: run1Category,
        structured_traits: Object.fromEntries(relevantTraits.map((field) => [field, String(run1Traits?.[field] || "unknown")])),
        usage: run1.usage || {}
      },
      run_2: {
        visual_summary: run2Summary,
        category_noun: run2Category,
        structured_traits: Object.fromEntries(relevantTraits.map((field) => [field, String(run2Traits?.[field] || "unknown")])),
        usage: run2.usage || {}
      },
      stability: {
        category_noun_match: Boolean(run1Category && run1Category === run2Category),
        structured_trait_match: traitSummary,
        prose_similarity: proseSimilarity
      }
    });

    writeJson(OUTPUT_PATH, buildArtifact({
      seed: DEFAULT_SEED,
      results,
      completedRuns,
      stage0SelectionCalls,
      estimatedCostUsd,
      stage0SelectionCostUsd
    }));
  }

  const artifact = buildArtifact({
    seed: DEFAULT_SEED,
    results,
    completedRuns,
    stage0SelectionCalls,
    estimatedCostUsd,
    stage0SelectionCostUsd
  });
  writeJson(OUTPUT_PATH, artifact);
  console.log(`Saved ${results.length} products / ${completedRuns} runs to ${OUTPUT_PATH}`);
}

run().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
