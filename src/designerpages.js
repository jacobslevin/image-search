import { normalizeWhitespace, uniqueStrings } from "./utils.js";

const DESIGNERPAGES_HOSTS = new Set(["designerpages.com", "www.designerpages.com"]);
const HTML_ENTITY_MAP = new Map([
  ["amp", "&"],
  ["quot", "\""],
  ["apos", "'"],
  ["lt", "<"],
  ["gt", ">"],
  ["#39", "'"]
]);

function decodeHtmlEntities(value = "") {
  return String(value || "").replace(/&([^;]+);/g, (match, entity) => HTML_ENTITY_MAP.get(entity) || match);
}

export function buildDesignerPagesProductUrl(productId) {
  const normalized = normalizeWhitespace(productId).replace(/\D+/g, "");
  if (!normalized) {
    return "";
  }
  return `https://designerpages.com/products/${normalized}`;
}

export function parseDesignerPagesProductId(value = "") {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return "";
  }

  if (/^\d+$/.test(normalized)) {
    return normalized;
  }

  try {
    const parsed = new URL(normalized);
    if (!DESIGNERPAGES_HOSTS.has(parsed.hostname.toLowerCase())) {
      return "";
    }
    const match = parsed.pathname.match(/^\/products\/(\d+)(?:\/[^/?#]*)?\/?$/i);
    return match ? match[1] : "";
  } catch {
    return "";
  }
}

export function isDesignerPagesProductUrl(value = "") {
  return Boolean(parseDesignerPagesProductId(value));
}

export async function fetchDesignerPagesProductHtml(productIdOrUrl, options = {}) {
  const productId = parseDesignerPagesProductId(productIdOrUrl);
  const url = productId ? buildDesignerPagesProductUrl(productId) : normalizeWhitespace(productIdOrUrl);
  if (!url) {
    throw new Error(`Invalid Designer Pages product identifier: ${productIdOrUrl}`);
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent": options.userAgent || "Mozilla/5.0 (compatible; CatalogIntake/1.0; +https://designerpages.com)"
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url} (${response.status})`);
  }
  return response.text();
}

function extractSourceDataJson(html = "") {
  const match = String(html || "").match(
    /<div[^>]*class="[^"]*\bimage-column\b[^"]*"[^>]*data-source-data=(["'])(.*?)\1/is
  );
  if (!match) {
    return null;
  }

  try {
    return JSON.parse(decodeHtmlEntities(match[2]));
  } catch {
    return null;
  }
}

function buildCategoryLevels(dpCategories = []) {
  const categories = Array.isArray(dpCategories) ? dpCategories.filter((item) => item && typeof item === "object") : [];
  const byLevel = new Map();

  for (const category of categories) {
    const level = Number(category.level);
    const name = normalizeWhitespace(category.name);
    if (!name) {
      continue;
    }
    if (!byLevel.has(level)) {
      byLevel.set(level, []);
    }
    byLevel.get(level).push(name);
  }

  const aLevel = uniqueStrings(byLevel.get(0) || []);
  const bLevel = uniqueStrings(byLevel.get(1) || []);
  const cLevel = uniqueStrings(byLevel.get(2) || []);
  const fallback = uniqueStrings(categories.map((item) => normalizeWhitespace(item.name)).filter(Boolean));

  return {
    a_level: aLevel,
    b_level: bLevel.length ? bLevel : fallback.slice(0, 1),
    c_level: cLevel
  };
}

export function parseDesignerPagesProductPayload(html = "") {
  const payload = extractSourceDataJson(html);
  if (!payload) {
    throw new Error("Could not locate Designer Pages product payload.");
  }

  const productId = normalizeWhitespace(payload.id);
  const name = normalizeWhitespace(payload.name);
  const manufacturer = payload.manufacturer && typeof payload.manufacturer === "object"
    ? normalizeWhitespace(payload.manufacturer.name)
    : "";
  const website = buildDesignerPagesProductUrl(productId);
  const categoryLevels = buildCategoryLevels(payload.dp_categories || []);
  const defaultImage = payload.default_image && typeof payload.default_image === "object"
    ? normalizeWhitespace(payload.default_image.url)
    : "";
  const additionalImages = Array.isArray(payload.additional_images)
    ? payload.additional_images
        .filter((item) => item && typeof item === "object")
        .map((item) => normalizeWhitespace(item.url))
        .filter(Boolean)
    : [];

  return {
    source_product_id: productId,
    name,
    brand: manufacturer,
    website,
    ...categoryLevels,
    raw_category: uniqueStrings([
      ...(categoryLevels.c_level || []),
      ...(categoryLevels.b_level || [])
    ]).join(" :: "),
    default_image_url: defaultImage,
    gallery_image_urls: uniqueStrings([defaultImage, ...additionalImages].filter(Boolean)),
    payload
  };
}
