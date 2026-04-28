#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { generateProductExtractionRecordsWithCap } from "../src/captioning.js";
import { buildPipelineDiagnostics } from "../src/pipeline-diagnostics.js";
import { getEffectiveClassification, normalizeImageClassification } from "../src/utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
const indexPath = path.join(rootDir, "data", "image-index.json");
const normalizedCatalogPath = path.join(rootDir, "data", "normalized-catalog.json");
const backupPath = path.join(rootDir, "data", "image-index.pre-pipeline-compliance-migration-backup.json");
const argList = process.argv.slice(2);

const DIRECT_MAPPINGS = Object.freeze({
  base_finish: {
    "painted / powder coat": "Painted color",
    polished: "Polished chrome / aluminum",
    "polished aluminum": "Polished chrome / aluminum",
    wood: "Natural wood"
  },
  back_finish: {
    wood: "Natural wood"
  },
  seat_finish: {
    wood: "Natural wood"
  },
  base_type: {
    "sled base": "Sled"
  }
});

function normalizeStage0Result(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return ["scene", "product", "product_detail"].includes(normalized) ? normalized : "";
}

function buildIndexedImageRecord(image, generated, refreshedAt = new Date().toISOString(), extra = {}) {
  const stage0Result = normalizeStage0Result(generated?.stage_0_result || extra?.stage_0_result);
  const stage1OverrideResult = normalizeImageClassification(
    generated?.stage_1_override_result || extra?.stage_1_override_result
  );
  const effectiveClassification = getEffectiveClassification({
    ...generated,
    ...extra,
    stage_0_result: stage0Result,
    stage_1_override_result: stage1OverrideResult
  });
  return {
    ...generated,
    ...extra,
    stage_0_result: stage0Result || String(generated?.stage_0_result || extra?.stage_0_result || "").trim(),
    stage_1_override_result: stage1OverrideResult,
    effective_classification: effectiveClassification,
    ai_refreshed_at: refreshedAt
  };
}

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
    if (getEffectiveClassification(image) === "product" && !image.excluded) {
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

function collectDirectMigrationCandidates(images = []) {
  const candidates = [];
  for (const image of images) {
    const enumFields = image?.enum_fields && typeof image.enum_fields === "object" ? image.enum_fields : null;
    if (!enumFields) {
      continue;
    }
    for (const [field, mapping] of Object.entries(DIRECT_MAPPINGS)) {
      const rawValue = String(enumFields[field] || "").trim();
      const nextValue = mapping[rawValue.toLowerCase()];
      if (!nextValue) {
        continue;
      }
      candidates.push({
        image_id: image.image_id,
        product_id: image.product_id,
        product_name: image.product_name || image.name || "",
        seating_type: image.seating_type || "",
        field,
        from: rawValue,
        to: nextValue
      });
    }
  }
  return candidates;
}

function collectConfigurationProducts(images = []) {
  const byProduct = new Map();
  for (const image of images) {
    if (String(image?.seating_type || "").trim() !== "lounge_chair") {
      continue;
    }
    if (String(image?.enum_fields?.configuration || "").trim().toLowerCase() !== "multi-seat / sofa") {
      continue;
    }
    const productId = String(image.product_id || "").trim();
    if (!productId || byProduct.has(productId)) {
      continue;
    }
    byProduct.set(productId, {
      product_id: productId,
      product_name: String(image.product_name || image.name || "").trim()
    });
  }
  return [...byProduct.values()].sort((a, b) => (
    a.product_name.localeCompare(b.product_name) || a.product_id.localeCompare(b.product_id)
  ));
}

function getArgValues(flag) {
  const values = [];
  for (let index = 0; index < argList.length; index += 1) {
    if (argList[index] === flag && argList[index + 1]) {
      values.push(String(argList[index + 1]).trim());
      index += 1;
    }
  }
  return values.filter(Boolean);
}

function hasFlag(flag) {
  return argList.includes(flag);
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required.");
  }

  const originalIndex = JSON.parse(await fs.readFile(indexPath, "utf8"));
  const catalog = JSON.parse(await fs.readFile(normalizedCatalogPath, "utf8"));
  const beforeDiagnostics = buildPipelineDiagnostics(originalIndex);
  const directCandidates = collectDirectMigrationCandidates(originalIndex.images || []);
  const excludedConfigProducts = new Set(getArgValues("--exclude-config-product"));
  const configurationProducts = collectConfigurationProducts(originalIndex.images || [])
    .filter((product) => !excludedConfigProducts.has(product.product_id) && !excludedConfigProducts.has(product.product_name));

  await fs.writeFile(backupPath, `${JSON.stringify(originalIndex, null, 2)}\n`);
  console.log(`Backup written: ${backupPath}`);

  const directByImageId = new Map();
  for (const candidate of directCandidates) {
    const key = String(candidate.image_id || "");
    const list = directByImageId.get(key) || [];
    list.push(candidate);
    directByImageId.set(key, list);
  }

  const migratedImages = [];
  let directFieldUpdates = 0;

  for (const image of originalIndex.images || []) {
    const imageId = String(image.image_id || "");
    const candidates = directByImageId.get(imageId) || [];
    if (!candidates.length) {
      migratedImages.push({ ...image });
      continue;
    }

    const nextEnumFields = {
      ...(image.enum_fields || {})
    };
    for (const candidate of candidates) {
      nextEnumFields[candidate.field] = candidate.to;
      directFieldUpdates += 1;
    }
    migratedImages.push({
      ...image,
      enum_fields: nextEnumFields,
      image_traits: nextEnumFields
    });
  }

  const migratedIndex = {
    ...originalIndex,
    generated_at: new Date().toISOString(),
    images: migratedImages,
    products: buildProductRecords(migratedImages)
  };
  console.log(`Applied ${directFieldUpdates} direct field remaps across ${new Set(directCandidates.map((entry) => entry.image_id)).size} image records.`);

  const byProductId = new Map();
  for (const image of migratedImages) {
    const productId = String(image.product_id || "").trim();
    if (!productId) {
      continue;
    }
    const list = byProductId.get(productId) || [];
    list.push(image);
    byProductId.set(productId, list);
  }

  const reextractionFailures = [];
  const reextractionResults = [];

  if (!hasFlag("--skip-config-rerun")) {
    for (const product of configurationProducts) {
      console.log(`[config-rerun:start] ${product.product_name} (${product.product_id})`);
      const matchingImages = (catalog.images || []).filter((image) => String(image.product_id || "").trim() === product.product_id);
      if (!matchingImages.length) {
        reextractionFailures.push({
          product_id: product.product_id,
          product_name: product.product_name,
          error: "No normalized catalog images available for re-extraction."
        });
        continue;
      }

      try {
        const generated = await generateProductExtractionRecordsWithCap(matchingImages, {
          apiKey: process.env.OPENAI_API_KEY,
          provider: "openai",
          visionModel: process.env.VISION_MODEL || "gpt-4.1",
          embeddingModel: process.env.EMBEDDING_MODEL
        });
        const refreshedAt = new Date().toISOString();
        const rerunRows = (generated.records || []).map((recordLike) => {
          const sourceImage = matchingImages.find((image) => image.image_id === recordLike.image_id || image.image_url === recordLike.image_url) || recordLike;
          return buildIndexedImageRecord(sourceImage, recordLike, refreshedAt);
        });
        reextractionResults.push({
          product_id: product.product_id,
          product_name: product.product_name,
          image_count: rerunRows.length,
          effective_cap_applied: Number(generated.progress?.effective_cap_applied || 0),
          images_skipped_by_cap: Number(generated.progress?.images_skipped_by_cap || 0)
        });
        byProductId.set(product.product_id, rerunRows);
        console.log(
          `[config-rerun:done] ${product.product_name} images=${rerunRows.length} cap=${Number(generated.progress?.effective_cap_applied || 0)} skipped=${Number(generated.progress?.images_skipped_by_cap || 0)}`
        );
      } catch (error) {
        reextractionFailures.push({
          product_id: product.product_id,
          product_name: product.product_name,
          error: String(error?.message || error || "Unknown re-extraction error.")
        });
        console.log(`[config-rerun:failed] ${product.product_name} ${String(error?.message || error || "Unknown re-extraction error.")}`);
      }
    }
  }

  const finalImages = [];
  const replacedProductIds = new Set(reextractionResults.map((entry) => entry.product_id));
  for (const image of migratedImages) {
    const productId = String(image.product_id || "").trim();
    if (!replacedProductIds.has(productId)) {
      finalImages.push(image);
      continue;
    }
    if (finalImages.some((existing) => String(existing.product_id || "").trim() === productId)) {
      continue;
    }
    finalImages.push(...(byProductId.get(productId) || []));
  }

  const finalIndex = {
    ...migratedIndex,
    generated_at: new Date().toISOString(),
    images: finalImages,
    products: buildProductRecords(finalImages)
  };

  await fs.writeFile(indexPath, `${JSON.stringify(finalIndex, null, 2)}\n`);

  const afterDiagnostics = buildPipelineDiagnostics(finalIndex);

  console.log(JSON.stringify({
    backup_path: backupPath,
    mapping_table: DIRECT_MAPPINGS,
    direct_migration: {
      candidate_field_updates: directCandidates.length,
      applied_field_updates: directFieldUpdates,
      image_records_touched: new Set(directCandidates.map((entry) => entry.image_id)).size
    },
    configuration_reextraction: {
      excluded_products: [...excludedConfigProducts],
      skipped: hasFlag("--skip-config-rerun"),
      product_count: configurationProducts.length,
      image_record_count: (originalIndex.images || []).filter((image) => (
        configurationProducts.some((product) => product.product_id === String(image.product_id || "").trim())
      )).length,
      succeeded_products: reextractionResults.length,
      succeeded_image_records: reextractionResults.reduce((sum, entry) => sum + Number(entry.image_count || 0), 0),
      failures: reextractionFailures
    },
    before_audit: {
      schema_compliance_violations: beforeDiagnostics.schema_compliance_violations.length,
      logical_inconsistencies: beforeDiagnostics.logical_inconsistencies.length,
      trait_health_issues: beforeDiagnostics.trait_health.issue_count
    },
    after_audit: {
      schema_compliance_violations: afterDiagnostics.schema_compliance_violations.length,
      logical_inconsistencies: afterDiagnostics.logical_inconsistencies.length,
      trait_health_issues: afterDiagnostics.trait_health.issue_count
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
