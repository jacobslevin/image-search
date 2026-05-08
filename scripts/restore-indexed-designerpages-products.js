#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

import {
  DATA_DIR,
  normalizeWhitespace,
  readJson,
  uniqueStrings,
  writeJson
} from "../src/utils.js";
import { buildDesignerPagesProductUrl } from "../src/designerpages.js";

const execFileAsync = promisify(execFile);
const DEFAULT_CATALOG_PATH = path.join(DATA_DIR, "normalized-catalog.json");
const DEFAULT_REPORT_PATH = path.join(DATA_DIR, "designerpages-index-restore-report.json");

function usage() {
  console.error("Usage: node scripts/restore-indexed-designerpages-products.js --source path/to/product-ids.xlsx --index /absolute/path/to/image-index.json [--catalog data/normalized-catalog.json] [--report data/designerpages-index-restore-report.json]");
  process.exit(1);
}

function parseArgs(argv = []) {
  const args = {
    source: "",
    index: "",
    catalog: DEFAULT_CATALOG_PATH,
    report: DEFAULT_REPORT_PATH
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source") {
      args.source = path.resolve(argv[index + 1] || "");
      index += 1;
      continue;
    }
    if (arg === "--index") {
      args.index = path.resolve(argv[index + 1] || "");
      index += 1;
      continue;
    }
    if (arg === "--catalog") {
      args.catalog = path.resolve(argv[index + 1] || "");
      index += 1;
      continue;
    }
    if (arg === "--report") {
      args.report = path.resolve(argv[index + 1] || "");
      index += 1;
    }
  }

  return args;
}

function toLegacyCategoryFields(levels = {}) {
  const a = Array.isArray(levels.a_level) ? levels.a_level : [];
  const b = Array.isArray(levels.b_level) ? levels.b_level : [];
  const c = Array.isArray(levels.c_level) ? levels.c_level : [];
  const primaryCategory = [a[0], b[0]].filter(Boolean).join(" > ");
  const leafCategory = c[0] || b[0] || "";

  return {
    category: primaryCategory || leafCategory,
    designer_category: leafCategory,
    primary_category: primaryCategory,
    categories: { a, b, c }
  };
}

function sortCatalogProducts(products = []) {
  return [...products].sort((left, right) => {
    const brandCompare = String(left.brand || "").localeCompare(String(right.brand || ""));
    if (brandCompare) {
      return brandCompare;
    }
    return String(left.name || "").localeCompare(String(right.name || ""));
  });
}

