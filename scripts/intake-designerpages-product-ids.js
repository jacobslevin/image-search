#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  DATA_DIR,
  getCategoryGroupingKey,
  looksLikeImageUrl,
  normalizeWhitespace,
  readJson,
  uniqueStrings,
  writeJson
} from "../src/utils.js";
import {
  buildDesignerPagesProductUrl,
  fetchDesignerPagesProductHtml,
  parseDesignerPagesProductId,
  parseDesignerPagesProductPayload
} from "../src/designerpages.js";
import {
  buildExistingDesignerPagesProductKey,
  buildExistingDesignerPagesProductLookup,
  findExistingDesignerPagesProduct
} from "../src/designerpages-intake.js";

const execFileAsync = promisify(execFile);
const DEFAULT_CATALOG_PATH = path.join(DATA_DIR, "normalized-catalog.json");
const DEFAULT_FLAGGED_PATH = path.join(DATA_DIR, "designerpages-intake-flagged.json");
const DEFAULT_REPORT_PATH = path.join(DATA_DIR, "designerpages-intake-report.json");
const MIN_SHORT_SIDE = 591;

function usage() {
  console.error("Usage: node scripts/intake-designerpages-product-ids.js --source path/to/product-ids.csv [--catalog data/normalized-catalog.json] [--flagged data/designerpages-intake-flagged.json] [--report data/designerpages-intake-report.json]");
  process.exit(1);
}

