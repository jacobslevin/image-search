#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

import { DATA_DIR, getImageIndexPath, readJson, writeJson } from "../src/utils.js";

const EXPECTED_HEADERS = [
  "Product ID",
  "Product Name",
  "Brand Name",
  "Image Url",
  "A level Names",
  "B Level Names",
  "C Level Names",
  "User Selected Category Name"
];

const PLACEHOLDER_BRANDS = new Set([
  "tbd",
  "to bid",
  "to be bid",
  "to  bid",
  "t.b.d",
  "custom",
  "n/a",
  "na",
  "none",
  "unknown",
  "unspecified",
  "vendor",
  "manufacturer",
  "various",
  "see spec",
  "per spec",
  "per drawings"
]);

const PLACEHOLDER_NAMES = new Set([
  "tbd",
  "t.b.d",
  "n/a",
  "na",
  "none",
  "unknown",
  "unspecified",
  "cushion",
  "pillow",
  "fabric"
]);

function normalizeCell(value) {
  return String(value || "").trim();
}

function normalizeMatchValue(value) {
  return normalizeCell(value).toLowerCase();
}

function splitCategoryValues(value) {
  return normalizeCell(value)
    .split("::")
    .map((item) => item.trim())
    .filter((item) => item && item !== "0");
}

function normalizeImageUrl(value) {
  return normalizeCell(value).replace(/_large(?=\.[A-Za-z0-9]+(?:[?#].*)?$)/i, "");
}

function splitImageUrls(value) {
  return [...new Set(
    normalizeCell(value)
      .split(",")
      .map((item) => normalizeImageUrl(item))
      .filter((item) => item.toLowerCase().startsWith("http"))
  )];
}

function incrementCounter(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function sortCounts(counts) {
  return Object.fromEntries(
    [...counts.entries()]
      .sort((a, b) => {
        if (b[1] !== a[1]) {
          return b[1] - a[1];
        }
        return a[0].localeCompare(b[0]);
      })
  );
}

function parseCsv(content) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const nextChar = content[index + 1];

    if (char === "\"") {
      if (inQuotes && nextChar === "\"") {
        cell += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows
    .filter((currentRow) => currentRow.some((value) => String(value).trim() !== ""))
    .map((currentRow) => currentRow.map((value) => String(value)));
}

function rowsToObjects(rows) {
  if (!rows.length) {
    throw new Error("CSV is empty.");
  }

  const headers = rows[0].map((value) => normalizeCell(value));
  const headerMismatch = EXPECTED_HEADERS.length !== headers.length
    || EXPECTED_HEADERS.some((header, index) => header !== headers[index]);

  if (headerMismatch) {
    throw new Error(
      `CSV headers did not match expected columns.\nExpected: ${EXPECTED_HEADERS.join(", ")}\nReceived: ${headers.join(", ")}`
    );
  }

  return rows.slice(1).map((values) => {
    const record = {};

    for (let index = 0; index < EXPECTED_HEADERS.length; index += 1) {
      record[EXPECTED_HEADERS[index]] = values[index] || "";
    }

    return record;
  });
}

function logTopCounts(label, counts) {
  const entries = Object.entries(counts).slice(0, 10);
  console.log(label);

  if (!entries.length) {
    console.log("  none");
    return;
  }

  for (const [name, count] of entries) {
    console.log(`  ${name}: ${count}`);
  }
}

const csvPathArg = process.argv[2];

if (!csvPathArg) {
  console.error("Usage: node scripts/import-catalog.js path/to/cleaned.csv");
  process.exit(1);
}

const csvPath = path.resolve(csvPathArg);
const queuePath = path.join(DATA_DIR, "import-queue.json");
const summaryPath = path.join(DATA_DIR, "import-summary.json");
const indexPath = getImageIndexPath();

console.log(`Reading CSV: ${csvPath}`);
const csvContent = await fs.readFile(csvPath, "utf8");
const records = rowsToObjects(parseCsv(csvContent));
const existingIndex = await readJson(indexPath, { images: [] });
const existingProductIds = new Set(
  Array.isArray(existingIndex?.images)
    ? existingIndex.images.map((image) => image?.product_id).filter(Boolean)
    : []
);

const importedAt = new Date().toISOString();
const readyProducts = [];
const brandCounts = new Map();
const categoryCounts = new Map();
const summary = {
  total_rows: records.length,
  skipped_brand_placeholder: 0,
  skipped_name_placeholder: 0,
  skipped_no_image: 0,
  skipped_already_indexed: 0,
  ready_to_import: 0,
  top_brands: {},
  top_categories: {}
};

for (let index = 0; index < records.length; index += 1) {
  const record = records[index];
  const productIdValue = normalizeCell(record["Product ID"]);
  const productName = normalizeCell(record["Product Name"]);
  const brandName = normalizeCell(record["Brand Name"]);
  const imageUrls = splitImageUrls(record["Image Url"]);
  const imageUrl = imageUrls[0] || "";
  const aLevelCategories = splitCategoryValues(record["A level Names"]);
  const bLevelCategories = splitCategoryValues(record["B Level Names"]);
  const cLevelCategories = splitCategoryValues(record["C Level Names"]);
  const userSelectedCategory = normalizeCell(record["User Selected Category Name"]);
  const normalizedBrand = normalizeMatchValue(brandName);
  const normalizedName = normalizeMatchValue(productName);
  const productId = `product_${productIdValue}`;

  if (!normalizedBrand || PLACEHOLDER_BRANDS.has(normalizedBrand)) {
    summary.skipped_brand_placeholder += 1;
    continue;
  }

  if (!normalizedName || PLACEHOLDER_NAMES.has(normalizedName)) {
    summary.skipped_name_placeholder += 1;
    continue;
  }

  if (!imageUrl || !imageUrl.toLowerCase().startsWith("http")) {
    summary.skipped_no_image += 1;
    continue;
  }

  if (existingProductIds.has(productId)) {
    summary.skipped_already_indexed += 1;
    console.log(`Already indexed — skipping: ${productName}`);
    continue;
  }

  readyProducts.push({
    product_id: productId,
    name: productName,
    brand: brandName,
    a_level: aLevelCategories,
    b_level: bLevelCategories,
    c_level: cLevelCategories,
    user_selected_category: userSelectedCategory,
    image_url: imageUrl,
    image_urls: imageUrls,
    source: "designerpages",
    imported_at: importedAt
  });

  incrementCounter(brandCounts, brandName);
  (bLevelCategories.length ? bLevelCategories : aLevelCategories).forEach((category) => incrementCounter(categoryCounts, category));

  if ((index + 1) % 100 === 0 || index === records.length - 1) {
    console.log(`Processed ${index + 1}/${records.length} rows`);
  }
}

summary.ready_to_import = readyProducts.length;
summary.top_brands = sortCounts(brandCounts);
summary.top_categories = sortCounts(categoryCounts);

await writeJson(queuePath, readyProducts);
await writeJson(summaryPath, summary);

console.log(`Wrote ${queuePath}`);
console.log(`Wrote ${summaryPath}`);
console.log(JSON.stringify(summary, null, 2));
logTopCounts("Top 10 brands", summary.top_brands);
logTopCounts("Top 10 categories", summary.top_categories);