function buildCatalogImages(products = []) {
  const images = [];
  for (const product of products) {
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
  return images;
}

function buildCatalogOutput(products = []) {
  const sortedProducts = sortCatalogProducts(products);
  const images = buildCatalogImages(sortedProducts);
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

async function extractProductIdsFromWorkbook(sourcePath = "") {
  const pythonSnippet = [
    "import json, openpyxl, sys",
    "wb = openpyxl.load_workbook(sys.argv[1], data_only=True)",
    "ws = wb[wb.sheetnames[0]]",
    "values = []",
    "for row in ws.iter_rows(min_row=1, values_only=True):",
    "    cell = row[0] if row else None",
    "    if cell is None:",
    "        values.append('')",
    "    else:",
    "        values.append(str(cell))",
    "print(json.dumps(values))"
  ].join("\n");
  const { stdout } = await execFileAsync("python3", ["-c", pythonSnippet, sourcePath], {
    maxBuffer: 1024 * 1024 * 10
  });
  const values = JSON.parse(stdout);
  const firstCell = normalizeWhitespace(values?.[0] || "").toLowerCase();
  const hasHeader = ["product id", "product_id", "id", "designerpages product id"].includes(firstCell);
  const dataValues = hasHeader ? values.slice(1) : values;
  return uniqueStrings(
    dataValues
      .map((value) => normalizeWhitespace(value).replace(/\D+/g, ""))
      .filter(Boolean)
  );
}

function buildIndexedProductLookup(images = []) {
  const lookup = new Map();
  for (const image of Array.isArray(images) ? images : []) {
    const productId = normalizeWhitespace(image.product_id);
    const sourceProductId = productId.startsWith("product_dp_")
      ? productId.replace(/^product_dp_/i, "")
      : "";
    if (!sourceProductId) {
      continue;
    }

    if (!lookup.has(sourceProductId)) {
      lookup.set(sourceProductId, {
        source_product_id: sourceProductId,
        product_id: productId,
        name: "",
        brand: "",
        a_level: new Set(),
        b_level: new Set(),
        c_level: new Set(),
        image_urls: [],
        website: "",
        source_file: "",
        raw_category_terms: []
      });
    }

    const record = lookup.get(sourceProductId);
    if (!record.name) {
      record.name = normalizeWhitespace(image.name);
    }
    if (!record.brand) {
      record.brand = normalizeWhitespace(image.brand);
    }
    for (const level of image.a_level || []) {
      const normalized = normalizeWhitespace(level);
      if (normalized) {
        record.a_level.add(normalized);
      }
    }
    for (const level of image.b_level || []) {
      const normalized = normalizeWhitespace(level);
      if (normalized) {
        record.b_level.add(normalized);
      }
    }
    for (const level of image.c_level || []) {
      const normalized = normalizeWhitespace(level);
      if (normalized) {
        record.c_level.add(normalized);
      }
    }
    const imageUrl = normalizeWhitespace(image.image_url);
    if (imageUrl && !record.image_urls.includes(imageUrl)) {
      record.image_urls.push(imageUrl);
    }
    const website = normalizeWhitespace(image.website);
    if (website && !record.website) {
      record.website = website;
    }
    const sourceFile = normalizeWhitespace(image.source_file);
    if (sourceFile && !record.source_file) {
      record.source_file = sourceFile;
    }
  }
  return lookup;
}

function buildRestoredProductRecord(indexed = {}) {
  const levels = {
    a_level: [...indexed.a_level],
    b_level: [...indexed.b_level],
    c_level: [...indexed.c_level]
  };
  const rawCategory = uniqueStrings([
    ...levels.c_level,
    ...levels.b_level
  ]).join(" :: ");
  return {
    product_id: indexed.product_id,
    source_system: "designerpages",
    source_product_id: indexed.source_product_id,
    name: indexed.name,
    brand: indexed.brand,
    description: "",
    raw_category: rawCategory,
    a_level: levels.a_level,
    b_level: levels.b_level,
    c_level: levels.c_level,
    product_image: indexed.image_urls[0] || "",
    website: indexed.website || buildDesignerPagesProductUrl(indexed.source_product_id),
    source_file: indexed.source_file || "pixelseek-live-index-restore",
    image_urls: indexed.image_urls,
    phase1_status: "restored_from_index",
    phase1_screened_at: new Date().toISOString(),
    ...toLegacyCategoryFields(levels)
  };
}

const args = parseArgs(process.argv.slice(2));
if (!args.source || !args.index) {
  usage();
}

const productIds = await extractProductIdsFromWorkbook(args.source);
if (!productIds.length) {
  throw new Error("No product IDs were found in the source workbook.");
}

const [catalog, index] = await Promise.all([
  readJson(args.catalog, { generated_at: "", totals: { products: 0, images: 0 }, brands: [], categories: [], products: [], images: [] }),
  readJson(args.index, { images: [] })
]);

const productsById = new Map(
  (catalog.products || []).map((product) => [normalizeWhitespace(product.product_id), product]).filter(([key]) => key)
);
const indexedLookup = buildIndexedProductLookup(index.images || []);

const restoredProducts = [];
const skippedAlreadyPresent = [];
const skippedMissingFromIndex = [];

for (const sourceProductId of productIds) {
  const indexed = indexedLookup.get(sourceProductId);
  if (!indexed) {
    skippedMissingFromIndex.push(sourceProductId);
    continue;
  }

  if (productsById.has(indexed.product_id)) {
    skippedAlreadyPresent.push(sourceProductId);
    continue;
  }

  const restored = buildRestoredProductRecord(indexed);
  productsById.set(restored.product_id, restored);
  restoredProducts.push({
    source_product_id: sourceProductId,
    product_id: restored.product_id,
    name: restored.name,
    brand: restored.brand,
    image_count: restored.image_urls.length
  });
}

const nextCatalog = buildCatalogOutput([...productsById.values()]);
await writeJson(args.catalog, nextCatalog);
await writeJson(args.report, {
  generated_at: new Date().toISOString(),
  source: args.source,
  index: args.index,
  submitted_total: productIds.length,
  restored_total: restoredProducts.length,
  restored_products: restoredProducts,
  skipped_already_present_total: skippedAlreadyPresent.length,
  skipped_already_present: skippedAlreadyPresent,
  skipped_missing_from_index_total: skippedMissingFromIndex.length,
  skipped_missing_from_index: skippedMissingFromIndex,
  resulting_catalog_totals: nextCatalog.totals
});

console.log(`Restored ${restoredProducts.length} product(s) from ${args.index}.`);
console.log(`Skipped ${skippedAlreadyPresent.length} product(s) already present in catalog.`);
console.log(`Skipped ${skippedMissingFromIndex.length} product(s) not present in index.`);
console.log(`Catalog now has ${nextCatalog.totals.products} product(s) and ${nextCatalog.totals.images} Phase 1 image record(s).`);
console.log(`Wrote ${args.catalog}`);
console.log(`Wrote ${args.report}`);
