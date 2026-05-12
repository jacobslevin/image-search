import {
  getAllCategoryTerms,
  getCategoryGroupingKey,
  getCategoryLevels,
  getEffectiveClassification,
  normalizeVisualTypeKey
} from "./utils.js";

function tailId(productId = "") {
  const match = String(productId || "").match(/(\d+)$/);
  return match ? match[1] : "";
}

function isDpProductId(productId = "") {
  return /^product_dp_\d+$/i.test(String(productId || ""));
}

function isHashedProductId(productId = "") {
  return /^product_[0-9a-f]+_\d+$/i.test(String(productId || ""));
}

export function cloneRefreshDiagnostics(value = null) {
  if (!value || typeof value !== "object") {
    return null;
  }
  return {
    last_attempted_at: String(value.last_attempted_at || "").trim(),
    ai_refreshed_at: String(value.ai_refreshed_at || "").trim(),
    seating_type: String(value.seating_type || "").trim(),
    visual_type: normalizeVisualTypeKey(value.visual_type || value.seating_type || ""),
    stage0_passing_count: Math.max(0, Number(value.stage0_passing_count) || 0),
    selected_product_image_count: Math.max(0, Number(value.selected_product_image_count) || 0),
    successful_extraction_count: Math.max(0, Number(value.successful_extraction_count) || 0),
    failed_image_count: Math.max(0, Number(value.failed_image_count) || 0),
    failed_stage0_count: Math.max(0, Number(value.failed_stage0_count) || 0),
    failed_stage23_count: Math.max(0, Number(value.failed_stage23_count) || 0),
    images_skipped_by_cap: Math.max(0, Number(value.images_skipped_by_cap) || 0),
    hard_upper_cap_binding: Boolean(value.hard_upper_cap_binding),
    partial_image_failure: Boolean(value.partial_image_failure),
    skipped_unmapped: Boolean(value.skipped_unmapped),
    unmapped_grouping: String(value.unmapped_grouping || "").trim(),
    failed_images: Array.isArray(value.failed_images)
      ? value.failed_images.map((entry) => ({
          image_id: String(entry?.image_id || "").trim(),
          image_url: String(entry?.image_url || "").trim(),
          stage: String(entry?.stage || "").trim(),
          error: String(entry?.error || "").trim()
        }))
      : []
  };
}

export function buildLightweightProductRecords(catalog, imageRecords = [], previousProducts = [], refreshDiagnosticsByProductId = new Map()) {
  const byProductId = new Map();
  const previousByProductId = new Map(
    (Array.isArray(previousProducts) ? previousProducts : [])
      .map((product) => [String(product?.product_id || "").trim(), product])
  );
  const hashedCatalogProductIdByTail = new Map();

  for (const product of catalog?.products || []) {
    const { a_level, b_level, c_level } = getCategoryLevels(product);
    const previous = previousByProductId.get(String(product.product_id || "").trim()) || {};
    byProductId.set(product.product_id, {
      product_id: product.product_id,
      product_name: product.name,
      name: product.name,
      brand: product.brand,
      a_level,
      b_level,
      c_level,
      image_urls: [...new Set(product.image_urls || [])],
      passing_image_count: 0,
      refresh_diagnostics: cloneRefreshDiagnostics(previous.refresh_diagnostics)
    });
    const productId = String(product.product_id || "").trim();
    const tail = tailId(productId);
    if (tail && isHashedProductId(productId) && !hashedCatalogProductIdByTail.has(tail)) {
      hashedCatalogProductIdByTail.set(tail, productId);
    }
  }

  for (const image of imageRecords) {
    const imageProductId = String(image.product_id || "").trim();
    const imageTail = tailId(imageProductId);
    const summaryProductId = (
      imageProductId &&
      !byProductId.has(imageProductId) &&
      isDpProductId(imageProductId) &&
      imageTail &&
      hashedCatalogProductIdByTail.has(imageTail)
    )
      ? hashedCatalogProductIdByTail.get(imageTail)
      : imageProductId;

    if (!byProductId.has(summaryProductId)) {
      byProductId.set(summaryProductId, {
        product_id: summaryProductId,
        product_name: image.product_name || image.name || "",
        name: image.product_name || image.name || "",
        brand: image.brand || "",
        a_level: image.a_level || [],
        b_level: image.b_level || [],
        c_level: image.c_level || [],
        image_urls: [],
        passing_image_count: 0,
        refresh_diagnostics: cloneRefreshDiagnostics(previousByProductId.get(summaryProductId)?.refresh_diagnostics)
      });
    }

    const product = byProductId.get(summaryProductId);
    product.image_urls = [...new Set([...product.image_urls, image.image_url].filter(Boolean))];
    if (getEffectiveClassification(image) === "product") {
      product.passing_image_count += 1;
    }
  }

  if (refreshDiagnosticsByProductId instanceof Map) {
    for (const [productId, diagnostics] of refreshDiagnosticsByProductId.entries()) {
      if (!byProductId.has(productId)) {
        continue;
      }
      byProductId.get(productId).refresh_diagnostics = cloneRefreshDiagnostics(diagnostics);
    }
  }

  return [...byProductId.values()];
}

