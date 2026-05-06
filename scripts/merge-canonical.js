import crypto from "node:crypto";
import {
  CATALOG_SOURCE_SYSTEM,
  IMAGE_INDEX_SOURCE_SYSTEM,
  createDevClient,
  initializeSchema,
  normalizeArray,
  normalizeJson,
  normalizeText
} from "./postgres-dev-common.js";

function tailId(sourceProductId) {
  const match = normalizeText(sourceProductId).match(/(\d+)$/);
  return match ? match[1] : "";
}

function normalizeKey(value) {
  return normalizeText(value).trim().toLowerCase();
}

function scoreStringQuality(value) {
  const text = normalizeText(value);
  if (!text) {
    return -1000;
  }
  let score = text.length;
  if (/[ÂâÃ�]/.test(text)) {
    score -= 50;
  }
  if (/�/.test(text)) {
    score -= 100;
  }
  if (/[®™°—]/.test(text)) {
    score += 10;
  }
  return score;
}

function chooseCleanerString(primary, secondary) {
  return scoreStringQuality(primary) >= scoreStringQuality(secondary) ? normalizeText(primary) : normalizeText(secondary);
}

function hashKey(...parts) {
  return crypto.createHash("sha1").update(parts.join("::")).digest("hex").slice(0, 16);
}

function parseVectorValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry));
  }
  const text = normalizeText(value).trim();
  if (!text.startsWith("[") || !text.endsWith("]")) {
    return null;
  }
  const body = text.slice(1, -1).trim();
  if (!body) {
    return null;
  }
  const parsed = body
    .split(",")
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry));
  return parsed.length ? parsed : null;
}

function productCanonicalKey({ matchStrategy, dpNumericId, catalogProduct, imageIndexProduct }) {
  if (dpNumericId) {
    return `dp:${dpNumericId}`;
  }
  if (matchStrategy === "exact_brand_name") {
    return `fallback:${hashKey(normalizeKey(catalogProduct?.brand || imageIndexProduct?.brand), normalizeKey(catalogProduct?.product_name || imageIndexProduct?.product_name))}`;
  }
  const source = catalogProduct || imageIndexProduct;
  return `${source.source_system}:${source.source_product_id}`;
}

function imageCanonicalKey(canonicalProductKey, imageUrl, fallbackSourceImageId) {
  const stable = normalizeText(imageUrl) || normalizeText(fallbackSourceImageId);
  return `${canonicalProductKey}:img:${hashKey(stable)}`;
}

function unionImageUrls(...lists) {
  return [...new Set(lists.flatMap((list) => normalizeArray(list)).filter(Boolean))];
}

async function loadProducts(client, sourceSystem) {
  const result = await client.query(
    `SELECT * FROM products WHERE source_system = $1 ORDER BY id`,
    [sourceSystem]
  );
  return result.rows;
}

async function loadImages(client, sourceSystem) {
  const result = await client.query(
    `SELECT * FROM images WHERE source_system = $1 ORDER BY id`,
    [sourceSystem]
  );
  return result.rows;
}

function buildExactNameIndex(products) {
  const index = new Map();
  for (const product of products) {
    const key = `${normalizeKey(product.brand)}::${normalizeKey(product.product_name)}`;
    if (!index.has(key)) {
      index.set(key, []);
    }
    index.get(key).push(product);
  }
  return index;
}

function buildTailIndex(products) {
  const index = new Map();
  for (const product of products) {
    const dpId = tailId(product.source_product_id);
    if (!dpId) {
      continue;
    }
    if (!index.has(dpId)) {
      index.set(dpId, []);
    }
    index.get(dpId).push(product);
  }
  return index;
}

function buildImageUrlIndex(images) {
  const index = new Map();
  for (const image of images) {
    const url = normalizeText(image.image_url);
    if (!url) {
      continue;
    }
    if (!index.has(url)) {
      index.set(url, []);
    }
    index.get(url).push(image);
  }
  return index;
}

function chooseCanonicalProductFields(catalogProduct, imageIndexProduct) {
  const catalog = catalogProduct || {};
  const index = imageIndexProduct || {};
  return {
    product_name: chooseCleanerString(index.product_name, catalog.product_name),
    brand: normalizeText(catalog.brand || index.brand),
    description: normalizeText(catalog.description),
    raw_category: normalizeText(catalog.raw_category),
    a_level: normalizeArray(catalog.a_level || index.a_level),
    b_level: normalizeArray(catalog.b_level || index.b_level),
    c_level: normalizeArray(catalog.c_level || index.c_level),
    product_image_url: normalizeText(catalog.product_image_url || index.image_urls?.[0] || ""),
    website: normalizeText(catalog.website),
    source_file: normalizeText(catalog.source_file),
    image_urls: unionImageUrls(catalog.image_urls, index.image_urls),
    preferred_name_source: scoreStringQuality(index.product_name) >= scoreStringQuality(catalog.product_name)
      ? IMAGE_INDEX_SOURCE_SYSTEM
      : CATALOG_SOURCE_SYSTEM,
    preferred_metadata_source: catalogProduct ? CATALOG_SOURCE_SYSTEM : IMAGE_INDEX_SOURCE_SYSTEM
  };
}