function parseArgs(argv = []) {
  const args = {
    source: "",
    catalog: DEFAULT_CATALOG_PATH,
    flagged: DEFAULT_FLAGGED_PATH,
    report: DEFAULT_REPORT_PATH
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source") {
      args.source = path.resolve(argv[index + 1] || "");
      index += 1;
      continue;
    }
    if (arg === "--catalog") {
      args.catalog = path.resolve(argv[index + 1] || "");
      index += 1;
      continue;
    }
    if (arg === "--flagged") {
      args.flagged = path.resolve(argv[index + 1] || "");
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

function parseCsvLines(content = "") {
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

  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((currentRow) => currentRow.some((value) => normalizeWhitespace(value)));
}

function extractProductIds(rows = []) {
  if (!rows.length) {
    return [];
  }

  const firstCell = normalizeWhitespace(rows[0]?.[0] || "").toLowerCase();
  const hasHeader = ["product id", "product_id", "id", "designerpages product id"].includes(firstCell);
  const dataRows = hasHeader ? rows.slice(1) : rows;

  return uniqueStrings(
    dataRows
      .map((row) => parseDesignerPagesProductId(row?.[0] || "") || normalizeWhitespace(row?.[0] || "").replace(/\D+/g, ""))
      .filter(Boolean)
  );
}

async function measureImageDimensionsFromUrl(imageUrl = "") {
  const response = await fetch(imageUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; CatalogIntake/1.0; +https://designerpages.com)" }
  });
  if (!response.ok) {
    throw new Error(`Failed to download image (${response.status})`);
  }

  const mimeType = String(response.headers.get("content-type") || "image/jpeg").split(";")[0].toLowerCase();
  const extension = mimeType.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "jpg";
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "designerpages-intake-"));
  const tempPath = path.join(tempDir, `source.${extension}`);

  try {
    const bytes = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(tempPath, bytes);
    const { stdout } = await execFileAsync("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", tempPath]);
    const width = Number((stdout.match(/pixelWidth:\s*(\d+)/) || [])[1] || 0);
    const height = Number((stdout.match(/pixelHeight:\s*(\d+)/) || [])[1] || 0);
    return {
      width,
      height,
      short_side: Math.min(width || 0, height || 0)
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
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

function sortCatalogProducts(products = []) {
  return [...products].sort((a, b) => {
    const brandCompare = String(a.brand || "").localeCompare(String(b.brand || ""));
    if (brandCompare) {
      return brandCompare;
    }
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
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

function buildExistingProductKey(product = {}) {
  return buildExistingDesignerPagesProductKey(product);
}

function buildPhase1ProductRecord(scraped = {}, acceptedImageUrls = []) {
  const productIdValue = normalizeWhitespace(scraped.source_product_id);
  const categoryLevels = {
    a_level: scraped.a_level || [],
    b_level: scraped.b_level || [],
    c_level: scraped.c_level || []
  };
  const legacy = toLegacyCategoryFields(categoryLevels);

  return {
    product_id: `product_dp_${productIdValue}`,
    source_system: "designerpages",
    source_product_id: productIdValue,
    name: scraped.name,
    brand: scraped.brand,
    description: "",
    raw_category: scraped.raw_category || "",
    a_level: categoryLevels.a_level,
    b_level: categoryLevels.b_level,
    c_level: categoryLevels.c_level,
    product_image: acceptedImageUrls[0] || "",
    website: scraped.website || buildDesignerPagesProductUrl(productIdValue),
    source_file: "designerpages-live-intake",
    image_urls: acceptedImageUrls,
    phase1_status: "ready",
    phase1_screened_at: new Date().toISOString(),
    ...legacy
  };
}

function mergeFlaggedEntries(existingEntries = [], newEntries = []) {
  const byKey = new Map();
  for (const entry of [...existingEntries, ...newEntries]) {
    const key = `designerpages:${normalizeWhitespace(entry.source_product_id)}`;
    if (!key) {
      continue;
    }
    byKey.set(key, entry);
  }
  return [...byKey.values()].sort((a, b) => String(a.source_product_id || "").localeCompare(String(b.source_product_id || "")));
}

const args = parseArgs(process.argv.slice(2));
if (!args.source) {
  usage();
}

const csvContent = await fs.readFile(args.source, "utf8");
const productIds = extractProductIds(parseCsvLines(csvContent));
if (!productIds.length) {
  throw new Error("No product IDs were found in the source CSV.");
}

const existingCatalog = await readJson(args.catalog, { generated_at: "", totals: { products: 0, images: 0 }, brands: [], categories: [], products: [], images: [] });
const existingFlagged = await readJson(args.flagged, { generated_at: "", total: 0, products: [] });
const runStartedAt = new Date().toISOString();
const mergedProducts = new Map();
for (const product of existingCatalog.products || []) {
  const key = buildExistingProductKey(product);
  if (key) {
    mergedProducts.set(key, product);
  }
}
const existingDesignerPagesProducts = buildExistingDesignerPagesProductLookup(existingCatalog.products || []);

const acceptedProducts = [];
const flaggedProducts = [];
const skippedExistingProducts = [];

for (const [index, productId] of productIds.entries()) {
  const productUrl = buildDesignerPagesProductUrl(productId);
  console.log(`[${index + 1}/${productIds.length}] Intake ${productId}`);

  const existingProduct = findExistingDesignerPagesProduct(existingDesignerPagesProducts, productId);
  if (existingProduct) {
    skippedExistingProducts.push({
      source_product_id: productId,
      product_id: normalizeWhitespace(existingProduct.product_id),
      name: normalizeWhitespace(existingProduct.name),
      brand: normalizeWhitespace(existingProduct.brand),
      reason: "already exists in catalog"
    });
    console.log(`  skipped: already exists as ${normalizeWhitespace(existingProduct.product_id) || "(unknown product id)"}`);
    continue;
  }

  try {
    const html = await fetchDesignerPagesProductHtml(productUrl);
    const scraped = parseDesignerPagesProductPayload(html);
    const imageChecks = [];
    const passingImageUrls = [];

    for (const imageUrl of scraped.gallery_image_urls || []) {
      if (!looksLikeImageUrl(imageUrl)) {
        continue;
      }

      try {
        const dimensions = await measureImageDimensionsFromUrl(imageUrl);
        const passed = dimensions.short_side >= MIN_SHORT_SIDE;
        imageChecks.push({ image_url: imageUrl, ...dimensions, passed });
        if (passed) {
          passingImageUrls.push(imageUrl);
        }
      } catch (error) {
        imageChecks.push({
          image_url: imageUrl,
          width: 0,
          height: 0,
          short_side: 0,
          passed: false,
          error: normalizeWhitespace(error.message)
        });
      }
    }

    if (!passingImageUrls.length) {
      flaggedProducts.push({
        source_system: "designerpages",
        source_product_id: productId,
        website: productUrl,
        name: scraped.name || "",
        brand: scraped.brand || "",
        reason: "no image above minimum resolution",
        checked_at: new Date().toISOString(),
        image_checks: imageChecks
      });
      console.log(`  flagged: no image above minimum resolution`);
      continue;
    }

    const nextProduct = buildPhase1ProductRecord(scraped, uniqueStrings(passingImageUrls));
    mergedProducts.set(`designerpages:${productId}`, nextProduct);
    existingDesignerPagesProducts.set(productId, nextProduct);
    acceptedProducts.push({
      source_product_id: productId,
      product_id: nextProduct.product_id,
      name: nextProduct.name,
      accepted_images: nextProduct.image_urls.length,
      category_grouping: getCategoryGroupingKey(nextProduct),
      raw_category: normalizeWhitespace(nextProduct.raw_category)
    });
    console.log(`  accepted: ${nextProduct.image_urls.length} qualifying image(s)`);
  } catch (error) {
    flaggedProducts.push({
      source_system: "designerpages",
      source_product_id: productId,
      website: productUrl,
      name: "",
      brand: "",
      reason: "page scrape failed",
      checked_at: new Date().toISOString(),
      error: normalizeWhitespace(error.message)
    });
    console.log(`  flagged: ${normalizeWhitespace(error.message)}`);
  }
}

const nextCatalog = buildCatalogOutput([...mergedProducts.values()]);
await writeJson(args.catalog, nextCatalog);

const nextFlaggedProducts = mergeFlaggedEntries(existingFlagged.products || [], flaggedProducts);
await writeJson(args.flagged, {
  generated_at: new Date().toISOString(),
  total: nextFlaggedProducts.length,
  products: nextFlaggedProducts
});
await writeJson(args.report, {
  generated_at: new Date().toISOString(),
  started_at: runStartedAt,
  submitted_product_ids: productIds,
  submitted_total: productIds.length,
  accepted_products: acceptedProducts,
  accepted_total: acceptedProducts.length,
  skipped_existing_products: skippedExistingProducts,
  skipped_existing_total: skippedExistingProducts.length,
  flagged_products: flaggedProducts,
  flagged_total: flaggedProducts.length,
  skipped_unmapped_products: [],
  skipped_unmapped_total: 0,
  resulting_catalog_totals: nextCatalog.totals
});

console.log(`Accepted ${acceptedProducts.length} product(s).`);
console.log(`Flagged ${flaggedProducts.length} product(s) this run.`);
console.log(`Skipped ${skippedExistingProducts.length} product(s) because they already exist in the catalog.`);
console.log(`Catalog now has ${nextCatalog.totals.products} product(s) and ${nextCatalog.totals.images} Phase 1 image record(s).`);
console.log(`Wrote ${args.catalog}`);
console.log(`Wrote ${args.flagged}`);
console.log(`Wrote ${args.report}`);
