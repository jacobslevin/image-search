import { parseDesignerPagesProductId } from "./designerpages.js";
import { normalizeWhitespace } from "./utils.js";

export function resolveDesignerPagesSourceProductId(product = {}) {
  const explicitSourceId = normalizeWhitespace(product.source_product_id);
  if (/^\d+$/.test(explicitSourceId)) {
    return explicitSourceId;
  }

  const websiteId = parseDesignerPagesProductId(product.website || "");
  if (websiteId) {
    return websiteId;
  }

  const productId = normalizeWhitespace(product.product_id);
  if (!/^product_dp_/i.test(productId)) {
    return "";
  }
  const suffixMatch = productId.match(/(\d+)$/);
  if (suffixMatch) {
    return suffixMatch[1];
  }

  return "";
}

export function buildExistingDesignerPagesProductKey(product = {}) {
  const sourceProductId = resolveDesignerPagesSourceProductId(product);
  if (sourceProductId) {
    return `designerpages:${sourceProductId}`;
  }

  const productId = normalizeWhitespace(product.product_id);
  return productId ? `product:${productId}` : "";
}

export function buildExistingDesignerPagesProductLookup(products = []) {
  const lookup = new Map();
  for (const product of Array.isArray(products) ? products : []) {
    const sourceProductId = resolveDesignerPagesSourceProductId(product);
    if (sourceProductId) {
      lookup.set(sourceProductId, product);
    }
  }
  return lookup;
}

export function findExistingDesignerPagesProduct(productsOrLookup, productId = "") {
  const normalizedProductId = normalizeWhitespace(productId).replace(/\D+/g, "");
  if (!normalizedProductId) {
    return null;
  }

  if (productsOrLookup instanceof Map) {
    return productsOrLookup.get(normalizedProductId) || null;
  }

  return buildExistingDesignerPagesProductLookup(productsOrLookup).get(normalizedProductId) || null;
}
