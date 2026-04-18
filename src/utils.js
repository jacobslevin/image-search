import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
export const IMAGE_CLASSIFICATIONS = new Set(["scene", "product", "product_detail"]);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT_DIR = path.resolve(__dirname, "..");
export const DATA_DIR = path.join(ROOT_DIR, "data");

function resolveOverridePath(envName, defaultPath) {
  const rawValue = String(process.env[envName] || "").trim();
  if (!rawValue) {
    return defaultPath;
  }
  return path.isAbsolute(rawValue) ? rawValue : path.resolve(ROOT_DIR, rawValue);
}

export function getImageIndexPath() {
  return resolveOverridePath("IMAGE_INDEX_PATH", path.join(DATA_DIR, "image-index.json"));
}

export function normalizeImageClassification(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return IMAGE_CLASSIFICATIONS.has(normalized) ? normalized : "";
}

export function getEffectiveClassification(record = {}) {
  const explicit = normalizeImageClassification(record?.effective_classification);
  if (explicit) {
    return explicit;
  }

  const override = normalizeImageClassification(record?.stage_1_override_result);
  if (override) {
    return override;
  }

  const raw = normalizeImageClassification(record?.stage_0_result);
  if (raw) {
    return raw;
  }

  const stage1Result = normalizeImageClassification(record?.stage1?.result);
  if (stage1Result) {
    return stage1Result;
  }

  return "";
}

export function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function createId(prefix, ...parts) {
  const hash = crypto
    .createHash("sha1")
    .update(parts.filter(Boolean).join("::"))
    .digest("hex")
    .slice(0, 12);
  return `${prefix}_${hash}`;
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function readJson(filePath, fallback = null) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

export async function writeJson(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(value, null, 2));
}

export function tokenize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

export function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean))];
}

function normalizeCategoryList(values = []) {
  return uniqueStrings(
    values.filter((value) => {
      const normalized = String(value || "").trim();
      return normalized && normalized !== "0";
    })
  );
}

export function getCategoryLevels(record = {}) {
  if (!record || typeof record !== "object") {
    return { a_level: [], b_level: [], c_level: [] };
  }

  const categories = record.categories && typeof record.categories === "object" ? record.categories : {};
  const a_level = normalizeCategoryList(record.a_level || categories.a || []);
  const b_level = normalizeCategoryList(record.b_level || categories.b || (record.category ? [record.category] : []));
  const c_level = normalizeCategoryList(record.c_level || categories.c || []);

  return { a_level, b_level, c_level };
}

export function getLeafCategories(record = {}) {
  const { b_level, c_level } = getCategoryLevels(record);
  return c_level.length ? c_level : b_level;
}

export function getNavigationCategories(record = {}) {
  return getCategoryLevels(record).b_level;
}

export function getAllCategoryTerms(record = {}) {
  const { a_level, b_level, c_level } = getCategoryLevels(record);
  return uniqueStrings([...a_level, ...b_level, ...c_level]);
}

export function getCategoryGroupingKey(record = {}) {
  return getAllCategoryTerms(record)
    .sort((left, right) => left.localeCompare(right))
    .join(" | ");
}

const PIXELSEEK_TYPE_BY_GROUPING = Object.freeze({
  "Lounge Seating": "Lounge Seating",
  "Lounge Seating | Modular Seating": "Lounge Seating",
  "Modular Seating": "Lounge Seating",
  "Lounge Seating | Outdoor Seating": "Lounge Seating",
  "Multi-use Guest Chairs": "Multi-Use / Guest Chairs",
  "Stacking / Nesting Chairs": "Multi-Use / Guest Chairs",
  "Multi-use Guest Chairs | Stacking / Nesting Chairs": "Multi-Use / Guest Chairs",
  "Multi-use Guest Chairs | Outdoor Seating": "Multi-Use / Guest Chairs",
  "High-performing Chairs / Stools | Workplace": "Work Chairs",
  "Other Work Chairs | Workplace": "Work Chairs",
  "Executive Chairs | Workplace": "Work Chairs",
  "Fixed-height Stools": "Stools",
  "Fixed-height Stools | Outdoor Seating": "Stools",
  "Bench Seating": "Benches",
  "Bench Seating | Outdoor Seating": "Benches"
});

export function getPixelSeekType(record = {}) {
  const grouping = getCategoryGroupingKey(record);
  if (!grouping) {
    return "SKIP";
  }
  return PIXELSEEK_TYPE_BY_GROUPING[grouping] || "SKIP";
}

const IMPORT_SKIP_LOG_SOURCES = new Set(["retroactive_cleanup", "import", "manual_skip"]);

export function buildImportSkipLogEntry(record = {}, source = "import", timestamp = new Date().toISOString()) {
  const normalizedSource = IMPORT_SKIP_LOG_SOURCES.has(source) ? source : "import";
  return {
    product_id: String(record.product_id || "").trim(),
    product_name: String(record.name || record.product_name || "").trim(),
    brand: String(record.brand || "").trim(),
    unmapped_grouping: getCategoryGroupingKey(record),
    skip_timestamp: String(timestamp || "").trim(),
    source: normalizedSource
  };
}

export function getCategoryDisplayLabel(record = {}) {
  return getNavigationCategories(record).join(" · ");
}

export function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (!normA || !normB) {
    return 0;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function embedText(value, dimensions = 192) {
  const vector = new Array(dimensions).fill(0);
  const tokens = tokenize(value);

  for (const token of tokens) {
    const digest = crypto.createHash("sha1").update(token).digest();
    for (let i = 0; i < 4; i += 1) {
      const index = digest.readUInt16BE(i * 2) % dimensions;
      const sign = digest[i + 8] % 2 === 0 ? 1 : -1;
      vector[index] += sign * (1 + (digest[i + 12] / 255));
    }
  }

  const length = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0)) || 1;
  return vector.map((item) => Number((item / length).toFixed(6)));
}

export async function embedTextWithOpenAi(value, options = {}) {
  const input = String(value || "").trim();
  if (!input) {
    return [];
  }

  if (!options.apiKey) {
    throw new Error("OPENAI_API_KEY is required for embeddings.");
  }

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.apiKey}`
    },
    body: JSON.stringify({
      input,
      model: options.model || "text-embedding-3-small"
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI embeddings request failed with ${response.status}.`);
  }

  const payload = await response.json();
  const embedding = payload?.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || !embedding.length) {
    throw new Error("OpenAI embeddings response did not include an embedding vector.");
  }

  return embedding.map((item) => Number(item));
}

export function looksLikeImageUrl(value) {
  if (!value) {
    return false;
  }

  try {
    const parsed = new URL(String(value).trim());
    const pathname = parsed.pathname.toLowerCase();
    return [...IMAGE_EXTENSIONS].some((extension) => pathname.endsWith(extension));
  } catch {
    return false;
  }
}

export function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function sentenceCase(value) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return "";
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function pickDefined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}
