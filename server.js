import fsSync from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { analyzeInspirationImage, buildStage1ClassificationPrompt, combinedStage23Prompt, extractTextQueryTraits, generateProductExtractionRecordsWithCap, generateSearchQuery, inferTextQueryCategory, QueryImageAnalysisStageError, ResolutionGateError } from "./src/captioning.js";
import { RESULT_CUTOFF_DEFAULTS } from "./public/result-cutoff.js";
import { parseSearchQuery } from "./src/query-parser.js";
import {
  filterSearchResultsByCategory,
  isIntentionallyExcludedImageRecord,
  isIntentionallyExcludedProduct,
  normalizeSearchCategoryFilters
} from "./src/search-category-filter.js";
import { getRankingRulesSummary, normalizeEmbedding, resolveQueryEmbedding, searchIndex } from "./src/search.js";
import { detectTraitTextConflicts } from "./src/trait-conflicts.js";
import { buildPipelineDiagnostics, readPipelineDiagnosticsBaseline } from "./src/pipeline-diagnostics.js";
import {
  ACTIVE_VISUAL_TYPE_KEYS,
  createId,
  ensureDir,
  getAllCategoryTerms,
  getCategoryDisplayLabel,
  getCategoryGroupingKey,
  getCategoryLevels,
  getEffectiveClassification,
  getImageIndexPath,
  getUnmappedCategoryDecisionsPath,
  getLeafCategories,
  normalizeImageClassification,
  normalizeVisualTypeKey,
  resolveVisualType,
  readJson,
  writeJson
} from "./src/utils.js";
import { loadSeatingTypesAdapter } from "./src/seating-types-adapter.js";
import { loadVisualTypesRegistry } from "./src/visual-types-registry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envFiles = [
  path.join(__dirname, ".env.local"),
  path.join(__dirname, ".env")
];
const publicDir = path.join(__dirname, "public");
const privateBrowsePath = "/velvet-lobster-orbit-773-nebula";
const normalizedPath = path.join(__dirname, "data", "normalized-catalog.json");
const indexPath = getImageIndexPath();
const unmappedCategoryDecisionsPath = getUnmappedCategoryDecisionsPath();
const sceneFilterProgressPath = path.join(__dirname, "data", "scene-filter-progress.json");
const sceneFilterBatchLogPath = path.join("/tmp", "scene-filter-batch.log");
const evalResultsPath = path.join(__dirname, "scripts", "eval-results.json");
const evalJudgmentsPath = path.join(__dirname, "scripts", "eval-judgments.json");
const traitCorrectionsPath = path.join(__dirname, "data", "trait-corrections.json");
const traitCorrectionImagesDir = path.join(__dirname, "data", "trait-correction-images");
const captioningSourcePath = path.join(__dirname, "src", "captioning.js");
const seatingTypesConfig = loadSeatingTypesAdapter();
const seatingTypes = seatingTypesConfig.types || {};
const defaultSeatingType = seatingTypesConfig.default_type || "";
const visualTypesRegistry = loadVisualTypesRegistry();
const visualTypeLegacyAliases = visualTypesRegistry.legacyAliases || {};
const QUERY_IMAGE_ANALYSIS_RETRY_MESSAGE = "Our fault, but we encountered an unexpected issue. Please resubmit your image.";
const PROMPT_LIBRARY_STAGE23_TYPES = [
  "lounge_chair",
  "task_collab_chair",
  "guest_chair",
  "stool",
  "bench"
];
const PROMPT_LIBRARY_SECTION_RANGES = {
  stage1: [
    { label: "Stage 1 prompt builder", start: 2656, end: 2684 }
  ],
  stage23Shared: [
    { label: "Combined Stage 2/3 prompt builder", start: 1748, end: 1799 },
    { label: "Field guide builder", start: 965, end: 979 },
    { label: "Visual summary instruction builder", start: 350, end: 389 }
  ],
  visualSummaryConfig: {
    lounge_chair: { label: "Visual summary config", start: 307, end: 314 },
    task_collab_chair: { label: "Visual summary config", start: 315, end: 323 },
    guest_chair: { label: "Visual summary config", start: 324, end: 331 },
    stool: { label: "Visual summary config", start: 332, end: 339 },
    bench: { label: "Visual summary config", start: 340, end: 347 }
  },
  typeRules: {
    lounge_chair: [
      { label: "Lounge chair canonical rules", start: 266, end: 272 },
      { label: "Lounge chair configuration rules", start: 257, end: 264 },
      { label: "Lounge chair shape rules", start: 241, end: 255 }
    ],
    task_collab_chair: [
      { label: "Task & collaborative chair canonical rules", start: 279, end: 284 }
    ],
    guest_chair: [
      { label: "Guest chair canonical rules", start: 286, end: 291 }
    ],
    stool: [
      { label: "Stool canonical rules", start: 274, end: 277 }
    ],
    bench: [
      { label: "Bench canonical rules", start: 293, end: 297 }
    ]
  }
};
const QUERY_IMAGE_PROGRESS_TTL_MS = 10 * 60 * 1000;
const queryImageProgressStore = new Map();

function pruneQueryImageProgressStore(now = Date.now()) {
  for (const [requestId, entry] of queryImageProgressStore.entries()) {
    if (!entry || (now - Number(entry.updated_at_ms || 0)) > QUERY_IMAGE_PROGRESS_TTL_MS) {
      queryImageProgressStore.delete(requestId);
    }
  }
}

function ensureQueryImageProgressEntry(requestId = "", options = {}) {
  const normalizedRequestId = String(requestId || "").trim();
  if (!normalizedRequestId) {
    return null;
  }
  pruneQueryImageProgressStore();
  const now = Date.now();
  const existing = queryImageProgressStore.get(normalizedRequestId);
  if (existing) {
    existing.updated_at_ms = now;
    if (typeof options.expected_passes === "number" && options.expected_passes > 0) {
      existing.expected_passes = Number(options.expected_passes);
    }
    return existing;
  }
  const next = {
    request_id: normalizedRequestId,
    sequence: 0,
    expected_passes: Number(options.expected_passes || 0),
    last_event: null,
    events: [],
    updated_at: new Date(now).toISOString(),
    updated_at_ms: now,
    done: false,
    error: ""
  };
  queryImageProgressStore.set(normalizedRequestId, next);
  return next;
}

function recordQueryImageProgressEvent(requestId = "", event = {}) {
  const entry = ensureQueryImageProgressEntry(requestId, {
    expected_passes: event.expected_passes
  });
  if (!entry) {
    return null;
  }
  entry.sequence += 1;
  entry.last_event = {
    sequence: entry.sequence,
    type: String(event.type || "").trim(),
    run_label: String(event.run_label || "").trim(),
    expected_passes: Number(event.expected_passes || entry.expected_passes || 0),
    current_pass: Number(event.current_pass || 0),
    timestamp: new Date().toISOString()
  };
  entry.events.push({ ...entry.last_event });
  if (entry.events.length > 40) {
    entry.events = entry.events.slice(-40);
  }
  entry.updated_at = entry.last_event.timestamp;
  entry.updated_at_ms = Date.now();
  if (typeof event.done === "boolean") {
    entry.done = event.done;
  }
  if (typeof event.error === "string" && event.error.trim()) {
    entry.error = event.error.trim();
  }
  return entry;
}

function finalizeQueryImageProgress(requestId = "", options = {}) {
  const entry = ensureQueryImageProgressEntry(requestId);
  if (!entry) {
    return null;
  }
  entry.done = true;
  entry.updated_at = new Date().toISOString();
  entry.updated_at_ms = Date.now();
  if (typeof options.error === "string" && options.error.trim()) {
    entry.error = options.error.trim();
  }
  if (options.event && typeof options.event === "object") {
    recordQueryImageProgressEvent(requestId, {
      ...options.event,
      done: true
    });
  }
  return entry;
}

function buildQueryImageProgressPayload(requestId = "", sinceSequence = 0) {
  const entry = queryImageProgressStore.get(String(requestId || "").trim());
  if (!entry) {
    return null;
  }
  const normalizedSinceSequence = Math.max(0, Number(sinceSequence || 0));
  return {
    request_id: entry.request_id,
    sequence: Number(entry.sequence || 0),
    expected_passes: Number(entry.expected_passes || 0),
    done: Boolean(entry.done),
    error: String(entry.error || "").trim(),
    updated_at: String(entry.updated_at || "").trim(),
    events: Array.isArray(entry.events)
      ? entry.events.filter((event) => Number(event?.sequence || 0) > normalizedSinceSequence).map((event) => ({ ...event }))
      : [],
    last_event: entry.last_event && typeof entry.last_event === "object"
      ? { ...entry.last_event }
      : null
  };
}

function buildPromptLibrarySourceSections(typeKey = "") {
  const sections = [];
  if (!typeKey) {
    return PROMPT_LIBRARY_SECTION_RANGES.stage1.map((section) => ({
      ...section,
      file: captioningSourcePath
    }));
  }
  const typeSpecific = PROMPT_LIBRARY_SECTION_RANGES.typeRules[typeKey] || [];
  const visualSummaryConfig = PROMPT_LIBRARY_SECTION_RANGES.visualSummaryConfig[typeKey]
    ? [{ ...PROMPT_LIBRARY_SECTION_RANGES.visualSummaryConfig[typeKey] }]
    : [];
  return [
    ...PROMPT_LIBRARY_SECTION_RANGES.stage23Shared,
    ...visualSummaryConfig,
    ...typeSpecific
  ].map((section) => ({
    ...section,
    file: captioningSourcePath
  }));
}

function buildPromptLibraryPayload() {
  const prompts = [
    {
      id: "stage1",
      label: "Stage 1 Seating Type Classification",
      stage: "Stage 1",
      typeKey: "",
      typeLabel: "Shared across all seating types",
      prompt: buildStage1ClassificationPrompt(),
      runtime_notes: [
        "[catalog context appended at runtime, not shown]"
      ],
      source_sections: buildPromptLibrarySourceSections("")
    },
    ...PROMPT_LIBRARY_STAGE23_TYPES.map((typeKey) => ({
      id: `stage23-${typeKey}`,
      label: `Stage 2/3 Combined Prompt`,
      stage: "Stage 2/3",
      typeKey,
      typeLabel: seatingTypes[typeKey]?.label || typeKey,
      prompt: combinedStage23Prompt(typeKey),
      runtime_notes: [
        "[catalog context appended at runtime, not shown]",
        `[runtime routing note appended as user input: Resolved PixelSeek type is: ${typeKey}. Use this as the routing type even if catalog context suggests another label.]`
      ],
      source_sections: buildPromptLibrarySourceSections(typeKey)
    }))
  ];
  return {
    generated_at: new Date().toISOString(),
    prompts
  };
}

function buildTraitFieldConfigIndex(types = {}) {
  const index = new Map();
  Object.entries(types || {}).forEach(([typeKey, typeConfig]) => {
    const fieldMap = new Map();
    (typeConfig?.fields || []).forEach((fieldConfig) => {
      const fieldName = String(fieldConfig?.field || "").trim();
      if (fieldName) {
        fieldMap.set(fieldName, fieldConfig);
      }
    });
    index.set(typeKey, fieldMap);
  });
  return index;
}

const traitFieldConfigIndex = buildTraitFieldConfigIndex(seatingTypes);

function getTraitFieldConfig(typeKey = "", fieldName = "") {
  const normalizedTypeKey = String(typeKey || "").trim();
  const normalizedFieldName = String(fieldName || "").trim();
  const resolvedTypeKey = traitFieldConfigIndex.has(normalizedTypeKey) ? normalizedTypeKey : defaultSeatingType;
  return traitFieldConfigIndex.get(resolvedTypeKey)?.get(normalizedFieldName) || null;
}

function getFieldPriority(typeKey = "", fieldName = "") {
  const priority = String(getTraitFieldConfig(typeKey, fieldName)?.priority || "")
    .trim()
    .toLowerCase();
  return priority === "essential" || priority === "low" || priority === "normal"
    ? priority
    : "normal";
}

function buildUnmappedCombinationSummary(index = { images: [] }, decisions = {}) {
  const images = Array.isArray(index?.images) ? index.images : [];
  const byGrouping = new Map();

  for (const image of images) {
    const excludedReason = String(image?.excluded_reason || "").trim().toLowerCase();
    if (excludedReason !== "unmapped_category_grouping" && excludedReason !== "intentionally_excluded") {
      continue;
    }

    const grouping = getCategoryGroupingKey(image) || "(none)";
    if (!byGrouping.has(grouping)) {
      byGrouping.set(grouping, {
        grouping,
        product_ids: new Set(),
        products: [],
        first_seen_at: "",
        current_excluded_reasons: new Set()
      });
    }

    const entry = byGrouping.get(grouping);
    const productId = String(image?.product_id || "").trim();
    const productName = String(image?.product_name || image?.name || "").trim();
    const timestamp = String(image?.ai_refreshed_at || image?.extraction_timestamp || "").trim();
    if (productId && !entry.product_ids.has(productId)) {
      entry.product_ids.add(productId);
      entry.products.push({ product_id: productId, name: productName });
      entry.products.sort((left, right) => String(left.name || left.product_id).localeCompare(String(right.name || right.product_id)));
    }
    if (timestamp && (!entry.first_seen_at || timestamp < entry.first_seen_at)) {
      entry.first_seen_at = timestamp;
    }
    if (excludedReason) {
      entry.current_excluded_reasons.add(excludedReason);
    }
  }

  const normalized = [...byGrouping.values()].map((entry) => {
    const decision = decisions?.[entry.grouping] && typeof decisions[entry.grouping] === "object"
      ? decisions[entry.grouping]
      : null;
    const status = String(decision?.status || "").trim() || "active";
    return {
      grouping: entry.grouping,
      count: entry.products.length,
      first_seen_at: entry.first_seen_at || "",
      products: entry.products,
      status,
      mapping_target: String(decision?.mapping_target || "").trim(),
      updated_at: String(decision?.updated_at || "").trim(),
      current_excluded_reasons: [...entry.current_excluded_reasons].sort()
    };
  }).sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count;
    }
    return String(left.grouping).localeCompare(String(right.grouping));
  });

  return {
    active: normalized.filter((entry) => entry.status !== "mapped" && entry.status !== "intentionally_excluded"),
    resolved: normalized.filter((entry) => entry.status === "mapped" || entry.status === "intentionally_excluded")
  };
}

async function buildExtractionSummary(index = { images: [] }) {
  const baseline = await readPipelineDiagnosticsBaseline();
  const diagnostics = buildPipelineDiagnostics(index, { baseline });
  const decisions = await readJson(unmappedCategoryDecisionsPath, {});
  const unmappedCombinations = buildUnmappedCombinationSummary(index, decisions);

  return {
    ...diagnostics,
    unmapped_combinations: unmappedCombinations
  };
}

function normalizeFocusAreaPayload(rawFocusArea = null) {
  if (!rawFocusArea || typeof rawFocusArea !== "object") {
    return null;
  }
  const x = Number(rawFocusArea.x);
  const y = Number(rawFocusArea.y);
  const width = Number(rawFocusArea.width);
  const height = Number(rawFocusArea.height);
  if (![x, y, width, height].every((value) => Number.isFinite(value))) {
    return null;
  }
  return { x, y, width, height };
}

