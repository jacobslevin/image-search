#!/usr/bin/env node
import path from "node:path";

import { normalizeCatalog } from "../src/catalog.js";
import { DATA_DIR, getCategoryLevels, getNavigationCategories, readJson, uniqueStrings, writeJson } from "../src/utils.js";

const args = process.argv.slice(2);
const sourceArgIndex = args.indexOf("--source");
const selectionArgIndex = args.indexOf("--selection");
const outputArgIndex = args.indexOf("--output");

const sourcePath = sourceArgIndex >= 0
  ? path.resolve(args[sourceArgIndex + 1])
  : path.resolve("Product Data with Images");
const selectionPath = selectionArgIndex >= 0
  ? path.resolve(args[selectionArgIndex + 1])
  : path.join(DATA_DIR, "catalog-image-selection-record.json");
const outputPath = outputArgIndex >= 0
  ? path.resolve(args[outputArgIndex + 1])
  : path.join(DATA_DIR, "normalized-catalog.json");

const [catalog, selection] = await Promise.all([
  normalizeCatalog(sourcePath),
  readJson(selectionPath)
]);

if (!selection?.products?.length) {
  throw new Error(`Selection record not found or empty: ${selectionPath}`);
}

const selectionByProductId = new Map(
  selection.products.map((product) => [product.product_id, product])
);

const products = [];
for (const product of catalog.products || []) {
  const selected = selectionByProductId.get(product.product_id);
  const imageUrls = Array.isArray(selected?.selected_image_urls)
    ? selected.selected_image_urls.filter(Boolean)
    : [];

  if (!imageUrls.length) {
    continue;
  }

  products.push({
    ...product,
    product_image: imageUrls[0] || "",
    image_urls: imageUrls
  });
}

const images = [];
for (const product of products) {
  for (const [index, imageUrl] of product.image_urls.entries()) {
    images.push({
      image_id: `${product.product_id}_img_${String(index + 1).padStart(3, "0")}`,
      product_id: product.product_id,
      name: product.name,
      brand: product.brand,
      ...getCategoryLevels(product),
      category: getNavigationCategories(product)[0] || "",
      image_url: imageUrl,
      source_file: product.source_file
    });
  }
}

const output = {
  generated_at: new Date().toISOString(),
  source_catalog: sourcePath,
  source_selection: selectionPath,
  totals: {
    products: products.length,
    images: images.length
  },
  brands: uniqueStrings(products.map((product) => product.brand)).sort((a, b) => a.localeCompare(b)),
  categories: uniqueStrings(products.flatMap((product) => product.b_level || [])).sort((a, b) => a.localeCompare(b)),
  products,
  images
};

await writeJson(outputPath, output);

console.log(`Canonicalized ${products.length} products and ${images.length} images.`);
console.log(`Wrote ${outputPath}`);