export function buildIndexOutput(index, catalog, mergedImages, options = {}) {
  const searchableImages = mergedImages.filter((image) => getEffectiveClassification(image) === "product");
  const refreshDiagnosticsByProductId = options.refreshDiagnosticsByProductId instanceof Map
    ? options.refreshDiagnosticsByProductId
    : new Map();
  const products = buildLightweightProductRecords(catalog, mergedImages, index?.products || [], refreshDiagnosticsByProductId);
  const indexedBrands = [...new Set(products.map((product) => product.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const indexedCategories = [...new Set(products.flatMap((product) => getAllCategoryTerms(product)).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  return {
    ...index,
    generated_at: new Date().toISOString(),
    provider: "openai",
    totals: {
      products: products.length,
      images: searchableImages.length
    },
    brands: indexedBrands.length ? indexedBrands : catalog.brands,
    categories: indexedCategories.length ? indexedCategories : catalog.categories,
    products,
    images: mergedImages
  };
}

export function createEmptyIndex(catalog) {
  return {
    generated_at: "",
    provider: "openai",
    totals: {
      products: 0,
      images: 0
    },
    brands: catalog?.brands || [],
    categories: catalog?.categories || [],
    products: buildLightweightProductRecords(catalog, []),
    images: []
  };
}

function mergeRefreshedImages(index, catalog, refreshedImages = [], options = {}) {
  if (!refreshedImages.length) {
    return index;
  }

  const refreshedMap = new Map(refreshedImages.map((image) => [image.image_id || image.image_url, image]));
  const mergedImageMap = new Map();

  for (const image of index.images || []) {
    const key = image.image_id || image.image_url;
    mergedImageMap.set(key, refreshedMap.get(key) || image);
  }

  for (const image of refreshedImages) {
    const key = image.image_id || image.image_url;
    mergedImageMap.set(key, image);
  }

  const mergedImages = [...mergedImageMap.values()];

  return buildIndexOutput(index, catalog, mergedImages, options);
}

export function replaceProductImages(index, catalog, productIds = [], refreshedImages = [], options = {}) {
  const normalizedProductIds = [...new Set(
    (productIds || [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )];

  if (!normalizedProductIds.length) {
    return refreshedImages.length ? mergeRefreshedImages(index, catalog, refreshedImages, options) : index;
  }

  const targetProductIds = new Set(normalizedProductIds);
  const retainedImages = (index?.images || []).filter((image) => !targetProductIds.has(String(image?.product_id || "").trim()));
  const nextImages = [...retainedImages, ...refreshedImages];
  return buildIndexOutput(index, catalog, nextImages, options);
}

export function summarizeRefreshOutcome({
  productId = "",
  matchingImages = [],
  refreshedImages = [],
  successfulExtractionCount = 0,
  lastError = null
} = {}) {
  const normalizedProductId = String(productId || "").trim();
  const skippedUnmapped = refreshedImages.length === 1 &&
    refreshedImages[0]?.excluded_reason === "unmapped_category_grouping" &&
    Boolean(refreshedImages[0]?.is_synthetic_skip);
  const grouping = skippedUnmapped ? (getCategoryGroupingKey(matchingImages[0] || {}) || "(none)") : "";

  if (Number(successfulExtractionCount || 0) <= 0 && !skippedUnmapped) {
    throw new Error(lastError?.message || "All images failed extraction for this product.");
  }

  return {
    product_id: normalizedProductId,
    skipped_unmapped: skippedUnmapped,
    unmapped_grouping: grouping
  };
}
