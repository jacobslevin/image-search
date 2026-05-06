import {
  getAllCategoryTerms,
  getCategoryDisplayLabel,
  getEffectiveClassification,
  getLeafCategories,
  normalizeVisualTypeKey
} from "./utils.js";
import { parseVectorLiteral, queryPostgres, vectorToSqlLiteral } from "./postgres.js";

const SEARCH_CANDIDATE_LIMIT = 3000;

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

function normalizeArray(value) {
  return Array.isArray(value) ? value.filter(Boolean).map((entry) => String(entry)) : [];
}

function normalizeText(value) {
  return value == null ? "" : String(value);
}

function serializeTimestamp(value) {
  if (!value) {
    return "";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function mapCanonicalProductRow(row) {
  return {
    product_id: normalizeText(row.canonical_key),
    product_name: normalizeText(row.product_name),
    name: normalizeText(row.product_name),
    brand: normalizeText(row.brand),
    description: normalizeText(row.description),
    raw_category: normalizeText(row.raw_category),
    a_level: normalizeArray(row.a_level),
    b_level: normalizeArray(row.b_level),
    c_level: normalizeArray(row.c_level),
    product_image: normalizeText(row.product_image_url),
    website: normalizeText(row.website),
    source_file: normalizeText(row.source_file),
    image_urls: normalizeArray(row.image_urls)
  };
}

function mapCanonicalImageRow(row) {
  const visualType = normalizeVisualTypeKey(row.visual_type || row.seating_type || "");
  return {
    image_id: normalizeText(row.canonical_image_key),
    image_url: normalizeText(row.image_url),
    product_id: normalizeText(row.canonical_key),
    product_name: normalizeText(row.product_name),
    name: normalizeText(row.product_name),
    brand: normalizeText(row.brand),
    a_level: normalizeArray(row.a_level),
    b_level: normalizeArray(row.b_level),
    c_level: normalizeArray(row.c_level),
    stage_0_result: normalizeText(row.stage_0_result),
    stage_1_override: row.stage_1_override && typeof row.stage_1_override === "object" ? row.stage_1_override : {},
    stage_1_override_result: normalizeText(row.stage_1_override_result),
    stage_1_override_reason: normalizeText(row.stage_1_override_reason),
    effective_classification: normalizeText(row.effective_classification),
    seating_type: visualType,
    visual_type: visualType,
    family: normalizeText(row.family),
    pixelseek_type: normalizeText(row.pixelseek_type),
    type_routing_source: normalizeText(row.type_routing_source),
    enum_fields: row.enum_fields && typeof row.enum_fields === "object" ? row.enum_fields : {},
    field_confidence: row.field_confidence && typeof row.field_confidence === "object" ? row.field_confidence : {},
    free_text: row.free_text && typeof row.free_text === "object" ? row.free_text : {},
    reasoning: normalizeText(row.reasoning),
    plan_shape_reasoning: normalizeText(row.plan_shape_reasoning),
    tiebreaker_triggered: typeof row.tiebreaker_triggered === "boolean" ? row.tiebreaker_triggered : null,
    confidence_tier: normalizeText(row.confidence_tier),
    tokens: row.tokens && typeof row.tokens === "object" ? row.tokens : {},
    cost: row.cost && typeof row.cost === "object" ? row.cost : {},
    extraction_timestamp: serializeTimestamp(row.extraction_timestamp),
    excluded: row.excluded === true,
    excluded_reason: normalizeText(row.excluded_reason),
    image_traits: row.image_traits && typeof row.image_traits === "object" ? row.image_traits : {},
    visual_summary: normalizeText(row.visual_summary),
    structured_caption: normalizeText(row.structured_caption),
    stage1: row.stage1 && typeof row.stage1 === "object"
      ? { ...row.stage1, visual_type: visualType, seating_type: visualType }
      : { visual_type: visualType, seating_type: visualType },
    stage2: row.stage2 && typeof row.stage2 === "object" ? row.stage2 : {},
    stage3: row.stage3 && typeof row.stage3 === "object" ? row.stage3 : {},
    visual_summary_embedding: parseVectorLiteral(row.visual_summary_embedding),
    search_text_embedding: parseVectorLiteral(row.search_text_embedding),
    search_text: normalizeText(row.search_text),
    image_width: Number.isFinite(row.image_width) ? row.image_width : null,
    image_height: Number.isFinite(row.image_height) ? row.image_height : null,
    image_short_side: Number.isFinite(row.image_short_side) ? row.image_short_side : null,
    ai_refreshed_at: serializeTimestamp(row.ai_refreshed_at),
    is_room_scene: false
  };
}

function buildIndexFromJoinedRows(rows = []) {
  const products = [];
  const images = [];
  const productMap = new Map();
  const brandSet = new Set();

  for (const row of rows) {
    const productId = normalizeText(row.canonical_key);
    if (!productMap.has(productId)) {
      const product = mapCanonicalProductRow(row);
      productMap.set(productId, product);
      products.push(product);
      if (product.brand) {
        brandSet.add(product.brand);
      }
    }
    images.push(mapCanonicalImageRow(row));
  }

  return {
    generated_at: new Date().toISOString(),
    brands: [...brandSet].sort((left, right) => left.localeCompare(right)),
    products,
    images
  };
}

async function fetchCanonicalJoinedRows(whereSql = "", params = [], orderSql = "") {
  const sql = `
    SELECT
      cp.id AS canonical_product_id,
      cp.canonical_key,
      cp.dp_numeric_id,
      cp.product_name,
      cp.brand,
      cp.description,
      cp.raw_category,
      cp.a_level,
      cp.b_level,
      cp.c_level,
      cp.product_image_url,
      cp.website,
      cp.source_file,
      cp.image_urls,
      ci.id AS canonical_image_id,
      ci.canonical_image_key,
      ci.image_url,
      ci.category,
      ci.visual_type,
      ci.family,
      ci.seating_type,
      ci.pixelseek_type,
      ci.type_routing_source,
      ci.stage_0_result,
      ci.stage_1_override,
      ci.stage_1_override_result,
      ci.stage_1_override_reason,
      ci.effective_classification,
      ci.enum_fields,
      ci.field_confidence,
      ci.free_text,
      ci.reasoning,
      ci.plan_shape_reasoning,
      ci.tiebreaker_triggered,
      ci.confidence_tier,
      ci.tokens,
      ci.cost,
      ci.extraction_timestamp,
      ci.excluded,
      ci.excluded_reason,
      ci.image_traits,
      ci.visual_summary,
      ci.structured_caption,
      ci.stage1,
      ci.stage2,
      ci.stage3,
      ci.visual_summary_embedding,
      ci.search_text_embedding,
      ci.search_text,
      ci.image_width,
      ci.image_height,
      ci.image_short_side,
      ci.ai_refreshed_at
    FROM canonical_images ci
    JOIN canonical_products cp ON cp.id = ci.canonical_product_id
    ${whereSql}
    ${orderSql}
  `;
  const result = await queryPostgres(sql, params);
  return result.rows;
}

export async function loadCanonicalBootstrapData() {
  const [countsResult, productResult] = await Promise.all([
    queryPostgres(
      `SELECT
        (SELECT count(*)::int FROM canonical_products) AS products,
        (SELECT count(*)::int FROM canonical_images) AS images,
        (SELECT count(*)::int FROM canonical_images WHERE visual_summary_embedding IS NOT NULL OR search_text_embedding IS NOT NULL) AS indexed_images`
    ),
    queryPostgres(`SELECT canonical_key, product_name, brand, raw_category, a_level, b_level, c_level FROM canonical_products ORDER BY product_name`)
  ]);

  const products = productResult.rows.map(mapCanonicalProductRow);
  const brands = [...new Set(products.map((product) => product.brand).filter(Boolean))].sort((left, right) => left.localeCompare(right));
  const categories = [...new Set(products.flatMap((product) => getLeafCategories(product)).filter(Boolean))].sort((left, right) => left.localeCompare(right));
  const counts = countsResult.rows[0] || { products: 0, images: 0, indexed_images: 0 };

  return {
    has_index: Number(counts.indexed_images || 0) > 0,
    brands,
    categories,
    stats: {
      products: Number(counts.products || 0),
      images: Number(counts.images || 0)
    }
  };
}

export async function loadCanonicalBrowseIndex() {
  const rows = await fetchCanonicalJoinedRows("", [], "ORDER BY cp.product_name, ci.id");
  const index = buildIndexFromJoinedRows(rows);
  return {
    catalog: {
      generated_at: index.generated_at,
      totals: {
        products: index.products.length,
        images: index.images.length
      },
      brands: index.brands,
      products: index.products
    },
    index
  };
}

export async function loadCanonicalSearchIndex({
  queryEmbedding = [],
  brand = "",
  compatibleVisualTypes = [],
  sourceImageUrl = "",
  includeSourceImage = false,
  limit = SEARCH_CANDIDATE_LIMIT
}) {
  const vectorLiteral = vectorToSqlLiteral(queryEmbedding);
  if (!vectorLiteral) {
    return {
      generated_at: new Date().toISOString(),
      brands: [],
      products: [],
      images: []
    };
  }

  const params = [];
  const clauses = [
    `(ci.search_text_embedding IS NOT NULL OR ci.visual_summary_embedding IS NOT NULL)`,
    `ci.effective_classification = 'product'`,
    `ci.excluded = false`
  ];

  params.push(vectorLiteral);
  const distanceSql = `(
    CASE
      WHEN ci.search_text_embedding IS NOT NULL THEN ci.search_text_embedding
      ELSE ci.visual_summary_embedding
    END <=> $${params.length}::vector
  )`;

  const normalizedBrand = normalizeText(brand).trim();
  if (normalizedBrand) {
    params.push(normalizedBrand);
    clauses.push(`cp.brand = $${params.length}`);
  }

  const normalizedVisualTypes = (Array.isArray(compatibleVisualTypes) ? compatibleVisualTypes : [])
    .map((value) => normalizeVisualTypeKey(value))
    .filter(Boolean);
  if (normalizedVisualTypes.length) {
    params.push(normalizedVisualTypes);
    clauses.push(`ci.visual_type = ANY($${params.length}::text[])`);
  }

  const canonicalSourceImageUrl = canonicalizeImageUrl(sourceImageUrl);
  if (canonicalSourceImageUrl && !includeSourceImage) {
    params.push(canonicalSourceImageUrl);
    clauses.push(`regexp_replace(ci.image_url, '[#?].*$', '') <> $${params.length}`);
  }

  params.push(Math.max(1, Number(limit) || SEARCH_CANDIDATE_LIMIT));
  const limitPlaceholder = `$${params.length}`;

  const rows = await fetchCanonicalJoinedRows(
    `WHERE ${clauses.join(" AND ")}`,
    params,
    `ORDER BY ${distanceSql} ASC, cp.canonical_key, ci.id LIMIT ${limitPlaceholder}`
  );

  const includeExactSourceImage = canonicalSourceImageUrl && includeSourceImage;
  if (includeExactSourceImage) {
    const exactRows = await fetchCanonicalJoinedRows(
      `WHERE regexp_replace(ci.image_url, '[#?].*$', '') = $1`,
      [canonicalSourceImageUrl]
    );
      const seen = new Set(rows.map((row) => `${row.canonical_key}::${row.canonical_image_key}`));
      for (const row of exactRows) {
      const key = `${row.canonical_key}::${row.canonical_image_key}`;
      if (!seen.has(key)) {
        rows.push(row);
        seen.add(key);
      }
    }
  }

  return buildIndexFromJoinedRows(rows);
}

export async function findCanonicalProductTargetEmbedding(canonicalProductKey = "") {
  const productKey = normalizeText(canonicalProductKey).trim();
  if (!productKey) {
    return null;
  }
  const result = await queryPostgres(
    `SELECT visual_summary_embedding
     FROM canonical_images
     WHERE canonical_product_id = (
       SELECT id FROM canonical_products WHERE canonical_key = $1
     )
       AND effective_classification = 'product'
       AND visual_summary_embedding IS NOT NULL
     ORDER BY
       CASE lower(confidence_tier)
         WHEN 'high' THEN 3
         WHEN 'medium' THEN 2
         WHEN 'low' THEN 1
         ELSE 0
       END DESC,
       ai_refreshed_at DESC NULLS LAST,
       id ASC
     LIMIT 1`,
    [productKey]
  );
  if (!result.rows.length) {
    return null;
  }
  return parseVectorLiteral(result.rows[0].visual_summary_embedding);
}
