import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRoutingKey as resolveRegistryRoutingKey } from "./visual-types-registry.js";

export const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
export const IMAGE_CLASSIFICATIONS = new Set(["scene", "product", "product_detail"]);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT_DIR = path.resolve(__dirname, "..");
export const DATA_DIR = path.join(ROOT_DIR, "data");
const DEFAULT_LIVE_IMAGE_INDEX_PATH = path.join(DATA_DIR, "image-index.json");

function resolveOverridePath(envName, defaultPath) {
  const rawValue = String(process.env[envName] || "").trim();
  if (!rawValue) {
    return defaultPath;
  }
  return path.isAbsolute(rawValue) ? rawValue : path.resolve(ROOT_DIR, rawValue);
}

export function getImageIndexPath() {
  // Default to a repo-local path so non-macOS environments never depend on a user-specific absolute path.
  // Explicit IMAGE_INDEX_PATH still wins when set.
  return resolveOverridePath("IMAGE_INDEX_PATH", DEFAULT_LIVE_IMAGE_INDEX_PATH);
}

export function getUnmappedCategoryDecisionsPath() {
  return resolveOverridePath("UNMAPPED_CATEGORY_DECISIONS_PATH", path.join(DATA_DIR, "unmapped-category-decisions.json"));
}

export function getPipelineDiagnosticsBaselinePath() {
  return resolveOverridePath("PIPELINE_DIAGNOSTICS_BASELINE_PATH", path.join(DATA_DIR, "pipeline-diagnostics-baseline.json"));
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
  "Conference Tables": "conference",
  "Conference Tables | Workplace": "conference",
  "Cafe Tables": "cafe_dining",
  "Lounge Seating": "lounge_chair",
  "Lounge Seating | Modular Seating": "lounge_chair",
  "Modular Seating": "lounge_chair",
  "Lounge Seating | Outdoor Seating": "lounge_chair",
  "Multi-use Guest Chairs": "guest_chair",
  "Stacking / Nesting Chairs": "guest_chair",
  "Multi-use Guest Chairs | Stacking / Nesting Chairs": "guest_chair",
  "Multi-use Guest Chairs | Outdoor Seating": "guest_chair",
  "High-performing Chairs / Stools | Workplace": "task_collab_chair",
  "Other Work Chairs | Workplace": "task_collab_chair",
  "Executive Chairs | Workplace": "task_collab_chair",
  "Occasional Tables": "occasional",
  "Fixed-height Stools": "stool",
  "Fixed-height Stools | Outdoor Seating": "stool",
  "Bench Seating": "bench",
  "Bench Seating | Outdoor Seating": "bench",
  "Training Tables": "training",
  "Training Tables | Workplace": "training"
});

const VISUAL_TYPE_TO_PIXELSEEK_LABEL = Object.freeze({
  task_collab_chair: "Work Chairs",
  guest_chair: "Multi-Use / Guest Chairs",
  lounge_chair: "Lounge Seating",
  stool: "Stools",
  bench: "Benches",
  conference: "Conference Tables",
  occasional: "Occasional Tables",
  cafe_dining: "Cafe/Dining Tables",
  training: "Training Tables",
  huddle_collaborative: "Huddle/Collaborative Tables"
});

const LEGACY_VISUAL_TYPE_VALUE_ALIASES = Object.freeze({
  task_chair: "task_collab_chair",
  collaborative_chair: "task_collab_chair",
  perch_stool: "stool"
});

export const ACTIVE_VISUAL_TYPE_KEYS = Object.freeze(Object.keys(VISUAL_TYPE_TO_PIXELSEEK_LABEL));
export const ACTIVE_SEATING_TYPE_KEYS = ACTIVE_VISUAL_TYPE_KEYS;

let unmappedCategoryDecisionsCache = {
  path: "",
  mtimeMs: -1,
  value: {}
};

function readUnmappedCategoryDecisionsSync() {
  const filePath = getUnmappedCategoryDecisionsPath();
  try {
    const stats = fsSync.statSync(filePath);
    if (
      unmappedCategoryDecisionsCache.path === filePath &&
      unmappedCategoryDecisionsCache.mtimeMs === stats.mtimeMs
    ) {
      return unmappedCategoryDecisionsCache.value;
    }
    const parsed = JSON.parse(fsSync.readFileSync(filePath, "utf8"));
    const value = parsed && typeof parsed === "object" ? parsed : {};
    unmappedCategoryDecisionsCache = {
      path: filePath,
      mtimeMs: stats.mtimeMs,
      value
    };
    return value;
  } catch (error) {
    if (error.code === "ENOENT") {
      unmappedCategoryDecisionsCache = {
        path: filePath,
        mtimeMs: -1,
        value: {}
      };
      return {};
    }
    throw error;
  }
}

