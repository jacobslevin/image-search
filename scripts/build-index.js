#!/usr/bin/env node
import path from "node:path";

import { generateImageExtractionRecord } from "../src/captioning.js";
import { normalizeCatalog } from "../src/catalog.js";
import { DATA_DIR, getAllCategoryTerms, getEffectiveClassification, getImageIndexPath, readJson, writeJson } from "../src/utils.js";

const args = process.argv.slice(2);
const providerArgIndex = args.indexOf("--provider");
const categoryArgIndex = args.indexOf("--category");
const categoriesArgIndex = args.indexOf("--categories");
const brandArgIndex = args.indexOf("--brand");
const nameArgIndex = args.indexOf("--name");
const startArgIndex = args.indexOf("--start");
const maxProductsArgIndex = args.indexOf("--max-products");
const imagesPerProductArgIndex = args.indexOf("--images-per-product");
const catalogArgIndex = args.indexOf("--catalog");
const appendFlag = args.includes("--append");
const replaceFlag = args.includes("--replace");
const seatingOnlyFlag = args.includes("--seating-only");
const provider = providerArgIndex >= 0
  ? args[providerArgIndex + 1]
  : process.env.CAPTION_PROVIDER || (process.env.OPENAI_API_KEY ? "openai" : "demo");
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

const normalizedPath = catalogArgIndex >= 0
  ? path.resolve(args[catalogArgIndex + 1] || "")
  : path.join(DATA_DIR, "normalized-catalog.json");
const indexPath = getImageIndexPath();

function canonicalizeImageUrl(value = "") {
  const input = String(value || "").trim();
  if (!input) {
    return "";
  }

  try {
    const url = new URL(input);
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return input.replace(/[#?].*$/, "").replace(/\/$/, "");
  }
}

function buildLightweightProducts(catalog, imageRecords = []) {
  const byProductId = new Map();

  for (const product of catalog.products || []) {
    byProductId.set(product.product_id, {
      product_id: product.product_id,
      product_name: product.name,
      name: product.name,
      brand: product.brand,
      a_level: product.a_level || [],
      b_level: product.b_level || [],
      c_level: product.c_level || [],
      image_urls: product.image_urls || [],
      passing_image_count: 0
    });
  }

  for (const record of imageRecords) {
    if (!byProductId.has(record.product_id)) {
      byProductId.set(record.product_id, {
        product_id: record.product_id,
        product_name: record.product_name || record.name || "",
        name: record.product_name || record.name || "",
        brand: record.brand || "",
        a_level: record.a_level || [],
        b_level: record.b_level || [],
        c_level: record.c_level || [],
        image_urls: [],
        passing_image_count: 0
      });
    }

    const product = byProductId.get(record.product_id);
    product.image_urls = [...new Set([...product.image_urls, record.image_url].filter(Boolean))];
    if (getEffectiveClassification(record) === "product") {
      product.passing_image_count += 1;
    }
  }

  return [...byProductId.values()];
}

function buildIndexOutput(catalog, imageRecords = []) {
  const products = buildLightweightProducts(catalog, imageRecords);
  const searchableImages = imageRecords.filter((image) => getEffectiveClassification(image) === "product");
  const indexedBrands = [...new Set(products.map((product) => product.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const indexedCategories = [...new Set(products.flatMap((product) => getAllCategoryTerms(product)).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  return {
    generated_at: new Date().toISOString(),
    provider: "openai",
    totals: {
      products: products.length,
      images: searchableImages.length
    },
    brands: indexedBrands.length ? indexedBrands : catalog.brands,
    categories: indexedCategories.length ? indexedCategories : catalog.categories,
    products,
    images: imageRecords
  };
}

let catalog = await readJson(normalizedPath);
if (!catalog) {
  catalog = await normalizeCatalog(path.resolve("Product Data with Images"));
  await writeJson(normalizedPath, catalog);
}

const imagesByProductId = new Map();
for (const image of catalog.images || []) {
  if (!imagesByProductId.has(image.product_id)) {
    imagesByProductId.set(image.product_id, []);
  }
  imagesByProductId.get(image.product_id).push(image);
}

let products = (catalog.products || []).filter((product) => {
  const allCategoryTerms = getAllCategoryTerms(product).map((value) => value.toLowerCase());
  const brandValue = String(product.brand || "").toLowerCase();
  const nameValue = String(product.name || "").toLowerCase();

  if (seatingOnlyFlag && !allCategoryTerms.some((value) => seatingCategoryTerms.some((term) => value.includes(term)))) {
    return false;
  }
  if (categoryFilter && !allCategoryTerms.some((value) => value.includes(categoryFilter.toLowerCase()))) {
    return false;
  }
  if (categoryFilters.length && !categoryFilters.some((term) => allCategoryTerms.some((value) => value.includes(term)))) {
    return false;
  }
  if (brandFilter && !brandValue.includes(brandFilter.toLowerCase())) {
    return false;
  }
  if (nameFilter && !nameValue.includes(nameFilter.toLowerCase())) {
    return false;
  }
  return true;
});

const productLimit = maxProducts || products.length;
products = products.slice(startIndex, startIndex + productLimit);

if (provider !== "openai" || !process.env.OPENAI_API_KEY) {
  throw new Error("Indexing now requires provider=openai and OPENAI_API_KEY.");
}

console.log(
  `Indexing ${products.length} products with provider=${provider}${appendFlag ? " append" : ""}${seatingOnlyFlag ? " seating-only" : ""}${categoryFilter ? ` category=${categoryFilter}` : ""}${categoryFilters.length ? ` categories=${categoryFilters.join("|")}` : ""}${startIndex ? ` start=${startIndex}` : ""}${maxProducts ? ` maxProducts=${maxProducts}` : ""}${imagesPerProduct ? ` imagesPerProduct=${imagesPerProduct}` : ""}`
);

const existingIndex = !replaceFlag ? await readJson(indexPath) : null;
const indexedImages = [];
const existingImageIds = new Set((existingIndex?.images || []).map((image) => String(image?.image_id || "").trim()).filter(Boolean));
const existingImageUrls = new Set((existingIndex?.images || []).map((image) => canonicalizeImageUrl(image?.image_url)).filter(Boolean));

for (let index = 0; index < products.length; index += 1) {
  const product = products[index];
  const productImages = (imagesByProductId.get(product.product_id) || [])
    .filter((image) => {
      if (!appendFlag) {
        return true;
      }

      const imageId = String(image?.image_id || "").trim();
      const imageUrl = canonicalizeImageUrl(image?.image_url);
      return !(existingImageIds.has(imageId) || (imageUrl && existingImageUrls.has(imageUrl)));
    })
    .slice(0, imagesPerProduct || Number.POSITIVE_INFINITY);

  if (!productImages.length) {
    continue;
  }

  for (const image of productImages) {
    const record = await generateImageExtractionRecord(image, {
      provider,
      apiKey: process.env.OPENAI_API_KEY,
      visionModel: process.env.VISION_MODEL,
      embeddingModel: process.env.EMBEDDING_MODEL
    });
    indexedImages.push(record);
  }

  if ((index + 1) % 10 === 0 || index === products.length - 1) {
    console.log(`Indexed ${index + 1}/${products.length} products`);
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
const output = buildIndexOutput(catalog, mergedImages);

await writeJson(indexPath, output);
console.log(`Wrote ${indexPath} with ${mergedImages.length} image records across ${output.products.length} products`);