function getQueryImageAnalysisIdentifier({ imageSource = "", imageUrl = "", fileName = "" } = {}) {
  const normalizedFileName = String(fileName || "").trim();
  if (normalizedFileName) {
    return `upload:${normalizedFileName}`;
  }

  const normalizedImageUrl = String(imageUrl || "").trim();
  if (normalizedImageUrl) {
    return normalizedImageUrl;
  }

  const normalizedSource = String(imageSource || "").trim();
  if (normalizedSource.startsWith("data:image/")) {
    return createId("query_image", normalizedSource.slice(0, 256));
  }

  return normalizedSource || createId("query_image", String(Date.now()));
}

function logQueryImageAnalysisFailure({ imageIdentifier = "", stage = "", error = null } = {}) {
  const errorMessage = String(error?.message || error || "").trim() || "Unknown query-time image analysis error.";
  console.error("[query-image-analysis] failure", JSON.stringify({
    image_identifier: imageIdentifier,
    stage: String(stage || "").trim() || "unknown",
    error_message: errorMessage
  }));
}

function extensionFromMimeType(mimeType = "") {
  const normalized = String(mimeType || "").trim().toLowerCase();
  if (!normalized.startsWith("image/")) {
    return ".bin";
  }
  const subtype = normalized.split("/")[1]?.split(";")[0]?.trim() || "png";
  if (subtype === "jpeg") {
    return ".jpg";
  }
  return `.${subtype.replace(/[^a-z0-9]/gi, "") || "png"}`;
}

function extensionFromImageUrl(imageUrl = "") {
  try {
    const pathname = new URL(String(imageUrl || "").trim()).pathname || "";
    const ext = path.extname(pathname).toLowerCase();
    return ext || ".jpg";
  } catch {
    return ".jpg";
  }
}

async function persistTraitCorrectionImageAsset(imageSource = "", recordId = "") {
  const source = String(imageSource || "").trim();
  if (!source) {
    return {
      source_kind: "unknown",
      source_url: "",
      stored_image_path: "",
      mime_type: ""
    };
  }

  await ensureDir(traitCorrectionImagesDir);

  if (source.startsWith("data:image/")) {
    const match = source.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (!match) {
      return {
        source_kind: "data_url",
        source_url: "",
        stored_image_path: "",
        mime_type: ""
      };
    }
    const mimeType = String(match[1] || "").trim().toLowerCase();
    const extension = extensionFromMimeType(mimeType);
    const fileName = `${recordId}${extension}`;
    const outputPath = path.join(traitCorrectionImagesDir, fileName);
    await fs.writeFile(outputPath, Buffer.from(match[2], "base64"));
    return {
      source_kind: "upload",
      source_url: "",
      stored_image_path: path.relative(__dirname, outputPath),
      mime_type: mimeType
    };
  }

  if (/^https?:\/\//i.test(source)) {
    try {
      const remoteResponse = await fetch(source);
      if (!remoteResponse.ok) {
        throw new Error(`Remote fetch failed with ${remoteResponse.status}`);
      }
      const mimeType = String(remoteResponse.headers.get("content-type") || "").trim().toLowerCase();
      const extension = mimeType ? extensionFromMimeType(mimeType) : extensionFromImageUrl(source);
      const fileName = `${recordId}${extension}`;
      const outputPath = path.join(traitCorrectionImagesDir, fileName);
      const buffer = Buffer.from(await remoteResponse.arrayBuffer());
      await fs.writeFile(outputPath, buffer);
      return {
        source_kind: "remote_url",
        source_url: source,
        stored_image_path: path.relative(__dirname, outputPath),
        mime_type: mimeType
      };
    } catch {
      return {
        source_kind: "remote_url",
        source_url: source,
        stored_image_path: "",
        mime_type: ""
      };
    }
  }

  return {
    source_kind: "unknown",
    source_url: source,
    stored_image_path: "",
    mime_type: ""
  };
}

async function loadLocalEnv() {
  for (const envPath of envFiles) {
    let contents = "";
    try {
      contents = await fs.readFile(envPath, "utf8");
    } catch {
      continue;
    }

    for (const rawLine of contents.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }

      const separatorIndex = line.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) {
        continue;
      }

      let value = line.slice(separatorIndex + 1).trim();
      if (
        (value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      process.env[key] = value;
    }
  }
}

const seedQueries = [
  "highback lounge chairs with wood bases",
  "guest chairs with circular shaped backs",
  "sofas with concealed bases"
];

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

let sceneFilterRunner = {
  pid: 0,
  startedAt: "",
  command: []
};

const MODEL_PRICING_USD_PER_MILLION = {
  "gpt-4.1-nano": {
    input: 0.10,
    output: 0.40
  }
};

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function getResultCutoffConfig() {
  return {
    minResults: envNumber("RESULT_CUTOFF_MIN_RESULTS", RESULT_CUTOFF_DEFAULTS.minResults),
    maxResults: envNumber("RESULT_CUTOFF_MAX_RESULTS", RESULT_CUTOFF_DEFAULTS.maxResults),
    minGapAbsolute: envNumber("RESULT_CUTOFF_MIN_GAP_ABSOLUTE", RESULT_CUTOFF_DEFAULTS.minGapAbsolute),
    minGapRatio: envNumber("RESULT_CUTOFF_MIN_GAP_RATIO", RESULT_CUTOFF_DEFAULTS.minGapRatio),
    relativeFloor: envNumber("RESULT_CUTOFF_RELATIVE_FLOOR", RESULT_CUTOFF_DEFAULTS.relativeFloor),
    uniformThreshold: envNumber("RESULT_CUTOFF_UNIFORM_THRESHOLD", RESULT_CUTOFF_DEFAULTS.uniformThreshold)
  };
}

function normalizeStage0Result(value = "") {
  return normalizeImageClassification(value);
}

function incrementReindexStage0Counts(result = "") {
  const normalized = normalizeStage0Result(result);
  if (normalized === "product") {
    reindexState.product_photos = Number(reindexState.product_photos || 0) + 1;
    return normalized;
  }
  if (normalized === "scene") {
    reindexState.scene_photos = Number(reindexState.scene_photos || 0) + 1;
    return normalized;
  }
  if (normalized === "product_detail") {
    reindexState.detail_photos = Number(reindexState.detail_photos || 0) + 1;
    return normalized;
  }
  return "";
}

async function readSceneFilterProgress() {
  let raw = "";
  try {
    raw = await fs.readFile(sceneFilterProgressPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { available: false };
    }
    throw error;
  }

  const payload = raw ? JSON.parse(raw) : {};
  const total = Math.max(0, Number(payload.total_products ?? payload.max_products) || 0);
  const completed = Math.max(0, Number(payload.completed_products) || 0);
  const imagesChecked = Math.max(0, Number(payload.images_checked) || 0);
  const productPhotos = Math.max(0, Number(payload.product_photos) || 0);
  const scenePhotos = Math.max(0, Number(payload.scene_photos) || 0);
  const inputTokens = Math.max(0, Number(payload.input_tokens) || 0);
  const outputTokens = Math.max(0, Number(payload.output_tokens) || 0);
  const totalTokens = Math.max(0, Number(payload.total_tokens) || 0);
  const updatedAt = String(payload.updated_at || "").trim();
  const updatedMs = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  const stale = !Number.isNaN(updatedMs) && (Date.now() - updatedMs) > (3 * 60 * 1000);
  const done = Boolean(payload.done) || (total > 0 && completed >= total);
  const running = !done && !stale;
  const pricing = MODEL_PRICING_USD_PER_MILLION[String(payload.model_version || "").trim()] || null;
  const estimatedInputCostUsd = pricing ? (inputTokens / 1_000_000) * pricing.input : 0;
  const estimatedOutputCostUsd = pricing ? (outputTokens / 1_000_000) * pricing.output : 0;
  const estimatedTotalCostUsd = estimatedInputCostUsd + estimatedOutputCostUsd;

  return {
    available: true,
    running: running || Boolean(sceneFilterRunner.pid),
    done,
    stale: !done && stale,
    total,
    completed,
    left: Math.max(total - completed, 0),
    images_checked: imagesChecked,
    product_photos: productPhotos,
    scene_photos: scenePhotos,
    product_photo_pct: imagesChecked ? Number(((productPhotos / imagesChecked) * 100).toFixed(1)) : 0,
    scene_photo_pct: imagesChecked ? Number(((scenePhotos / imagesChecked) * 100).toFixed(1)) : 0,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    avg_total_tokens_per_image: imagesChecked ? Number((totalTokens / imagesChecked).toFixed(1)) : 0,
    estimated_input_cost_usd: Number(estimatedInputCostUsd.toFixed(6)),
    estimated_output_cost_usd: Number(estimatedOutputCostUsd.toFixed(6)),
    estimated_total_cost_usd: Number(estimatedTotalCostUsd.toFixed(6)),
    avg_cost_per_image_usd: imagesChecked ? Number((estimatedTotalCostUsd / imagesChecked).toFixed(6)) : 0,
    model_version: String(payload.model_version || "").trim(),
    detail: String(payload.detail || "").trim(),
    label: String(payload.label || "").trim(),
    product_ids_file: String(payload.product_ids_file || "").trim(),
    last_product_id: String(payload.last_product_id || "").trim(),
    updated_at: updatedAt,
    log: Array.isArray(payload.log) ? payload.log.slice(0, 8) : [],
    runner_pid: sceneFilterRunner.pid || 0
  };
}

async function startSceneFilterRunner() {
  if (sceneFilterRunner.pid) {
    throw new Error("Stage 0 scene filter is already running.");
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Stage 0 scene filter requires OPENAI_API_KEY on the local server.");
  }

  const progress = await readSceneFilterProgress();
  if (!progress.available) {
    throw new Error("No Stage 0 checkpoint found to resume.");
  }
  if (progress.done) {
    throw new Error("Stage 0 scene filter is already complete.");
  }
  const remainingProducts = Math.max(progress.left, 0);
  if (!remainingProducts) {
    throw new Error("No remaining products to process.");
  }

  const progressPayload = JSON.parse(await fs.readFile(sceneFilterProgressPath, "utf8"));
  const resumedStartIndex = Math.max(0, Number(progressPayload.start_index) || 0) + Math.max(0, Number(progressPayload.completed_products) || 0);
  const command = [
    path.join(__dirname, "scripts", "run-scene-filter-sample.js"),
    "--start", String(resumedStartIndex),
    "--max-products", String(remainingProducts),
    "--progress-start-index", String(Math.max(0, Number(progressPayload.start_index) || 0)),
    "--progress-total-products", String(Math.max(0, Number(progressPayload.total_products ?? progressPayload.max_products) || remainingProducts)),
    "--resume-completed", String(Math.max(0, Number(progressPayload.completed_products) || 0)),
    "--resume-images-checked", String(Math.max(0, Number(progressPayload.images_checked) || 0)),
    "--resume-product-photos", String(Math.max(0, Number(progressPayload.product_photos) || 0)),
    "--resume-scene-photos", String(Math.max(0, Number(progressPayload.scene_photos) || 0)),
    "--resume-input-tokens", String(Math.max(0, Number(progressPayload.input_tokens) || 0)),
    "--resume-output-tokens", String(Math.max(0, Number(progressPayload.output_tokens) || 0)),
    "--resume-total-tokens", String(Math.max(0, Number(progressPayload.total_tokens) || 0))
  ];
  if (String(progressPayload.product_ids_file || "").trim()) {
    command.push("--product-ids-file", String(progressPayload.product_ids_file).trim());
  }
  if (String(progressPayload.label || "").trim()) {
    command.push("--progress-label", String(progressPayload.label).trim());
  }

  const logFd = fsSync.openSync(sceneFilterBatchLogPath, "a");
  const child = spawn(process.execPath, command, {
    cwd: __dirname,
    env: process.env,
    detached: true,
    stdio: ["ignore", logFd, logFd]
  });
  fsSync.closeSync(logFd);

  sceneFilterRunner = {
    pid: child.pid || 0,
    startedAt: new Date().toISOString(),
    command
  };

  child.once("exit", () => {
    sceneFilterRunner = {
      pid: 0,
      startedAt: "",
      command: []
    };
  });
  child.unref();

  return {
    started: true,
    pid: sceneFilterRunner.pid,
    start_index: resumedStartIndex,
    remaining_products: remainingProducts
  };
}
const BULK_REFRESH_BATCH_SIZE = 5;
const BULK_REFRESH_PRODUCT_DELAY_MS = 200;
const BULK_REFRESH_BATCH_DELAY_MS = 1000;
let reindexState = {
  running: false,
  started_at: "",
  total: 0,
  completed: 0,
  failed: 0,
  failed_unmapped: 0,
  failed_other: 0,
  failed_products: [],
  unmapped_groupings: [],
  current_product: "",
  current_product_id: "",
  current_product_images_passed: 0,
  current_product_successful_extractions: 0,
  current_product_failed_images: 0,
  current_run: "",
  current_image_url: "",
  processed_images: 0,
  product_photos: 0,
  scene_photos: 0,
  detail_photos: 0,
  total_cost_usd: 0,
  tiebreaker_products: 0,
  current_batch: 0,
  total_batches: 0,
  log: [],
  done: false
};

function upsertUnmappedGroupingEntry(grouping = "", product = {}) {
  const normalizedGrouping = String(grouping || "").trim() || "(none)";
  const productId = String(product.product_id || "").trim();
  const productName = String(product.name || "").trim();
  if (!normalizedGrouping || !productId) {
    return;
  }

  const existing = reindexState.unmapped_groupings.find((entry) => entry.grouping === normalizedGrouping);
  if (existing) {
    if (!existing.products.some((entry) => entry.product_id === productId)) {
      existing.products.push({ product_id: productId, name: productName });
      existing.products.sort((left, right) => String(left.name || left.product_id).localeCompare(String(right.name || right.product_id)));
    }
    existing.count = existing.products.length;
    return;
  }

  reindexState.unmapped_groupings.push({
    grouping: normalizedGrouping,
    count: 1,
    products: [{ product_id: productId, name: productName }]
  });
  reindexState.unmapped_groupings.sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count;
    }
    return String(left.grouping).localeCompare(String(right.grouping));
  });
}

function json(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  response.end(JSON.stringify(payload));
}

function normalizeRequestedVisualType(input = null) {
  if (typeof input === "string") {
    return resolveVisualType({ visual_type: input })?.visual_type || "";
  }

  if (input && typeof input === "object") {
    const canonical = String(input.visual_type || "").trim();
    if (canonical) {
      return resolveVisualType({ visual_type: canonical })?.visual_type || "";
    }

    const legacy = String(input.seating_type || "").trim().toLowerCase();
    return seatingTypes[legacy] ? legacy : "";
  }

  return "";
}

function isAllVisualTypeRequest(input = null) {
  if (typeof input === "string") {
    return String(input || "").trim().toLowerCase() === "all";
  }
  if (input && typeof input === "object") {
    const canonical = String(input.visual_type || "").trim();
    if (canonical) {
      return canonical.toLowerCase() === "all";
    }
    return String(input.seating_type || "").trim().toLowerCase() === "all";
  }
  return false;
}

function resolvePayloadVisualType(payload = {}) {
  return normalizeVisualTypeKey(
    payload?.visual_type ||
    payload?.seating_type ||
    payload?.stage1?.visual_type ||
    payload?.stage1?.seating_type ||
    ""
  );
}

function addVisualTypeField(payload = {}) {
  return {
    ...payload,
    visual_type: resolvePayloadVisualType(payload)
  };
}

