#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { searchIndex } from "../src/search.js";
import {
  embedText,
  getEffectiveClassification,
  getAllCategoryTerms,
  getCategoryDisplayLabel,
  getImageIndexPath,
  getLeafCategories,
  readJson
} from "../src/utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const OUTPUT_PATH = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.join(ROOT_DIR, "tmp", "pr1a-snapshot.json");
const NORMALIZED_PATH = path.join(ROOT_DIR, "data", "normalized-catalog.json");

const searchCases = [
  {
    id: "work-chair-scene-coverage",
    query: "minimal task chair with continuous upholstered shell low integrated arms and casters",
    seatingType: "task_collab_chair",
    selectedBullets: []
  },
  {
    id: "lounge-chair-soft",
    query: "soft lounge chair with exposed wood base and rounded upholstered back",
    seatingType: "lounge_chair",
    selectedBullets: []
  },
  {
    id: "guest-chair-upholstered",
    query: "guest chair with upholstered seat and wood base",
    seatingType: "guest_chair",
    selectedBullets: []
  },
  {
    id: "stool-metal-base",
    query: "upholstered stool with metal base and foot ring",
    seatingType: "stool",
    selectedBullets: []
  },
  {
    id: "outdoor-chair",
    query: "outdoor lounge chair with weather resistant frame and relaxed profile",
    seatingType: "outdoor_seating",
    selectedBullets: []
  },
  {
    id: "wood-shell-chair",
    query: "wood shell chair with upholstered seat",
    seatingType: "guest_chair",
    selectedBullets: []
  }
];

function summarizeResults(results = [], limit = 10) {
  return results.slice(0, limit).map((item, index) => ({
    rank: index + 1,
    product_id: item.product_id,
    name: item.name,
    score: Number(Number(item.score || 0).toFixed(6)),
    best_image_url: item.best_image_url || "",
    hero_image_id: item.hero_image?.image_id || "",
    hero_image_url: item.hero_image?.image_url || ""
  }));
}

function getEmbeddingDimensions(index) {
  const sampleRecord = (index?.images || []).find((record) =>
    Array.isArray(record.search_text_embedding) && record.search_text_embedding.length
  ) || (index?.images || []).find((record) =>
    Array.isArray(record.visual_summary_embedding) && record.visual_summary_embedding.length
  );
  return sampleRecord?.search_text_embedding?.length || sampleRecord?.visual_summary_embedding?.length || 192;
}

async function runSearchSnapshots(index) {
  const snapshots = [];
  const embeddingDimensions = getEmbeddingDimensions(index);
  for (const testCase of searchCases) {
    const imageAnalysis = testCase.seatingType
      ? { stage1: { seating_type: testCase.seatingType } }
      : null;
    const queryEmbedding = embedText(testCase.query, embeddingDimensions);
    const response = await searchIndex({
      query: testCase.query,
      parsed: {
        category: null,
        brand: null,
        visual_query: "",
        query_traits: null
      },
      index,
      imageAnalysis,
      selectedBullets: testCase.selectedBullets,
      queryEmbedding,
      rerankerEnabled: false,
      apiKey: process.env.OPENAI_API_KEY
    });

    snapshots.push({
      id: testCase.id,
      query: testCase.query,
      seating_type: testCase.seatingType,
      top_results: summarizeResults(response.results, 10)
    });
  }
  return snapshots;
}

async function runBrowseSnapshot(index) {
  const catalog = await readJson(NORMALIZED_PATH);
  const indexedByProductId = new Map();
  for (const image of index?.images || []) {
    if (!indexedByProductId.has(image.product_id)) {
      indexedByProductId.set(image.product_id, []);
    }
    indexedByProductId.get(image.product_id).push(image);
  }

  const products = (catalog?.products || [])
    .map((product) => {
      const indexedImages = indexedByProductId.get(product.product_id) || [];
      const passingImages = indexedImages.filter((image) => getEffectiveClassification(image) === "product");
      const browseImages = indexedImages.length ? indexedImages : [];
      const heroImage = passingImages[0] || browseImages[0] || null;
      const imageUrls = (product.image_urls || []).filter(Boolean);
      return {
        product_id: product.product_id,
        name: product.product_name || product.name,
        brand: product.brand,
        category: getCategoryDisplayLabel(product),
        category_tags: getLeafCategories(product),
        filter_categories: getAllCategoryTerms(product),
        ai_refreshed_at: String(
          heroImage?.ai_refreshed_at ||
          heroImage?.extraction_timestamp ||
          heroImage?.generated_at ||
          ""
        ).trim(),
        best_image_url: heroImage?.image_url || imageUrls[0] || "",
        hero_image: heroImage
          ? {
              image_id: heroImage.image_id,
              image_url: heroImage.image_url
            }
          : null
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.brand.localeCompare(b.brand));

  return {
    total_results: products.length,
    top_results: summarizeResults(products, 25)
  };
}

async function main() {
  const indexPath = getImageIndexPath();
  const index = await readJson(indexPath);
  if (!index?.images?.length) {
    throw new Error(`Image index not found or empty at ${indexPath}`);
  }

  const snapshot = {
    generated_at: new Date().toISOString(),
    image_index_path: indexPath,
    search_cases: await runSearchSnapshots(index),
    browse_case: await runBrowseSnapshot(index)
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(snapshot, null, 2));
  console.log(OUTPUT_PATH);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
