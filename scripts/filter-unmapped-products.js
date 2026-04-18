#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

import {
  DATA_DIR,
  buildImportSkipLogEntry,
  getAllCategoryTerms,
  getEffectiveClassification,
  getPixelSeekType,
  uniqueStrings,
  writeJson
} from "../src/utils.js";

const normalizedPath = path.join(DATA_DIR, "normalized-catalog.json");
const normalizedBackupPath = path.join(DATA_DIR, "normalized-catalog.pre-cleanup-backup.json");
const indexPath = path.join(DATA_DIR, "image-index.json");
const indexBackupPath = path.join(DATA_DIR, "image-index.pre-cleanup-backup.json");
const skipLogPath = path.join(DATA_DIR, "import-skipped-log.json");

const EXPECTED_REMOVED_PRODUCTS = 65;
const EXPECTED_REMOVED_IMAGES = 281;

function buildCatalogOutput(products = []) {
  const sortedProducts = [...products].sort((a, b) => {
    const brandCompare = String(a.brand || "").localeCompare(String(b.brand || ""));
    if (brandCompare) {
      return brandCompare;
    }
    return String(a.name || "").localeCompare(String(b.name || ""));
  });

  const images = [];
  for (const product of sortedProducts) {
    for (const [index, imageUrl] of (product.image_urls || []).entries()) {
      images.push({
        image_id: `${product.product_id}_img_${String(index + 1).padStart(3, "0")}`,
        product_id: product.product_id,
        name: product.name,
        brand: product.brand,
        a_level: product.a_level || [],
        b_level: product.b_level || [],
        c_level: product.c_level || [],
        image_url: imageUrl,
        source_file: product.source_file || ""
      });
    }
  }

  return {
    generated_at: new Date().toISOString(),
    totals: {
      products: sortedProducts.length,
      images: images.length
    },
    brands: uniqueStrings(sortedProducts.map((product) => product.brand)).sort((a, b) => a.localeCompare(b)),
    categories: uniqueStrings(sortedProducts.flatMap((product) => product.b_level || [])).sort((a, b) => a.localeCompare(b)),
    products: sortedProducts,
    images
  };
}

function buildIndexOutput(index = {}, products = [], images = []) {
  const indexedBrands = [...new Set(products.map((product) => product.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const indexedCategories = [...new Set(products.flatMap((product) => getAllCategoryTerms(product)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const searchableImages = images.filter((image) => getEffectiveClassification(image) === "product");

  return {
    ...index,
    generated_at: new Date().toISOString(),
    provider: index.provider || "openai",
    totals: {
      products: products.length,
      images: searchableImages.length
    },
    brands: indexedBrands,
    categories: indexedCategories,
    products,
    images
  };
}

async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

const [normalizedRaw, indexRaw] = await Promise.all([
  fs.readFile(normalizedPath, "utf8"),
  fs.readFile(indexPath, "utf8")
]);

await fs.writeFile(normalizedBackupPath, normalizedRaw);
await fs.writeFile(indexBackupPath, indexRaw);

const normalizedCatalog = JSON.parse(normalizedRaw);
const imageIndex = JSON.parse(indexRaw);
const timestamp = new Date().toISOString();

const catalogProducts = Array.isArray(normalizedCatalog.products) ? normalizedCatalog.products : [];
const skipProducts = [];
const keepProducts = [];

for (const product of catalogProducts) {
  if (getPixelSeekType(product) === "SKIP") {
    skipProducts.push(product);
  } else {
    keepProducts.push(product);
  }
}

const skipProductIds = new Set(skipProducts.map((product) => product.product_id).filter(Boolean));
const removedCatalogImages = (Array.isArray(normalizedCatalog.images) ? normalizedCatalog.images : [])
  .filter((image) => skipProductIds.has(image.product_id));
const nextCatalog = buildCatalogOutput(keepProducts);

const indexImages = Array.isArray(imageIndex.images) ? imageIndex.images : [];
const indexProducts = Array.isArray(imageIndex.products) ? imageIndex.products : [];
const removedIndexImages = indexImages.filter((image) => skipProductIds.has(image.product_id));
const keptIndexImages = indexImages.filter((image) => !skipProductIds.has(image.product_id));
const keptIndexProducts = indexProducts.filter((product) => !skipProductIds.has(product.product_id));

if (skipProducts.length !== EXPECTED_REMOVED_PRODUCTS || removedIndexImages.length !== EXPECTED_REMOVED_IMAGES) {
  throw new Error(
    `Cleanup counts mismatch. Expected ${EXPECTED_REMOVED_PRODUCTS} products and ${EXPECTED_REMOVED_IMAGES} images, got ${skipProducts.length} products and ${removedIndexImages.length} images.`
  );
}

const existingSkipLog = await readJsonFile(skipLogPath, []);
const retroactiveEntries = skipProducts.map((product) => buildImportSkipLogEntry(product, "retroactive_cleanup", timestamp));
const nextIndex = buildIndexOutput(imageIndex, keptIndexProducts, keptIndexImages);

await writeJson(normalizedPath, nextCatalog);
await writeJson(indexPath, nextIndex);
await writeJson(skipLogPath, [...(Array.isArray(existingSkipLog) ? existingSkipLog : []), ...retroactiveEntries]);

JSON.parse(await fs.readFile(normalizedPath, "utf8"));
JSON.parse(await fs.readFile(indexPath, "utf8"));

console.log(JSON.stringify({
  orphan_count: 0,
  removed_products: skipProducts.length,
  removed_images: removedIndexImages.length,
  removed_catalog_images: removedCatalogImages.length,
  final_normalized_totals: nextCatalog.totals,
  final_index_totals: nextIndex.totals,
  backups: {
    normalized: normalizedBackupPath,
    index: indexBackupPath
  },
  skip_log_path: skipLogPath
}, null, 2));
