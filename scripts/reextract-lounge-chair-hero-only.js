import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { regenerateImageExtractionRecordWithExistingStage0 } from "../src/captioning.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
const indexPath = path.join(rootDir, "data", "image-index.json");
const reportPath = path.join(rootDir, "data", "reextract-lounge-chair-hero-report.json");
const progressPath = path.join(rootDir, "data", "reextract-lounge-chair-hero-progress.json");

function uniqueStrings(values = []) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function buildProductRecords(images = []) {
  const productMap = new Map();

  for (const image of images) {
    const productId = String(image.product_id || "").trim();
    if (!productId) continue;

    const existing = productMap.get(productId) || {
      product_id: productId,
      product_name: String(image.product_name || image.name || "").trim(),
      brand: String(image.brand || "").trim(),
      a_level: [],
      b_level: [],
      c_level: [],
      image_urls: [],
      passing_image_count: 0
    };

    existing.product_name = existing.product_name || String(image.product_name || image.name || "").trim();
    existing.brand = existing.brand || String(image.brand || "").trim();
    existing.a_level.push(...(image.a_level || []));
    existing.b_level.push(...(image.b_level || []));
    existing.c_level.push(...(image.c_level || []));
    existing.image_urls.push(String(image.image_url || "").trim());
    if (image.stage_0_result === "product" && !image.excluded) {
      existing.passing_image_count += 1;
    }

    productMap.set(productId, existing);
  }

  return [...productMap.values()]
    .map((product) => ({
      ...product,
      a_level: uniqueStrings(product.a_level),
      b_level: uniqueStrings(product.b_level),
      c_level: uniqueStrings(product.c_level),
      image_urls: uniqueStrings(product.image_urls)
    }))
    .sort((a, b) => a.product_name.localeCompare(b.product_name) || a.product_id.localeCompare(b.product_id));
}

function buildHeroSelection(originalIndex = {}) {
  const products = Array.isArray(originalIndex.products) ? originalIndex.products : [];
  const images = Array.isArray(originalIndex.images) ? originalIndex.images : [];
  const imageMap = new Map(images.map((image) => [String(image.image_url || "").trim(), image]));
  const selected = [];
  const skipped = [];

  for (const product of products) {
    const imageUrls = Array.isArray(product.image_urls) ? product.image_urls.map((value) => String(value || "").trim()).filter(Boolean) : [];
    const heroUrl = imageUrls[0] || "";
    const heroRecord = imageMap.get(heroUrl);

    if (!heroRecord) {
      skipped.push({
        product_id: product.product_id,
        product_name: product.product_name,
        hero_url: heroUrl,
        reason: "hero image record missing"
      });
      continue;
    }

    if (String(heroRecord.seating_type || "").trim().toLowerCase() !== "lounge_chair") {
      skipped.push({
        product_id: product.product_id,
        product_name: product.product_name,
        hero_url: heroUrl,
        reason: `hero seating_type is ${String(heroRecord.seating_type || "").trim() || "blank"}`
      });
      continue;
    }

    selected.push(heroRecord);
  }

  return { selected, skipped };
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required.");
  }

  const startedAt = new Date().toISOString();
  const originalIndex = JSON.parse(await fs.readFile(indexPath, "utf8"));
  const originalImages = Array.isArray(originalIndex.images) ? originalIndex.images : [];
  const { selected, skipped } = buildHeroSelection(originalIndex);
  const selectedById = new Map(selected.map((record) => [record.image_id, record]));
  const totalImages = selected.length;

  if (!totalImages) {
    throw new Error("No default hero lounge_chair images found to re-extract.");
  }

  let totalRerunCostUsd = 0;
  let completed = 0;
  const nextImages = [];

  for (const existingRecord of originalImages) {
    const selectedRecord = selectedById.get(existingRecord.image_id);
    if (!selectedRecord) {
      nextImages.push(existingRecord);
      continue;
    }

    const imageRecord = {
      image_id: existingRecord.image_id,
      image_url: existingRecord.image_url,
      product_id: existingRecord.product_id,
      product_name: existingRecord.product_name || existingRecord.name || "",
      name: existingRecord.product_name || existingRecord.name || "",
      brand: existingRecord.brand || "",
      a_level: existingRecord.a_level || [],
      b_level: existingRecord.b_level || [],
      c_level: existingRecord.c_level || [],
      stage_0_result: existingRecord.stage_0_result
    };

    console.log(`[${completed + 1}/${totalImages}] re-extracting hero ${imageRecord.product_name} :: ${imageRecord.image_url}`);

    const nextRecord = await regenerateImageExtractionRecordWithExistingStage0(
      imageRecord,
      existingRecord,
      {
        apiKey: process.env.OPENAI_API_KEY,
        provider: "openai",
        visionModel: "gpt-4.1"
      }
    );

    nextImages.push(nextRecord);
    completed += 1;
    totalRerunCostUsd += Number(
      (nextRecord.cost?.runs || []).reduce((sum, run) => sum + Number(run?.estimated_cost_usd || 0), 0)
    );

    await fs.writeFile(progressPath, `${JSON.stringify({
      started_at: startedAt,
      updated_at: new Date().toISOString(),
      completed,
      total: totalImages,
      total_cost_usd_stage123_only: Number(totalRerunCostUsd.toFixed(6)),
      current_product: imageRecord.product_name,
      current_image_url: imageRecord.image_url
    }, null, 2)}\n`);
  }

  const nextProducts = buildProductRecords(nextImages);
  const nextIndex = {
    ...originalIndex,
    generated_at: new Date().toISOString(),
    images: nextImages,
    products: nextProducts
  };

  const report = {
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    reextracted_hero_images: totalImages,
    skipped_products: skipped.length,
    total_cost_usd_stage123_only: Number(totalRerunCostUsd.toFixed(6)),
    selected_products: selected.map((record) => ({
      product_id: record.product_id,
      product_name: record.product_name,
      image_id: record.image_id,
      image_url: record.image_url
    })),
    skipped
  };

  await fs.writeFile(indexPath, `${JSON.stringify(nextIndex, null, 2)}\n`);
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(progressPath, `${JSON.stringify({ ...report, progress_complete: true }, null, 2)}\n`);

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
