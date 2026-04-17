#!/usr/bin/env node
import fs from "node:fs";

import { aggregateCaptionResults, evaluateImageCandidates, generateCaption } from "../src/captioning.js";

const PRODUCT_LIMIT = 5;

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required.");
}

const catalog = JSON.parse(fs.readFileSync("data/normalized-catalog.json", "utf8"));
const imageIndex = JSON.parse(fs.readFileSync("data/image-index.json", "utf8"));

const products = (catalog.products || []).slice(0, PRODUCT_LIMIT);
const imagesByProductId = new Map();
for (const image of catalog.images || []) {
  if (!imagesByProductId.has(image.product_id)) {
    imagesByProductId.set(image.product_id, []);
  }
  imagesByProductId.get(image.product_id).push(image);
}

const stage0ByProductId = new Map();
for (const record of imageIndex.images || []) {
  if (!record?.product_id || stage0ByProductId.has(record.product_id)) continue;
  stage0ByProductId.set(record.product_id, Array.isArray(record.scene_filter_results) ? record.scene_filter_results : []);
}

function confidenceLabelFromFraction(value) {
  const numeric = Number(value || 0);
  if (numeric >= 0.9999) return "high";
  if (numeric >= 0.5) return "medium";
  return "low";
}

const results = [];
let totalProductCost = 0;
let totalImageCost = 0;
let totalPassingImages = 0;
let tiebreakerProducts = 0;

for (const product of products) {
  const productImages = imagesByProductId.get(product.product_id) || [];
  const sceneResults = stage0ByProductId.get(product.product_id) || [];
  const stage0Map = new Map(
    sceneResults
      .filter((entry) => entry?.image_url && (entry.result === "product" || entry.result === "scene"))
      .map((entry) => [String(entry.image_url), String(entry.result)])
  );
  const stage0ProductImages = productImages.filter((image) => stage0Map.get(image.image_url) === "product");
  const evaluation = await evaluateImageCandidates(stage0ProductImages, { logFailures: false });
  const passingAttempts = evaluation.attempts.filter((attempt) => attempt.passed);

  const generatedEntries = [];
  for (const attempt of passingAttempts) {
    const generated = await generateCaption(attempt.image, {
      provider: "openai",
      apiKey: process.env.OPENAI_API_KEY,
      visionModel: "gpt-4.1",
      extractionRuns: 3,
      precomputedImageDimensions: attempt.dimensions
    });
    generatedEntries.push({
      image: attempt.image,
      generated
    });
  }

  const aggregate = generatedEntries.length ? aggregateCaptionResults(generatedEntries) : null;
  const totalUsage = generatedEntries.reduce((acc, entry) => {
    const usage = entry.generated?.extraction_consensus?.total_usage || {};
    acc.prompt_tokens += Number(usage.prompt_tokens || 0);
    acc.completion_tokens += Number(usage.completion_tokens || 0);
    acc.total_tokens += Number(usage.total_tokens || 0);
    acc.estimated_cost_usd += Number(usage.estimated_cost_usd || 0);
    return acc;
  }, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, estimated_cost_usd: 0 });
  const tiebreakerNeeded = generatedEntries.some((entry) => entry.generated?.extraction_consensus?.tiebreaker_used);

  totalProductCost += totalUsage.estimated_cost_usd;
  totalImageCost += totalUsage.estimated_cost_usd;
  totalPassingImages += passingAttempts.length;
  if (tiebreakerNeeded) tiebreakerProducts += 1;

  const enumFieldConfidence = {};
  for (const [field, value] of Object.entries(aggregate?.field_confidence?.image_traits || {})) {
    enumFieldConfidence[field] = {
      score: Number(value || 0),
      label: confidenceLabelFromFraction(value)
    };
  }

  results.push({
    product_id: product.product_id,
    product_name: product.name,
    stage0_product_image_count: stage0ProductImages.length,
    extracted_image_count: passingAttempts.length,
    free_text_from_run1: aggregate ? {
      silhouette: aggregate.stage2?.silhouette || "",
      proportions: aggregate.stage2?.proportions || "",
      structure_type: aggregate.stage2?.structure_type || "",
      back_geometry: aggregate.stage2?.back_geometry || "",
      seat_geometry: aggregate.stage2?.seat_geometry || "",
      arm_geometry: aggregate.stage2?.arm_geometry || "",
      surface_language: aggregate.stage2?.surface_language || "",
      distinctive_elements: aggregate.stage2?.distinctive_elements || [],
      visual_summary: aggregate.stage2?.visual_summary || "",
      structured_caption: aggregate.structured_caption || "",
      raw_visual_highlights: aggregate.raw_visual_highlights || []
    } : null,
    final_consensus_enum_fields: aggregate ? Object.fromEntries(
      Object.entries(aggregate.image_traits || {}).map(([field, value]) => [field, {
        value,
        confidence: enumFieldConfidence[field] || { score: 0, label: "low" }
      }])
    ) : {},
    tiebreaker_needed: tiebreakerNeeded,
    total_usage: totalUsage
  });
}

const summary = {
  average_cost_per_product: results.length ? Number((totalProductCost / results.length).toFixed(6)) : 0,
  average_cost_per_image: totalPassingImages ? Number((totalImageCost / totalPassingImages).toFixed(6)) : 0,
  products_needing_tiebreaker: tiebreakerProducts
};

console.log(JSON.stringify({ products: results, summary }, null, 2));
