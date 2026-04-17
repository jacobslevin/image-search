import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { regenerateImageExtractionRecordWithExistingStage0 } from "../src/captioning.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
const indexPath = path.join(rootDir, "data", "image-index.json");
const reportPath = path.join(rootDir, "data", "reextract-stage123-report.json");
const progressPath = path.join(rootDir, "data", "reextract-stage123-progress.json");

function uniqueStrings(values = []) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function buildProductRecords(images = []) {
  const productMap = new Map();

  for (const image of images) {
    const productId = String(image.product_id || "").trim();
    if (!productId) {
      continue;
    }

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

function findNegationLanguage(records = []) {
  const patterns = [
    /\bno\b/i,
    /\bnone\b/i,
    /not visible/i,
    /concealed/i,
    /\bunknown\b/i
  ];
  const findings = [];

  for (const record of records) {
    if (record.stage_0_result !== "product") {
      continue;
    }

    for (const [field, value] of Object.entries(record.free_text || {})) {
      if (Array.isArray(value)) {
        for (const item of value) {
          const text = String(item || "").trim();
          if (text && patterns.some((pattern) => pattern.test(text))) {
            findings.push({ product_name: record.product_name, image_url: record.image_url, field, text });
          }
        }
        continue;
      }

      const text = String(value || "").trim();
      if (text && patterns.some((pattern) => pattern.test(text))) {
        findings.push({ product_name: record.product_name, image_url: record.image_url, field, text });
      }
    }
  }

  return findings;
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required.");
  }

  const startedAt = new Date().toISOString();
  const originalIndex = JSON.parse(await fs.readFile(indexPath, "utf8"));
  const originalImages = Array.isArray(originalIndex.images) ? originalIndex.images : [];
  const concurrency = Math.max(1, Number(process.env.REEXTRACT_CONCURRENCY || 4));
  const beforeSeatingType = new Map(
    originalImages
      .filter((record) => record.stage_0_result === "product")
      .map((record) => [record.image_id, String(record.seating_type || "").trim()])
  );

  let totalRerunCostUsd = 0;
  let productImageCount = 0;
  let sceneImageCount = 0;
  const nextImages = [];
  const totalImages = originalImages.length;

  for (let start = 0; start < originalImages.length; start += concurrency) {
    const batch = originalImages.slice(start, start + concurrency);
    const batchResults = await Promise.all(batch.map(async (existingRecord, batchOffset) => {
      const index = start + batchOffset;
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

      console.log(`[${index + 1}/${totalImages}] ${existingRecord.stage_0_result === "product" ? "re-extracting" : "reusing scene"} ${imageRecord.product_name} :: ${imageRecord.image_url}`);

      const nextRecord = await regenerateImageExtractionRecordWithExistingStage0(
        imageRecord,
        existingRecord,
        {
          apiKey: process.env.OPENAI_API_KEY,
          provider: "openai",
          visionModel: "gpt-4.1"
        }
      );

      return {
        index,
        existingRecord,
        imageRecord,
        nextRecord
      };
    }));

    batchResults.sort((a, b) => a.index - b.index);

    for (const entry of batchResults) {
      nextImages.push(entry.nextRecord);

      if (entry.existingRecord.stage_0_result === "product") {
        productImageCount += 1;
        totalRerunCostUsd += Number(
          (entry.nextRecord.cost?.runs || []).reduce((sum, run) => sum + Number(run?.estimated_cost_usd || 0), 0)
        );
      } else {
        sceneImageCount += 1;
      }
    }

    const lastEntry = batchResults[batchResults.length - 1];
    await fs.writeFile(progressPath, `${JSON.stringify({
      started_at: startedAt,
      updated_at: new Date().toISOString(),
      completed: nextImages.length,
      total: totalImages,
      product_images_completed: productImageCount,
      scene_images_reused: sceneImageCount,
      total_cost_usd_stage123_only: Number(totalRerunCostUsd.toFixed(6)),
      current_product: lastEntry?.imageRecord?.product_name || "",
      current_image_url: lastEntry?.imageRecord?.image_url || ""
    }, null, 2)}\n`);
  }

  const nextProducts = buildProductRecords(nextImages);
  const seatingTypeChanges = nextImages
    .filter((record) => record.stage_0_result === "product")
    .map((record) => ({
      image_id: record.image_id,
      product_name: record.product_name,
      image_url: record.image_url,
      before: beforeSeatingType.get(record.image_id) || "",
      after: String(record.seating_type || "").trim()
    }))
    .filter((entry) => entry.before !== entry.after);

  const preludeRecords = nextImages.filter((record) => record.product_name === "Prelude - Lounge" && record.stage_0_result === "product");
  const negationFindings = findNegationLanguage(nextImages);

  const nextIndex = {
    ...originalIndex,
    generated_at: new Date().toISOString(),
    images: nextImages,
    products: nextProducts
  };

  const report = {
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    reextracted_image_records: productImageCount,
    reused_scene_records: sceneImageCount,
    total_cost_usd_stage123_only: Number(totalRerunCostUsd.toFixed(6)),
    note: "Total cost reflects rerun Stage 1-3 calls only. Existing Stage 0 classifications were reused and embedding API cost is not separately tracked by current code.",
    prelude_positive_base_values: preludeRecords.map((record) => ({
      image_url: record.image_url,
      floor_interface: record.enum_fields?.floor_interface || "",
      shell_material: record.enum_fields?.shell_material || ""
    })),
    seating_type_changes: seatingTypeChanges,
    negation_language_findings: negationFindings
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