function chooseCanonicalImageFields(catalogImage, imageIndexImage, canonicalProduct) {
  const preferred = imageIndexImage || catalogImage || {};
  const fallback = catalogImage || {};
  return {
    image_url: normalizeText(preferred.image_url || fallback.image_url),
    product_name: normalizeText(canonicalProduct.product_name || preferred.product_name || fallback.product_name),
    brand: normalizeText(canonicalProduct.brand || preferred.brand || fallback.brand),
    a_level: normalizeArray(canonicalProduct.a_level?.length ? canonicalProduct.a_level : (preferred.a_level || fallback.a_level)),
    b_level: normalizeArray(canonicalProduct.b_level?.length ? canonicalProduct.b_level : (preferred.b_level || fallback.b_level)),
    c_level: normalizeArray(canonicalProduct.c_level?.length ? canonicalProduct.c_level : (preferred.c_level || fallback.c_level)),
    category: normalizeText(fallback.category),
    visual_type: normalizeText(preferred.visual_type),
    family: normalizeText(preferred.family),
    seating_type: normalizeText(preferred.seating_type),
    pixelseek_type: normalizeText(preferred.pixelseek_type),
    type_routing_source: normalizeText(preferred.type_routing_source),
    stage_0_result: normalizeText(preferred.stage_0_result),
    stage_1_override: normalizeJson(preferred.stage_1_override),
    stage_1_override_result: normalizeText(preferred.stage_1_override_result),
    stage_1_override_reason: normalizeText(preferred.stage_1_override_reason),
    effective_classification: normalizeText(preferred.effective_classification),
    enum_fields: normalizeJson(preferred.enum_fields),
    field_confidence: normalizeJson(preferred.field_confidence),
    free_text: normalizeJson(preferred.free_text),
    reasoning: normalizeText(preferred.reasoning),
    plan_shape_reasoning: normalizeText(preferred.plan_shape_reasoning),
    tiebreaker_triggered: typeof preferred.tiebreaker_triggered === "boolean" ? preferred.tiebreaker_triggered : null,
    confidence_tier: normalizeText(preferred.confidence_tier),
    tokens: normalizeJson(preferred.tokens),
    cost: normalizeJson(preferred.cost),
    extraction_timestamp: preferred.extraction_timestamp || null,
    excluded: Boolean(preferred.excluded),
    excluded_reason: normalizeText(preferred.excluded_reason),
    image_traits: normalizeJson(preferred.image_traits),
    visual_summary: normalizeText(preferred.visual_summary),
    structured_caption: normalizeText(preferred.structured_caption),
    stage1: normalizeJson(preferred.stage1),
    stage2: normalizeJson(preferred.stage2),
    stage3: normalizeJson(preferred.stage3),
    search_text: normalizeText(preferred.search_text),
    visual_summary_embedding: parseVectorValue(preferred.visual_summary_embedding),
    search_text_embedding: parseVectorValue(preferred.search_text_embedding),
    image_width: Number.isFinite(preferred.image_width) ? preferred.image_width : null,
    image_height: Number.isFinite(preferred.image_height) ? preferred.image_height : null,
    image_short_side: Number.isFinite(preferred.image_short_side) ? preferred.image_short_side : null,
    ai_refreshed_at: preferred.ai_refreshed_at || null,
    is_catalog_primary_image: Boolean(catalogImage?.is_catalog_primary_image),
    preferred_source_system: imageIndexImage ? IMAGE_INDEX_SOURCE_SYSTEM : CATALOG_SOURCE_SYSTEM,
    image_metadata: {
      catalog_image_id: catalogImage?.source_image_id || "",
      image_index_image_id: imageIndexImage?.source_image_id || ""
    }
  };
}

function vectorLiteral(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  return `[${value.map((entry) => Number(entry)).join(",")}]`;
}

const DEFAULT_BATCH_SIZE = Math.max(1, Number(process.env.CANONICAL_MERGE_BATCH_SIZE) || 500);
const IMAGE_INSERT_BATCH_SIZE = Math.max(1, Number(process.env.CANONICAL_IMAGE_BATCH_SIZE) || 100);