function addVisualTypeToAnalysisPayload(analysis = {}) {
  const visualType = resolvePayloadVisualType(analysis);
  return {
    ...analysis,
    visual_type: visualType,
    stage1: analysis?.stage1 && typeof analysis.stage1 === "object"
      ? {
          ...analysis.stage1,
          visual_type: normalizeVisualTypeKey(analysis.stage1.visual_type || analysis.stage1.seating_type || visualType || "")
        }
      : analysis?.stage1
  };
}

function addVisualTypeToRecordPayload(record = {}) {
  if (!record || typeof record !== "object") {
    return record;
  }
  const visualType = resolvePayloadVisualType(record);
  return {
    ...record,
    visual_type: visualType,
    stage1: record?.stage1 && typeof record.stage1 === "object"
      ? {
          ...record.stage1,
          visual_type: normalizeVisualTypeKey(record.stage1.visual_type || record.stage1.seating_type || visualType || "")
        }
      : record?.stage1
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getSceneFilterResults(record = null) {
  return Array.isArray(record?.scene_filter_results) ? record.scene_filter_results : [];
}

function findSceneFilterResult(record = null, imageUrl = "") {
  const canonicalTarget = canonicalizeProductImageUrl(imageUrl);
  if (!canonicalTarget) {
    return null;
  }

  return getSceneFilterResults(record).find((entry) => {
    const modelVersion = String(entry?.model_version || "").trim();
    return /gpt-4\.1-nano/i.test(modelVersion) &&
      canonicalizeProductImageUrl(entry?.image_url) === canonicalTarget &&
      (entry?.result === "scene" || entry?.result === "product");
  }) || null;
}

function selectSceneFilterHeroImage(record = null, candidateUrls = []) {
  const results = getSceneFilterResults(record);
  if (!results.length) {
    return "";
  }

  const candidateMap = new Map(
    (candidateUrls || [])
      .map((url) => [canonicalizeProductImageUrl(url), String(url || "").trim()])
      .filter(([canonical, original]) => canonical && original)
  );

  for (const entry of results) {
    const canonical = canonicalizeProductImageUrl(entry?.image_url);
    if (candidateMap.has(canonical)) {
      return candidateMap.get(canonical);
    }
  }

  return "";
}

function buildSceneFilterBadge(record = null, imageUrl = "") {
  const match = findSceneFilterResult(record, imageUrl);
  if (!match) {
    return null;
  }

  return {
    label: match.result === "scene" ? "Scene" : "Product",
    result: match.result,
    model_version: String(match.model_version || "").trim()
  };
}

function splitSentences(value = "") {
  return String(value || "")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function normalizeTraitValue(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function collectTraitTokens(namespace, source, collector) {
  if (!source || typeof source !== "object") {
    return;
  }

  for (const [field, rawValue] of Object.entries(source)) {
    if (rawValue === null || rawValue === undefined) {
      continue;
    }

    if (Array.isArray(rawValue)) {
      for (const item of rawValue) {
        const normalized = normalizeTraitValue(item);
        if (!normalized || normalized === "unknown") {
          continue;
        }
        collector.add(`${namespace}.${field}:${normalized}`);
      }
      continue;
    }

    if (typeof rawValue === "object") {
      continue;
    }

    const normalized = normalizeTraitValue(rawValue);
    if (!normalized || normalized === "unknown") {
      continue;
    }
    collector.add(`${namespace}.${field}:${normalized}`);
  }
}

function buildEvalCandidateProfile(record = {}) {
  const traitSet = new Set();
  collectTraitTokens("image", record.image_traits, traitSet);
  collectTraitTokens("merged", record.merged_traits, traitSet);
  collectTraitTokens("visual", record.visual_traits, traitSet);

  if (record.category) {
    traitSet.add(`catalog.category:${normalizeTraitValue(record.category)}`);
  }
  if (record.seating_type) {
    traitSet.add(`catalog.seating_type:${normalizeTraitValue(record.seating_type)}`);
  }

  return {
    product_id: String(record.product_id || "").trim(),
    product_name: String(record.product_name || record.name || "").trim(),
    brand: String(record.brand || "").trim(),
    category: String(record.category || "").trim(),
    seating_type: String(record.seating_type || "").trim(),
    visual_type: normalizeVisualTypeKey(record.visual_type || record.seating_type || ""),
    visual_summary: String(record.visual_summary || "").trim(),
    traits: [...traitSet].sort()
  };
}

function sortCountEntries(counts) {
  return [...counts.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }
      return a[0].localeCompare(b[0]);
    })
    .map(([trait, count]) => ({ trait, count }));
}

function buildTraitPreferencePayload(
  result,
  index,
  rerankerOrder = [],
  humanCorrectedOrder = [],
  options = {}
) {
  const imageLookup = new Map((index?.images || []).map((image) => [image.product_id, image]));
  const removedProductIds = Array.isArray(options.removedProductIds)
    ? options.removedProductIds.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const belowLineProductIds = Array.isArray(options.belowLineProductIds)
    ? options.belowLineProductIds.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const candidateIds = [...new Set([
    String(result?.product_id || "").trim(),
    ...rerankerOrder.map((value) => String(value || "").trim()),
    ...humanCorrectedOrder.map((value) => String(value || "").trim()),
    ...removedProductIds,
    ...belowLineProductIds
  ].filter(Boolean))];
  const candidateProfiles = Object.fromEntries(
    candidateIds.map((productId) => [productId, buildEvalCandidateProfile(imageLookup.get(productId) || {})])
  );
  const queryProfile = candidateProfiles[String(result?.product_id || "").trim()] || buildEvalCandidateProfile({});

  const rerankerPositions = new Map(rerankerOrder.map((productId, index) => [productId, index]));
  const humanPositions = new Map(humanCorrectedOrder.map((productId, index) => [productId, index]));
  const irrelevantIds = [...new Set([...removedProductIds, ...belowLineProductIds])];
  const irrelevantIdSet = new Set(irrelevantIds);
  const relevantOrder = humanCorrectedOrder.filter((productId) => !irrelevantIdSet.has(productId));
  const topRelevantIds = relevantOrder.slice(0, Math.min(3, relevantOrder.length));
  const preferredCounts = new Map();
  const demotedCounts = new Map();
  const preferencePairs = [];
  const pairKeys = new Set();

  function trackTraitCounts(preferredOnlyTraits = [], demotedOnlyTraits = []) {
    preferredOnlyTraits.forEach((trait) => {
      preferredCounts.set(trait, (preferredCounts.get(trait) || 0) + 1);
    });
    demotedOnlyTraits.forEach((trait) => {
      demotedCounts.set(trait, (demotedCounts.get(trait) || 0) + 1);
    });
  }

  function appendPreferencePair(preferredId, demotedId, metadata = {}) {
    if (!preferredId || !demotedId || preferredId === demotedId) {
      return;
    }

    const pairType = String(metadata.pairType || "reorder_correction").trim() || "reorder_correction";
    const pairKey = `${pairType}::${preferredId}::${demotedId}`;
    if (pairKeys.has(pairKey)) {
      return;
    }

    const preferredProfile = candidateProfiles[preferredId] || buildEvalCandidateProfile({});
    const demotedProfile = candidateProfiles[demotedId] || buildEvalCandidateProfile({});
    const preferredTraits = new Set(preferredProfile.traits || []);
    const demotedTraits = new Set(demotedProfile.traits || []);
    const sharedTraits = [...preferredTraits].filter((trait) => demotedTraits.has(trait)).sort();
    const preferredOnlyTraits = [...preferredTraits].filter((trait) => !demotedTraits.has(trait)).sort();
    const demotedOnlyTraits = [...demotedTraits].filter((trait) => !preferredTraits.has(trait)).sort();
    const queryTraits = new Set(queryProfile.traits || []);
    const queryAlignedPreferredTraits = preferredOnlyTraits.filter((trait) => queryTraits.has(trait));
    const queryAlignedDemotedTraits = demotedOnlyTraits.filter((trait) => queryTraits.has(trait));

    trackTraitCounts(preferredOnlyTraits, demotedOnlyTraits);
    pairKeys.add(pairKey);
    preferencePairs.push({
      preferred_product_id: preferredId,
      demoted_product_id: demotedId,
      preferred_product_name: preferredProfile.product_name,
      demoted_product_name: demotedProfile.product_name,
      preferred_rank: metadata.preferredRank ?? null,
      demoted_rank: metadata.demotedRank ?? null,
      reranker_preferred_rank: metadata.rerankerPreferredRank ?? null,
      reranker_demoted_rank: metadata.rerankerDemotedRank ?? null,
      pair_type: pairType,
      irrelevance_reason: metadata.irrelevanceReason || null,
      shared_traits: sharedTraits,
      preferred_only_traits: preferredOnlyTraits,
      demoted_only_traits: demotedOnlyTraits,
      query_aligned_preferred_traits: queryAlignedPreferredTraits,
      query_aligned_demoted_traits: queryAlignedDemotedTraits
    });
  }

  for (let leftIndex = 0; leftIndex < humanCorrectedOrder.length; leftIndex += 1) {
    const preferredId = humanCorrectedOrder[leftIndex];
    if (irrelevantIdSet.has(preferredId)) {
      continue;
    }
    const preferredRank = leftIndex + 1;
    for (let rightIndex = leftIndex + 1; rightIndex < humanCorrectedOrder.length; rightIndex += 1) {
      const demotedId = humanCorrectedOrder[rightIndex];
      if (irrelevantIdSet.has(demotedId)) {
        continue;
      }
      const demotedRank = rightIndex + 1;
      const rerankerPreferredRank = rerankerPositions.get(preferredId);
      const rerankerDemotedRank = rerankerPositions.get(demotedId);

      if (rerankerPreferredRank === undefined || rerankerDemotedRank === undefined) {
        continue;
      }

      // Keep only true corrections, where the human order inverted the original reranker order.
      if (rerankerPreferredRank < rerankerDemotedRank) {
        continue;
      }

      appendPreferencePair(preferredId, demotedId, {
        preferredRank,
        demotedRank,
        rerankerPreferredRank: rerankerPreferredRank + 1,
        rerankerDemotedRank: rerankerDemotedRank + 1,
        pairType: "reorder_correction"
      });
    }
  }

  irrelevantIds.forEach((demotedId) => {
    const demotedRank = humanPositions.get(demotedId);
    const rerankerDemotedRank = rerankerPositions.get(demotedId);
    const irrelevanceReason = removedProductIds.includes(demotedId) ? "removed" : "below_line";

    topRelevantIds.forEach((preferredId, index) => {
      const preferredRank = humanPositions.get(preferredId);
      const rerankerPreferredRank = rerankerPositions.get(preferredId);

      appendPreferencePair(preferredId, demotedId, {
        preferredRank: preferredRank === undefined ? index + 1 : preferredRank + 1,
        demotedRank: demotedRank === undefined ? null : demotedRank + 1,
        rerankerPreferredRank: rerankerPreferredRank === undefined ? null : rerankerPreferredRank + 1,
        rerankerDemotedRank: rerankerDemotedRank === undefined ? null : rerankerDemotedRank + 1,
        pairType: "irrelevant_result",
        irrelevanceReason
      });
    });
  });

  return {
    query_product_profile: queryProfile,
    candidate_profiles: candidateProfiles,
    preference_pairs: preferencePairs,
    trait_preference_summary: {
      preferred_traits: sortCountEntries(preferredCounts),
      demoted_traits: sortCountEntries(demotedCounts)
    }
  };
}

async function loadEvalData() {
  const [evalResults, index, judgments] = await Promise.all([
    readJson(evalResultsPath),
    readJson(indexPath),
    readJson(evalJudgmentsPath, [])
  ]);

  if (!evalResults) {
    throw new Error("Eval results not found. Run `node scripts/eval-reranker.js` first.");
  }

  const imageMap = new Map();
  for (const image of index?.images || []) {
    if (!imageMap.has(image.product_id)) {
      imageMap.set(image.product_id, {
        product_id: image.product_id,
        product_name: image.name,
        brand: image.brand,
        image_url: image.image_url,
        visual_summary: image.visual_summary || "",
        summary_preview: splitSentences(image.visual_summary || "").slice(0, 2).join(" "),
        is_room_scene: Boolean(image.is_room_scene)
      });
    }
  }

  const mergedResults = (evalResults.results || []).map((result) => ({
    ...result,
    image_url: imageMap.get(result.product_id)?.image_url || "",
    summary_preview: splitSentences(result.visual_summary || "").slice(0, 2).join(" "),
    is_room_scene: Boolean(imageMap.get(result.product_id)?.is_room_scene),
    embedding_top10: (result.embedding_top10 || []).map((item) => ({
      ...item,
      image_url: imageMap.get(item.product_id)?.image_url || "",
      visual_summary: imageMap.get(item.product_id)?.visual_summary || "",
      is_room_scene: Boolean(imageMap.get(item.product_id)?.is_room_scene)
    })),
    reranker_top10: (result.reranker_top10 || []).map((item) => ({
      ...item,
      image_url: imageMap.get(item.product_id)?.image_url || "",
      visual_summary: imageMap.get(item.product_id)?.visual_summary || "",
      is_room_scene: Boolean(imageMap.get(item.product_id)?.is_room_scene)
    }))
  }));

  return {
    summary: evalResults.summary || {},
    results: mergedResults,
    judgments: Array.isArray(judgments) ? judgments : []
  };
}

async function readRequestJson(request) {
  const chunks = [];
  let total = 0;

  for await (const chunk of request) {
    total += chunk.length;
    if (total > 10 * 1024 * 1024) {
      throw new Error("Request body too large.");
    }
    chunks.push(chunk);
  }

  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function collapseRepeatedTokenSequences(text) {
  const tokens = String(text || "").split(/\s+/).filter(Boolean);
  if (!tokens.length) {
    return "";
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (let size = Math.min(12, Math.floor(tokens.length / 2)); size >= 3; size -= 1) {
      for (let i = 0; i + size * 2 <= tokens.length; i += 1) {
        const a = tokens.slice(i, i + size).join(" ").toLowerCase();
        const b = tokens.slice(i + size, i + size * 2).join(" ").toLowerCase();
        if (a === b) {
          tokens.splice(i + size, size);
          changed = true;
          break;
        }
      }
      if (changed) {
        break;
      }
    }
  }

  return tokens.join(" ");
}

function collapseMirroredRepetition(text) {
  const tokens = String(text || "").split(/\s+/).filter(Boolean);
  if (!tokens.length) {
    return "";
  }

  const connectors = new Set(["on", "with", "featuring", "and"]);
  let changed = true;
  while (changed) {
    changed = false;
    for (let size = Math.min(10, Math.floor((tokens.length - 1) / 2)); size >= 3; size -= 1) {
      for (let i = 0; i + size * 2 + 1 <= tokens.length; i += 1) {
        const connector = String(tokens[i + size] || "").toLowerCase();
        if (!connectors.has(connector)) {
          continue;
        }
        const left = tokens.slice(i, i + size).join(" ").toLowerCase();
        const right = tokens.slice(i + size + 1, i + size * 2 + 1).join(" ").toLowerCase();
        if (left === right) {
          tokens.splice(i + size, size + 1);
          changed = true;
          break;
        }
      }
      if (changed) {
        break;
      }
    }
  }

  return tokens.join(" ");
}

function normalizeCandidateText(value = "") {
  return collapseMirroredRepetition(collapseRepeatedTokenSequences(String(value || "")))
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,+/g, ", ")
    .replace(/\b(finish)\s+\1\b/gi, "$1")
    .trim()
    .replace(/^[,.;:!?]+|[,.;:!?]+$/g, "");
}

function getTypeFields(typeKey) {
  return seatingTypes[typeKey]?.fields || seatingTypes[defaultSeatingType]?.fields || [];
}

const STRUCTURED_BULLET_FIELD_ALIASES = new Map([
  ["arms", "arm_option"],
  ["base", "base_type"],
  ["design", "design_register"],
  ["shape", "shape_character"],
  ["height", "height_category"],
  ["adjustability", "height_adjustability"]
]);

function formatStructuredBulletFieldLabel(field = "") {
  return String(field || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function resolveStructuredBulletField(typeKey = "", fieldLabel = "") {
  const normalizedField = String(fieldLabel || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!normalizedField) {
    return "";
  }

  const typeFields = getTypeFields(typeKey);
  if (typeFields.some((field) => field.field === normalizedField)) {
    return normalizedField;
  }

  const schemaLabelMatch = typeFields.find((field) => (
    formatStructuredBulletFieldLabel(field.field).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") === normalizedField
  ));
  if (schemaLabelMatch) {
    return schemaLabelMatch.field;
  }

  const aliasMatch = STRUCTURED_BULLET_FIELD_ALIASES.get(normalizedField);
  if (aliasMatch && typeFields.some((field) => field.field === aliasMatch)) {
    return aliasMatch;
  }

  return aliasMatch || normalizedField;
}

function formatDetectedTraits(imageTraits = {}, typeKey, limit = 6) {
  const labels = new Map([
    ["height_category", "Height"],
    ["height_adjustability", "Adjustability"],
    ["back", "Back"],
    ["base_type", "Base"],
    ["base_frame_finish", "Base Finish"],
    ["seat_material", "Seat"],
    ["seat_fabric", "Fabric"],
    ["design_register", "Design"],
    ["base_finish", "Base Finish"],
    ["frame", "Frame"],
    ["back_style", "Back"],
    ["arm_option", "Arms"],
    ["seat_upholstery", "Seat"],
    ["shell_material", "Shell"],
    ["body_construction", "Body"]
  ]);
  const fieldMap = new Map(getTypeFields(typeKey).map((field) => [field.field, field]));

  return Object.entries(imageTraits || {})
    .map(([field, value]) => {
      const fieldConfig = fieldMap.get(field);
      if (fieldConfig?.detectability === "no") {
        return "";
      }

      const normalized = String(value ?? "").trim();
      if (!normalized || normalized.toLowerCase() === "unknown") {
        return "";
      }

      return `${labels.get(field) || field.replace(/_/g, " ")}: ${normalized}`;
    })
    .filter(Boolean)
    .slice(0, limit);
}


function dedupeVisualBullets(bullets = []) {
  const clean = bullets
    .map((value) => normalizeCandidateText(value))
    .filter(Boolean);

  const sorted = [...clean].sort((a, b) => b.length - a.length);
  const kept = [];

  for (const bullet of sorted) {
    const normalized = bullet.toLowerCase();
    const isRedundant = kept.some((existing) => {
      const existingNormalized = existing.toLowerCase();
      return (
        existingNormalized.includes(normalized) ||
        normalized.includes(existingNormalized) ||
        (normalized.includes("five-star") && existingNormalized.includes("base") && !existingNormalized.includes("five-star")) ||
        (normalized.includes("base") && existingNormalized.includes("base") && /chrome|metal|polished|five-star|caster/.test(existingNormalized)) ||
        (normalized.includes("caster") && existingNormalized.includes("wheel")) ||
        (normalized.includes("leather") && existingNormalized.includes("seat")) ||
        (normalized.includes("task chair") && existingNormalized.includes("chair"))
      );
    });

    if (!isRedundant) {
      kept.push(bullet);
    }
  }

  return kept.reverse();
}

function normalizeStructuredBullets(bullets = [], seatingType = "") {
  const normalizeList = (values = []) => {
    const seen = new Set();
    const normalized = [];

    for (const value of values || []) {
      const bullet = normalizeCandidateText(value);
      const key = bullet.toLowerCase();
      if (!bullet || seen.has(key)) {
        continue;
      }
      seen.add(key);
      normalized.push(bullet);
    }

    return normalized;
  };

  if (Array.isArray(bullets)) {
    const normalized = { essential: [], normal: [], low: [] };
    normalizeList(bullets).forEach((bullet) => {
      const text = String(bullet || "");
      const separatorIndex = text.indexOf(":");
      const field = separatorIndex === -1
        ? ""
        : text.slice(0, separatorIndex).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
      const priority = getFieldPriority(seatingType, field);
      if (priority === "essential") {
        normalized.essential.push(text);
      } else if (priority === "low") {
        normalized.low.push(text);
      } else {
        normalized.normal.push(text);
      }
    });
    return normalized;
  }

  if (!bullets || typeof bullets !== "object") {
    return { essential: [], normal: [], low: [] };
  }

  return {
    essential: normalizeList(bullets.essential || []),
    normal: normalizeList(bullets.normal || []),
    low: normalizeList(bullets.low || [])
  };
}

function mergeStructuredBullets(seatingType = "", ...groups) {
  const priorityRank = new Map([
    ["essential", 3],
    ["normal", 2],
    ["low", 1]
  ]);
  const mergedByKey = new Map();
  let order = 0;

  const normalizeBulletValue = (value = "") => String(value || "").trim().toLowerCase();
  const semanticKeyForBullet = (bullet = "") => {
    const text = String(bullet || "").trim();
    const separatorIndex = text.indexOf(":");
    if (separatorIndex === -1) {
      return null;
    }
    const field = resolveStructuredBulletField(seatingType, text.slice(0, separatorIndex).trim());
    const value = normalizeBulletValue(text.slice(separatorIndex + 1).trim());
    if (!field || !value) {
      return null;
    }
    return `${field}::${value}`;
  };

  for (const group of groups) {
    const normalized = normalizeStructuredBullets(group, seatingType);
    for (const priority of ["essential", "normal", "low"]) {
      for (const bullet of normalized[priority]) {
        const key = semanticKeyForBullet(bullet) || `raw::${String(bullet || "").trim().toLowerCase()}`;
        const existing = mergedByKey.get(key);
        const candidate = {
          text: bullet,
          priority,
          order: order += 1
        };
        if (!existing) {
          mergedByKey.set(key, candidate);
          continue;
        }
        const existingRank = priorityRank.get(existing.priority) || 0;
        const candidateRank = priorityRank.get(candidate.priority) || 0;
        if (candidateRank > existingRank) {
          mergedByKey.set(key, {
            ...candidate,
            order: existing.order
          });
        }
      }
    }
  }

  const merged = { essential: [], normal: [], low: [] };
  [...mergedByKey.values()]
    .sort((left, right) => left.order - right.order)
    .forEach((entry) => {
      merged[entry.priority].push(entry.text);
    });

  return normalizeStructuredBullets(merged, seatingType);
}

function normalizeComposedQueryText(value = "") {
  const collapseRepeatedClauses = (text) => {
    const parts = String(text || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const seen = new Set();
    const kept = [];
    for (const part of parts) {
      const key = part.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      kept.push(part);
    }
    return kept.join(", ");
  };

  return collapseRepeatedClauses(normalizeCandidateText(value));
}

function formatTraitChangeLine(change = {}) {
  const label = String(change.label || change.field || "Trait").trim();
  const oldValue = String(change.old_value || "").trim();
  const newValue = String(change.new_value || "").trim();
  if (oldValue && newValue) {
    return `- ${label}: ${oldValue} -> ${newValue}`;
  }
  if (newValue) {
    return `- ${label}: (not specified) -> ${newValue}`;
  }
  return `- ${label}: ${oldValue} -> removed`;
}

async function rewriteQueryFromTraitChanges(currentQueryText = "", traitChanges = [], activeBullets = [], apiKey = "") {
  const queryText = String(currentQueryText || "").trim();
  if (!queryText) {
    return "";
  }

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for targeted query rewrites.");
  }

  const changesText = (Array.isArray(traitChanges) ? traitChanges : [])
    .map((entry) => formatTraitChangeLine(entry))
    .filter(Boolean)
    .join("\n");
  const activeTraitsText = (Array.isArray(activeBullets) ? activeBullets : [])
    .map((bullet) => `- ${String(bullet || "").trim()}`)
    .filter((line) => line !== "-")
    .join("\n");
  const systemPrompt = "You are making targeted edits to a furniture search query. Your goal is to preserve as much of the original query as possible while reflecting the trait changes listed below.\n\nRules:\n- Only modify phrases that describe the changed traits\n- If the original query contains language that conflicts with any trait in the current active trait set, replace that conflicting language. The active traits always win over the original description.\n- If a changed trait was not mentioned in the original query, add a brief natural-sounding phrase for it\n- Do not rewrite, remove, or restructure any part of the query that is not related to the changed traits\n- The result should read as natural flowing prose, not a list of traits\n- Avoid vague substitutions like 'unique material' or 'special finish'; use the actual trait values\n\nReturn the updated query text only. No preamble, no explanation, no quotation marks.";
  const userPrompt = `Original query:\n${queryText}\n\nTraits that changed (old value -> new value):\n${changesText || "- None"}\n\nCurrent active trait set (full target state):\n${activeTraitsText || "- None"}`;

  console.log("[rewrite-query-traits] original_query_text:", queryText);
  console.log("[rewrite-query-traits] trait_changes:", JSON.stringify(traitChanges));
  console.log("[rewrite-query-traits] active_bullets:", JSON.stringify(activeBullets));
  console.log("[rewrite-query-traits] system_prompt:", systemPrompt);
  console.log("[rewrite-query-traits] user_prompt:", userPrompt);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4.1",
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: userPrompt
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI targeted query rewrite failed with ${response.status}.`);
  }

  const payload = await response.json();
  const content = String(payload?.choices?.[0]?.message?.content || "").trim();
  console.log("[rewrite-query-traits] model_response_raw:", JSON.stringify(payload));
  console.log("[rewrite-query-traits] model_response_text:", content);
  if (!content) {
    console.log("[rewrite-query-traits] empty model response; client will fall back to composeQueryWithFallback.");
  }
  return normalizeComposedQueryText(content);
}

function polishSearchQuery(value = "") {
  const cleaned = normalizeComposedQueryText(value)
    .replace(/\bshell design\b/gi, "shell")
    .replace(/\bsupporting (the )?seat\b/gi, "")
    .replace(/\bon\s+([^,]+?)\s+featuring\s+/gi, "with $1, ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,+/g, ", ")
    .replace(/\s+/g, " ")
    .trim();

  const clauses = cleaned
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const deduped = [];
  for (const clause of clauses) {
    const lower = clause.toLowerCase();
    const isContained = deduped.some((kept) => {
      const keptLower = kept.toLowerCase();
      return keptLower.includes(lower) || lower.includes(keptLower);
    });
    if (!isContained) {
      deduped.push(clause);
    }
  }

  const hasWoodBase = deduped.some((clause) => /\bwood\b.*\bbase\b|\bbase\b.*\bwood\b/i.test(clause));
  const trimmed = deduped.filter((clause) => {
    if (hasWoodBase && /\bwood\b.*\bframe\b|\bframe\b.*\bwood\b/i.test(clause)) {
      return false;
    }
    return true;
  });

  return normalizeComposedQueryText(trimmed.join(", "))
    .replace(/\s+,/g, ",")
    .replace(/,\s*,+/g, ", ")
    .trim();
}

function hasLowQualityRepetition(value = "") {
  const text = String(value || "").toLowerCase();
  const tokens = text.split(/\s+/).filter(Boolean);
  for (let size = Math.min(10, Math.floor(tokens.length / 2)); size >= 4; size -= 1) {
    for (let i = 0; i + size * 2 <= tokens.length; i += 1) {
      const a = tokens.slice(i, i + size).join(" ");
      const b = tokens.slice(i + size, i + size * 2).join(" ");
      if (a === b) {
        return true;
      }
    }
  }
  return false;
}

const COMPOSE_GLUE_TOKENS = new Set([
  "a",
  "an",
  "the",
  "with",
  "and",
  "on",
  "in",
  "of",
  "for",
  "from",
  "featuring",
  "that",
  "this",
  "it",
  "is",
  "are",
  "has",
  "have",
  "set",
  "profile",
  "form",
  "design",
  "style",
  "look",
  "feel"
]);

function lexicalTokens(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => token.replace(/s$/, ""))
    .filter((token) => token.length > 1);
}

function isConstrainedRewriteValid(query, bullets = []) {
  const queryTokens = lexicalTokens(query);
  const bulletTokens = new Set(lexicalTokens((bullets || []).join(" ")));
  if (!queryTokens.length || !bulletTokens.size) {
    return false;
  }

  // No additions: every lexical token in composed query must come from bullets
  // (except small glue words used for fluent sentence structure).
  const unexpected = queryTokens.filter((token) => !bulletTokens.has(token) && !COMPOSE_GLUE_TOKENS.has(token));
  if (unexpected.length > 0) {
    return false;
  }

  // No removals in practice: each bullet should contribute at least one lexical token.
  return (bullets || []).every((bullet) => {
    const tokens = lexicalTokens(bullet).filter((token) => !COMPOSE_GLUE_TOKENS.has(token));
    if (!tokens.length) return true;
    return tokens.some((token) => queryTokens.includes(token));
  });
}

function toSentenceCase(text) {
  const value = String(text || "").trim();
  if (!value) {
    return "";
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function buildNaturalQueryFromBullets(bullets = []) {
  if (!bullets.length) {
    return "";
  }

  const normalizedBullets = [...new Set(bullets.map((bullet) => normalizeCandidateText(bullet)).filter(Boolean))];
  const typeBullet = normalizedBullets.find((bullet) => /\b(chair|lounge chair|guest chair|task chair|office chair|stool|bench|table|desk)\b/i.test(bullet)) || "chair";
  const noArmsBullet = normalizedBullets.find((bullet) => /\bno arms\b|\barmless\b/i.test(bullet));
  const seatBullets = normalizedBullets
    .filter((bullet) => /\bseat\b|\bbackrest\b|\bshell\b|\bupholstery\b|\bleather\b|\bfabric\b|\bcurved\b|\bscooped\b/i.test(bullet) && bullet !== typeBullet && bullet !== noArmsBullet)
    .slice(0, 2);
  const baseBullets = normalizedBullets
    .filter((bullet) => /\bbase\b|\bcaster\b|\bwheels\b|\blegs?\b/i.test(bullet))
    .slice(0, 2);
  const mechanismBullets = normalizedBullets.filter((bullet) => /\badjust|\blever\b|\bswivel\b|\btilt\b|\bheight\b/i.test(bullet));
  const styleBullets = normalizedBullets
    .filter((bullet) => /\bminimal\b|\bstreamlined\b|\bsleek\b|\bergonomic\b/i.test(bullet) && !seatBullets.includes(bullet))
    .slice(0, 1);

  const phrases = [];
  const cleanType = typeBullet.replace(/\boffice task chair\b/gi, "chair").replace(/\boffice chair\b/gi, "chair");
  const leadType = noArmsBullet ? `${noArmsBullet.replace(/\bdesign\b/gi, "").trim()} ${cleanType}` : cleanType;
  phrases.push(leadType);

  if (seatBullets.length) {
    phrases.push(`with ${seatBullets.join(", ")}`);
  }

  const baseParts = [...new Set(baseBullets)];
  const mechanismParts = [...new Set(mechanismBullets)];
  if (baseParts.length) {
    const basePhrase = mechanismParts.length
      ? `${baseParts.join(", ")} and ${mechanismParts.join(", ")}`
      : baseParts.join(", ");
    phrases.push(`on ${basePhrase}`);
  } else if (mechanismParts.length) {
    phrases.push(`with ${mechanismParts.join(", ")}`);
  }

  const leftover = normalizedBullets.filter((bullet) =>
    ![typeBullet, noArmsBullet, ...seatBullets, ...baseBullets, ...mechanismBullets].includes(bullet)
  );
  const descriptorParts = [...new Set([...styleBullets, ...leftover])].filter(Boolean).slice(0, 2);
  if (descriptorParts.length) {
    phrases.push(`featuring ${descriptorParts.join(", ")}`);
  }

  return normalizeComposedQueryText(toSentenceCase(
    phrases
      .join(" ")
      .replace(/\s+,/g, ",")
      .replace(/,\s*,+/g, ", ")
      .replace(/\s+/g, " ")
      .trim()
  ));
}

function buildFallbackQuery(bullets = []) {
  return buildNaturalQueryFromBullets(bullets);
}

async function composeSearchQueryFromBullets(bullets = [], apiKey) {
  const cleanBullets = dedupeVisualBullets(bullets);
  if (!cleanBullets.length) {
    return "";
  }

  const fallbackQuery = buildFallbackQuery(cleanBullets);
  const composeProvider = String(process.env.QUERY_COMPOSE_PROVIDER || "deterministic").toLowerCase();

  // Default behavior is deterministic composition for stable output across users/computers.
  // Opt into model rewriting only when explicitly configured.
  if (composeProvider !== "openai" || !apiKey) {
    return fallbackQuery;
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: process.env.QUERY_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: "Rewrite selected visual bullets into one concise natural-language furniture image-search query. Write a single polished phrase, not a list. You must preserve bullet meaning only: do not add any new attributes, materials, colors, finishes, styles, components, counts, or object types that are not explicitly present in the bullets. Do not remove bullet intent; every bullet should be represented semantically in the final sentence. Only reorder/compress wording for fluency. Preserve only visually observable form, materials, geometry, silhouette, structural traits, and object type from the provided bullets. Be conservative about category labels: prefer broader terms like chair, lounge chair, guest chair, stool, or table unless bullets clearly require narrower classification. Return plain text only."
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: cleanBullets.map((bullet) => `- ${bullet}`).join("\n")
            }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI query rewrite failed with ${response.status}.`);
  }

  const payload = await response.json();
  const rawQuery = String(payload.output_text || "").trim() || fallbackQuery;
  const normalizedQuery = polishSearchQuery(
    normalizeComposedQueryText(rawQuery)
    .replace(/\boffice task chair\b/gi, "chair")
    .trim()
  );

  if (
    !isConstrainedRewriteValid(normalizedQuery, cleanBullets) ||
    (normalizedQuery.match(/,/g) || []).length >= Math.max(3, cleanBullets.length - 1) ||
    normalizedQuery.split(",").length >= Math.max(4, cleanBullets.length - 1) ||
    hasLowQualityRepetition(normalizedQuery) ||
    normalizedQuery.length > 220
  ) {
    return polishSearchQuery(fallbackQuery);
  }

  return normalizedQuery;
}

async function loadCatalog() {
  const [catalog, index] = await Promise.all([readJson(normalizedPath), readJson(indexPath)]);
  return { catalog, index };
}

async function loadSeatingTypes() {
  return loadSeatingTypesAdapter();
}

function buildIndexedImageRecord(image, generated, refreshedAt = new Date().toISOString(), extra = {}) {
  const stage0Result = normalizeStage0Result(generated?.stage_0_result || extra?.stage_0_result);
  const stage1OverrideResult = normalizeImageClassification(
    generated?.stage_1_override_result || extra?.stage_1_override_result
  );
  const effectiveClassification = getEffectiveClassification({
    ...generated,
    ...extra,
    stage_0_result: stage0Result,
    stage_1_override_result: stage1OverrideResult
  });
  return {
    ...generated,
    ...extra,
    stage_0_result: stage0Result || String(generated?.stage_0_result || extra?.stage_0_result || "").trim(),
    stage_1_override_result: stage1OverrideResult,
    effective_classification: effectiveClassification,
    ai_refreshed_at: refreshedAt
  };
}

function cloneRefreshDiagnostics(value = null) {
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

function buildLightweightProductRecords(catalog, imageRecords = [], previousProducts = [], refreshDiagnosticsByProductId = new Map()) {
  const byProductId = new Map();
  const previousByProductId = new Map(
    (Array.isArray(previousProducts) ? previousProducts : [])
      .map((product) => [String(product?.product_id || "").trim(), product])
  );

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
  }

  for (const image of imageRecords) {
    if (!byProductId.has(image.product_id)) {
      byProductId.set(image.product_id, {
        product_id: image.product_id,
        product_name: image.product_name || image.name || "",
        name: image.product_name || image.name || "",
        brand: image.brand || "",
        a_level: image.a_level || [],
        b_level: image.b_level || [],
        c_level: image.c_level || [],
        image_urls: [],
        passing_image_count: 0,
        refresh_diagnostics: cloneRefreshDiagnostics(previousByProductId.get(String(image.product_id || "").trim())?.refresh_diagnostics)
      });
    }

    const product = byProductId.get(image.product_id);
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

function buildIndexOutput(index, catalog, mergedImages, options = {}) {
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

function createEmptyIndex(catalog) {
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

function replaceProductImages(index, catalog, productIds = [], refreshedImages = [], options = {}) {
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

async function generateProductRefreshPayload(productId, matchingImages = []) {
  const refreshedAt = new Date().toISOString();
  const refreshedImages = [];
  const failedImages = [];
  let stage0PassingCount = 0;
  let selectedProductImageCount = 0;
  let successfulExtractionCount = 0;
  let productCostUsd = 0;
  let tiebreakerUsed = false;
  let lastError = null;

  try {
    const generated = await generateProductExtractionRecordsWithCap(matchingImages, {
      provider: "openai",
      apiKey: process.env.OPENAI_API_KEY,
      visionModel: process.env.VISION_MODEL,
      embeddingModel: process.env.EMBEDDING_MODEL,
      progressCallback: (event = {}) => {
        if (event.type === "image_start") {
          reindexState.current_image_url = String(event.image_url || "").trim();
          return;
        }
        if (event.type === "run_start") {
          const rawLabel = String(event.run_label || "").trim().toLowerCase();
          reindexState.current_run = rawLabel === "run_3"
            ? "Tiebreaker"
            : rawLabel === "run_2"
              ? "Run 2"
              : "Run 1";
        }
      }
    });

    stage0PassingCount = Number(generated.progress?.stage0_passing_count || 0);
    selectedProductImageCount = Number(generated.progress?.selected_product_image_count || 0);
    successfulExtractionCount = Number(generated.progress?.successful_extraction_count || 0);
    reindexState.current_product_images_passed = stage0PassingCount;
    reindexState.current_product_successful_extractions = successfulExtractionCount;
    reindexState.current_product_failed_images = Number(generated.progress?.failed_image_count || 0);
    reindexState.current_product_images_skipped_by_cap = Number(generated.progress?.images_skipped_by_cap || 0);
    reindexState.current_product_effective_cap = Number(generated.progress?.effective_cap_applied || 0);
    reindexState.current_product_hard_cap_binding = Boolean(generated.progress?.hard_upper_cap_binding);

    console.log(
      `[cap] ${productId} | ${matchingImages[0]?.name || productId} | type=${generated.progress?.seating_type || "unknown"} | ` +
      `stage0_passing=${generated.progress?.stage0_passing_count || 0} | cap=${generated.progress?.effective_cap_applied || 0} | ` +
      `skipped=${generated.progress?.images_skipped_by_cap || 0} | extracted=${generated.progress?.successful_extraction_count || 0} | ` +
      `failed_images=${generated.progress?.failed_image_count || 0}${generated.progress?.hard_upper_cap_binding ? " hard-cap" : ""}`
    );

    for (const recordLike of generated.records) {
      const sourceImage = matchingImages.find((image) => image.image_id === recordLike.image_id || image.image_url === recordLike.image_url) || recordLike;
      const record = buildIndexedImageRecord(sourceImage, recordLike, refreshedAt);
      refreshedImages.push(record);
      reindexState.processed_images = Number(reindexState.processed_images || 0) + 1;
      const normalizedStage0Result = incrementReindexStage0Counts(record.stage_0_result);
      if (!normalizedStage0Result) {
        console.warn(
          `[reindex-progress] Unrecognized stage_0_result for product ${productId}: ${JSON.stringify(record.stage_0_result || "")}`
        );
      }
      if (record.tiebreaker_triggered) {
        tiebreakerUsed = true;
      }
      productCostUsd = Number((productCostUsd + Number(record.cost?.total_usd || 0)).toFixed(6));
      reindexState.total_cost_usd = Number((Number(reindexState.total_cost_usd || 0) + Number(record.cost?.total_usd || 0)).toFixed(6));
    }
    failedImages.push(...(Array.isArray(generated.failed_images) ? generated.failed_images : []));
  } catch (error) {
    lastError = error;
    failedImages.push({
      image_url: "",
      error: error?.message || "Product extraction failed."
    });
    console.warn(`Skipping product during refresh for ${productId}: ${error?.message || "Product extraction failed."}`);
  }

  const unmappedImages = refreshedImages.filter((record) => record.excluded_reason === "unmapped_category_grouping");
  if (unmappedImages.length === refreshedImages.length) {
    const grouping = getCategoryGroupingKey(matchingImages[0] || {});
    const error = new Error(`Unmapped DP category combination: ${grouping || "(none)"}`);
    error.code = "UNMAPPED_CATEGORY_GROUPING";
    error.grouping = grouping || "(none)";
    error.product_id = productId;
    error.product_name = String(matchingImages[0]?.name || productId).trim();
    throw error;
  }

  if (successfulExtractionCount <= 0) {
    throw new Error(lastError?.message || "All images failed extraction for this product.");
  }

  const representativeProductImage = refreshedImages.find((record) => getEffectiveClassification(record) === "product");
  const representativeSeatingType = String(representativeProductImage?.seating_type || "").trim();
  const refreshDiagnostics = {
    last_attempted_at: refreshedAt,
    ai_refreshed_at: refreshedAt,
    seating_type: representativeSeatingType,
    visual_type: normalizeVisualTypeKey(representativeProductImage?.visual_type || representativeSeatingType || ""),
    stage0_passing_count: stage0PassingCount,
    selected_product_image_count: selectedProductImageCount,
    successful_extraction_count: successfulExtractionCount,
    failed_image_count: failedImages.length,
    failed_stage0_count: failedImages.filter((entry) => entry.stage === "stage0").length,
    failed_stage23_count: failedImages.filter((entry) => entry.stage === "stage23").length,
    images_skipped_by_cap: Number(reindexState.current_product_images_skipped_by_cap || 0),
    hard_upper_cap_binding: Boolean(reindexState.current_product_hard_cap_binding),
    partial_image_failure: failedImages.length > 0,
    failed_images: failedImages
  };

  return {
    product_id: productId,
    refreshed_images: refreshedImages.length,
    caption_model_version: "openai:gpt-4.1",
    ai_refreshed_at: refreshedAt,
    seating_type: representativeSeatingType,
    visual_type: normalizeVisualTypeKey(representativeProductImage?.visual_type || representativeSeatingType || ""),
    images: refreshedImages,
    progress: {
      product_cost_usd: productCostUsd,
      tiebreaker_used: tiebreakerUsed,
      stage0_passing_count: stage0PassingCount,
      passing_image_count: selectedProductImageCount,
      selected_product_image_count: selectedProductImageCount,
      successful_extraction_count: successfulExtractionCount,
      failed_image_count: failedImages.length,
      failed_stage0_count: failedImages.filter((entry) => entry.stage === "stage0").length,
      failed_stage23_count: failedImages.filter((entry) => entry.stage === "stage23").length,
      effective_cap_applied: Number(reindexState.current_product_effective_cap || 0),
      images_skipped_by_cap: Number(reindexState.current_product_images_skipped_by_cap || 0),
      hard_upper_cap_binding: Boolean(reindexState.current_product_hard_cap_binding)
    },
    failed_images: failedImages,
    refresh_diagnostics: refreshDiagnostics
  };
}

function resetReindexState(productIds = []) {
  const uniqueProductIds = [...new Set((productIds || []).map((value) => String(value || "").trim()).filter(Boolean))];
  reindexState = {
    running: true,
    started_at: new Date().toISOString(),
    total: uniqueProductIds.length,
    completed: 0,
    failed: 0,
    failed_unmapped: 0,
    failed_other: 0,
    failed_products: [],
    unmapped_groupings: [],
    current_product: "",
    current_product_id: "",
    current_product_images_passed: 0,
    current_product_successful_extractions: 0,
    current_product_failed_images: 0,
    current_product_images_skipped_by_cap: 0,
    current_product_effective_cap: 0,
    current_product_hard_cap_binding: false,
    current_run: "",
    current_image_url: "",
    processed_images: 0,
    product_photos: 0,
    scene_photos: 0,
    detail_photos: 0,
    total_cost_usd: 0,
    tiebreaker_products: 0,
    current_batch: uniqueProductIds.length ? 1 : 0,
    total_batches: Math.ceil(uniqueProductIds.length / BULK_REFRESH_BATCH_SIZE),
    log: [],
    done: false
  };
  return uniqueProductIds;
}

async function runBulkRefresh(productIds, catalog, initialIndex) {
  const productImageMap = new Map();
  for (const image of catalog.images || []) {
    if (!productImageMap.has(image.product_id)) {
      productImageMap.set(image.product_id, []);
    }
    productImageMap.get(image.product_id).push(image);
  }

  let workingIndex = initialIndex;
  const batches = [];
  for (let index = 0; index < productIds.length; index += BULK_REFRESH_BATCH_SIZE) {
    batches.push(productIds.slice(index, index + BULK_REFRESH_BATCH_SIZE));
  }

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    if (batchIndex === 0) {
      console.log("Starting batch 1");
    }
    reindexState.current_batch = batchIndex + 1;
    const batchProductIds = batches[batchIndex];
    const batchRefreshedImages = [];
    const successfulProductIds = [];
    const batchRefreshDiagnosticsByProductId = new Map();

    for (let productIndex = 0; productIndex < batchProductIds.length; productIndex += 1) {
      const productId = batchProductIds[productIndex];
      const matchingImages = productImageMap.get(productId) || [];
      const productName = matchingImages[0]?.name || productId;
      reindexState.current_product = productName;
      reindexState.current_product_id = productId;
      reindexState.current_product_images_passed = 0;
      reindexState.current_product_successful_extractions = 0;
      reindexState.current_product_failed_images = 0;
      reindexState.current_product_images_skipped_by_cap = 0;
      reindexState.current_product_effective_cap = 0;
      reindexState.current_product_hard_cap_binding = false;
      reindexState.current_run = "";
      reindexState.current_image_url = "";

      try {
        if (!matchingImages.length) {
          throw new Error("Product not found in normalized catalog.");
        }

        const productPayload = await generateProductRefreshPayload(productId, matchingImages);
        batchRefreshedImages.push(...productPayload.images);
        successfulProductIds.push(productId);
        batchRefreshDiagnosticsByProductId.set(productId, productPayload.refresh_diagnostics);
        reindexState.current_product_images_passed = Number(productPayload.progress?.stage0_passing_count || 0);
        reindexState.current_product_successful_extractions = Number(productPayload.progress?.successful_extraction_count || 0);
        reindexState.current_product_failed_images = Number(productPayload.progress?.failed_image_count || 0);
        if (productPayload.progress?.tiebreaker_used) {
          reindexState.tiebreaker_products += 1;
        }
        const typeForLog = String(productPayload.seating_type || "").trim() ||
          String(productPayload.images.find((image) => getEffectiveClassification(image) === "product")?.seating_type || "").trim();
        reindexState.log.unshift({
          name: productName,
          status: "success",
          type: typeForLog,
          stage0_passing_count: Number(productPayload.progress?.stage0_passing_count || 0),
          successful_extraction_count: Number(productPayload.progress?.successful_extraction_count || 0),
          failed_image_count: Number(productPayload.progress?.failed_image_count || 0),
          effective_cap_applied: Number(productPayload.progress?.effective_cap_applied || 0),
          images_skipped_by_cap: Number(productPayload.progress?.images_skipped_by_cap || 0),
          hard_upper_cap_binding: Boolean(productPayload.progress?.hard_upper_cap_binding)
        });
        reindexState.completed += 1;
      } catch (error) {
        reindexState.failed += 1;
        if (error?.code === "UNMAPPED_CATEGORY_GROUPING") {
          reindexState.failed_unmapped += 1;
          upsertUnmappedGroupingEntry(error.grouping, {
            product_id: productId,
            name: productName
          });
        } else {
          reindexState.failed_other += 1;
        }
        reindexState.failed_products.push({
          name: productName,
          product_id: productId,
          error: error.message || "Product refresh failed."
        });
        reindexState.log.unshift({
          name: productName,
          status: "failed",
          error: error.message || "Product refresh failed."
        });
        reindexState.completed += 1;
      }

      reindexState.log = reindexState.log.slice(0, 8);
      reindexState.current_product = batchProductIds[productIndex + 1]
        ? (productImageMap.get(batchProductIds[productIndex + 1]) || [])[0]?.name || batchProductIds[productIndex + 1]
        : batches[batchIndex + 1]?.[0]
          ? (productImageMap.get(batches[batchIndex + 1][0]) || [])[0]?.name || batches[batchIndex + 1][0]
          : "";
      reindexState.current_product_id = batchProductIds[productIndex + 1]
        ? batchProductIds[productIndex + 1]
        : batches[batchIndex + 1]?.[0] || "";
      reindexState.current_product_images_passed = 0;
      reindexState.current_product_successful_extractions = 0;
      reindexState.current_product_failed_images = 0;
      reindexState.current_product_images_skipped_by_cap = 0;
      reindexState.current_product_effective_cap = 0;
      reindexState.current_product_hard_cap_binding = false;
      reindexState.current_run = "";
      reindexState.current_image_url = "";

      if (reindexState.completed < reindexState.total) {
        await sleep(BULK_REFRESH_PRODUCT_DELAY_MS);
      }
    }

    if (batchRefreshedImages.length) {
      workingIndex = replaceProductImages(workingIndex, catalog, successfulProductIds, batchRefreshedImages, {
        refreshDiagnosticsByProductId: batchRefreshDiagnosticsByProductId
      });
      await writeJson(indexPath, workingIndex);
    }

    if (batchIndex < batches.length - 1) {
      await sleep(BULK_REFRESH_BATCH_DELAY_MS);
    }
  }

  reindexState.running = false;
  reindexState.current_product = "";
  reindexState.current_product_id = "";
  reindexState.current_product_images_passed = 0;
  reindexState.current_product_successful_extractions = 0;
  reindexState.current_product_failed_images = 0;
  reindexState.current_product_images_skipped_by_cap = 0;
  reindexState.current_product_effective_cap = 0;
  reindexState.current_product_hard_cap_binding = false;
  reindexState.current_run = "";
  reindexState.current_image_url = "";
  reindexState.done = true;
}

async function refreshProductIndex(productId) {
  const { catalog, index } = await loadCatalog();
  if (!catalog?.images?.length) {
    throw new Error("Normalized catalog not found. Run `npm run normalize` first.");
  }

  const matchingImages = catalog.images.filter((image) => image.product_id === productId);
  if (!matchingImages.length) {
    throw new Error("Product not found in normalized catalog.");
  }

  const productPayload = await generateProductRefreshPayload(productId, matchingImages);
  const workingIndex = index?.images?.length ? index : createEmptyIndex(catalog);
  const output = replaceProductImages(workingIndex, catalog, [productId], productPayload.images, {
    refreshDiagnosticsByProductId: new Map([[productId, productPayload.refresh_diagnostics]])
  });
  await writeJson(indexPath, output);
  return (output.images || []).filter((image) => image.product_id === productId);
}

async function refreshProductsIndex(productIds = []) {
  const { catalog, index } = await loadCatalog();
  if (!catalog?.images?.length || !index?.images?.length) {
    throw new Error("Index not found. Run `npm run normalize` and `npm run index` first.");
  }

  const uniqueProductIds = [...new Set((productIds || []).map((value) => String(value || "").trim()).filter(Boolean))];
  const refreshedProducts = [];
  const refreshedImages = [];
  const errors = [];

  for (const productId of uniqueProductIds) {
    const matchingImages = catalog.images.filter((image) => image.product_id === productId);
    if (!matchingImages.length) {
      errors.push({ product_id: productId, error: "Product not found in normalized catalog." });
      continue;
    }

    try {
      const productPayload = await generateProductRefreshPayload(productId, matchingImages);
      refreshedImages.push(...productPayload.images);
      refreshedProducts.push(productPayload);
    } catch (error) {
      errors.push({ product_id: productId, error: error.message || "Product refresh failed." });
    }
  }

  if (refreshedImages.length) {
    const refreshedProductIds = refreshedProducts.map((product) => product.product_id);
    const output = replaceProductImages(index, catalog, refreshedProductIds, refreshedImages, {
      refreshDiagnosticsByProductId: new Map(
        refreshedProducts.map((product) => [product.product_id, product.refresh_diagnostics])
      )
    });
    await writeJson(indexPath, output);
  }

  return { products: refreshedProducts, errors };
}

function compareProductsBySort(a, b, sort = "auto", browseMode = false) {
  if (sort === "refreshed_desc") {
    return String(b.ai_refreshed_at || "").localeCompare(String(a.ai_refreshed_at || "")) ||
      a.name.localeCompare(b.name) ||
      a.brand.localeCompare(b.brand);
  }

  if (sort === "refreshed_asc") {
    return String(a.ai_refreshed_at || "").localeCompare(String(b.ai_refreshed_at || "")) ||
      a.name.localeCompare(b.name) ||
      a.brand.localeCompare(b.brand);
  }

  if (sort === "name") {
    return a.name.localeCompare(b.name) || a.brand.localeCompare(b.brand);
  }

  if (browseMode) {
    return a.name.localeCompare(b.name) || a.brand.localeCompare(b.brand);
  }

  return 0;
}

function normalizeCategoryFilter(value) {
  return String(value || "").trim().toLowerCase();
}

function getRefreshTimestamp(record = null) {
  return String(
    record?.ai_refreshed_at ||
    record?.extraction_timestamp ||
    record?.generated_at ||
    ""
  ).trim();
}

function refreshAgeToMs(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  const mapping = {
    "1m": 60 * 1000,
    "5m": 5 * 60 * 1000,
    "10m": 10 * 60 * 1000,
    "30m": 30 * 60 * 1000,
    "1h": 60 * 60 * 1000,
    "1d": 24 * 60 * 60 * 1000
  };
  return mapping[normalized] || 0;
}

function filterResultsByCategory(results = [], category = "") {
  const normalizedCategories = (Array.isArray(category) ? category : category ? [category] : [])
    .map((value) => normalizeCategoryFilter(value))
    .filter(Boolean);
  if (!normalizedCategories.length) {
    return results;
  }

  return results.filter((result) => (
    (result.filter_categories || []).some((value) => normalizedCategories.includes(normalizeCategoryFilter(value)))
  ));
}

function filterResultsByRefreshAge(results = [], refreshAge = "") {
  const normalizedRefreshAge = String(refreshAge || "").trim().toLowerCase();
  if (normalizedRefreshAge === "none") {
    return results.filter((result) => {
      const refreshedAt = getRefreshTimestamp(result);
      if (!refreshedAt) {
        return true;
      }
      return Number.isNaN(Date.parse(refreshedAt));
    });
  }

  const thresholdMs = refreshAgeToMs(normalizedRefreshAge);
  if (!thresholdMs) {
    return results;
  }

  const now = Date.now();
  return results.filter((result) => {
    const refreshedAt = getRefreshTimestamp(result);
    if (!refreshedAt) {
      return false;
    }
    const timestamp = Date.parse(refreshedAt);
    if (Number.isNaN(timestamp)) {
      return true;
    }
    return (now - timestamp) >= thresholdMs;
  });
}

function canonicalizeProductImageUrl(value = "") {
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

function selectBrowsePrimaryImage(indexedImages = [], allowedImageUrls = []) {
  const allowedUrls = new Set(
    (allowedImageUrls || [])
      .map((imageUrl) => canonicalizeProductImageUrl(imageUrl))
      .filter(Boolean)
  );

  if (!allowedUrls.size) {
    return indexedImages[0] || null;
  }

  return indexedImages.find((image) => allowedUrls.has(canonicalizeProductImageUrl(image?.image_url))) || null;
}

function buildProductImageUrls({
  bestImageUrl = "",
  indexedImages = [],
  catalogImageUrls = [],
  fallbackImageUrl = "",
  allowedImageUrls = []
}) {
  const urls = [];
  const seen = new Set();
  const allowed = new Set((allowedImageUrls || []).map((imageUrl) => canonicalizeProductImageUrl(imageUrl)).filter(Boolean));

  function appendCandidates(candidates = []) {
    for (const candidate of candidates) {
      const normalized = String(candidate || "").trim();
      const canonical = canonicalizeProductImageUrl(normalized);
      if (!canonical || seen.has(canonical)) {
        continue;
      }
      if (allowed.size && !allowed.has(canonical)) {
        continue;
      }
      seen.add(canonical);
      urls.push(normalized);
    }
  }

  appendCandidates([bestImageUrl]);
  appendCandidates(indexedImages.flatMap((image) => image.passing_image_urls || []));
  appendCandidates(indexedImages.flatMap((image) => image.all_image_urls || [image.image_url]));
  appendCandidates(catalogImageUrls);
  appendCandidates([fallbackImageUrl]);

  return urls;
}

function buildBrowseResults(catalog, index, limit = Infinity, sort = "auto", category = []) {
  const indexedByProductId = new Map();
  for (const image of index?.images || []) {
    if (!indexedByProductId.has(image.product_id)) {
      indexedByProductId.set(image.product_id, []);
    }
    indexedByProductId.get(image.product_id).push(image);
  }

  const productRecords = catalog?.products || [];

  return productRecords
    .map((product) => {
      const indexedImages = indexedByProductId.get(product.product_id) || [];
      if (isIntentionallyExcludedProduct(product, indexedImages)) {
        return null;
      }
      const includedImages = indexedImages.filter((image) => !isIntentionallyExcludedImageRecord(image));
      const passingImages = includedImages.filter((image) => getEffectiveClassification(image) === "product");
      const browseImages = includedImages;
      const heroImage = passingImages[0] || browseImages[0] || null;
      const imageUrls = (product.image_urls || []).filter(Boolean);

      return {
        product_id: product.product_id,
        name: product.product_name || product.name,
        brand: product.brand,
        website: product.website || "",
        category: getCategoryDisplayLabel(product),
        category_tags: getLeafCategories(product),
        filter_categories: getAllCategoryTerms(product),
        ai_refreshed_at: getRefreshTimestamp(heroImage),
        best_image_url: heroImage?.image_url || imageUrls[0] || "",
        image_urls: imageUrls,
        score: 1,
        matched_traits: heroImage
          ? formatDetectedTraits(heroImage.enum_fields || heroImage.image_traits, heroImage.seating_type, 3)
          : [],
        debug: {
          structured_caption: heroImage?.structured_caption || heroImage?.free_text?.structured_caption || "",
          visual_description: heroImage?.visual_summary || heroImage?.free_text?.visual_summary || "",
          plan_shape_reasoning: heroImage?.plan_shape_reasoning || heroImage?.reasoning || heroImage?.free_text?.reasoning || "",
          visual_highlights: heroImage?.free_text?.distinctive_elements || [],
          detected_traits: heroImage
            ? formatDetectedTraits(heroImage.enum_fields || heroImage.image_traits, heroImage.seating_type, 6)
            : []
        },
        image_count: imageUrls.length,
        match_count: browseImages.length || imageUrls.length || 1,
        matching_images: browseImages.map((image) => ({
          image_id: image.image_id,
          image_url: image.image_url,
          stage_0_result: image.stage_0_result,
          effective_classification: getEffectiveClassification(image),
          seating_type: image.seating_type,
          visual_type: normalizeVisualTypeKey(image.visual_type || image.seating_type || ""),
          matched_traits: image.matched_traits || [],
          trait_contributions: image.trait_contributions || {},
          enum_fields: image.enum_fields || image.image_traits || {},
          free_text: image.free_text || {},
          visual_summary_embedding: image.visual_summary_embedding || image.search_text_embedding || [],
          score: 1,
          confidence_tier: image.confidence_tier || "high"
        })),
        hero_image: heroImage
          ? {
              image_id: heroImage.image_id,
              image_url: heroImage.image_url,
              stage_0_result: heroImage.stage_0_result,
              effective_classification: getEffectiveClassification(heroImage),
              seating_type: heroImage.seating_type,
              visual_type: normalizeVisualTypeKey(heroImage.visual_type || heroImage.seating_type || ""),
              matched_traits: heroImage.matched_traits || [],
              trait_contributions: heroImage.trait_contributions || {},
              enum_fields: heroImage.enum_fields || heroImage.image_traits || {},
              free_text: heroImage.free_text || {},
              visual_summary_embedding: heroImage.visual_summary_embedding || heroImage.search_text_embedding || [],
              score: 1,
              confidence_tier: heroImage.confidence_tier || "high"
            }
          : null,
        scene_filter: buildSceneFilterBadge(heroImage, heroImage?.image_url || ""),
        scene_filter_results: getSceneFilterResults(heroImage)
      };
    })
    .filter(Boolean)
    .filter((result) => {
      const normalizedCategories = (Array.isArray(category) ? category : category ? [category] : [])
        .map((value) => normalizeCategoryFilter(value))
        .filter(Boolean);
      return !normalizedCategories.length || result.filter_categories.some((value) => normalizedCategories.includes(normalizeCategoryFilter(value)));
    })
    .sort((a, b) => compareProductsBySort(a, b, sort, true))
    .slice(0, limit);
}

async function serveStatic(requestPath, response) {
  const safePath = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = path.join(publicDir, safePath);

  try {
    const content = await fs.readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      Expires: "0"
    });
    response.end(content);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    response.end();
    return;
  }

  const url = new URL(request.url, "http://localhost");

  if (url.pathname === "/eval") {
    return serveStatic("/eval.html", response);
  }

  if (url.pathname === "/curate") {
    return serveStatic("/curate.html", response);
  }

  if (url.pathname === privateBrowsePath) {
    return serveStatic("/index.html", response);
  }

  if (url.pathname === "/api/health") {
    return json(response, 200, { ok: true });
  }

  if (url.pathname === "/api/bootstrap") {
    const [{ catalog, index }, seatingTypes] = await Promise.all([loadCatalog(), loadSeatingTypes()]);
    const catalogLeafCategories = [...new Set(((catalog?.products || [])).flatMap((product) => getLeafCategories(product)).filter(Boolean))];
    const categorySource = catalogLeafCategories.sort((a, b) => a.localeCompare(b));
    return json(response, 200, {
      has_index: Boolean(index?.images?.length),
      seed_queries: seedQueries,
      brands: catalog?.brands || [],
      categories: categorySource,
      stats: catalog?.totals || { products: 0, images: 0 },
      image_analysis_available: Boolean(process.env.OPENAI_API_KEY),
      ranking_rules: getRankingRulesSummary(),
      seating_types: seatingTypes,
      visual_types: seatingTypes,
      seating_category_options: Object.keys(seatingTypes),
      visual_type_options: Object.keys(seatingTypes),
      legacy_aliases: visualTypeLegacyAliases,
      result_cutoff: getResultCutoffConfig()
    });
  }

  if (url.pathname === "/api/extraction-summary" && request.method === "GET") {
    try {
      const index = await readJson(indexPath, { images: [] });
      return json(response, 200, await buildExtractionSummary(index));
    } catch (error) {
      return json(response, 500, { error: error.message || "Extraction summary unavailable." });
    }
  }

  if (url.pathname === "/api/prompt-library" && request.method === "GET") {
    try {
      return json(response, 200, buildPromptLibraryPayload());
    } catch (error) {
      return json(response, 500, { error: error.message || "Prompt library unavailable." });
    }
  }

  if (url.pathname === "/api/unmapped-category-decision" && request.method === "POST") {
    try {
      const body = await readRequestJson(request);
      const grouping = String(body.grouping || "").trim();
      const status = String(body.status || "").trim().toLowerCase();
      const mappingTarget = normalizeRequestedSeatingType(body.mapping_target || "");
      if (!grouping) {
        return json(response, 400, { error: "grouping is required." });
      }
      if (!["mapped", "intentionally_excluded", "active"].includes(status)) {
        return json(response, 400, { error: "status must be mapped, intentionally_excluded, or active." });
      }
      if (status === "mapped" && !mappingTarget) {
        return json(response, 400, { error: "mapping_target is required for mapped decisions." });
      }

      const decisions = await readJson(unmappedCategoryDecisionsPath, {});
      const nextDecisions = decisions && typeof decisions === "object" ? { ...decisions } : {};
      if (status === "active") {
        delete nextDecisions[grouping];
      } else {
        const previous = nextDecisions[grouping] && typeof nextDecisions[grouping] === "object"
          ? nextDecisions[grouping]
          : {};
        nextDecisions[grouping] = {
          status,
          mapping_target: status === "mapped" ? mappingTarget : "",
          created_at: String(previous.created_at || new Date().toISOString()).trim(),
          updated_at: new Date().toISOString()
        };
      }

      await writeJson(unmappedCategoryDecisionsPath, nextDecisions);
      const index = await readJson(indexPath, { images: [] });
      return json(response, 200, {
        ok: true,
        decision: nextDecisions[grouping] || null,
        extraction_summary: await buildExtractionSummary(index)
      });
    } catch (error) {
      return json(response, 500, { error: error.message || "Failed to update unmapped category decision." });
    }
  }

  if (url.pathname === "/api/search") {
    const { catalog, index } = await loadCatalog();

    const body = request.method === "POST" ? await readRequestJson(request) : {};
    const query = String((request.method === "POST" ? body.q : url.searchParams.get("q")) || "").trim();
    const category = request.method === "POST"
      ? (Array.isArray(body.category) ? body.category : body.category ? [body.category] : [])
      : url.searchParams.getAll("category");
    const normalizedSearchCategories = normalizeSearchCategoryFilters(category);
    const refreshAge = String((request.method === "POST" ? body.refresh_age : url.searchParams.get("refresh_age")) || "").trim();
    const matchMode = String((request.method === "POST" ? body.match_mode : url.searchParams.get("match_mode")) || "balanced").trim();
    const sourceImageUrl = String((request.method === "POST" ? body.source_image_url : url.searchParams.get("source_image_url")) || "").trim();
    const debugParam = request.method === "POST" ? body.debug : url.searchParams.get("debug");
    const debug = debugParam === true || String(debugParam || "").trim().toLowerCase() === "true";
    const sort = String((request.method === "POST" ? body.sort : url.searchParams.get("sort")) || "auto").trim();
    const requestedVisualTypeInput = request.method === "POST"
      ? { visual_type: body.visual_type, seating_type: body.seating_type }
      : { visual_type: url.searchParams.get("visual_type"), seating_type: url.searchParams.get("seating_type") };
    const disableVisualTypeInference = isAllVisualTypeRequest(requestedVisualTypeInput);
    const explicitVisualType = disableVisualTypeInference
      ? ""
      : normalizeRequestedVisualType(requestedVisualTypeInput);
    const imageAnalysis = body.image_analysis && typeof body.image_analysis === "object" ? body.image_analysis : null;
    const rawSelectedBullets = body.selected_bullets;
    if (!query) {
      const results = filterResultsByRefreshAge(
        buildBrowseResults(catalog, index, Infinity, sort, category),
        refreshAge
      );
      return json(response, 200, {
        query,
        category_filter: category,
        refresh_age_filter: refreshAge,
        sort,
        parsed: {
          category: null,
          brand: null,
          visual_query: "",
          query_traits: null
        },
        seating_type_source: "all",
        visual_type: "",
        total_results: results.length,
        browse_mode: true,
        results
      });
    }

    if (normalizedSearchCategories.invalid.length) {
      return json(response, 400, {
        error: `Search category filters must use PixelSeek seating types (${ACTIVE_VISUAL_TYPE_KEYS.join(", ")}) or display labels.`,
        invalid_category_filters: normalizedSearchCategories.invalid
      });
    }

    if (!index?.images?.length) {
      return json(response, 409, {
        error: "Search index not found. Browsing works from the catalog, but visual search needs `npm run index`."
      });
    }

    let inferredCategory = null;
    let resolvedVisualType = explicitVisualType;
    let seatingTypeSource = explicitVisualType ? "explicit" : "all";
    if (!imageAnalysis && !disableVisualTypeInference) {
      inferredCategory = await inferTextQueryCategory(query, {
        apiKey: process.env.OPENAI_API_KEY,
        model: "gpt-4o-mini"
      });
      if (!resolvedVisualType && inferredCategory?.status === "resolved") {
        resolvedVisualType = String(inferredCategory.category_key || "").trim();
        seatingTypeSource = "inferred";
      }
    }
    if (disableVisualTypeInference) {
      seatingTypeSource = "all";
    }

    const selectedBullets = normalizeStructuredBullets(rawSelectedBullets, resolvedVisualType);

    const parsed = await parseSearchQuery(query, index.brands || [], {
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.QUERY_MODEL
    });
    parsed.seating_type = resolvedVisualType || "";
    parsed.visual_type = resolvedVisualType || "";
    let textQueryTraits = null;
    if (!imageAnalysis) {
      if (!resolvedVisualType) {
        console.warn("[text-query-traits] skipping extraction because visualType is unresolved");
      } else {
        textQueryTraits = await extractTextQueryTraits(query, {
          apiKey: process.env.OPENAI_API_KEY,
          model: "gpt-4.1-mini",
          seatingType: resolvedVisualType
        });
      }
    }
    const effectiveSelectedBullets = mergeStructuredBullets(
      resolvedVisualType,
      textQueryTraits?.search_bullets,
      selectedBullets
    );
    const queryEmbedding = await resolveQueryEmbedding({
      query,
      imageAnalysis,
      selectedBullets: effectiveSelectedBullets,
      apiKey: process.env.OPENAI_API_KEY
    });
    const searchResponse = await searchIndex({
      query,
      parsed,
      index,
      sourceImageUrl,
      sort,
      imageAnalysis,
      selectedBullets: effectiveSelectedBullets,
      queryEmbedding,
      apiKey: process.env.OPENAI_API_KEY,
      includeSourceImage: debug
    });
    const results = filterResultsByRefreshAge(
      normalizedSearchCategories.normalized.length
        ? filterSearchResultsByCategory(searchResponse.results, normalizedSearchCategories.normalized)
        : searchResponse.results,
      refreshAge
    );

    return json(response, 200, {
      query,
      category_filter: category,
      refresh_age_filter: refreshAge,
      sort,
      match_mode: matchMode,
      source_image_url: sourceImageUrl,
      debug,
      parsed,
      seating_type: resolvedVisualType || "",
      visual_type: resolvedVisualType || "",
      seating_type_confidence: seatingTypeSource === "all" ? "low" : "high",
      seating_type_source: seatingTypeSource,
      category_required: Boolean(!resolvedVisualType && inferredCategory?.status === "category_required"),
      seating_category_options: Array.isArray(inferredCategory?.options) ? inferredCategory.options : Object.keys(seatingTypes),
      visual_type_options: Array.isArray(inferredCategory?.options) ? inferredCategory.options : Object.keys(seatingTypes),
      selected_bullets: effectiveSelectedBullets,
      text_query_traits: textQueryTraits,
      query_embedding: queryEmbedding,
      reranker_used: searchResponse.reranker_used,
      total_results: results.length,
      results
    });
  }

  if (url.pathname === "/api/refine-search" && request.method === "POST") {
    try {
      const { index } = await loadCatalog();
      if (!index) {
        return json(response, 409, {
          error: "Index not found. Run `npm run normalize` and `npm run index` first."
        });
      }

      const body = await readRequestJson(request);
      const queryEmbedding = Array.isArray(body.query_embedding) ? body.query_embedding.map((value) => Number(value)) : [];
      const category = Array.isArray(body.category) ? body.category : body.category ? [body.category] : [];
      const normalizedSearchCategories = normalizeSearchCategoryFilters(category);
      const refreshAge = String(body.refresh_age || "").trim();
      const sourceImageUrl = String(body.source_image_url || "").trim();
      const debug = body.debug === true || String(body.debug || "").trim().toLowerCase() === "true";
      const requestedVisualTypeInput = { visual_type: body.visual_type, seating_type: body.seating_type };
      const visualType = normalizeRequestedVisualType(requestedVisualTypeInput);
      const selectedBullets = normalizeStructuredBullets(body.selected_bullets, visualType);
      const rerankerEnabled = body.reranker_enabled !== false;
      const action = String(body.action || "").trim();
      const productId = String(body.product_id || "").trim();

      if (!queryEmbedding.length) {
        return json(response, 400, { error: "query_embedding is required." });
      }
      if (normalizedSearchCategories.invalid.length) {
        return json(response, 400, {
          error: `Search category filters must use PixelSeek seating types (${ACTIVE_VISUAL_TYPE_KEYS.join(", ")}) or display labels.`,
          invalid_category_filters: normalizedSearchCategories.invalid
        });
      }
      let blendedQueryEmbedding = normalizeEmbedding(queryEmbedding);

      if (action || productId) {
        if (!productId) {
          return json(response, 400, { error: "product_id is required." });
        }
        if (!["more", "less"].includes(action)) {
          return json(response, 400, { error: "action must be 'more' or 'less'." });
        }

        const targetRecord = (index.images || [])
          .filter((record) => record.product_id === productId && getEffectiveClassification(record) === "product")
          .sort((a, b) => String(b.confidence_tier || "").localeCompare(String(a.confidence_tier || "")))[0];
        if (!targetRecord?.visual_summary_embedding?.length) {
          return json(response, 404, { error: "Target product embedding not found." });
        }

        const normalizedTarget = normalizeEmbedding(targetRecord.visual_summary_embedding);
        blendedQueryEmbedding = normalizeEmbedding(
          blendedQueryEmbedding.map((value, index) =>
            action === "more"
              ? (value + (normalizedTarget[index] || 0)) / 2
              : value - (normalizedTarget[index] || 0)
          )
        );
      }

      const parsed = {
        category: null,
        brand: null,
        visual_query: "",
        query_traits: null
      };
      const imageAnalysis = visualType
        ? { stage1: { seating_type: visualType } }
        : null;
      const searchResponse = await searchIndex({
        query: "",
        parsed,
        index,
        sourceImageUrl,
        sort: "auto",
        imageAnalysis,
        selectedBullets,
        queryEmbedding: blendedQueryEmbedding,
        apiKey: process.env.OPENAI_API_KEY,
        rerankerEnabled,
        includeSourceImage: debug
      });
      const results = filterResultsByRefreshAge(
        normalizedSearchCategories.normalized.length
          ? filterSearchResultsByCategory(searchResponse.results, normalizedSearchCategories.normalized)
          : searchResponse.results,
        refreshAge
      );

      return json(response, 200, {
        action,
        category_filter: category,
        refresh_age_filter: refreshAge,
        product_id: productId,
        query_embedding: blendedQueryEmbedding,
        debug,
        parsed,
        visual_type: visualType || "",
        reranker_used: searchResponse.reranker_used,
        total_results: results.length,
        results
      });
    } catch (error) {
      return json(response, 500, { error: error.message || "Search refinement failed." });
    }
  }

  if (url.pathname === "/api/eval-data" && request.method === "GET") {
    try {
      const payload = await loadEvalData();
      return json(response, 200, payload);
    } catch (error) {
      return json(response, 409, { error: error.message || "Eval data unavailable." });
    }
  }

  if (url.pathname === "/api/eval-progress" && request.method === "GET") {
    try {
      const payload = await loadEvalData();
      const uniqueJudgments = new Map(
        (payload.judgments || []).map((judgment) => [judgment.product_id, judgment])
      );
      const reviewed = uniqueJudgments.size;
      const corrected = [...uniqueJudgments.values()].filter((judgment) => judgment.was_corrected).length;

      return json(response, 200, {
        reviewed,
        total: (payload.results || []).length,
        corrected
      });
    } catch (error) {
      return json(response, 409, { error: error.message || "Eval progress unavailable." });
    }
  }

  if (url.pathname === "/api/eval-judgment" && request.method === "POST") {
    try {
      const body = await readRequestJson(request);
      const productId = String(body.product_id || "").trim();
      if (!productId) {
        return json(response, 400, { error: "product_id is required." });
      }

      const [existing, evalResults, index] = await Promise.all([
        readJson(evalJudgmentsPath, []),
        readJson(evalResultsPath, { results: [] }),
        readJson(indexPath, { images: [] })
      ]);
      const judgments = Array.isArray(existing) ? existing : [];
      const evalResult = (evalResults?.results || []).find((result) => result.product_id === productId) || null;
      const rerankerOrder = Array.isArray(body.reranker_order) ? body.reranker_order.map((value) => String(value)) : [];
      const humanCorrectedOrder = Array.isArray(body.human_corrected_order) ? body.human_corrected_order.map((value) => String(value)) : [];
      const removedProductIds = Array.isArray(body.removed_product_ids)
        ? body.removed_product_ids.map((value) => String(value))
        : [];
      const belowLineProductIds = Array.isArray(body.below_line_product_ids)
        ? body.below_line_product_ids.map((value) => String(value))
        : [];
      const belowLineAfterRank = Number.isInteger(body.below_line_after_rank) ? body.below_line_after_rank : null;
      const traitPreferencePayload = buildTraitPreferencePayload(evalResult, index, rerankerOrder, humanCorrectedOrder, {
        removedProductIds,
        belowLineProductIds
      });
      const irrelevantProductIds = new Set([...removedProductIds, ...belowLineProductIds]);
      const keptProductIds = (
        belowLineAfterRank && belowLineAfterRank > 0
          ? humanCorrectedOrder.slice(0, belowLineAfterRank)
          : humanCorrectedOrder
      ).filter((value) => !irrelevantProductIds.has(value));
      const hasEvaluativeSignal =
        Boolean(body.was_corrected) ||
        removedProductIds.length > 0 ||
        belowLineProductIds.length > 0 ||
        belowLineAfterRank !== null ||
        (traitPreferencePayload.preference_pairs || []).length > 0;

      if (!hasEvaluativeSignal) {
        return json(response, 200, {
          ok: true,
          skipped: true,
          reason: "No evaluative signal provided; judgment not written."
        });
      }

      const nextJudgment = {
        product_id: productId,
        query_product_name: String(body.query_product_name || "").trim(),
        visual_summary: String(body.visual_summary || "").trim(),
        reranker_order: rerankerOrder,
        human_corrected_order: humanCorrectedOrder,
        kept_product_ids: keptProductIds,
        removed_product_ids: removedProductIds,
        below_line_product_ids: belowLineProductIds,
        below_line_after_rank: belowLineAfterRank,
        was_corrected: Boolean(body.was_corrected),
        timestamp: String(body.timestamp || new Date().toISOString()),
        query_product_profile: traitPreferencePayload.query_product_profile,
        candidate_profiles: traitPreferencePayload.candidate_profiles,
        preference_pairs: traitPreferencePayload.preference_pairs,
        trait_preference_summary: traitPreferencePayload.trait_preference_summary
      };

      const nextJudgments = judgments.filter((judgment) => judgment.product_id !== productId);
      nextJudgments.push(nextJudgment);
      await writeJson(evalJudgmentsPath, nextJudgments);

      return json(response, 200, {
        ok: true,
        saved_count: nextJudgments.length,
        judgment: nextJudgment
      });
    } catch (error) {
      return json(response, 500, { error: error.message || "Failed to save eval judgment." });
    }
  }

  if (url.pathname === "/api/eval-flag-room-scene" && request.method === "POST") {
    try {
      const body = await readRequestJson(request);
      const productId = String(body.product_id || "").trim();
      if (!productId) {
        return json(response, 400, { error: "product_id is required." });
      }

      const index = await readJson(indexPath);
      if (!index?.images?.length) {
        return json(response, 409, { error: "Index not found." });
      }

      let updated = false;
      index.images = (index.images || []).map((image) => {
        if (image.product_id !== productId) {
          return image;
        }
        updated = true;
        return {
          ...image,
          is_room_scene: true
        };
      });

      if (!updated) {
        return json(response, 404, { error: "Product not found in image index." });
      }

      await writeJson(indexPath, index);
      return json(response, 200, { ok: true, product_id: productId });
    } catch (error) {
      return json(response, 500, { error: error.message || "Failed to flag room scene." });
    }
  }

  if (url.pathname === "/api/eval-judgments" && request.method === "GET") {
    try {
      const judgments = await readJson(evalJudgmentsPath, []);
      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": 'attachment; filename="eval-judgments.json"'
      });
      response.end(JSON.stringify(Array.isArray(judgments) ? judgments : [], null, 2));
      return;
    } catch (error) {
      return json(response, 500, { error: error.message || "Eval judgments unavailable." });
    }
  }

  if (url.pathname === "/api/eval-export" && request.method === "GET") {
    try {
      const judgments = await readJson(evalJudgmentsPath, []);
      const snapshot = {
        exported_at: new Date().toISOString(),
        eval_judgments: Array.isArray(judgments) ? judgments : []
      };
      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": 'attachment; filename="eval-session-snapshot.json"'
      });
      response.end(JSON.stringify(snapshot, null, 2));
      return;
    } catch (error) {
      return json(response, 500, { error: error.message || "Eval export unavailable." });
    }
  }

  if (url.pathname === "/api/analyze-image" && request.method === "POST") {
    let imageIdentifier = "";
    let progressRequestId = "";
    try {
      const body = await readRequestJson(request);
      const imageDataUrl = String(body.image_data_url || "").trim();
      const imageUrl = String(body.image_url || "").trim();
      const fileName = String(body.file_name || "").trim();
      const matchMode = String(body.match_mode || "balanced").trim();
      const rawFocusArea = body.focus_area && typeof body.focus_area === "object" ? body.focus_area : null;
      const focusArea = rawFocusArea
        ? {
            x: Number(rawFocusArea.x),
            y: Number(rawFocusArea.y),
            width: Number(rawFocusArea.width),
            height: Number(rawFocusArea.height)
          }
        : null;
      const imageSource = imageDataUrl.startsWith("data:image/") ? imageDataUrl : imageUrl;
      const stage1Only = Boolean(body?.stage1_only);
      const visualTypeOverride = normalizeRequestedVisualType({
        visual_type: body?.visual_type_override,
        seating_type: body?.seating_type_override
      });
      progressRequestId = String(body?.progress_request_id || "").trim();
      imageIdentifier = getQueryImageAnalysisIdentifier({
        imageSource,
        imageUrl,
        fileName
      });

      if (!imageSource) {
        return json(response, 400, { error: "Upload an image file or paste an image URL to analyze." });
      }

      if (!process.env.OPENAI_API_KEY) {
        return json(response, 409, { error: "Image analysis requires OPENAI_API_KEY on the local server." });
      }

      ensureQueryImageProgressEntry(progressRequestId, {
        expected_passes: stage1Only ? 0 : 2
      });

      const analysis = await analyzeInspirationImage(imageSource, {
        provider: "openai",
        apiKey: process.env.OPENAI_API_KEY,
        visionModel: process.env.VISION_MODEL,
        fileName,
        matchMode,
        focusArea,
        stage1Only,
        seatingTypeOverride: visualTypeOverride,
        progressCallback: (event = {}) => {
          if (!progressRequestId) {
            return;
          }
          recordQueryImageProgressEvent(progressRequestId, event);
        }
      });

      if (stage1Only) {
        const stage1Result = String(analysis?.stage1?.result || "").trim().toLowerCase();
        const seatingTypeConfidence = String(analysis?.field_confidence?.stage1?.seating_type || "").trim().toLowerCase();
        const resolvedVisualType = normalizeRequestedVisualType({
          visual_type: analysis?.visual_type || analysis?.stage1?.visual_type,
          seating_type: analysis?.seating_type || analysis?.stage1?.seating_type
        });
        return json(response, 200, {
          category_required: Boolean(
            stage1Result !== "product" ||
            seatingTypeConfidence !== "high" ||
            !seatingTypes[resolvedVisualType]
          ),
          seating_category_options: Object.keys(seatingTypes),
          visual_type_options: Object.keys(seatingTypes),
          analysis: {
            ...addVisualTypeToAnalysisPayload(analysis),
            image_preview_url: imageSource
          }
        });
      }

      const traitConflicts = detectTraitTextConflicts(analysis);

      return json(response, 200, {
        analysis: {
          ...addVisualTypeToAnalysisPayload(analysis),
          trait_conflicts: traitConflicts,
          clarification_conflict: traitConflicts[0] || null,
          image_preview_url: imageSource
        }
      });
    } catch (error) {
      finalizeQueryImageProgress(progressRequestId, {
        error: error?.message || "Image analysis failed."
      });
      if (error instanceof ResolutionGateError) {
        return json(response, 400, { error: error.message });
      }
      if (error instanceof QueryImageAnalysisStageError) {
        logQueryImageAnalysisFailure({
          imageIdentifier,
          stage: error.stage,
          error
        });
        return json(response, 500, { error: QUERY_IMAGE_ANALYSIS_RETRY_MESSAGE });
      }
      return json(response, 500, { error: error.message || "Image analysis failed." });
    }
  }

  if (url.pathname === "/api/analyze-image-progress" && request.method === "GET") {
    const requestId = String(url.searchParams.get("request_id") || "").trim();
    const since = Math.max(0, Number(url.searchParams.get("since") || 0));
    if (!requestId) {
      return json(response, 400, { error: "request_id is required." });
    }
    const payload = buildQueryImageProgressPayload(requestId, since);
    if (!payload) {
      return json(response, 404, { error: "No image analysis progress found for that request." });
    }
    return json(response, 200, payload);
  }

  if (url.pathname === "/api/trait-correction" && request.method === "POST") {
    try {
      const body = await readRequestJson(request);
      const recordId = createId(
        "trait_correction",
        new Date().toISOString(),
        String(body.image_url || "").trim(),
        String(body.field || "").trim(),
        String(body.user_selected_value ?? body.model_extracted_value ?? "").trim()
      );
      const focusArea = normalizeFocusAreaPayload(body.focus_area);
      const persistedImage = await persistTraitCorrectionImageAsset(String(body.image_url || "").trim(), recordId);
      const nextRecord = {
        id: recordId,
        timestamp: new Date().toISOString(),
        image_url: persistedImage.source_url,
        stored_image_path: persistedImage.stored_image_path,
        image_source_kind: persistedImage.source_kind,
        image_mime_type: persistedImage.mime_type,
        source_file_name: String(body.source_file_name || "").trim(),
        focus_area: focusArea,
        field: String(body.field || "").trim(),
        model_extracted_value: String(body.model_extracted_value || "").trim(),
        stage2_free_text: String(body.stage2_free_text || "").trim(),
        conflict_evidence: String(body.conflict_evidence || "").trim(),
        user_selected_value: body.user_selected_value == null ? null : String(body.user_selected_value).trim(),
        was_skipped: Boolean(body.was_skipped),
        search_query: String(body.search_query || "").trim(),
        active_bullets: normalizeStructuredBullets(
          body.active_bullets,
          normalizeRequestedVisualType({ visual_type: body.visual_type, seating_type: body.seating_type })
        ),
        training_example_version: 1
      };

      const existing = await readJson(traitCorrectionsPath, []);
      const records = Array.isArray(existing) ? existing : [];
      records.push(nextRecord);
      await writeJson(traitCorrectionsPath, records);

      return json(response, 200, {
        ok: true,
        correction: nextRecord
      });
    } catch (error) {
      return json(response, 500, { error: error.message || "Failed to store trait correction." });
    }
  }

  if (url.pathname === "/api/refresh-product" && request.method === "POST") {
    try {
      if (!process.env.OPENAI_API_KEY) {
        return json(response, 409, { error: "Product refresh requires OPENAI_API_KEY on the local server." });
      }

      const body = await readRequestJson(request);
      const productId = String(body.product_id || "").trim();
      if (!productId) {
        return json(response, 400, { error: "product_id is required." });
      }

      const refreshedImages = await refreshProductIndex(productId);
      return json(response, 200, {
        ok: true,
        product_id: productId,
        refreshed_images: refreshedImages.length,
        caption_model_version: refreshedImages[0]?.caption_model_version || "",
        ai_refreshed_at: refreshedImages[0]?.ai_refreshed_at || "",
        images: refreshedImages.map((image) => addVisualTypeToRecordPayload(image))
      });
    } catch (error) {
      return json(response, 500, { error: error.message || "Product refresh failed." });
    }
  }

  if (url.pathname === "/api/refresh-products" && request.method === "POST") {
    try {
      if (!process.env.OPENAI_API_KEY) {
        return json(response, 409, { error: "Product refresh requires OPENAI_API_KEY on the local server." });
      }

      const body = await readRequestJson(request);
      const productIds = Array.isArray(body.product_ids) ? body.product_ids : [];
      if (!productIds.length) {
        return json(response, 400, { error: "product_ids is required." });
      }
      if (reindexState.running) {
        return json(response, 409, { error: "A bulk AI refresh is already running." });
      }

      const { catalog, index } = await loadCatalog();
      if (!catalog?.images?.length) {
        return json(response, 409, {
          error: "Normalized catalog not found. Run `npm run normalize` first."
        });
      }

      const uniqueProductIds = resetReindexState(productIds);
      const initialIndex = index?.images?.length ? index : createEmptyIndex(catalog);
      void (async () => {
        console.log("Batch runner started, total products:", uniqueProductIds.length);
        try {
          await runBulkRefresh(uniqueProductIds, catalog, initialIndex);
        } catch (error) {
          console.error("Batch runner failed:", error);
          reindexState.failed += Math.max(reindexState.total - reindexState.completed, 0);
          reindexState.failed_other += Math.max(reindexState.total - reindexState.completed, 0);
          reindexState.completed = reindexState.total;
          reindexState.running = false;
          reindexState.current_product = "";
          reindexState.failed_products.push({
            product_id: "",
            name: "Bulk refresh",
            error: error.message || "Batch product refresh failed."
          });
          reindexState.log.unshift({
            status: "failed",
            name: "Bulk refresh"
          });
          reindexState.log = reindexState.log.slice(0, 8);
          reindexState.done = true;
        }
      })();

      return json(response, 200, { started: true });
    } catch (error) {
      return json(response, 500, { error: error.message || "Batch product refresh failed." });
    }
  }

  if (url.pathname === "/api/reindex-status" && request.method === "GET") {
    return json(response, 200, reindexState);
  }

  if (url.pathname === "/api/scene-filter-progress" && request.method === "GET") {
    try {
      return json(response, 200, await readSceneFilterProgress());
    } catch (error) {
      return json(response, 500, { error: error.message || "Scene filter progress unavailable." });
    }
  }

  if (url.pathname === "/api/scene-filter-resume" && request.method === "POST") {
    try {
      return json(response, 200, await startSceneFilterRunner());
    } catch (error) {
      const message = error.message || "Stage 0 scene filter resume failed.";
      const status = /requires OPENAI_API_KEY|already running|already complete|No Stage 0 checkpoint|No remaining products/.test(message) ? 409 : 500;
      return json(response, status, { error: message });
    }
  }

  if (url.pathname === "/api/compose-query" && request.method === "POST") {
    try {
      const body = await readRequestJson(request);
      const visualType = normalizeRequestedVisualType({ visual_type: body.visual_type, seating_type: body.seating_type }) || "seating";
      const bullets = normalizeStructuredBullets(body.bullets, visualType);
      const query = await generateSearchQuery(visualType, bullets, {
        apiKey: process.env.OPENAI_API_KEY,
        visionModel: process.env.VISION_MODEL
      });
      return json(response, 200, { query });
    } catch (error) {
      return json(response, 500, { error: error.message || "Query composition failed." });
    }
  }

  if (url.pathname === "/api/rewrite-query-traits" && request.method === "POST") {
    try {
      const body = await readRequestJson(request);
      const query = await rewriteQueryFromTraitChanges(
        body.current_query_text,
        Array.isArray(body.trait_changes) ? body.trait_changes : [],
        Array.isArray(body.active_bullets) ? body.active_bullets : [],
        process.env.OPENAI_API_KEY
      );
      return json(response, 200, { query });
    } catch (error) {
      return json(response, 500, { error: error.message || "Targeted query rewrite failed." });
    }
  }

  return serveStatic(url.pathname, response);
});

await loadLocalEnv();

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";

server.on("error", (error) => {
  if (error?.syscall === "listen") {
    console.error(`Failed to start server on http://${host}:${port}: ${error.message}`);
    process.exit(1);
  }
});

server.listen(port, host, () => {
  console.log(`Image Search prototype running at http://${host}:${port}`);
});
