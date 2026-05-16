#!/usr/bin/env node
/**
 * Migrates selected product bundles from the local source database to the
 * production target database.
 *
 * Local source DB uses the standard app PostgreSQL env vars:
 * - PGHOST
 * - PGPORT
 * - PGDATABASE
 * - PGUSER
 * - PGPASSWORD
 * - PGSSLMODE
 *
 * Production target DB must be provided explicitly:
 * - PROD_PGHOST
 * - PROD_PGPORT
 * - PROD_PGDATABASE
 * - PROD_PGUSER
 * - PROD_PGPASSWORD
 * - PROD_PGSSLMODE
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

import { DEV_DATABASE_NAME, normalizeText, normalizeJson } from "./postgres-dev-common.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCE_PRODUCT_FIELDS_TO_COMPARE = ["product_name", "brand", "description"];
const CANONICAL_PRODUCT_FIELDS_TO_COMPARE = ["product_name", "brand", "description"];

function usage() {
  console.log(`
Usage:
  node scripts/migrate-products-to-production.js --product product_dp_14049553 --product product_dp_9527971 --dry-run
  node scripts/migrate-products-to-production.js --input data/product-migration-batch.json --dry-run

Options:
  --product <id>     Repeatable source product id (for example: product_dp_14049553)
  --input <path>     JSON file with { "product_ids": ["..."] }
  --dry-run          Plan only, do not write
  --force-refresh    Refresh products that are already present in production
  --allow-canonical-only
                     Permit canonical-only migration for anomalous products that lack local source-aware image lineage
  --verbose          Print extra detail
`.trim());
}

function parseArgs(argv = []) {
  const args = {
    productIds: [],
    inputPath: "",
    dryRun: false,
    forceRefresh: false,
    allowCanonicalOnly: false,
    verbose: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "").trim();
    if (arg === "--product") {
      args.productIds.push(String(argv[index + 1] || "").trim());
      index += 1;
      continue;
    }
    if (arg === "--input") {
      args.inputPath = String(argv[index + 1] || "").trim();
      index += 1;
      continue;
    }
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (arg === "--force-refresh") {
      args.forceRefresh = true;
      continue;
    }
    if (arg === "--allow-canonical-only") {
      args.allowCanonicalOnly = true;
      continue;
    }
    if (arg === "--verbose") {
      args.verbose = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

async function loadRequestedProductIds(args) {
  const fromArgs = Array.isArray(args.productIds) ? args.productIds : [];
  let fromFile = [];

  if (args.inputPath) {
    const absolutePath = path.isAbsolute(args.inputPath)
      ? args.inputPath
      : path.resolve(process.cwd(), args.inputPath);
    const parsed = JSON.parse(await fs.readFile(absolutePath, "utf8"));
    fromFile = Array.isArray(parsed?.product_ids) ? parsed.product_ids : [];
  }

  const values = [...fromArgs, ...fromFile]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  const deduped = [...new Set(values)];
  if (!deduped.length) {
    throw new Error("Provide at least one --product or an --input JSON file.");
  }
  return deduped;
}

function getLocalConnectionConfig() {
  return {
    host: process.env.PGHOST,
    port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE || DEV_DATABASE_NAME,
    ssl: String(process.env.PGSSLMODE || "").trim().toLowerCase() === "require"
      ? { rejectUnauthorized: false }
      : undefined,
    keepAlive: true
  };
}

function requireEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function sslConfigFromMode(mode = "") {
  const normalized = String(mode || "").trim().toLowerCase();
  if (normalized !== "require") {
    throw new Error(`PROD_PGSSLMODE must be "require" for production migrations, got: "${mode}"`);
  }
  return { rejectUnauthorized: false };
}

function getProductionConnectionConfig() {
  const sslMode = requireEnv("PROD_PGSSLMODE");
  return {
    host: requireEnv("PROD_PGHOST"),
    port: Number(requireEnv("PROD_PGPORT")),
    user: requireEnv("PROD_PGUSER"),
    password: requireEnv("PROD_PGPASSWORD"),
    database: requireEnv("PROD_PGDATABASE"),
    ssl: sslConfigFromMode(sslMode),
    keepAlive: true
  };
}

async function createClient(config) {
  const client = new Client(config);
  await client.connect();
  return client;
}

function dpNumericIdFromProductId(productId = "") {
  const match = String(productId || "").trim().match(/(\d+)$/);
  return match ? match[1] : "";
}

async function fetchOne(client, sql, params = []) {
  const result = await client.query(sql, params);
  return result.rows[0] || null;
}

async function fetchMany(client, sql, params = []) {
  const result = await client.query(sql, params);
  return result.rows;
}

async function fetchLocalBundle(localClient, requestedProductId) {
  const sourceProduct = await fetchOne(
    localClient,
    `SELECT * FROM products WHERE source_system = 'image_index' AND source_product_id = $1`,
    [requestedProductId]
  );

  const dpNumericId = dpNumericIdFromProductId(requestedProductId);
  const canonicalProduct = dpNumericId
    ? await fetchOne(
        localClient,
        `SELECT * FROM canonical_products WHERE canonical_key = $1`,
        [`dp:${dpNumericId}`]
      )
    : null;

  const sourceImages = await fetchMany(
    localClient,
    `SELECT * FROM images WHERE source_system = 'image_index' AND source_product_id = $1 ORDER BY id`,
    [requestedProductId]
  );

  const canonicalProductSources = canonicalProduct
    ? await fetchMany(
        localClient,
        `SELECT * FROM canonical_product_sources WHERE canonical_product_id = $1 ORDER BY id`,
        [canonicalProduct.id]
      )
    : [];

  const canonicalImages = canonicalProduct
    ? await fetchMany(
        localClient,
        `SELECT * FROM canonical_images WHERE canonical_product_id = $1 ORDER BY id`,
        [canonicalProduct.id]
      )
    : [];

  const canonicalImageSources = canonicalImages.length
    ? await fetchMany(
        localClient,
        `SELECT * FROM canonical_image_sources WHERE canonical_image_id = ANY($1::bigint[]) ORDER BY id`,
        [canonicalImages.map((row) => row.id)]
      )
    : [];

  const referencedProductIds = [...new Set(canonicalProductSources.map((row) => Number(row.product_id)).filter(Number.isFinite))];
  const referencedProducts = referencedProductIds.length
    ? await fetchMany(
        localClient,
        `SELECT * FROM products WHERE id = ANY($1::bigint[]) ORDER BY id`,
        [referencedProductIds]
      )
    : [];

  const referencedImageIds = [...new Set(canonicalImageSources.map((row) => Number(row.image_id)).filter(Number.isFinite))];
  const referencedImages = referencedImageIds.length
    ? await fetchMany(
        localClient,
        `SELECT * FROM images WHERE id = ANY($1::bigint[]) ORDER BY id`,
        [referencedImageIds]
      )
    : [];

  return {
    requestedProductId,
    dpNumericId,
    sourceProduct,
    sourceImages,
    canonicalProduct,
    canonicalProductSources,
    canonicalImages,
    canonicalImageSources,
    referencedProducts,
    referencedImages
  };
}

async function fetchProductionBundle(prodClient, requestedProductId) {
  return fetchLocalBundle(prodClient, requestedProductId);
}

function buildFieldDiffs(localRow, productionRow, fields = [], tableName = "") {
  return fields.map((field) => {
    const localValue = normalizeText(localRow?.[field]);
    const productionValue = normalizeText(productionRow?.[field]);
    return {
      tableName,
      field,
      localValue,
      productionValue,
      changed: localValue !== productionValue
    };
  });
}

function validateLocalBundle(bundle) {
  const errors = [];
  const warnings = [];

  if (!bundle.sourceProduct) {
    errors.push("Local source product row is missing.");
  }
  if (!bundle.canonicalProduct) {
    errors.push("Local canonical product row is missing.");
  }
  if (!bundle.canonicalImages.length) {
    errors.push("Local canonical image rows are missing.");
  }
  if (!bundle.canonicalProductSources.length) {
    errors.push("Local canonical product source rows are missing.");
  }
  if (!bundle.canonicalImageSources.length) {
    errors.push("Local canonical image source rows are missing.");
  }

  const usableImages = bundle.canonicalImages.filter(
    (row) =>
      normalizeText(row.visual_summary) &&
      normalizeText(row.structured_caption) &&
      row.visual_summary_embedding &&
      row.search_text_embedding
  );

  if (!usableImages.length) {
    errors.push("No usable local canonical images with captions and embeddings were found.");
  }

  const localReferencedProducts = bundle.referencedProducts.length;
  const localReferencedImages = bundle.referencedImages.length;
  if (!localReferencedProducts) {
    warnings.push("No referenced source products were loaded from canonical_product_sources.");
  }
  if (!localReferencedImages) {
    warnings.push("No referenced source images were loaded from canonical_image_sources.");
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    canonicalOnlyAnomaly: Boolean(bundle.canonicalImages.length) && bundle.canonicalImageSources.length === 0,
    stats: {
      sourceImages: bundle.sourceImages.length,
      canonicalImages: bundle.canonicalImages.length,
      usableCanonicalImages: usableImages.length,
      canonicalProductSources: bundle.canonicalProductSources.length,
      canonicalImageSources: bundle.canonicalImageSources.length,
      referencedProducts: localReferencedProducts,
      referencedImages: localReferencedImages
    }
  };
}

function assessProductionGap(localBundle, productionBundle) {
  const hasSourceProduct = Boolean(productionBundle.sourceProduct);
  const hasCanonicalProduct = Boolean(productionBundle.canonicalProduct);
  const productionCanonicalImageCount = productionBundle.canonicalImages.length;

  if (!hasSourceProduct && !hasCanonicalProduct && productionCanonicalImageCount === 0) {
    return "missing_everything";
  }
  if ((hasSourceProduct || hasCanonicalProduct) && productionCanonicalImageCount === 0) {
    return "product_shell_only";
  }
  if (productionCanonicalImageCount > 0 && productionCanonicalImageCount < localBundle.canonicalImages.length) {
    return "partially_migrated";
  }
  if (productionCanonicalImageCount >= localBundle.canonicalImages.length) {
    return "already_present";
  }
  return "unknown";
}

function buildMigrationPlan(localBundle, productionBundle, validation) {
  const gapStatus = assessProductionGap(localBundle, productionBundle);
  const sourceProductDiffs = buildFieldDiffs(
    localBundle.sourceProduct,
    productionBundle.sourceProduct,
    SOURCE_PRODUCT_FIELDS_TO_COMPARE,
    "products"
  );
  const canonicalProductDiffs = buildFieldDiffs(
    localBundle.canonicalProduct,
    productionBundle.canonicalProduct,
    CANONICAL_PRODUCT_FIELDS_TO_COMPARE,
    "canonical_products"
  );

  const productionCanonicalImageKeys = new Set(
    productionBundle.canonicalImages.map((row) => normalizeText(row.canonical_image_key))
  );
  const missingCanonicalImages = localBundle.canonicalImages.filter(
    (row) => !productionCanonicalImageKeys.has(normalizeText(row.canonical_image_key))
  );

  const productionSourceImageKeys = new Set(
    productionBundle.referencedImages
      .filter((row) => normalizeText(row.source_system) === "image_index")
      .map((row) => `${normalizeText(row.source_system)}::${normalizeText(row.source_image_id)}`)
  );

  const missingSourceImages = localBundle.referencedImages.filter(
    (row) => !productionSourceImageKeys.has(`${normalizeText(row.source_system)}::${normalizeText(row.source_image_id)}`)
  );

  const anomalyWarning = validation.canonicalOnlyAnomaly
    ? [
        `[WARNING] ${localBundle.requestedProductId} is in CANONICAL-ONLY state.`,
        "  This product has no source-aware image lineage in local.",
        "  This is an anomalous state — 0.2% of products are like this (only Capas and HUGO).",
        "  Production runtime reads canonical tables only, so this migration is functionally safe.",
        "  But local data integrity for this product remains incomplete after migration.",
        "  Consider lineage repair as a separate cleanup task."
      ]
    : [];

  return {
    requestedProductId: localBundle.requestedProductId,
    canonicalKey: normalizeText(localBundle.canonicalProduct?.canonical_key),
    gapStatus,
    blocked: !validation.ok,
    canonicalOnlyAnomaly: validation.canonicalOnlyAnomaly,
    forceRefreshEligible: gapStatus === "already_present",
    validation,
    anomalyWarning,
    sourceProductDiffs,
    canonicalProductDiffs,
    actions: {
      sourceProduct: productionBundle.sourceProduct ? "update" : "insert",
      sourceImages: {
        insert: missingSourceImages.length,
        update: Math.max(0, localBundle.referencedImages.length - missingSourceImages.length)
      },
      canonicalProduct: productionBundle.canonicalProduct ? "update" : "insert",
      canonicalProductSources: {
        insert: Math.max(0, localBundle.canonicalProductSources.length - productionBundle.canonicalProductSources.length),
        update: Math.min(localBundle.canonicalProductSources.length, productionBundle.canonicalProductSources.length)
      },
      canonicalImages: {
        insert: missingCanonicalImages.length,
        update: Math.max(0, localBundle.canonicalImages.length - missingCanonicalImages.length)
      },
      canonicalImageSources: {
        insert: Math.max(0, localBundle.canonicalImageSources.length - productionBundle.canonicalImageSources.length),
        update: Math.min(localBundle.canonicalImageSources.length, productionBundle.canonicalImageSources.length)
      }
    },
    keysTouched: {
      sourceProductId: normalizeText(localBundle.sourceProduct?.source_product_id),
      canonicalKey: normalizeText(localBundle.canonicalProduct?.canonical_key),
      canonicalImageKeys: localBundle.canonicalImages.map((row) => normalizeText(row.canonical_image_key))
    }
  };
}

function printConnectionSummary(localConfig, prodConfig) {
  console.log(`Target database: ${prodConfig.database} @ ${prodConfig.host}`);
  console.log(`Local read source: ${localConfig.database || DEV_DATABASE_NAME} @ ${localConfig.host || "localhost"}`);
}

function printFieldDiffs(title, diffs) {
  console.log(`  ${title}:`);
  diffs.forEach((diff) => {
    const status = diff.changed ? "changed" : "unchanged";
    console.log(
      `    ${diff.tableName}.${diff.field}: "${diff.localValue}" (local) = "${diff.productionValue}" (production) — ${status}`
    );
  });
}

function printDryRunReport(plans = []) {
  plans.forEach((plan) => {
    console.log(`[DRY RUN] ${plan.requestedProductId} — ${plan.gapStatus}`);
    console.log(`  canonical key: ${plan.canonicalKey}`);
    if (plan.forceRefreshEligible && plan.forceRefresh) {
      console.log("  force refresh: enabled; existing production rows will be updated through the normal UPSERT path");
    } else if (plan.forceRefreshEligible) {
      console.log("  skip: already present in production; use --force-refresh to update existing rows");
    }
    if (plan.anomalyWarning.length) {
      plan.anomalyWarning.forEach((line) => console.log(line));
    }
    if (plan.validation.errors.length) {
      console.log("  preflight errors:");
      plan.validation.errors.forEach((error) => console.log(`    - ${error}`));
    }
    if (plan.validation.warnings.length) {
      console.log("  preflight warnings:");
      plan.validation.warnings.forEach((warning) => console.log(`    - ${warning}`));
    }
    console.log(
      `  local stats: source_images=${plan.validation.stats.sourceImages}, canonical_images=${plan.validation.stats.canonicalImages}, usable_canonical_images=${plan.validation.stats.usableCanonicalImages}`
    );
    printFieldDiffs("existing source product fields", plan.sourceProductDiffs);
    printFieldDiffs("existing canonical product fields", plan.canonicalProductDiffs);
    console.log("  plan:");
    console.log(`    source product: ${plan.actions.sourceProduct}`);
    console.log(`    source images: insert ${plan.actions.sourceImages.insert}, update ${plan.actions.sourceImages.update}`);
    console.log(`    canonical product: ${plan.actions.canonicalProduct}`);
    console.log(`    canonical product sources: insert ${plan.actions.canonicalProductSources.insert}, update ${plan.actions.canonicalProductSources.update}`);
    console.log(`    canonical images: insert ${plan.actions.canonicalImages.insert}, update ${plan.actions.canonicalImages.update}`);
    console.log(`    canonical image sources: insert ${plan.actions.canonicalImageSources.insert}, update ${plan.actions.canonicalImageSources.update}`);
    console.log(`    canonical image sample: ${plan.keysTouched.canonicalImageKeys.slice(0, 3).join(", ")}`);
  });

  const blocked = plans.filter((plan) => plan.blocked).length;
  const alreadyPresent = plans.filter((plan) => plan.gapStatus === "already_present").length;
  const forceRefresh = plans.filter((plan) => plan.forceRefresh).length;
  const canonicalOnlyAnomalies = plans.filter((plan) => plan.canonicalOnlyAnomaly).length;
  const ready = plans.length - blocked;
  console.log("Summary");
  console.log(`  requested: ${plans.length}`);
  console.log(`  ready: ${ready}`);
  console.log(`  blocked: ${blocked}`);
  console.log(`  already present: ${alreadyPresent}`);
  console.log(`  force refresh: ${forceRefresh}`);
  console.log(`  canonical-only anomalies: ${canonicalOnlyAnomalies}`);
}

function applyCanonicalOnlyOverride(plans = [], options = {}) {
  if (!options.allowCanonicalOnly) {
    return plans;
  }

  plans.forEach((plan) => {
    if (!plan.canonicalOnlyAnomaly) {
      return;
    }
    const remainingErrors = plan.validation.errors.filter(
      (error) => error !== "Local canonical image source rows are missing."
    );
    plan.validation.errors = remainingErrors;
    plan.validation.ok = remainingErrors.length === 0;
    plan.blocked = !plan.validation.ok;
  });
  return plans;
}

function applyForceRefresh(plans = [], options = {}) {
  plans.forEach((plan) => {
    plan.forceRefresh = Boolean(options.forceRefresh && plan.forceRefreshEligible);
  });
  return plans;
}

function assertPreflightReady(plans = []) {
  const blocked = plans.filter((plan) => plan.blocked);
  if (blocked.length) {
    const ids = blocked.map((plan) => plan.requestedProductId).join(", ");
    throw new Error(`Preflight failed for: ${ids}. Halting before any writes.`);
  }
}

async function upsertProductRow(client, row) {
  const result = await client.query(
    `INSERT INTO products (
      source_system, source_product_id, product_name, brand, description, raw_category, a_level, b_level, c_level,
      product_image_url, website, source_file, image_urls, product_metadata, raw_payload, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7::text[], $8::text[], $9::text[], $10, $11, $12, $13::text[], $14::jsonb, $15::jsonb, NOW()
    )
    ON CONFLICT (source_system, source_product_id) DO UPDATE SET
      product_name = EXCLUDED.product_name,
      brand = EXCLUDED.brand,
      description = EXCLUDED.description,
      raw_category = EXCLUDED.raw_category,
      a_level = EXCLUDED.a_level,
      b_level = EXCLUDED.b_level,
      c_level = EXCLUDED.c_level,
      product_image_url = EXCLUDED.product_image_url,
      website = EXCLUDED.website,
      source_file = EXCLUDED.source_file,
      image_urls = EXCLUDED.image_urls,
      product_metadata = EXCLUDED.product_metadata,
      raw_payload = EXCLUDED.raw_payload,
      updated_at = NOW()
    RETURNING id`,
    [
      row.source_system,
      row.source_product_id,
      row.product_name,
      row.brand,
      row.description,
      row.raw_category,
      row.a_level || [],
      row.b_level || [],
      row.c_level || [],
      row.product_image_url,
      row.website,
      row.source_file,
      row.image_urls || [],
      JSON.stringify(normalizeJson(row.product_metadata)),
      JSON.stringify(normalizeJson(row.raw_payload)),
    ]
  );
  return result.rows[0]?.id;
}

async function upsertImageRow(client, row, targetProductDbId) {
  const result = await client.query(
    `INSERT INTO images (
      source_system, source_image_id, product_db_id, source_product_id, image_url, product_name, brand,
      a_level, b_level, c_level, category, visual_type, family, seating_type, pixelseek_type,
      type_routing_source, stage_0_result, stage_1_override, stage_1_override_result, stage_1_override_reason,
      effective_classification, enum_fields, field_confidence, free_text, reasoning, plan_shape_reasoning,
      tiebreaker_triggered, confidence_tier, tokens, cost, extraction_timestamp, excluded, excluded_reason,
      image_traits, visual_summary, structured_caption, stage1, stage2, stage3, search_text,
      visual_summary_embedding, search_text_embedding, image_width, image_height, image_short_side,
      ai_refreshed_at, is_catalog_primary_image, image_metadata, raw_payload, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8::text[], $9::text[], $10::text[], $11, $12, $13, $14, $15,
      $16, $17, $18::jsonb, $19, $20, $21, $22::jsonb, $23::jsonb, $24::jsonb, $25, $26,
      $27, $28, $29::jsonb, $30::jsonb, $31, $32, $33, $34::jsonb, $35, $36, $37::jsonb,
      $38::jsonb, $39::jsonb, $40, $41::vector, $42::vector, $43, $44, $45, $46, $47, $48::jsonb, $49::jsonb, NOW()
    )
    ON CONFLICT (source_system, source_image_id) DO UPDATE SET
      product_db_id = EXCLUDED.product_db_id,
      source_product_id = EXCLUDED.source_product_id,
      image_url = EXCLUDED.image_url,
      product_name = EXCLUDED.product_name,
      brand = EXCLUDED.brand,
      a_level = EXCLUDED.a_level,
      b_level = EXCLUDED.b_level,
      c_level = EXCLUDED.c_level,
      category = EXCLUDED.category,
      visual_type = EXCLUDED.visual_type,
      family = EXCLUDED.family,
      seating_type = EXCLUDED.seating_type,
      pixelseek_type = EXCLUDED.pixelseek_type,
      type_routing_source = EXCLUDED.type_routing_source,
      stage_0_result = EXCLUDED.stage_0_result,
      stage_1_override = EXCLUDED.stage_1_override,
      stage_1_override_result = EXCLUDED.stage_1_override_result,
      stage_1_override_reason = EXCLUDED.stage_1_override_reason,
      effective_classification = EXCLUDED.effective_classification,
      enum_fields = EXCLUDED.enum_fields,
      field_confidence = EXCLUDED.field_confidence,
      free_text = EXCLUDED.free_text,
      reasoning = EXCLUDED.reasoning,
      plan_shape_reasoning = EXCLUDED.plan_shape_reasoning,
      tiebreaker_triggered = EXCLUDED.tiebreaker_triggered,
      confidence_tier = EXCLUDED.confidence_tier,
      tokens = EXCLUDED.tokens,
      cost = EXCLUDED.cost,
      extraction_timestamp = EXCLUDED.extraction_timestamp,
      excluded = EXCLUDED.excluded,
      excluded_reason = EXCLUDED.excluded_reason,
      image_traits = EXCLUDED.image_traits,
      visual_summary = EXCLUDED.visual_summary,
      structured_caption = EXCLUDED.structured_caption,
      stage1 = EXCLUDED.stage1,
      stage2 = EXCLUDED.stage2,
      stage3 = EXCLUDED.stage3,
      search_text = EXCLUDED.search_text,
      visual_summary_embedding = EXCLUDED.visual_summary_embedding,
      search_text_embedding = EXCLUDED.search_text_embedding,
      image_width = EXCLUDED.image_width,
      image_height = EXCLUDED.image_height,
      image_short_side = EXCLUDED.image_short_side,
      ai_refreshed_at = EXCLUDED.ai_refreshed_at,
      is_catalog_primary_image = EXCLUDED.is_catalog_primary_image,
      image_metadata = EXCLUDED.image_metadata,
      raw_payload = EXCLUDED.raw_payload,
      updated_at = NOW()
    RETURNING id`,
    [
      row.source_system,
      row.source_image_id,
      targetProductDbId,
      row.source_product_id,
      row.image_url,
      row.product_name,
      row.brand,
      row.a_level || [],
      row.b_level || [],
      row.c_level || [],
      row.category,
      row.visual_type,
      row.family,
      row.seating_type,
      row.pixelseek_type,
      row.type_routing_source,
      row.stage_0_result,
      JSON.stringify(normalizeJson(row.stage_1_override)),
      row.stage_1_override_result,
      row.stage_1_override_reason,
      row.effective_classification,
      JSON.stringify(normalizeJson(row.enum_fields)),
      JSON.stringify(normalizeJson(row.field_confidence)),
      JSON.stringify(normalizeJson(row.free_text)),
      row.reasoning,
      row.plan_shape_reasoning,
      row.tiebreaker_triggered,
      row.confidence_tier,
      JSON.stringify(normalizeJson(row.tokens)),
      JSON.stringify(normalizeJson(row.cost)),
      row.extraction_timestamp,
      row.excluded,
      row.excluded_reason,
      JSON.stringify(normalizeJson(row.image_traits)),
      row.visual_summary,
      row.structured_caption,
      JSON.stringify(normalizeJson(row.stage1)),
      JSON.stringify(normalizeJson(row.stage2)),
      JSON.stringify(normalizeJson(row.stage3)),
      row.search_text,
      row.visual_summary_embedding,
      row.search_text_embedding,
      row.image_width,
      row.image_height,
      row.image_short_side,
      row.ai_refreshed_at,
      row.is_catalog_primary_image,
      JSON.stringify(normalizeJson(row.image_metadata)),
      JSON.stringify(normalizeJson(row.raw_payload))
    ]
  );
  return result.rows[0]?.id;
}

async function upsertCanonicalProductRow(client, row, productIdMap) {
  const result = await client.query(
    `INSERT INTO canonical_products (
      canonical_key, dp_numeric_id, product_name, brand, description, raw_category, a_level, b_level, c_level,
      product_image_url, website, source_file, image_urls, merge_strategy, merge_confidence, source_count,
      catalog_product_id, image_index_product_id, preferred_name_source, preferred_metadata_source, merged_payload, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7::text[], $8::text[], $9::text[], $10, $11, $12, $13::text[], $14, $15, $16,
      $17, $18, $19, $20, $21::jsonb, NOW()
    )
    ON CONFLICT (canonical_key) DO UPDATE SET
      dp_numeric_id = EXCLUDED.dp_numeric_id,
      product_name = EXCLUDED.product_name,
      brand = EXCLUDED.brand,
      description = EXCLUDED.description,
      raw_category = EXCLUDED.raw_category,
      a_level = EXCLUDED.a_level,
      b_level = EXCLUDED.b_level,
      c_level = EXCLUDED.c_level,
      product_image_url = EXCLUDED.product_image_url,
      website = EXCLUDED.website,
      source_file = EXCLUDED.source_file,
      image_urls = EXCLUDED.image_urls,
      merge_strategy = EXCLUDED.merge_strategy,
      merge_confidence = EXCLUDED.merge_confidence,
      source_count = EXCLUDED.source_count,
      catalog_product_id = EXCLUDED.catalog_product_id,
      image_index_product_id = EXCLUDED.image_index_product_id,
      preferred_name_source = EXCLUDED.preferred_name_source,
      preferred_metadata_source = EXCLUDED.preferred_metadata_source,
      merged_payload = EXCLUDED.merged_payload,
      updated_at = NOW()
    RETURNING id`,
    [
      row.canonical_key,
      row.dp_numeric_id,
      row.product_name,
      row.brand,
      row.description,
      row.raw_category,
      row.a_level || [],
      row.b_level || [],
      row.c_level || [],
      row.product_image_url,
      row.website,
      row.source_file,
      row.image_urls || [],
      row.merge_strategy,
      row.merge_confidence,
      row.source_count,
      productIdMap.get(`normalized_catalog::${normalizeText(row.catalog_product_id)}`) || null,
      productIdMap.get(`image_index::${normalizeText(row.image_index_product_id)}`) || null,
      row.preferred_name_source,
      row.preferred_metadata_source,
      JSON.stringify(normalizeJson(row.merged_payload))
    ]
  );
  return result.rows[0]?.id;
}

async function upsertCanonicalProductSourceRow(client, row, targetCanonicalProductId, productIdMap) {
  await client.query(
    `INSERT INTO canonical_product_sources (
      canonical_product_id, product_id, source_system, source_product_id, match_strategy, match_confidence,
      is_preferred_metadata_source, is_preferred_name_source, source_payload
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb
    )
    ON CONFLICT (source_system, source_product_id) DO UPDATE SET
      canonical_product_id = EXCLUDED.canonical_product_id,
      product_id = EXCLUDED.product_id,
      match_strategy = EXCLUDED.match_strategy,
      match_confidence = EXCLUDED.match_confidence,
      is_preferred_metadata_source = EXCLUDED.is_preferred_metadata_source,
      is_preferred_name_source = EXCLUDED.is_preferred_name_source,
      source_payload = EXCLUDED.source_payload`,
    [
      targetCanonicalProductId,
      productIdMap.get(`${row.source_system}::${row.source_product_id}`) || null,
      row.source_system,
      row.source_product_id,
      row.match_strategy,
      row.match_confidence,
      row.is_preferred_metadata_source,
      row.is_preferred_name_source,
      JSON.stringify(normalizeJson(row.source_payload))
    ]
  );
}

async function upsertCanonicalImageRow(client, row, targetCanonicalProductId, imageIdMap) {
  const result = await client.query(
    `INSERT INTO canonical_images (
      canonical_product_id, canonical_image_key, image_url, product_name, brand, a_level, b_level, c_level, category,
      visual_type, family, seating_type, pixelseek_type, type_routing_source, stage_0_result, stage_1_override,
      stage_1_override_result, stage_1_override_reason, effective_classification, enum_fields, field_confidence, free_text,
      reasoning, plan_shape_reasoning, tiebreaker_triggered, confidence_tier, tokens, cost, extraction_timestamp, excluded,
      excluded_reason, image_traits, visual_summary, structured_caption, stage1, stage2, stage3, search_text,
      visual_summary_embedding, search_text_embedding, image_width, image_height, image_short_side, ai_refreshed_at,
      merge_strategy, merge_confidence, source_count, preferred_source_system, catalog_image_id, image_index_image_id,
      is_catalog_primary_image, image_metadata, merged_payload, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6::text[], $7::text[], $8::text[], $9,
      $10, $11, $12, $13, $14, $15, $16::jsonb,
      $17, $18, $19, $20::jsonb, $21::jsonb, $22::jsonb,
      $23, $24, $25, $26, $27::jsonb, $28::jsonb, $29, $30,
      $31, $32::jsonb, $33, $34, $35::jsonb, $36::jsonb, $37::jsonb, $38,
      $39::vector, $40::vector, $41, $42, $43, $44,
      $45, $46, $47, $48, $49, $50,
      $51, $52::jsonb, $53::jsonb, NOW()
    )
    ON CONFLICT (canonical_image_key) DO UPDATE SET
      canonical_product_id = EXCLUDED.canonical_product_id,
      image_url = EXCLUDED.image_url,
      product_name = EXCLUDED.product_name,
      brand = EXCLUDED.brand,
      a_level = EXCLUDED.a_level,
      b_level = EXCLUDED.b_level,
      c_level = EXCLUDED.c_level,
      category = EXCLUDED.category,
      visual_type = EXCLUDED.visual_type,
      family = EXCLUDED.family,
      seating_type = EXCLUDED.seating_type,
      pixelseek_type = EXCLUDED.pixelseek_type,
      type_routing_source = EXCLUDED.type_routing_source,
      stage_0_result = EXCLUDED.stage_0_result,
      stage_1_override = EXCLUDED.stage_1_override,
      stage_1_override_result = EXCLUDED.stage_1_override_result,
      stage_1_override_reason = EXCLUDED.stage_1_override_reason,
      effective_classification = EXCLUDED.effective_classification,
      enum_fields = EXCLUDED.enum_fields,
      field_confidence = EXCLUDED.field_confidence,
      free_text = EXCLUDED.free_text,
      reasoning = EXCLUDED.reasoning,
      plan_shape_reasoning = EXCLUDED.plan_shape_reasoning,
      tiebreaker_triggered = EXCLUDED.tiebreaker_triggered,
      confidence_tier = EXCLUDED.confidence_tier,
      tokens = EXCLUDED.tokens,
      cost = EXCLUDED.cost,
      extraction_timestamp = EXCLUDED.extraction_timestamp,
      excluded = EXCLUDED.excluded,
      excluded_reason = EXCLUDED.excluded_reason,
      image_traits = EXCLUDED.image_traits,
      visual_summary = EXCLUDED.visual_summary,
      structured_caption = EXCLUDED.structured_caption,
      stage1 = EXCLUDED.stage1,
      stage2 = EXCLUDED.stage2,
      stage3 = EXCLUDED.stage3,
      search_text = EXCLUDED.search_text,
      visual_summary_embedding = EXCLUDED.visual_summary_embedding,
      search_text_embedding = EXCLUDED.search_text_embedding,
      image_width = EXCLUDED.image_width,
      image_height = EXCLUDED.image_height,
      image_short_side = EXCLUDED.image_short_side,
      ai_refreshed_at = EXCLUDED.ai_refreshed_at,
      merge_strategy = EXCLUDED.merge_strategy,
      merge_confidence = EXCLUDED.merge_confidence,
      source_count = EXCLUDED.source_count,
      preferred_source_system = EXCLUDED.preferred_source_system,
      catalog_image_id = EXCLUDED.catalog_image_id,
      image_index_image_id = EXCLUDED.image_index_image_id,
      is_catalog_primary_image = EXCLUDED.is_catalog_primary_image,
      image_metadata = EXCLUDED.image_metadata,
      merged_payload = EXCLUDED.merged_payload,
      updated_at = NOW()
    RETURNING id`,
    [
      targetCanonicalProductId,
      row.canonical_image_key,
      row.image_url,
      row.product_name,
      row.brand,
      row.a_level || [],
      row.b_level || [],
      row.c_level || [],
      row.category,
      row.visual_type,
      row.family,
      row.seating_type,
      row.pixelseek_type,
      row.type_routing_source,
      row.stage_0_result,
      JSON.stringify(normalizeJson(row.stage_1_override)),
      row.stage_1_override_result,
      row.stage_1_override_reason,
      row.effective_classification,
      JSON.stringify(normalizeJson(row.enum_fields)),
      JSON.stringify(normalizeJson(row.field_confidence)),
      JSON.stringify(normalizeJson(row.free_text)),
      row.reasoning,
      row.plan_shape_reasoning,
      row.tiebreaker_triggered,
      row.confidence_tier,
      JSON.stringify(normalizeJson(row.tokens)),
      JSON.stringify(normalizeJson(row.cost)),
      row.extraction_timestamp,
      row.excluded,
      row.excluded_reason,
      JSON.stringify(normalizeJson(row.image_traits)),
      row.visual_summary,
      row.structured_caption,
      JSON.stringify(normalizeJson(row.stage1)),
      JSON.stringify(normalizeJson(row.stage2)),
      JSON.stringify(normalizeJson(row.stage3)),
      row.search_text,
      row.visual_summary_embedding,
      row.search_text_embedding,
      row.image_width,
      row.image_height,
      row.image_short_side,
      row.ai_refreshed_at,
      row.merge_strategy,
      row.merge_confidence,
      row.source_count,
      row.preferred_source_system,
      imageIdMap.get(`normalized_catalog::${normalizeText(row.catalog_image_id)}`) || null,
      imageIdMap.get(`image_index::${normalizeText(row.image_index_image_id)}`) || null,
      row.is_catalog_primary_image,
      JSON.stringify(normalizeJson(row.image_metadata)),
      JSON.stringify(normalizeJson(row.merged_payload))
    ]
  );
  return result.rows[0]?.id;
}

async function upsertCanonicalImageSourceRow(client, row, targetCanonicalImageId, imageIdMap) {
  await client.query(
    `INSERT INTO canonical_image_sources (
      canonical_image_id, image_id, source_system, source_image_id, match_strategy, match_confidence,
      is_preferred_source, source_payload
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8::jsonb
    )
    ON CONFLICT (source_system, source_image_id) DO UPDATE SET
      canonical_image_id = EXCLUDED.canonical_image_id,
      image_id = EXCLUDED.image_id,
      match_strategy = EXCLUDED.match_strategy,
      match_confidence = EXCLUDED.match_confidence,
      is_preferred_source = EXCLUDED.is_preferred_source,
      source_payload = EXCLUDED.source_payload`,
    [
      targetCanonicalImageId,
      imageIdMap.get(`${row.source_system}::${row.source_image_id}`) || null,
      row.source_system,
      row.source_image_id,
      row.match_strategy,
      row.match_confidence,
      row.is_preferred_source,
      JSON.stringify(normalizeJson(row.source_payload))
    ]
  );
}

async function migrateSingleProduct(prodClient, localBundle) {
  const touched = {
    sourceProducts: [],
    sourceImages: [],
    canonicalProduct: "",
    canonicalImages: []
  };

  await prodClient.query("BEGIN");
  try {
    const productIdMap = new Map();
    for (const productRow of localBundle.referencedProducts) {
      const targetId = await upsertProductRow(prodClient, productRow);
      productIdMap.set(`${productRow.source_system}::${productRow.source_product_id}`, targetId);
      touched.sourceProducts.push(`${productRow.source_system}::${productRow.source_product_id}`);
    }

    const imageIdMap = new Map();
    for (const imageRow of localBundle.referencedImages) {
      const targetProductDbId = productIdMap.get(`${imageRow.source_system}::${imageRow.source_product_id}`);
      const targetId = await upsertImageRow(prodClient, imageRow, targetProductDbId);
      imageIdMap.set(`${imageRow.source_system}::${imageRow.source_image_id}`, targetId);
      touched.sourceImages.push(`${imageRow.source_system}::${imageRow.source_image_id}`);
    }

    const targetCanonicalProductId = await upsertCanonicalProductRow(prodClient, localBundle.canonicalProduct, productIdMap);
    touched.canonicalProduct = localBundle.canonicalProduct.canonical_key;

    for (const row of localBundle.canonicalProductSources) {
      await upsertCanonicalProductSourceRow(prodClient, row, targetCanonicalProductId, productIdMap);
    }

    const canonicalImageIdMap = new Map();
    for (const row of localBundle.canonicalImages) {
      const targetCanonicalImageId = await upsertCanonicalImageRow(prodClient, row, targetCanonicalProductId, imageIdMap);
      canonicalImageIdMap.set(row.canonical_image_key, targetCanonicalImageId);
      touched.canonicalImages.push(row.canonical_image_key);
    }

    for (const row of localBundle.canonicalImageSources) {
      const localCanonicalImage = localBundle.canonicalImages.find((image) => Number(image.id) === Number(row.canonical_image_id));
      const targetCanonicalImageId = canonicalImageIdMap.get(localCanonicalImage?.canonical_image_key);
      await upsertCanonicalImageSourceRow(prodClient, row, targetCanonicalImageId, imageIdMap);
    }

    await prodClient.query("COMMIT");
    return touched;
  } catch (error) {
    await prodClient.query("ROLLBACK");
    throw error;
  }
}

async function postMigrationVerify(prodClient, localBundle) {
  const canonicalKey = localBundle.canonicalProduct?.canonical_key;
  const summary = await fetchOne(
    prodClient,
    `SELECT cp.canonical_key, count(ci.*)::int AS image_count
     FROM canonical_products cp
     LEFT JOIN canonical_images ci ON ci.canonical_product_id = cp.id
     WHERE cp.canonical_key = $1
     GROUP BY cp.canonical_key`,
    [canonicalKey]
  );
  const exactImage = await fetchOne(
    prodClient,
    `SELECT ci.canonical_image_key, ci.image_url
     FROM canonical_images ci
     JOIN canonical_products cp ON cp.id = ci.canonical_product_id
     WHERE cp.canonical_key = $1
       AND ci.image_url = ANY($2::text[])`,
    [canonicalKey, localBundle.canonicalImages.map((row) => row.image_url)]
  );
  return {
    canonicalKey,
    imageCount: Number(summary?.image_count || 0),
    matchedLocalImageUrl: normalizeText(exactImage?.image_url)
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const requestedProductIds = await loadRequestedProductIds(args);
  const localConfig = getLocalConnectionConfig();
  const prodConfig = getProductionConnectionConfig();

  printConnectionSummary(localConfig, prodConfig);

  const localClient = await createClient(localConfig);
  const prodClient = await createClient(prodConfig);

  try {
    const bundles = [];
    const plans = [];

    for (const requestedProductId of requestedProductIds) {
      const localBundle = await fetchLocalBundle(localClient, requestedProductId);
      const productionBundle = await fetchProductionBundle(prodClient, requestedProductId);
      const validation = validateLocalBundle(localBundle);
      const plan = buildMigrationPlan(localBundle, productionBundle, validation);
      bundles.push({ localBundle, productionBundle, plan });
      plans.push(plan);
    }

    applyCanonicalOnlyOverride(plans, args);
    applyForceRefresh(plans, args);
    printDryRunReport(plans);
    assertPreflightReady(plans);

    if (args.dryRun) {
      return;
    }

    let migratedCount = 0;
    let anomalyCount = 0;
    for (const entry of bundles) {
      entry.plan = plans.find((plan) => plan.requestedProductId === entry.plan.requestedProductId) || entry.plan;
      if (entry.plan.gapStatus === "already_present" && !entry.plan.forceRefresh) {
        console.log(`[SKIP] ${entry.plan.requestedProductId} already has ${entry.localBundle.canonicalImages.length} canonical images in production.`);
        continue;
      }
      if (entry.plan.anomalyWarning.length) {
        entry.plan.anomalyWarning.forEach((line) => console.log(line));
      }
      const touched = await migrateSingleProduct(prodClient, entry.localBundle);
      const verification = await postMigrationVerify(prodClient, entry.localBundle);
      const logPrefix = entry.plan.forceRefresh ? "[REFRESHED]" : "[MIGRATED]";
      console.log(`${logPrefix} ${entry.plan.requestedProductId}`);
      console.log(`  canonical key: ${verification.canonicalKey}`);
      console.log(`  production canonical images: ${verification.imageCount}`);
      console.log(`  matched image URL: ${verification.matchedLocalImageUrl}`);
      console.log(`  touched source products: ${touched.sourceProducts.length}`);
      console.log(`  touched source images: ${touched.sourceImages.length}`);
      console.log(`  touched canonical images: ${touched.canonicalImages.length}`);
      migratedCount += 1;
      if (entry.plan.canonicalOnlyAnomaly) {
        anomalyCount += 1;
      }
    }

    console.log("Final summary");
    console.log(`  migrated: ${migratedCount}`);
    console.log(`  migrated with anomaly: ${anomalyCount} (canonical-only state preserved)`);
    if (anomalyCount > 0) {
      console.log("  Recommended follow-up: local lineage reconstruction for Capas and HUGO");
    }
  } finally {
    await Promise.allSettled([localClient.end(), prodClient.end()]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
