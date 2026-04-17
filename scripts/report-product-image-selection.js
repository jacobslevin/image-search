#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

import { normalizeCatalog } from "../src/catalog.js";
import { evaluateImageCandidates, MATCHING_SAFE_MIN_SHORT_SIDE } from "../src/captioning.js";

const args = process.argv.slice(2);
const sourceArg = args[0];
const startArgIndex = args.indexOf("--start");
const maxProductsArgIndex = args.indexOf("--max-products");
const outputArgIndex = args.indexOf("--output");

if (!sourceArg) {
  console.error("Usage: node scripts/report-product-image-selection.js path/to/catalog.csv [--start N] [--max-products N] [--output path/to/output.json]");
  process.exit(1);
}

const sourcePath = path.resolve(sourceArg);
const startIndex = startArgIndex >= 0 ? Number(args[startArgIndex + 1] || 0) : 0;
const outputPath = outputArgIndex >= 0
  ? path.resolve(args[outputArgIndex + 1] || "")
  : path.resolve("data/catalog-image-selection-record.json");
const maxPassingImages = 5;

const catalog = await normalizeCatalog(sourcePath);
const imagesByProductId = new Map();
for (const image of catalog.images || []) {
  if (!imagesByProductId.has(image.product_id)) {
    imagesByProductId.set(image.product_id, []);
  }
  imagesByProductId.get(image.product_id).push(image);
}

const requestedMaxProducts = maxProductsArgIndex >= 0
  ? Number(args[maxProductsArgIndex + 1] || 0)
  : (catalog.products || []).length;
const selectedProducts = (catalog.products || []).slice(startIndex, startIndex + requestedMaxProducts);
const report = [];
const passingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0 };
let productsWithFivePassingImages = 0;
let productsWithZeroPassingImages = 0;
let totalImagesChecked = 0;

for (let index = 0; index < selectedProducts.length; index += 1) {
  const product = selectedProducts[index];
  const productImages = imagesByProductId.get(product.product_id) || [];
  const evaluation = await evaluateImageCandidates(productImages, {
    maxPassing: maxPassingImages,
    logFailures: false
  });
  const selectedImageUrls = evaluation.attempts
    .filter((attempt) => attempt.passed)
    .map((attempt) => attempt.image_url);
  const selectedCount = selectedImageUrls.length;
  totalImagesChecked += evaluation.checkedCount;

  if (selectedCount >= maxPassingImages) {
    productsWithFivePassingImages += 1;
  } else if (selectedCount === 0) {
    productsWithZeroPassingImages += 1;
  } else {
    passingDistribution[selectedCount] += 1;
  }

  report.push({
    product_id: product.product_id,
    selected_image_urls: selectedImageUrls,
    images_checked_before_hitting_5_passes: evaluation.checkedCount,
    excluded: selectedCount === 0,
    exclusion_status: selectedCount === 0 ? "excluded: no image above minimum resolution" : ""
  });

  console.log(`[${index + 1}/${selectedProducts.length}] ${product.product_id}: selected ${selectedImageUrls.length}/${maxPassingImages}`);
}

const output = {
  source: sourcePath,
  start_index: startIndex,
  max_products: selectedProducts.length,
  max_passing_images_per_product: maxPassingImages,
  min_short_side: MATCHING_SAFE_MIN_SHORT_SIDE,
  products: report,
  summary: {
    total_products_processed: selectedProducts.length,
    products_with_5_passing_images: productsWithFivePassingImages,
    products_with_1_passing_image: passingDistribution[1],
    products_with_2_passing_images: passingDistribution[2],
    products_with_3_passing_images: passingDistribution[3],
    products_with_4_passing_images: passingDistribution[4],
    products_with_0_passing_images: productsWithZeroPassingImages,
    average_images_checked_per_product_before_hitting_cap: selectedProducts.length
      ? Number((totalImagesChecked / selectedProducts.length).toFixed(2))
      : 0
  }
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);

console.log(`Wrote ${outputPath}`);
console.log(JSON.stringify(output, null, 2));