export const EXTRACTION_IMAGE_HARD_CAP = 15;
export const DEFAULT_EXTRACTION_IMAGE_SOFT_CAP = 8;
const EXTRACTION_IMAGE_SOFT_CAP_BY_TYPE = Object.freeze({
  task_collab_chair: 8,
  guest_chair: 8,
  lounge_chair: 10,
  stool: 8,
  bench: 8,
  "Work Chairs": 8,
  "Multi-Use / Guest Chairs": 8,
  "Lounge Seating": 10,
  "Stools": 8,
  "Benches": 8
});

export function getPixelSeekType(record = {}, decisionsOverride = null) {
  const grouping = getCategoryGroupingKey(record);
  if (!grouping) {
    return "SKIP";
  }
  const decisions = decisionsOverride && typeof decisionsOverride === "object"
    ? decisionsOverride
    : readUnmappedCategoryDecisionsSync();
  const decision = decisions && typeof decisions === "object" ? decisions[grouping] : null;
  const status = String(decision?.status || "").trim().toLowerCase();
  if (status === "intentionally_excluded") {
    return "INTENTIONALLY_EXCLUDED";
  }
  if (status === "mapped") {
    const mappedType = VISUAL_TYPE_TO_PIXELSEEK_LABEL[String(decision?.mapping_target || "").trim()];
    if (mappedType) {
      return mappedType;
    }
  }
  return PIXELSEEK_TYPE_BY_GROUPING[grouping] || "SKIP";
}

function normalizeVisualTypeCandidate(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }
  return LEGACY_VISUAL_TYPE_VALUE_ALIASES[normalized] || normalized;
}

export function resolveVisualType(input = "") {
  const tryResolve = (sourceField, value) => {
    const normalizedValue = normalizeVisualTypeCandidate(value);
    if (!normalizedValue) {
      return null;
    }
    try {
      return resolveRegistryRoutingKey({ [sourceField]: normalizedValue });
    } catch {
      return null;
    }
  };

  if (typeof input === "string") {
    return tryResolve("visual_type", input);
  }

  if (input && typeof input === "object") {
    const direct = tryResolve("visual_type", input.visual_type);
    if (direct) {
      return direct;
    }
    const legacy = tryResolve("seating_type", input.seating_type);
    if (legacy) {
      return legacy;
    }
  }

  return null;
}

export function normalizeVisualTypeKey(value = "") {
  return resolveVisualType(value)?.visual_type || "";
}

export function normalizeRoutingTypeKey(value = "") {
  return normalizeVisualTypeKey(value);
}

export function getVisualTypeLabel(typeKey = "") {
  return VISUAL_TYPE_TO_PIXELSEEK_LABEL[normalizeVisualTypeKey(typeKey)] || "";
}

export function getPixelSeekTypeLabel(typeKey = "") {
  return getVisualTypeLabel(typeKey);
}

export function normalizePixelSeekTypeFilter(value = "") {
  const normalizedTypeKey = normalizeVisualTypeKey(value);
  if (normalizedTypeKey) {
    return normalizedTypeKey;
  }

  const normalizedLabel = String(value || "").trim().toLowerCase();
  if (!normalizedLabel) {
    return "";
  }

  const labelMatch = Object.entries(VISUAL_TYPE_TO_PIXELSEEK_LABEL).find(([, label]) => (
    String(label || "").trim().toLowerCase() === normalizedLabel
  ));
  return labelMatch?.[0] || "";
}

export function getExtractionImageSoftCap(typeKey = "") {
  const normalized = String(typeKey || "").trim();
  return EXTRACTION_IMAGE_SOFT_CAP_BY_TYPE[normalized] || DEFAULT_EXTRACTION_IMAGE_SOFT_CAP;
}

export function getEffectiveExtractionImageCap(typeKey = "") {
  return Math.min(getExtractionImageSoftCap(typeKey), EXTRACTION_IMAGE_HARD_CAP);
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
