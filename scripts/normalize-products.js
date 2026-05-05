#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs/promises";

import { normalizeCatalog } from "../src/catalog.js";
import {
  DATA_DIR,
  buildImportSkipLogEntry,
  getPixelSeekType,
  uniqueStrings,
  writeJson
} from "../src/utils.js";

const args = process.argv.slice(2);
const sourceArgIndex = args.indexOf("--source");
// This script only normalizes the local CSV import folder. It is not the source
// of truth for the larger Designer Pages-derived browse corpus; that broader
// local catalog is maintained separately from the CSV import path.
const csvDirectory = sourceArgIndex >= 0
  ? path.resolve(args[sourceArgIndex + 1])
  : path.resolve("Product Data with Images");
const outputPath = path.join(DATA_DIR, "normalized-catalog.json");
const skipLogPath = path.join(DATA_DIR, "import-skipped-log.json");

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

async function readSkipLog(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

const catalog = await normalizeCatalog(csvDirectory);
const timestamp = new Date().toISOString();
const skippedEntries = [];
const keptProducts = [];

for (const product of catalog.products || []) {
  if (getPixelSeekType(product) === "SKIP") {
    skippedEntries.push(buildImportSkipLogEntry(product, "import", timestamp));
    continue;
  }
  keptProducts.push(product);
}

const nextCatalog = buildCatalogOutput(keptProducts);
await writeJson(outputPath, nextCatalog);

const existingSkipLog = await readSkipLog(skipLogPath);
if (skippedEntries.length) {
  await writeJson(skipLogPath, [...existingSkipLog, ...skippedEntries]);
}

console.log(`Normalized ${nextCatalog.totals.products} products and ${nextCatalog.totals.images} image records.`);
console.log(`Wrote ${outputPath}`);
if (skippedEntries.length) {
  console.log(`Appended ${skippedEntries.length} skipped product(s) to ${skipLogPath}`);
}