function chunkArray(items, chunkSize) {
  const chunks = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function formatDuration(milliseconds) {
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

async function runBatchedMutations(client, label, items, mutateItem, batchSize = DEFAULT_BATCH_SIZE) {
  if (!items.length) {
    console.log(`[merge-canonical] ${label}: 0/0`);
    return;
  }

  const startedAt = Date.now();
  let processed = 0;
  for (const batch of chunkArray(items, batchSize)) {
    await client.query("BEGIN");
    try {
      for (const item of batch) {
        await mutateItem(item);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    processed += batch.length;
    console.log(
      `[merge-canonical] ${label}: ${processed}/${items.length} inserted (${Math.round((processed / items.length) * 100)}%) after ${formatDuration(Date.now() - startedAt)}`
    );
  }
}

function buildValuesSql(rowCount, castSuffixes) {
  let parameterIndex = 1;
  const groups = [];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const placeholders = castSuffixes.map((suffix) => `$${parameterIndex++}${suffix}`);
    groups.push(`(${placeholders.join(", ")})`);
  }
  return groups.join(",\n      ");
}

function canonicalImageParamValues(payload) {
  return [
    payload.canonical_product_id,
    payload.canonical_image_key,
    payload.image_url,
    payload.product_name,
    payload.brand,
    payload.a_level,
    payload.b_level,
    payload.c_level,
    payload.category,
    payload.visual_type,
    payload.family,
    payload.seating_type,
    payload.pixelseek_type,
    payload.type_routing_source,
    payload.stage_0_result,
    JSON.stringify(payload.stage_1_override),
    payload.stage_1_override_result,
    payload.stage_1_override_reason,
    payload.effective_classification,
    JSON.stringify(payload.enum_fields),
    JSON.stringify(payload.field_confidence),
    JSON.stringify(payload.free_text),
    payload.reasoning,
    payload.plan_shape_reasoning,
    payload.tiebreaker_triggered,
    payload.confidence_tier,
    JSON.stringify(payload.tokens),
    JSON.stringify(payload.cost),
    payload.extraction_timestamp,
    payload.excluded,
    payload.excluded_reason,
    JSON.stringify(payload.image_traits),
    payload.visual_summary,
    payload.structured_caption,
    JSON.stringify(payload.stage1),
    JSON.stringify(payload.stage2),
    JSON.stringify(payload.stage3),
    payload.search_text,
    vectorLiteral(payload.visual_summary_embedding),
    vectorLiteral(payload.search_text_embedding),
    payload.image_width,
    payload.image_height,
    payload.image_short_side,
    payload.ai_refreshed_at,
    payload.merge_strategy,
    payload.merge_confidence,
    payload.source_count,
    payload.preferred_source_system,
    payload.catalog_image_id,
    payload.image_index_image_id,
    payload.is_catalog_primary_image,
    JSON.stringify(payload.image_metadata),
    JSON.stringify(payload.merged_payload)
  ];
}

async function insertCanonicalImagesBatch(client, payloads) {
  if (!payloads.length) {
    return [];
  }
  const castSuffixes = [
    "", "", "", "", "",
    "::text[]", "::text[]", "::text[]", "",
    "", "", "", "", "", "", "::jsonb",
    "", "", "", "::jsonb", "::jsonb", "::jsonb", "", "", "", "", "::jsonb", "::jsonb",
    "", "", "", "::jsonb", "", "", "::jsonb", "::jsonb", "::jsonb",
    "", "::vector", "::vector", "", "", "", "",
    "", "", "", "", "", "", "", "::jsonb", "::jsonb"
  ];
  const params = payloads.flatMap(canonicalImageParamValues);
  let parameterIndex = 1;
  const valuesSql = payloads
    .map(() => {
      const placeholders = castSuffixes.map((suffix) => `$${parameterIndex++}${suffix}`);
      return `(${placeholders.join(", ")}, NOW())`;
    })
    .join(",\n      ");
  const result = await client.query(
    `INSERT INTO canonical_images (
      canonical_product_id, canonical_image_key, image_url, product_name, brand, a_level, b_level, c_level, category,
      visual_type, family, seating_type, pixelseek_type, type_routing_source, stage_0_result, stage_1_override,
      stage_1_override_result, stage_1_override_reason, effective_classification, enum_fields, field_confidence,
      free_text, reasoning, plan_shape_reasoning, tiebreaker_triggered, confidence_tier, tokens, cost,
      extraction_timestamp, excluded, excluded_reason, image_traits, visual_summary, structured_caption, stage1, stage2, stage3,
      search_text, visual_summary_embedding, search_text_embedding, image_width, image_height, image_short_side, ai_refreshed_at,
      merge_strategy, merge_confidence, source_count, preferred_source_system, catalog_image_id, image_index_image_id,
      is_catalog_primary_image, image_metadata, merged_payload, updated_at
    ) VALUES
      ${valuesSql}
    RETURNING id, canonical_image_key`,
    params
  );
  return result.rows;
}

function canonicalImageSourceParamValues(payload) {
  return [
    payload.canonical_image_id,
    payload.image_id,
    payload.source_system,
    payload.source_image_id,
    payload.match_strategy,
    payload.match_confidence,
    payload.is_preferred_source,
    JSON.stringify(payload.source_payload)
  ];
}

async function insertCanonicalImageSourcesBatch(client, payloads) {
  if (!payloads.length) {
    return;
  }
  const castSuffixes = ["", "", "", "", "", "", "", "::jsonb"];
  const params = payloads.flatMap(canonicalImageSourceParamValues);
  const valuesSql = buildValuesSql(payloads.length, castSuffixes);
  await client.query(
    `INSERT INTO canonical_image_sources (
      canonical_image_id, image_id, source_system, source_image_id, match_strategy, match_confidence, is_preferred_source, source_payload
    ) VALUES
      ${valuesSql}`,
    params
  );
}

async function truncateCanonicalTables(client) {
  await client.query(`
    TRUNCATE canonical_image_sources, canonical_images, canonical_product_sources, canonical_products
    RESTART IDENTITY CASCADE
  `);
}

async function insertCanonicalProduct(client, payload) {
  const result = await client.query(
    `INSERT INTO canonical_products (
      canonical_key, dp_numeric_id, product_name, brand, description, raw_category, a_level, b_level, c_level,
      product_image_url, website, source_file, image_urls, merge_strategy, merge_confidence, source_count,
      catalog_product_id, image_index_product_id, preferred_name_source, preferred_metadata_source, merged_payload, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7::text[], $8::text[], $9::text[], $10, $11, $12, $13::text[], $14, $15, $16,
      $17, $18, $19, $20, $21::jsonb, NOW()
    ) RETURNING id`,
    [
      payload.canonical_key,
      payload.dp_numeric_id,
      payload.product_name,
      payload.brand,
      payload.description,
      payload.raw_category,
      payload.a_level,
      payload.b_level,
      payload.c_level,
      payload.product_image_url,
      payload.website,
      payload.source_file,
      payload.image_urls,
      payload.merge_strategy,
      payload.merge_confidence,
      payload.source_count,
      payload.catalog_product_id,
      payload.image_index_product_id,
      payload.preferred_name_source,
      payload.preferred_metadata_source,
      JSON.stringify(payload.merged_payload)
    ]
  );
  return result.rows[0].id;
}

async function insertCanonicalProductSource(client, payload) {
  await client.query(
    `INSERT INTO canonical_product_sources (
      canonical_product_id, product_id, source_system, source_product_id, match_strategy, match_confidence,
      is_preferred_metadata_source, is_preferred_name_source, source_payload
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
    [
      payload.canonical_product_id,
      payload.product_id,
      payload.source_system,
      payload.source_product_id,
      payload.match_strategy,
      payload.match_confidence,
      payload.is_preferred_metadata_source,
      payload.is_preferred_name_source,
      JSON.stringify(payload.source_payload)
    ]
  );
}

async function insertCanonicalImage(client, payload) {
  const result = await client.query(
    `INSERT INTO canonical_images (
      canonical_product_id, canonical_image_key, image_url, product_name, brand, a_level, b_level, c_level, category,
      visual_type, family, seating_type, pixelseek_type, type_routing_source, stage_0_result, stage_1_override,
      stage_1_override_result, stage_1_override_reason, effective_classification, enum_fields, field_confidence,
      free_text, reasoning, plan_shape_reasoning, tiebreaker_triggered, confidence_tier, tokens, cost,
      extraction_timestamp, excluded, excluded_reason, image_traits, visual_summary, structured_caption, stage1, stage2, stage3,
      search_text, visual_summary_embedding, search_text_embedding, image_width, image_height, image_short_side, ai_refreshed_at,
      merge_strategy, merge_confidence, source_count, preferred_source_system, catalog_image_id, image_index_image_id,
      is_catalog_primary_image, image_metadata, merged_payload, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6::text[], $7::text[], $8::text[], $9,
      $10, $11, $12, $13, $14, $15, $16::jsonb,
      $17, $18, $19, $20::jsonb, $21::jsonb, $22::jsonb, $23, $24, $25, $26, $27::jsonb, $28::jsonb,
      $29, $30, $31, $32::jsonb, $33, $34, $35::jsonb, $36::jsonb, $37::jsonb,
      $38, $39::vector, $40::vector, $41, $42, $43, $44,
      $45, $46, $47, $48, $49, $50, $51, $52::jsonb, $53::jsonb, NOW()
    ) RETURNING id`,
    [
      payload.canonical_product_id,
      payload.canonical_image_key,
      payload.image_url,
      payload.product_name,
      payload.brand,
      payload.a_level,
      payload.b_level,
      payload.c_level,
      payload.category,
      payload.visual_type,
      payload.family,
      payload.seating_type,
      payload.pixelseek_type,
      payload.type_routing_source,
      payload.stage_0_result,
      JSON.stringify(payload.stage_1_override),
      payload.stage_1_override_result,
      payload.stage_1_override_reason,
      payload.effective_classification,
      JSON.stringify(payload.enum_fields),
      JSON.stringify(payload.field_confidence),
      JSON.stringify(payload.free_text),
      payload.reasoning,
      payload.plan_shape_reasoning,
      payload.tiebreaker_triggered,
      payload.confidence_tier,
      JSON.stringify(payload.tokens),
      JSON.stringify(payload.cost),
      payload.extraction_timestamp,
      payload.excluded,
      payload.excluded_reason,
      JSON.stringify(payload.image_traits),
      payload.visual_summary,
      payload.structured_caption,
      JSON.stringify(payload.stage1),
      JSON.stringify(payload.stage2),
      JSON.stringify(payload.stage3),
      payload.search_text,
      vectorLiteral(payload.visual_summary_embedding),
      vectorLiteral(payload.search_text_embedding),
      payload.image_width,
      payload.image_height,
      payload.image_short_side,
      payload.ai_refreshed_at,
      payload.merge_strategy,
      payload.merge_confidence,
      payload.source_count,
      payload.preferred_source_system,
      payload.catalog_image_id,
      payload.image_index_image_id,
      payload.is_catalog_primary_image,
      JSON.stringify(payload.image_metadata),
      JSON.stringify(payload.merged_payload)
    ]
  );
  return result.rows[0].id;
}

async function insertCanonicalImageSource(client, payload) {
  await client.query(
    `INSERT INTO canonical_image_sources (
      canonical_image_id, image_id, source_system, source_image_id, match_strategy, match_confidence, is_preferred_source, source_payload
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      payload.canonical_image_id,
      payload.image_id,
      payload.source_system,
      payload.source_image_id,
      payload.match_strategy,
      payload.match_confidence,
      payload.is_preferred_source,
      JSON.stringify(payload.source_payload)
    ]
  );
}

async function main() {
  await initializeSchema();
  const readClient = await createDevClient();
  const writeClient = await createDevClient();

  try {
    const catalogProducts = await loadProducts(readClient, CATALOG_SOURCE_SYSTEM);
    const imageIndexProducts = await loadProducts(readClient, IMAGE_INDEX_SOURCE_SYSTEM);
    const catalogImages = await loadImages(readClient, CATALOG_SOURCE_SYSTEM);
    const imageIndexImages = await loadImages(readClient, IMAGE_INDEX_SOURCE_SYSTEM);

    const imageIndexByTail = buildTailIndex(imageIndexProducts);
    const imageIndexByExactName = buildExactNameIndex(imageIndexProducts);
    const imageIndexById = new Map(imageIndexProducts.map((product) => [product.id, product]));
    const catalogImagesByProductId = new Map();
    const imageIndexImagesByProductId = new Map();
    const imageIndexByUrl = buildImageUrlIndex(imageIndexImages);

    for (const image of catalogImages) {
      if (!catalogImagesByProductId.has(image.product_db_id)) {
        catalogImagesByProductId.set(image.product_db_id, []);
      }
      catalogImagesByProductId.get(image.product_db_id).push(image);
    }
    for (const image of imageIndexImages) {
      if (!imageIndexImagesByProductId.has(image.product_db_id)) {
        imageIndexImagesByProductId.set(image.product_db_id, []);
      }
      imageIndexImagesByProductId.get(image.product_db_id).push(image);
    }

    const matchedImageIndexProductIds = new Set();
    const canonicalProductPlans = [];
    const ambiguityLog = [];
    const mergeStats = {
      matched_by_tail: 0,
      matched_by_exact_name: 0,
      catalog_only: 0,
      image_index_only: 0,
      matched_image_pairs: 0
    };

    const unmatchedCatalogProducts = [];

    for (const catalogProduct of catalogProducts) {
      const dpNumericId = tailId(catalogProduct.source_product_id);
      if (dpNumericId) {
        const tailCandidates = imageIndexByTail.get(dpNumericId) || [];
        if (tailCandidates.length > 1) {
          throw new Error(`Ambiguous tail-id product match for ${catalogProduct.source_product_id}: ${tailCandidates.map((item) => item.source_product_id).join(", ")}`);
        }
        if (tailCandidates.length === 1) {
          const imageIndexProduct = tailCandidates[0];
          const matchStrategy = "tail_dp_numeric_id";
          const matchConfidence = "high";
          mergeStats.matched_by_tail += 1;
          matchedImageIndexProductIds.add(imageIndexProduct.id);
          canonicalProductPlans.push({
            catalogProduct,
            imageIndexProduct,
            dpNumericId,
            matchStrategy,
            matchConfidence
          });
          continue;
        }
      }
      unmatchedCatalogProducts.push(catalogProduct);
    }

    for (const catalogProduct of unmatchedCatalogProducts) {
      const dpNumericId = tailId(catalogProduct.source_product_id);
      const exactKey = `${normalizeKey(catalogProduct.brand)}::${normalizeKey(catalogProduct.product_name)}`;
      const exactCandidates = (imageIndexByExactName.get(exactKey) || []).filter(
        (candidate) => !matchedImageIndexProductIds.has(candidate.id)
      );
      if (exactCandidates.length > 1) {
        ambiguityLog.push({
          catalog_product_id: catalogProduct.source_product_id,
          strategy: "exact_brand_name",
          candidates: exactCandidates.map((item) => item.source_product_id)
        });
      } else if (exactCandidates.length === 1) {
        const imageIndexProduct = exactCandidates[0];
        matchedImageIndexProductIds.add(imageIndexProduct.id);
        mergeStats.matched_by_exact_name += 1;
        canonicalProductPlans.push({
          catalogProduct,
          imageIndexProduct,
          dpNumericId,
          matchStrategy: "exact_brand_name",
          matchConfidence: "medium"
        });
      } else {
        mergeStats.catalog_only += 1;
        canonicalProductPlans.push({
          catalogProduct,
          imageIndexProduct: null,
          dpNumericId,
          matchStrategy: "catalog_only",
          matchConfidence: "single_source"
        });
      }
    }

    if (ambiguityLog.length > 0) {
      throw new Error(`Unexpected ambiguous product matches: ${JSON.stringify(ambiguityLog.slice(0, 10))}`);
    }

    for (const imageIndexProduct of imageIndexProducts) {
      if (matchedImageIndexProductIds.has(imageIndexProduct.id)) {
        continue;
      }
      canonicalProductPlans.push({
        catalogProduct: null,
        imageIndexProduct,
        dpNumericId: tailId(imageIndexProduct.source_product_id),
        matchStrategy: "image_index_only",
        matchConfidence: "single_source"
      });
      mergeStats.image_index_only += 1;
    }

    const stagedCanonicalProducts = [];
    const stagedCanonicalProductSources = [];
    const stagedCanonicalImages = [];
    const stagedCanonicalImageSources = [];

    for (const plan of canonicalProductPlans) {
      const canonicalFields = chooseCanonicalProductFields(plan.catalogProduct, plan.imageIndexProduct);
      const canonicalKey = productCanonicalKey({
        matchStrategy: plan.matchStrategy,
        dpNumericId: plan.dpNumericId,
        catalogProduct: plan.catalogProduct,
        imageIndexProduct: plan.imageIndexProduct
      });
      stagedCanonicalProducts.push({
        canonical_key: canonicalKey,
        dp_numeric_id: plan.dpNumericId,
        ...canonicalFields,
        merge_strategy: plan.matchStrategy,
        merge_confidence: plan.matchConfidence,
        source_count: (plan.catalogProduct ? 1 : 0) + (plan.imageIndexProduct ? 1 : 0),
        catalog_product_id: plan.catalogProduct?.id || null,
        image_index_product_id: plan.imageIndexProduct?.id || null,
        merged_payload: {
          catalog_source_product_id: plan.catalogProduct?.source_product_id || "",
          image_index_source_product_id: plan.imageIndexProduct?.source_product_id || "",
          match_strategy: plan.matchStrategy,
          match_confidence: plan.matchConfidence
        }
      });

      if (plan.catalogProduct) {
        stagedCanonicalProductSources.push({
          canonical_product_key: canonicalKey,
          product_id: plan.catalogProduct.id,
          source_system: plan.catalogProduct.source_system,
          source_product_id: plan.catalogProduct.source_product_id,
          match_strategy: plan.matchStrategy,
          match_confidence: plan.matchConfidence,
          is_preferred_metadata_source: canonicalFields.preferred_metadata_source === CATALOG_SOURCE_SYSTEM,
          is_preferred_name_source: canonicalFields.preferred_name_source === CATALOG_SOURCE_SYSTEM,
          source_payload: normalizeJson(plan.catalogProduct.raw_payload)
        });
      }
      if (plan.imageIndexProduct) {
        stagedCanonicalProductSources.push({
          canonical_product_key: canonicalKey,
          product_id: plan.imageIndexProduct.id,
          source_system: plan.imageIndexProduct.source_system,
          source_product_id: plan.imageIndexProduct.source_product_id,
          match_strategy: plan.matchStrategy,
          match_confidence: plan.matchConfidence,
          is_preferred_metadata_source: canonicalFields.preferred_metadata_source === IMAGE_INDEX_SOURCE_SYSTEM,
          is_preferred_name_source: canonicalFields.preferred_name_source === IMAGE_INDEX_SOURCE_SYSTEM,
          source_payload: normalizeJson(plan.imageIndexProduct.raw_payload)
        });
      }

      const catalogProductImages = plan.catalogProduct ? (catalogImagesByProductId.get(plan.catalogProduct.id) || []) : [];
      const imageIndexProductImages = plan.imageIndexProduct ? (imageIndexImagesByProductId.get(plan.imageIndexProduct.id) || []) : [];
      const matchedImageIndexImageIds = new Set();

      for (const catalogImage of catalogProductImages) {
        const url = normalizeText(catalogImage.image_url);
        const candidates = (imageIndexByUrl.get(url) || []).filter((item) => plan.imageIndexProduct && item.product_db_id === plan.imageIndexProduct.id);
        if (candidates.length > 1) {
          throw new Error(`Ambiguous image URL match for ${catalogImage.source_image_id}: ${candidates.map((item) => item.source_image_id).join(", ")}`);
        }
        const imageIndexImage = candidates.length === 1 ? candidates[0] : null;
        if (imageIndexImage) {
          matchedImageIndexImageIds.add(imageIndexImage.id);
          mergeStats.matched_image_pairs += 1;
        }

        const canonicalImageFields = chooseCanonicalImageFields(catalogImage, imageIndexImage, canonicalFields);
        const canonicalImageKey = imageCanonicalKey(canonicalKey, canonicalImageFields.image_url, catalogImage.source_image_id);
        stagedCanonicalImages.push({
          canonical_product_key: canonicalKey,
          canonical_image_key: canonicalImageKey,
          ...canonicalImageFields,
          merge_strategy: imageIndexImage ? "image_url" : catalogImage.source_system,
          merge_confidence: imageIndexImage ? "high" : "single_source",
          source_count: imageIndexImage ? 2 : 1,
          catalog_image_id: catalogImage.id,
          image_index_image_id: imageIndexImage?.id || null,
          merged_payload: {
            catalog_source_image_id: catalogImage.source_image_id,
            image_index_source_image_id: imageIndexImage?.source_image_id || "",
            image_merge_strategy: imageIndexImage ? "image_url" : "catalog_only"
          }
        });

        stagedCanonicalImageSources.push({
          canonical_image_key: canonicalImageKey,
          image_id: catalogImage.id,
          source_system: catalogImage.source_system,
          source_image_id: catalogImage.source_image_id,
          match_strategy: imageIndexImage ? "image_url" : "single_source",
          match_confidence: imageIndexImage ? "high" : "single_source",
          is_preferred_source: !imageIndexImage,
          source_payload: normalizeJson(catalogImage.raw_payload)
        });

        if (imageIndexImage) {
          stagedCanonicalImageSources.push({
            canonical_image_key: canonicalImageKey,
            image_id: imageIndexImage.id,
            source_system: imageIndexImage.source_system,
            source_image_id: imageIndexImage.source_image_id,
            match_strategy: "image_url",
            match_confidence: "high",
            is_preferred_source: true,
            source_payload: normalizeJson(imageIndexImage.raw_payload)
          });
        }
      }

      for (const imageIndexImage of imageIndexProductImages) {
        if (matchedImageIndexImageIds.has(imageIndexImage.id)) {
          continue;
        }
        const canonicalImageFields = chooseCanonicalImageFields(null, imageIndexImage, canonicalFields);
        const canonicalImageKey = imageCanonicalKey(canonicalKey, canonicalImageFields.image_url, imageIndexImage.source_image_id);
        stagedCanonicalImages.push({
          canonical_product_key: canonicalKey,
          canonical_image_key: canonicalImageKey,
          ...canonicalImageFields,
          merge_strategy: imageIndexImage.source_system,
          merge_confidence: "single_source",
          source_count: 1,
          catalog_image_id: null,
          image_index_image_id: imageIndexImage.id,
          merged_payload: {
            catalog_source_image_id: "",
            image_index_source_image_id: imageIndexImage.source_image_id,
            image_merge_strategy: "image_index_only"
          }
        });

        stagedCanonicalImageSources.push({
          canonical_image_key: canonicalImageKey,
          image_id: imageIndexImage.id,
          source_system: imageIndexImage.source_system,
          source_image_id: imageIndexImage.source_image_id,
          match_strategy: "single_source",
          match_confidence: "single_source",
          is_preferred_source: true,
          source_payload: normalizeJson(imageIndexImage.raw_payload)
        });
      }
    }

    await writeClient.query("BEGIN");
    try {
      await truncateCanonicalTables(writeClient);
      await writeClient.query("COMMIT");
    } catch (error) {
      await writeClient.query("ROLLBACK");
      throw error;
    }

    const canonicalProductIdByKey = new Map();
    const canonicalImageIdByKey = new Map();

    await runBatchedMutations(
      writeClient,
      "canonical_products",
      stagedCanonicalProducts,
      async (payload) => {
        const canonicalProductId = await insertCanonicalProduct(writeClient, payload);
        canonicalProductIdByKey.set(payload.canonical_key, canonicalProductId);
      }
    );

    await runBatchedMutations(
      writeClient,
      "canonical_product_sources",
      stagedCanonicalProductSources,
      async (payload) => {
        await insertCanonicalProductSource(writeClient, {
          ...payload,
          canonical_product_id: canonicalProductIdByKey.get(payload.canonical_product_key)
        });
      }
    );

    const imageBatches = chunkArray(stagedCanonicalImages, IMAGE_INSERT_BATCH_SIZE);
    const imageStartedAt = Date.now();
    let insertedImages = 0;
    for (const batch of imageBatches) {
      const resolvedBatch = batch.map((payload) => ({
        ...payload,
        canonical_product_id: canonicalProductIdByKey.get(payload.canonical_product_key)
      }));
      await writeClient.query("BEGIN");
      try {
        const insertedRows = await insertCanonicalImagesBatch(writeClient, resolvedBatch);
        for (const row of insertedRows) {
          canonicalImageIdByKey.set(row.canonical_image_key, row.id);
        }
        await writeClient.query("COMMIT");
      } catch (error) {
        await writeClient.query("ROLLBACK");
        throw error;
      }
      insertedImages += batch.length;
      console.log(
        `[merge-canonical] canonical_images: ${insertedImages}/${stagedCanonicalImages.length} inserted (${Math.round((insertedImages / stagedCanonicalImages.length) * 100)}%) after ${formatDuration(Date.now() - imageStartedAt)}`
      );
    }

    const imageSourceBatches = chunkArray(stagedCanonicalImageSources, DEFAULT_BATCH_SIZE);
    const imageSourceStartedAt = Date.now();
    let insertedImageSources = 0;
    for (const batch of imageSourceBatches) {
      const resolvedBatch = batch.map((payload) => ({
        ...payload,
        canonical_image_id: canonicalImageIdByKey.get(payload.canonical_image_key)
      }));
      await writeClient.query("BEGIN");
      try {
        await insertCanonicalImageSourcesBatch(writeClient, resolvedBatch);
        await writeClient.query("COMMIT");
      } catch (error) {
        await writeClient.query("ROLLBACK");
        throw error;
      }
      insertedImageSources += batch.length;
      console.log(
        `[merge-canonical] canonical_image_sources: ${insertedImageSources}/${stagedCanonicalImageSources.length} inserted (${Math.round((insertedImageSources / stagedCanonicalImageSources.length) * 100)}%) after ${formatDuration(Date.now() - imageSourceStartedAt)}`
      );
    }

    console.log(
      JSON.stringify(
        {
          canonical_products_expected: canonicalProductPlans.length,
          canonical_images_expected: stagedCanonicalImages.length,
          canonical_product_sources_expected: stagedCanonicalProductSources.length,
          canonical_image_sources_expected: stagedCanonicalImageSources.length,
          matched_by_tail: mergeStats.matched_by_tail,
          matched_by_exact_name: mergeStats.matched_by_exact_name,
          catalog_only: mergeStats.catalog_only,
          image_index_only: mergeStats.image_index_only,
          matched_image_pairs: mergeStats.matched_image_pairs
        },
        null,
        2
      )
    );
  } catch (error) {
    throw error;
  } finally {
    await readClient.end();
    await writeClient.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
