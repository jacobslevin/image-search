#!/usr/bin/env node
import path from "node:path";

import { generateCaption } from "../src/captioning.js";
import { normalizeCatalog } from "../src/catalog.js";
import { DATA_DIR, readJson, writeJson } from "../src/utils.js";

const args = process.argv.slice(2);
const providerArgIndex = args.indexOf("--provider");
const maxImagesArgIndex = args.indexOf("--max-images");
const categoryArgIndex = args.indexOf("--category");
const categoriesArgIndex = args.indexOf("--categories");
const brandArgIndex = args.indexOf("--brand");
const nameArgIndex = args.indexOf("--name");
const startArgIndex = args.indexOf("--start");
const maxProductsArgIndex = args.indexOf("--max-products");
const imagesPerProductArgIndex = args.indexOf("--images-per-product");
const appendFlag = args.includes("--append");
const replaceFlag = args.includes("--replace");
const seatingOnlyFlag = args.includes("--seating-only");
const provider = providerArgIndex >= 0
  ? args[providerArgIndex + 1]
  : process.env.CAPTION_PROVIDER || (process.env.OPENAI_API_KEY ? "openai" : "demo");
const maxImages = maxImagesArgIndex >= 0 ? Number(args[maxImagesArgIndex + 1]) : null;
const categoryFilter = categoryArgIndex >= 0 ? String(args[categoryArgIndex + 1] || "") : "";
const categoryFilters = categoriesArgIndex >= 0
  ? String(args[categoriesArgIndex + 1] || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  : [];
const brandFilter = brandArgIndex >= 0 ? String(args[brandArgIndex + 1] || "") : "";
const nameFilter = nameArgIndex >= 0 ? String(args[nameArgIndex + 1] || "") : "";
const startIndex = startArgIndex >= 0 ? Number(args[startArgIndex + 1]) : 0;
const maxProducts = maxProductsArgIndex >= 0 ? Number(args[maxProductsArgIndex + 1]) : null;
const imagesPerProduct = imagesPerProductArgIndex >= 0 ? Number(args[imagesPerProductArgIndex + 1]) : null;
const seatingCategoryTerms = ["seating", "chair", "chairs", "stool", "stools", "bench"];

const normalizedPath = path.join(DATA_DIR, "normalized-catalog.json");
const indexPath = path.join(DATA_DIR, "image-index.json");

let catalog = await readJson(normalizedPath);
if (!catalog) {
  catalog = await normalizeCatalog(path.resolve("Product Data with Images"));
  await writeJson(normalizedPath, catalog);
}

let images = catalog.images
  .filter((image) => {
    if (
      seatingOnlyFlag &&
      !seatingCategoryTerms.some((term) => image.category.toLowerCase().includes(term))
    ) {
      return false;
    }
    if (categoryFilter && !image.category.toLowerCase().includes(categoryFilter.toLowerCase())) {
      return false;
    }
    if (categoryFilters.length && !categoryFilters.some((term) => image.category.toLowerCase().includes(term))) {
      return false;
    }
    if (brandFilter && !image.brand.toLowerCase().includes(brandFilter.toLowerCase())) {
      return false;
    }
    if (nameFilter && !image.name.toLowerCase().includes(nameFilter.toLowerCase())) {
      return false;
    }
    return true;
  })
  .slice(startIndex, startIndex + (maxImages || catalog.images.length));

if (maxProducts || imagesPerProduct) {
  const selectedProductIds = new Set();
  const perProductCounts = new Map();
  const filteredImages = [];

  for (const image of images) {
    const currentCount = perProductCounts.get(image.product_id) || 0;

    if (!selectedProductIds.has(image.product_id)) {
      if (maxProducts && selectedProductIds.size >= maxProducts) {
        continue;
      }
      selectedProductIds.add(image.product_id);
    }

    if (imagesPerProduct && currentCount >= imagesPerProduct) {
      continue;
    }

    filteredImages.push(image);
    perProductCounts.set(image.product_id, currentCount + 1);
  }

  images = filteredImages;
}
const indexedImages = [];
const existingIndex = !replaceFlag ? await readJson(indexPath) : null;

if (provider !== "openai" || !process.env.OPENAI_API_KEY) {
  throw new Error("Indexing now requires provider=openai and OPENAI_API_KEY so visual_summary embeddings can be stored.");
}

console.log(
  `Indexing ${images.length} images with provider=${provider}${appendFlag ? " append" : ""}${seatingOnlyFlag ? " seating-only" : ""}${categoryFilter ? ` category=${categoryFilter}` : ""}${categoryFilters.length ? ` categories=${categoryFilters.join("|")}` : ""}${startIndex ? ` start=${startIndex}` : ""}${maxProducts ? ` maxProducts=${maxProducts}` : ""}${imagesPerProduct ? ` imagesPerProduct=${imagesPerProduct}` : ""}`
);
for (let index = 0; index < images.length; index += 1) {
  const image = images[index];
  const generated = await generateCaption(image, {
    provider,
    apiKey: process.env.OPENAI_API_KEY,
    visionModel: process.env.VISION_MODEL
  });

  indexedImages.push({
    ...image,
    stage1: {
      seating_type: generated.stage1?.seating_type || generated.seating_type || "other_seating"
    },
    stage2: {
      visual_summary: generated.stage2?.visual_summary || ""
    },
    structured_caption: generated.structured_caption,
    raw_visual_highlights: generated.raw_visual_highlights || [],
    visual_summary: generated.stage2?.visual_summary || "",
    visual_highlights: generated.visual_highlights,
    seating_type: generated.seating_type || "other_seating",
    image_traits: generated.image_traits || {},
    spec_traits: generated.spec_traits || {},
    merged_traits: generated.merged_traits || {},
    trait_provenance: generated.trait_provenance || {},
    visual_traits: generated.visual_traits,
    caption_embedding: generated.caption_embedding,
    visual_description_embedding: generated.visual_description_embedding,
    visual_summary_embedding: generated.visual_summary_embedding,
    caption_model_version: generated.caption_model_version,
    embedding_model_version: generated.embedding_model_version
  });

  if ((index + 1) % 50 === 0 || index === images.length - 1) {
    console.log(`Indexed ${index + 1}/${images.length} images`);
  }
}

const mergedImageMap = new Map();

if (appendFlag && existingIndex?.images?.length) {
  for (const image of existingIndex.images) {
    mergedImageMap.set(image.image_id || image.image_url, image);
  }
}

for (const image of indexedImages) {
  mergedImageMap.set(image.image_id || image.image_url, image);
}

const mergedImages = [...mergedImageMap.values()];
const indexedBrands = [...new Set(mergedImages.map((image) => image.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b));
const indexedCategories = [...new Set(mergedImages.map((image) => image.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
const indexedProducts = new Set(mergedImages.map((image) => image.product_id)).size;

const output = {
  generated_at: new Date().toISOString(),
  provider,
  totals: {
    products: indexedProducts,
    images: mergedImages.length
  },
  brands: indexedBrands.length ? indexedBrands : catalog.brands,
  categories: indexedCategories.length ? indexedCategories : catalog.categories,
  images: mergedImages
};

await writeJson(indexPath, output);
console.log(`Wrote ${indexPath} with ${mergedImages.length} images across ${indexedProducts} products`);
