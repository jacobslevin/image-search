import {
  getEffectiveClassification,
  getPixelSeekType,
  normalizePixelSeekTypeFilter,
  normalizeRoutingTypeKey
} from "./utils.js";

export function normalizeSearchCategoryFilters(category = []) {
  const input = Array.isArray(category) ? category : category ? [category] : [];
  const normalized = [];
  const invalid = [];
  const seen = new Set();

  for (const value of input) {
    const raw = String(value || "").trim();
    if (!raw) {
      continue;
    }
    const normalizedValue = normalizePixelSeekTypeFilter(raw);
    if (!normalizedValue) {
      invalid.push(raw);
      continue;
    }
    if (seen.has(normalizedValue)) {
      continue;
    }
    seen.add(normalizedValue);
    normalized.push(normalizedValue);
  }

  return { normalized, invalid };
}

export function isIntentionallyExcludedImageRecord(record = {}, options = {}) {
  if (record?.excluded === true) {
    return true;
  }
  if (String(record?.excluded_reason || "").trim().toLowerCase() === "intentionally_excluded") {
    return true;
  }
  return getPixelSeekType(record, options?.decisions) === "INTENTIONALLY_EXCLUDED";
}

export function isIntentionallyExcludedProduct(product = {}, indexedImages = [], options = {}) {
  if (getPixelSeekType(product, options?.decisions) === "INTENTIONALLY_EXCLUDED") {
    return true;
  }
  return (Array.isArray(indexedImages) ? indexedImages : []).some((image) => isIntentionallyExcludedImageRecord(image, options));
}

export function collectActiveResultSeatingTypes(result = {}) {
  const activeTypes = new Set();
  const matchingImages = Array.isArray(result?.matching_images) ? result.matching_images : [];

  for (const image of matchingImages) {
    if (image?.excluded === true) {
      continue;
    }
    // Only active product classifications should satisfy a category filter.
    // Scene/detail images may exist in result payloads for inspection but should
    // never cause a product to match an active seating category.
    if (String(image?.effective_classification || "").trim().toLowerCase() !== "product") {
      continue;
    }
    const normalizedType = normalizeRoutingTypeKey(image?.seating_type);
    if (normalizedType) {
      activeTypes.add(normalizedType);
    }
  }

  return [...activeTypes];
}

export function filterSearchResultsByCategory(results = [], category = []) {
  const { normalized } = normalizeSearchCategoryFilters(category);
  if (!normalized.length) {
    return Array.isArray(results) ? results : [];
  }

  return (Array.isArray(results) ? results : []).filter((result) => {
    const activeTypes = new Set(collectActiveResultSeatingTypes(result));
    return normalized.some((categoryKey) => activeTypes.has(categoryKey));
  });
}

export function isSearchRecordEligible(record = {}, options = {}) {
  if (getEffectiveClassification(record) !== "product") {
    return false;
  }
  return !isIntentionallyExcludedImageRecord(record, options);
}
