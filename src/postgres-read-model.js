import {
  getAllCategoryTerms,
  getCategoryDisplayLabel,
  getEffectiveClassification,
  getLeafCategories,
  normalizeVisualTypeKey
} from "./utils.js";
import { parseVectorLiteral, queryPostgres, vectorToSqlLiteral } from "./postgres.js";

const SEARCH_CANDIDATE_LIMIT = 1000;
const BOOTSTRAP_CACHE_TTL_MS = 60 * 1000;

let canonicalBootstrapCache = {
  expiresAt: 0,
  value: null
};

const CANONICAL_PRODUCT_SELECT = `
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
  cp.image_urls
`;

const CANONICAL_IMAGE_SELECT = `
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
`;

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

function formatDetectedTraits(imageTraits = {}, typeKey = "", limit = 6) {
  void typeKey;
  const labels = new Map([
    ["height_category", "Height"],
    ["height_adjustability", "Adjustability"],
    ["back", "Back"],
    ["base_type", "Base"],
    ["base_frame_finish", "Base Finish"],
    ["seat_material", "Seat"],
    ["seat_fabric", "Fabric"],
    ["design_register", "Design"],
    ["shape_character", "Shape"],
    ["plan_shape", "Plan shape"],
    ["seat_construction", "Seat Construction"],
    ["narrow_arms", "Arm Width"],
    ["arms_flush_with_back", "Arm Height"],
    ["base_finish", "Base Finish"],
    ["frame", "Frame"],
    ["back_style", "Back"],
    ["arm_option", "Arms"],
    ["seat_upholstery", "Seat"],
    ["shell_material", "Shell"],
    ["body_construction", "Body"],
    ["top_shape", "Top Shape"],
    ["top_material", "Top Material"],
    ["base_visual_weight", "Base Weight"],
    ["mobility", "Mobility"],
    ["top_thickness", "Top Thickness"],
    ["edge_profile", "Edge Profile"],
    ["height_register", "Height"],
    ["power_data_integration", "Power/Data"]
  ]);

  return Object.entries(imageTraits || {})
    .map(([field, value]) => {
      const normalized = String(value ?? "").trim();
      if (!normalized || ["unknown", "n/a"].includes(normalized.toLowerCase())) {
        return "";
      }
      return `${labels.get(field) || field.replace(/_/g, " ")}: ${normalized}`;
    })
    .filter(Boolean)
    .slice(0, limit);
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
      ${CANONICAL_PRODUCT_SELECT},
      ${CANONICAL_IMAGE_SELECT}
    FROM canonical_images ci
    JOIN canonical_products cp ON cp.id = ci.canonical_product_id
    ${whereSql}
    ${orderSql}
  `;
  const result = await queryPostgres(sql, params);
  return result.rows;
}

function buildBrowseResultFromRow(row = {}) {
  const productId = normalizeText(row.canonical_key);
  const productName = normalizeText(row.product_name);
  const brand = normalizeText(row.brand);
  const website = normalizeText(row.website);
  const productImageUrl = normalizeText(row.product_image_url);
  const heroImage = row.canonical_image_key
    ? {
        image_id: normalizeText(row.canonical_image_key),
        image_url: normalizeText(row.image_url),
        stage_0_result: normalizeText(row.stage_0_result),
        effective_classification: normalizeText(row.effective_classification),
        seating_type: normalizeVisualTypeKey(row.seating_type || row.visual_type || ""),
        visual_type: normalizeVisualTypeKey(row.visual_type || row.seating_type || ""),
        confidence_tier: normalizeText(row.confidence_tier) || "high"
      }
    : null;
  const imageTraits = row.detected_traits_source && typeof row.detected_traits_source === "object"
    ? row.detected_traits_source
    : {};
  const bestImageUrl = heroImage?.image_url || productImageUrl || "";
  const imageUrls = bestImageUrl ? [bestImageUrl] : [];

  return {
    product_id: productId,
    name: productName,
    brand,
    website,
    category: getCategoryDisplayLabel(row),
    category_tags: getLeafCategories(row),
    filter_categories: getAllCategoryTerms(row),
    ai_refreshed_at: serializeTimestamp(row.ai_refreshed_at),
    best_image_url: bestImageUrl,
    image_urls: imageUrls,
    score: 1,
    matched_traits: heroImage
      ? formatDetectedTraits(imageTraits, heroImage.seating_type, 3)
      : [],
    debug: {
      structured_caption: "",
      visual_description: "",
      plan_shape_reasoning: "",
      visual_highlights: [],
      detected_traits: heroImage
        ? formatDetectedTraits(imageTraits, heroImage.seating_type, 6)
        : []
    },
    image_count: imageUrls.length,
    match_count: imageUrls.length || 1,
    matching_images: heroImage
      ? [{
          image_id: heroImage.image_id,
          image_url: heroImage.image_url,
          stage_0_result: heroImage.stage_0_result,
          effective_classification: getEffectiveClassification(heroImage),
          seating_type: heroImage.seating_type,
          visual_type: heroImage.visual_type,
          matched_traits: [],
          trait_contributions: {},
          enum_fields: {},
          free_text: {},
          visual_summary_embedding: [],
          score: 1,
          confidence_tier: heroImage.confidence_tier
        }]
      : [],
    hero_image: heroImage
      ? {
          image_id: heroImage.image_id,
          image_url: heroImage.image_url,
          stage_0_result: heroImage.stage_0_result,
          effective_classification: getEffectiveClassification(heroImage),
          seating_type: heroImage.seating_type,
          visual_type: heroImage.visual_type,
          matched_traits: [],
          trait_contributions: {},
          enum_fields: {},
          free_text: {},
          visual_summary_embedding: [],
          score: 1,
          confidence_tier: heroImage.confidence_tier
        }
      : null,
    scene_filter: null,
    scene_filter_results: []
  };
}

export async function loadCanonicalBrowseResults({ compatibleVisualTypes = [] } = {}) {
  const normalizedVisualTypes = (Array.isArray(compatibleVisualTypes) ? compatibleVisualTypes : [])
    .map((value) => normalizeVisualTypeKey(value))
    .filter(Boolean);
  const params = [];
  const visualTypeFilterSql = normalizedVisualTypes.length
    ? (() => {
        params.push(normalizedVisualTypes);
        return `AND ci.visual_type = ANY($${params.length}::text[])`;
      })()
    : "";
  const sql = `
    SELECT
      cp.canonical_key,
      cp.product_name,
      cp.brand,
      cp.raw_category,
      cp.a_level,
      cp.b_level,
      cp.c_level,
      cp.product_image_url,
      cp.website,
      hero.canonical_image_key,
      hero.image_url,
      hero.visual_type,
      hero.seating_type,
      hero.stage_0_result,
      hero.effective_classification,
      hero.detected_traits_source,
      hero.confidence_tier,
      hero.ai_refreshed_at
    FROM canonical_products cp
    LEFT JOIN LATERAL (
      SELECT
        ci.canonical_image_key,
        ci.image_url,
        ci.visual_type,
        ci.seating_type,
        ci.stage_0_result,
        ci.effective_classification,
        COALESCE(ci.enum_fields, ci.image_traits, '{}'::jsonb) AS detected_traits_source,
        ci.confidence_tier,
        ci.ai_refreshed_at
      FROM canonical_images ci
      WHERE ci.canonical_product_id = cp.id
        AND ci.excluded = false
        ${visualTypeFilterSql}
      ORDER BY
        CASE WHEN ci.effective_classification = 'product' THEN 0 ELSE 1 END,
        CASE WHEN ci.is_catalog_primary_image THEN 0 ELSE 1 END,
        ci.ai_refreshed_at DESC NULLS LAST,
        ci.id ASC
      LIMIT 1
    ) hero ON true
    ${normalizedVisualTypes.length ? "WHERE hero.canonical_image_key IS NOT NULL" : ""}
    ORDER BY cp.product_name, cp.id
  `;
  const result = await queryPostgres(sql, params);
  return result.rows.map(buildBrowseResultFromRow);
}

async function fetchCanonicalRankedSearchRows({
  whereSql = "",
  params = [],
  distanceSql = "",
  limit = SEARCH_CANDIDATE_LIMIT
}) {
  const sql = `
    WITH ranked_images AS (
      SELECT
        ci.*,
        ${distanceSql} AS vector_distance
      FROM canonical_images ci
      ${whereSql}
      ORDER BY ${distanceSql} ASC, ci.canonical_product_id, ci.id
      LIMIT $${params.length + 1}
    )
    SELECT
      ${CANONICAL_PRODUCT_SELECT},
      ranked.id AS canonical_image_id,
      ranked.canonical_image_key,
      ranked.image_url,
      ranked.category,
      ranked.visual_type,
      ranked.family,
      ranked.seating_type,
      ranked.pixelseek_type,
      ranked.type_routing_source,
      ranked.stage_0_result,
      ranked.stage_1_override,
      ranked.stage_1_override_result,
      ranked.stage_1_override_reason,
      ranked.effective_classification,
      ranked.enum_fields,
      ranked.field_confidence,
      ranked.free_text,
      ranked.reasoning,
      ranked.plan_shape_reasoning,
      ranked.tiebreaker_triggered,
      ranked.confidence_tier,
      ranked.tokens,
      ranked.cost,
      ranked.extraction_timestamp,
      ranked.excluded,
      ranked.excluded_reason,
      ranked.image_traits,
      ranked.visual_summary,
      ranked.structured_caption,
      ranked.stage1,
      ranked.stage2,
      ranked.stage3,
      ranked.visual_summary_embedding,
      ranked.search_text_embedding,
      ranked.search_text,
      ranked.image_width,
      ranked.image_height,
      ranked.image_short_side,
      ranked.ai_refreshed_at
    FROM ranked_images ranked
    JOIN canonical_products cp ON cp.id = ranked.canonical_product_id
    ORDER BY ranked.vector_distance ASC, cp.canonical_key, ranked.id
  `;
  const result = await queryPostgres(sql, [...params, limit]);
  return result.rows;
}

function buildSearchClauses({
  brand = "",
  compatibleVisualTypes = [],
  sourceImageUrl = "",
  includeSourceImage = false,
  embeddingColumn = "search_text_embedding"
}) {
  const params = [];
  const clauses = [
    `ci.${embeddingColumn} IS NOT NULL`,
    `ci.effective_classification = 'product'`,
    `ci.excluded = false`
  ];

  const normalizedBrand = normalizeText(brand).trim();
  if (normalizedBrand) {
    params.push(normalizedBrand);
    clauses.push(`ci.brand = $${params.length}`);
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

  return {
    params,
    clauses,
    canonicalSourceImageUrl
  };
}

export async function loadCanonicalBootstrapData() {
  const now = Date.now();
  if (canonicalBootstrapCache.value && canonicalBootstrapCache.expiresAt > now) {
    return canonicalBootstrapCache.value;
  }

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

  const payload = {
    has_index: Number(counts.indexed_images || 0) > 0,
    brands,
    categories,
    stats: {
      products: Number(counts.products || 0),
      images: Number(counts.images || 0)
    }
  };

  canonicalBootstrapCache = {
    expiresAt: now + BOOTSTRAP_CACHE_TTL_MS,
    value: payload
  };

  return payload;
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

  const effectiveLimit = Math.max(1, Number(limit) || SEARCH_CANDIDATE_LIMIT);
  const primarySearch = buildSearchClauses({
    brand,
    compatibleVisualTypes,
    sourceImageUrl,
    includeSourceImage,
    embeddingColumn: "search_text_embedding"
  });
  primarySearch.params.unshift(vectorLiteral);
  const primaryDistanceSql = `ci.search_text_embedding <=> $1::vector`;

  const rows = await fetchCanonicalRankedSearchRows({
    whereSql: `WHERE ${primarySearch.clauses.map((clause, index) => clause.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + 1}`)).join(" AND ")}`,
    params: primarySearch.params,
    distanceSql: primaryDistanceSql,
    limit: effectiveLimit
  });

  if (rows.length < effectiveLimit) {
    const fallbackSearch = buildSearchClauses({
      brand,
      compatibleVisualTypes,
      sourceImageUrl,
      includeSourceImage,
      embeddingColumn: "visual_summary_embedding"
    });
    fallbackSearch.params.unshift(vectorLiteral);
    const fallbackDistanceSql = `ci.visual_summary_embedding <=> $1::vector`;
    const fallbackRows = await fetchCanonicalRankedSearchRows({
      whereSql: `WHERE ${
        [
          ...fallbackSearch.clauses.map((clause, index) => clause.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + 1}`)),
          `ci.search_text_embedding IS NULL`
        ].join(" AND ")
      }`,
      params: fallbackSearch.params,
      distanceSql: fallbackDistanceSql,
      limit: effectiveLimit - rows.length
    });
    const seen = new Set(rows.map((row) => `${row.canonical_key}::${row.canonical_image_key}`));
    for (const row of fallbackRows) {
      const key = `${row.canonical_key}::${row.canonical_image_key}`;
      if (!seen.has(key)) {
        rows.push(row);
        seen.add(key);
      }
    }
  }

  const includeExactSourceImage = primarySearch.canonicalSourceImageUrl && includeSourceImage;
  if (includeExactSourceImage) {
    const exactRows = await fetchCanonicalJoinedRows(
      `WHERE regexp_replace(ci.image_url, '[#?].*$', '') = $1`,
      [primarySearch.canonicalSourceImageUrl]
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

export async function fetchCanonicalStoredImageContext({
  canonicalProductKey = "",
  canonicalImageKey = ""
} = {}) {
  const productKey = normalizeText(canonicalProductKey).trim();
  const imageKey = normalizeText(canonicalImageKey).trim();
  if (!productKey && !imageKey) {
    return null;
  }
  const result = imageKey
    ? await queryPostgres(
      `SELECT
         cp.canonical_key,
         ci.canonical_image_key,
         ci.image_url,
         ci.visual_type,
         ci.seating_type,
         ci.enum_fields,
         ci.visual_summary,
         ci.structured_caption,
         ci.visual_summary_embedding
       FROM canonical_images ci
       JOIN canonical_products cp ON cp.id = ci.canonical_product_id
       WHERE ci.canonical_image_key = $1
         AND ($2 = '' OR cp.canonical_key = $2)
         AND ci.effective_classification = 'product'
         AND ci.visual_summary_embedding IS NOT NULL
       ORDER BY
         CASE lower(ci.confidence_tier)
           WHEN 'high' THEN 3
           WHEN 'medium' THEN 2
           WHEN 'low' THEN 1
           ELSE 0
         END DESC,
         ci.ai_refreshed_at DESC NULLS LAST,
         ci.id ASC
       LIMIT 1`,
      [imageKey, productKey]
    )
    : await queryPostgres(
      `SELECT
         cp.canonical_key,
         ci.canonical_image_key,
         ci.image_url,
         ci.visual_type,
         ci.seating_type,
         ci.enum_fields,
         ci.visual_summary,
         ci.structured_caption,
         ci.visual_summary_embedding
       FROM canonical_images ci
       JOIN canonical_products cp ON cp.id = ci.canonical_product_id
       WHERE cp.canonical_key = $1
         AND ci.effective_classification = 'product'
         AND ci.visual_summary_embedding IS NOT NULL
       ORDER BY
         CASE lower(ci.confidence_tier)
           WHEN 'high' THEN 3
           WHEN 'medium' THEN 2
           WHEN 'low' THEN 1
           ELSE 0
         END DESC,
         ci.ai_refreshed_at DESC NULLS LAST,
         ci.id ASC
       LIMIT 1`,
      [productKey]
    );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const visualType = normalizeVisualTypeKey(row.visual_type || row.seating_type || "");
  return {
    product_id: normalizeText(row.canonical_key),
    image_id: normalizeText(row.canonical_image_key),
    image_url: normalizeText(row.image_url),
    visual_type: visualType,
    seating_type: visualType,
    enum_fields: row.enum_fields && typeof row.enum_fields === "object" ? row.enum_fields : {},
    visual_summary: normalizeText(row.visual_summary),
    structured_caption: normalizeText(row.structured_caption),
    visual_summary_embedding: parseVectorLiteral(row.visual_summary_embedding)
  };
}
