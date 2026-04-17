import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cosineSimilarity, embedTextWithOpenAi, getAllCategoryTerms, getCategoryDisplayLabel, getLeafCategories } from "./utils.js";

const RERANKER_ENABLED = true;
const RERANKER_MODEL = "gpt-4o-mini";
const RERANKER_SYSTEM_PROMPT = "You are a visual furniture similarity expert. Given a search query describing a piece of furniture and a list of candidate products with their visual descriptions, rerank the candidates from most to least visually similar to the query. Consider overall form, structure, materials, and distinctive visual features. Return only a JSON array of product_ids in ranked order. No explanation, no commentary.";
const ROOM_SCENE_PENALTY = -0.2;
const ROOM_SCENE_TERMS = [
  "room",
  "scene",
  "setting",
  "background",
  "environment",
  "cafe",
  "restaurant",
  "office space",
  "interior",
  "wall",
  "floor",
  "ceiling",
  "window",
  "table",
  "desk",
  "counter",
  "shelf",
  "shelving",
  "plant",
  "lighting",
  "decor",
  "furnishings",
  "space",
  "area"
];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const seatingTypesPath = path.join(__dirname, "..", "data", "seating-types.json");
const traitDecisionPath = path.join(__dirname, "..", "scripts", "reranker-trait-decisions.json");
const seatingTypesConfig = JSON.parse(fs.readFileSync(seatingTypesPath, "utf8"));
const seatingTypes = seatingTypesConfig.types || {};
const defaultSeatingType = seatingTypesConfig.default_type || "other_seating";
let approvedTraitDecisionCache = { mtimeMs: 0, decisions: [] };

function getTypeFields(typeKey) {
  return seatingTypes[typeKey]?.fields || seatingTypes[defaultSeatingType]?.fields || [];
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
    ["shape_character", "Shape"],
    ["plan_shape", "Plan shape"],
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
      if (!normalized || ["unknown", "n/a"].includes(normalized.toLowerCase())) {
        return "";
      }

      return `${labels.get(field) || field.replace(/_/g, " ")}: ${normalized}`;
    })
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeCategory(value) {
  return String(value || "").toLowerCase().trim();
}

function normalizeTraitValue(value = "") {
  return String(value || "").toLowerCase().trim();
}

function expandCompatibleSeatingTypes(seatingType = "") {
  const normalized = String(seatingType || "").trim().toLowerCase();
  if (!normalized) {
    return new Set();
  }
  if (normalized === "task_collab_chair") {
    return new Set(["task_collab_chair", "task_chair", "collaborative_chair"]);
  }
  if (normalized === "task_chair" || normalized === "collaborative_chair") {
    return new Set(["task_collab_chair", "task_chair", "collaborative_chair"]);
  }
  if (normalized === "stool") {
    return new Set(["stool", "perch_stool"]);
  }
  if (normalized === "perch_stool") {
    return new Set(["stool", "perch_stool"]);
  }
  return new Set([normalized]);
}

function getSceneFilterResults(record = null) {
  return Array.isArray(record?.scene_filter_results) ? record.scene_filter_results : [];
}

function findSceneFilterResult(record = null, imageUrl = "") {
  const canonicalTarget = canonicalizeImageUrl(imageUrl);
  if (!canonicalTarget) {
    return null;
  }

  return getSceneFilterResults(record).find((entry) => {
    const modelVersion = String(entry?.model_version || "").trim();
    return /gpt-4\.1-nano/i.test(modelVersion) &&
      canonicalizeImageUrl(entry?.image_url) === canonicalTarget &&
      (entry?.result === "scene" || entry?.result === "product");
  }) || null;
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

function extractTraitBase(fullTrait = "") {
  const trait = String(fullTrait || "").trim();
  const separatorIndex = trait.indexOf(".");
  return separatorIndex >= 0 ? trait.slice(separatorIndex + 1) : trait;
}

function buildRecordTraitSet(record = {}) {
  const traitSet = new Set();
  collectTraitTokens("image", record.image_traits, traitSet);
  collectTraitTokens("merged", record.merged_traits, traitSet);
  collectTraitTokens("visual", record.visual_traits, traitSet);

  for (const category of getAllCategoryTerms(record)) {
    traitSet.add(`catalog.category:${normalizeTraitValue(category)}`);
  }
  if (record.seating_type) {
    traitSet.add(`catalog.seating_type:${normalizeTraitValue(record.seating_type)}`);
  }

  return traitSet;
}

function buildQueryTraitSet({ parsed, imageAnalysis }) {
  const traitSet = new Set();
  const analysis = imageAnalysis && typeof imageAnalysis === "object" ? imageAnalysis : {};

  collectTraitTokens("image", analysis.image_traits || analysis.stage3?.image_traits, traitSet);
  collectTraitTokens("merged", analysis.merged_traits || analysis.stage3?.merged_traits, traitSet);
  collectTraitTokens("visual", analysis.visual_traits || analysis.stage3?.visual_traits, traitSet);

  const queryCategory = String(parsed?.category || "").trim();
  if (queryCategory) {
    traitSet.add(`catalog.category:${normalizeTraitValue(queryCategory)}`);
  }

  const seatingType = String(
    parsed?.seating_type ||
    analysis.stage1?.seating_type ||
    analysis.seating_type ||
    ""
  ).trim();
  if (seatingType) {
    traitSet.add(`catalog.seating_type:${normalizeTraitValue(seatingType)}`);
  }

  return traitSet;
}

function loadApprovedTraitDecisions() {
  try {
    const stat = fs.statSync(traitDecisionPath);
    if (stat.mtimeMs === approvedTraitDecisionCache.mtimeMs) {
      return approvedTraitDecisionCache.decisions;
    }

    const parsed = JSON.parse(fs.readFileSync(traitDecisionPath, "utf8"));
    const decisions = (Array.isArray(parsed) ? parsed : [])
      .filter((entry) => entry && entry.status === "approved" && entry.trait)
      .map((entry) => ({
        trait: String(entry.trait),
        base: extractTraitBase(String(entry.trait)),
        direction: String(entry.direction || "").trim(),
        proposed_weight: Number(entry.proposed_weight || 0)
      }))
      .filter((entry) => entry.direction === "up" || entry.direction === "down");

    approvedTraitDecisionCache = { mtimeMs: stat.mtimeMs, decisions };
    return decisions;
  } catch {
    approvedTraitDecisionCache = { mtimeMs: 0, decisions: [] };
    return [];
  }
}

function computeApprovedTraitDecisionBoost({ parsed, imageAnalysis, record }) {
  const approvedDecisions = loadApprovedTraitDecisions();
  if (!approvedDecisions.length) {
    return { value: 0, applied: [] };
  }

  const queryTraits = buildQueryTraitSet({ parsed, imageAnalysis });
  const queryBases = new Set([...queryTraits].map((trait) => extractTraitBase(trait)));
  const queryText = (parsed?.query || "").toLowerCase();
  const recordTraits = buildRecordTraitSet(record);
  const matchedByBase = new Map();

  for (const decision of approvedDecisions) {
    if (!recordTraits.has(decision.trait)) {
      continue;
    }
    const bucket = matchedByBase.get(decision.base) || { up: null, down: null };
    if (
      decision.direction === "up" &&
      (!bucket.up || decision.proposed_weight > bucket.up.proposed_weight)
    ) {
      bucket.up = decision;
    }
    if (
      decision.direction === "down" &&
      (!bucket.down || decision.proposed_weight > bucket.down.proposed_weight)
    ) {
      bucket.down = decision;
    }
    matchedByBase.set(decision.base, bucket);
  }

  let total = 0;
  const applied = [];

  for (const [base, bucket] of matchedByBase.entries()) {
    const traitValue = base.includes(":") ? base.split(":").slice(1).join(":").toLowerCase() : base.toLowerCase();
    const traitWords = traitValue.split(/\s+/).filter((w) => w.length > 3);
    const queryAligned = queryBases.has(base) || traitWords.some((w) => queryText.includes(w));
    if (queryAligned && bucket.up) {
      total += bucket.up.proposed_weight;
      applied.push({
        label: `approved trait upweight (${base})`,
        value: Number(bucket.up.proposed_weight.toFixed(4))
      });
      continue;
    }

    if (!queryAligned && bucket.down) {
      total -= bucket.down.proposed_weight;
      applied.push({
        label: `approved trait downweight (${base})`,
        value: Number((-bucket.down.proposed_weight).toFixed(4))
      });
    }
  }

  return {
    value: Number(Math.max(-0.6, Math.min(0.6, total)).toFixed(6)),
    applied
  };
}

function categoryScoreAdjustment(parsedCategory, record = {}) {
  const queryCategory = normalizeCategory(parsedCategory);
  const candidateCategories = getAllCategoryTerms(record);

  if (!queryCategory || !candidateCategories.length) {
    return { value: 0, label: "" };
  }

  if (candidateCategories.some((category) => queryCategory === normalizeCategory(category))) {
    return { value: 0.03, label: "category match" };
  }

  return { value: 0, label: "" };
}

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

function buildProductImageUrls({
  bestImageUrl = "",
  existingImageUrls = [],
  record = {}
}) {
  const urls = [];
  const seen = new Set();

  function appendCandidates(candidates = []) {
    for (const candidate of candidates) {
      const normalized = String(candidate || "").trim();
      const canonical = canonicalizeImageUrl(normalized);
      if (!canonical || seen.has(canonical)) {
        continue;
      }
      seen.add(canonical);
      urls.push(normalized);
    }
  }

  appendCandidates([bestImageUrl]);
  appendCandidates(record.passing_image_urls || []);
  appendCandidates(record.all_image_urls || []);
  appendCandidates(existingImageUrls);
  appendCandidates([record.image_url]);

  return urls;
}

function normalizeString(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeSimilarity(value) {
  return Number(Math.max(0, Math.min(1, (value + 1) / 2)).toFixed(6));
}

function confidenceRank(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "high") return 3;
  if (normalized === "medium") return 2;
  if (normalized === "low") return 1;
  return 0;
}

function deriveOverallConfidenceFromFields(fieldConfidence = {}) {
  const values = Object.values(fieldConfidence || {}).map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
  if (!values.length) {
    return "high";
  }
  if (values.includes("low")) {
    return "low";
  }
  if (values.includes("medium")) {
    return "medium";
  }
  return "high";
}

function getRefreshTimestamp(record = {}) {
  return String(record.ai_refreshed_at || record.extraction_timestamp || record.generated_at || "").trim();
}

export function isRoomSceneVisualSummary(value = "") {
  const normalized = String(value || "").toLowerCase();
  return ROOM_SCENE_TERMS.some((term) => normalized.includes(term));
}

export function normalizeEmbedding(vector = []) {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!norm) {
    return [];
  }

  return vector.map((value) => Number(value / norm));
}

function normalizeBulletFieldLabel(value = "") {
  return normalizeString(value).replace(/\s+/g, "_");
}

function collectEnumFieldValueMap(record) {
  const source = record?.enum_fields || record?.image_traits || {};
  const map = new Map();

  for (const [field, value] of Object.entries(source)) {
    const normalizedField = normalizeBulletFieldLabel(field);
    const normalizedValue = normalizeString(value);
    if (!normalizedField || !normalizedValue || normalizedValue === "unknown") {
      continue;
    }
    map.set(normalizedField, normalizedValue);
  }

  return map;
}

function isAbsenceStyleMatchReason(value = "") {
  const normalized = normalizeString(value);
  if (!normalized) {
    return false;
  }

  return [
    /\bno\b/,
    /\bnone\b/,
    /\bnot visible\b/,
    /\bconcealed\b/,
    /\bunknown\b/,
    /\bwithout\b/,
    /\babsent\b/,
    /\bhidden\b/
  ].some((pattern) => pattern.test(normalized));
}

function normalizePriorityBulletList(values = []) {
  const seen = new Set();
  const normalized = [];

  for (const value of values) {
    const bullet = String(value || "").trim();
    const key = normalizeString(bullet);
    if (!key || seen.has(key) || isAbsenceStyleMatchReason(bullet)) {
      continue;
    }
    seen.add(key);
    normalized.push(bullet);
  }

  return normalized;
}

function normalizeSelectedBulletsByPriority(selectedBullets = []) {
  if (Array.isArray(selectedBullets)) {
    const normalized = { essential: [], normal: [], low: [] };
    normalizePriorityBulletList(selectedBullets).forEach((bullet) => {
      const parsedBullet = parseStructuredTraitBullet(bullet);
      const field = parsedBullet?.field || "";
      if (DEFAULT_ESSENTIAL_BULLET_FIELDS.has(field)) {
        normalized.essential.push(bullet);
      } else if (DEFAULT_LOW_PRIORITY_BULLET_FIELDS.has(field)) {
        normalized.low.push(bullet);
      } else {
        normalized.normal.push(bullet);
      }
    });
    return normalized;
  }

  if (!selectedBullets || typeof selectedBullets !== "object") {
    return { essential: [], normal: [], low: [] };
  }

  return {
    essential: normalizePriorityBulletList(selectedBullets.essential || []),
    normal: normalizePriorityBulletList(selectedBullets.normal || []),
    low: normalizePriorityBulletList(selectedBullets.low || [])
  };
}

const NEAR_MANDATORY_TERMS = [
  "lumbar",
  "caster",
  "casters",
  "wheel",
  "wheels",
  "mesh back",
  "mesh backrest",
  "angled metal legs",
  "thin angled metal legs",
  "curved armrests",
  "slim curved armrests",
  "rounded seat cushion"
];

function parseStructuredTraitBullet(bullet = "") {
  const rawBullet = String(bullet || "").trim();
  if (!rawBullet) {
    return null;
  }

  const separatorIndex = rawBullet.indexOf(":");
  if (separatorIndex === -1) {
    return null;
  }

  const fieldLabel = rawBullet.slice(0, separatorIndex).trim();
  const valueLabel = rawBullet.slice(separatorIndex + 1).trim();
  const field = normalizeBulletFieldLabel(fieldLabel);
  const value = normalizeString(valueLabel);

  if (!field || !value || value === "unknown") {
    return null;
  }

  return {
    field,
    value,
    rawBullet
  };
}

function essentialMissPenalty(bullet = "") {
  const normalizedBullet = normalizeString(bullet);
  const hasNearMandatoryPhrase = NEAR_MANDATORY_TERMS.some((term) => normalizedBullet.includes(term));

  if (hasNearMandatoryPhrase) {
    return -0.55;
  }

  return -0.2;
}

function isBaseFinishBullet(bullet = "") {
  const normalizedBullet = normalizeString(bullet);
  if (!normalizedBullet) {
    return false;
  }

  return normalizedBullet.startsWith("base finish ") ||
    normalizedBullet.startsWith("base finish") ||
    /\bpolished aluminum\b/.test(normalizedBullet) ||
    /\bpainted powder coat\b/.test(normalizedBullet) ||
    /\bpowder coat\b/.test(normalizedBullet);
}

const HIGH_WEIGHT_TRAIT_FIELDS = new Set([
  "body_construction",
  "arm_configuration",
  "configuration",
  "back_height",
  "base_visibility"
]);

const DEFAULT_ESSENTIAL_BULLET_FIELDS = new Set([
  "body_construction",
  "arm_configuration",
  "configuration",
  "back_height",
  "base_visibility"
]);

const LOW_WEIGHT_TRAIT_FIELDS = new Set([
  "seat_upholstery",
  "base_type",
  "base_finish"
]);

const DEFAULT_LOW_PRIORITY_BULLET_FIELDS = new Set([
  "base_type",
  "base_finish"
]);

function traitFieldWeightScale(field = "") {
  const normalizedField = normalizeBulletFieldLabel(field);
  if (!normalizedField) {
    return 1;
  }
  if (HIGH_WEIGHT_TRAIT_FIELDS.has(normalizedField)) {
    return 2;
  }
  if (LOW_WEIGHT_TRAIT_FIELDS.has(normalizedField)) {
    return 0.5;
  }
  return 1;
}

function computeTraitBoost(selectedBullets = [], record = {}, options = {}) {
  const enumFieldValues = collectEnumFieldValueMap(record);
  const bulletsByPriority = normalizeSelectedBulletsByPriority(selectedBullets);
  const priorityWeights = { essential: 0.35, normal: 0.1, low: 0.05 };
  const isExactSourceImage = Boolean(options.isExactSourceImage);

  const matched = [];
  const seen = new Set();
  let weightedBoost = 0;

  for (const priority of ["essential", "normal", "low"]) {
    for (const bullet of bulletsByPriority[priority]) {
      const rawBullet = String(bullet || "").trim();
      const normalizedBullet = normalizeString(bullet);
      const parsedBullet = parseStructuredTraitBullet(rawBullet);
      if (!normalizedBullet || seen.has(normalizedBullet)) {
        continue;
      }
      seen.add(normalizedBullet);
      const weightScale = parsedBullet ? traitFieldWeightScale(parsedBullet.field) : (isBaseFinishBullet(rawBullet) ? 0.5 : 1);
      const storedValue = parsedBullet ? enumFieldValues.get(parsedBullet.field) : "";
      const matchesTraitValue = Boolean(parsedBullet && storedValue === parsedBullet.value);

      if (matchesTraitValue) {
        if (!isAbsenceStyleMatchReason(rawBullet)) {
          matched.push(rawBullet);
        }
        weightedBoost += priorityWeights[priority] * weightScale;
        continue;
      }

      if (priority === "essential" && !isExactSourceImage) {
        weightedBoost += essentialMissPenalty(rawBullet) * weightScale;
      }
    }
  }

  return {
    value: weightedBoost + (matched.length >= 3 ? 0.15 : 0),
    matched
  };
}

function sortProducts(products, sort = "auto") {
  if (sort === "refreshed_desc") {
    return [...products].sort((a, b) =>
      String(b.ai_refreshed_at || "").localeCompare(String(a.ai_refreshed_at || "")) ||
      b.score - a.score
    );
  }

  if (sort === "refreshed_asc") {
    return [...products].sort((a, b) =>
      String(a.ai_refreshed_at || "").localeCompare(String(b.ai_refreshed_at || "")) ||
      b.score - a.score
    );
  }

  if (sort === "name") {
    return [...products].sort((a, b) =>
      a.name.localeCompare(b.name) || a.brand.localeCompare(b.brand)
    );
  }

  return [...products].sort((a, b) => {
    const aExact = a.is_exact_source_image ? 1 : 0;
    const bExact = b.is_exact_source_image ? 1 : 0;
    if (aExact !== bExact) {
      return bExact - aExact;
    }
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return (b.confidence_rank || 0) - (a.confidence_rank || 0);
  });
}

function buildRerankerUserPrompt(query, candidates) {
  return `Search query: ${query}

Candidates:
${candidates.map((c, i) => `${i + 1}. product_id: ${c.product_id}
Visual description: ${c.visual_summary}`).join("\n\n")}

Return a JSON array of product_ids ordered from most to least visually similar. Example: ["id1", "id2", "id3"]`;
}

function extractJsonArray(rawContent = "") {
  const trimmed = String(rawContent || "").trim();
  if (!trimmed) {
    return [];
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;
  return JSON.parse(candidate);
}

async function rerankProducts(query, products, apiKey) {
  const candidates = products
    .slice(0, 10)
    .map((product) => ({
      product_id: product.product_id,
      visual_summary: String(product.debug?.visual_description || "").trim()
    }))
    .filter((candidate) => candidate.product_id && candidate.visual_summary);

  if (!apiKey || !String(query || "").trim() || candidates.length < 2) {
    return { products, rerankerUsed: false };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: RERANKER_MODEL,
        temperature: 0,
        max_tokens: 200,
        messages: [
          { role: "system", content: RERANKER_SYSTEM_PROMPT },
          { role: "user", content: buildRerankerUserPrompt(query, candidates) }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI reranker request failed with ${response.status}.`);
    }

    const payload = await response.json();
    const rawContent = String(payload?.choices?.[0]?.message?.content || "").trim();
    const rankedIds = extractJsonArray(rawContent);

    if (!Array.isArray(rankedIds) || !rankedIds.length) {
      throw new Error("OpenAI reranker response did not include a JSON array.");
    }

    const topProducts = products.slice(0, 10);
    const remainingProducts = products.slice(10);
    const topProductMap = new Map(topProducts.map((product) => [product.product_id, product]));
    const rerankedTop = [];

    for (const productId of rankedIds) {
      const product = topProductMap.get(productId);
      if (!product) {
        continue;
      }
      rerankedTop.push(product);
      topProductMap.delete(productId);
    }

    rerankedTop.push(...topProductMap.values());

    return {
      products: [...rerankedTop, ...remainingProducts],
      rerankerUsed: true
    };
  } catch (error) {
    console.error("Reranker failed, falling back to embedding order:", error);
    return { products, rerankerUsed: false };
  }
}

function resolveImageSearchContext({ parsed, imageAnalysis, selectedBullets }) {
  const analysis = imageAnalysis && typeof imageAnalysis === "object" ? imageAnalysis : null;
  const stage1Type = String(
    parsed?.seating_type ||
    analysis?.stage1?.seating_type ||
    analysis?.seating_type ||
    ""
  ).trim().toLowerCase();
  const visualSummary = String(analysis?.stage2?.visual_summary || analysis?.visual_summary || "").trim();
  const bulletsByPriority = normalizeSelectedBulletsByPriority(selectedBullets);

  return {
    stage1Type,
    visualSummary,
    selectedBullets: bulletsByPriority,
    isImageSearch: Boolean(visualSummary)
  };
}

export async function resolveQueryEmbedding({
  query = "",
  parsed = null,
  imageAnalysis = null,
  selectedBullets = [],
  apiKey = "",
  embeddingModel = process.env.EMBEDDING_MODEL || "text-embedding-3-small"
}) {
  const searchContext = resolveImageSearchContext({
    parsed,
    imageAnalysis,
    selectedBullets
  });
  const normalizedQuery = String(query || "").trim();
  const queryEmbeddingInput = normalizedQuery || (searchContext.isImageSearch ? searchContext.visualSummary : "");

  if (!queryEmbeddingInput) {
    return [];
  }

  if (!apiKey) {
    throw new Error("Search ranking now requires OPENAI_API_KEY to generate query embeddings.");
  }

  return embedTextWithOpenAi(queryEmbeddingInput, {
    apiKey,
    model: embeddingModel
  });
}

export function getRankingRulesSummary() {
  return {
    stages: [
      {
        name: "image relevance",
        summary: "Primary signal is match quality against each image record using combined free-text embeddings plus enum/free-text trait boosts."
      },
      {
        name: "confidence tie-break",
        summary: "When image relevance is close, high-confidence image records rank above medium-confidence, which rank above low-confidence."
      },
      {
        name: "product grouping",
        summary: "Images are ranked globally first, then grouped by product_id for display using the top-scoring image as the hero."
      }
    ],
    additive_boosts: {
      category_match: 0.03,
      source_image_exact_match: 2
    }
  };
}

export async function searchIndex({
  query,
  parsed,
  index,
  limit = Infinity,
  sourceImageUrl = "",
  sort = "auto",
  imageAnalysis = null,
  selectedBullets = [],
  queryEmbedding = null,
  apiKey = "",
  embeddingModel = process.env.EMBEDDING_MODEL || "text-embedding-3-small",
  rerankerEnabled = RERANKER_ENABLED,
  approvedTraitWeightsEnabled = true,
  includeSourceImage = false
}) {
  const canonicalSourceImageUrl = canonicalizeImageUrl(sourceImageUrl);
  const searchContext = resolveImageSearchContext({ parsed, imageAnalysis, selectedBullets });
  const compatibleStage1Types = expandCompatibleSeatingTypes(searchContext.stage1Type);
  const resolvedQueryEmbedding = Array.isArray(queryEmbedding) && queryEmbedding.length
      ? normalizeEmbedding(queryEmbedding)
      : await resolveQueryEmbedding({
        query,
        parsed,
        imageAnalysis,
        selectedBullets,
        apiKey,
        embeddingModel
      });

  if (!resolvedQueryEmbedding.length) {
    return [];
  }

  const filteredImages = (index.images || []).filter((record) => {
    if (record.stage_0_result !== "product" || record.excluded) {
      return false;
    }

    const isExactSourceImage = canonicalSourceImageUrl
      ? canonicalizeImageUrl(record.image_url) === canonicalSourceImageUrl
      : false;

    if (isExactSourceImage && !includeSourceImage) {
      return false;
    }

    if (parsed?.brand && record.brand !== parsed.brand) {
      return false;
    }

    if (
      searchContext.stage1Type &&
      !isExactSourceImage &&
      !compatibleStage1Types.has(String(record.stage1?.seating_type || record.seating_type || "").trim().toLowerCase())
    ) {
      return false;
    }

    return true;
  });

  const scoredImages = filteredImages
    .map((record) => {
      const recordEmbedding = Array.isArray(record.search_text_embedding) && record.search_text_embedding.length
        ? record.search_text_embedding
        : record.visual_summary_embedding;

      if (!Array.isArray(recordEmbedding) || !recordEmbedding.length) {
        throw new Error("Index is missing image embeddings. Re-run the indexing pipeline.");
      }

      const embeddingSimilarity = normalizeSimilarity(cosineSimilarity(resolvedQueryEmbedding, recordEmbedding));
      const isExactSourceImage = canonicalSourceImageUrl
        ? canonicalizeImageUrl(record.image_url) === canonicalSourceImageUrl
        : false;
      const traitBoost = computeTraitBoost(searchContext.selectedBullets, record, { isExactSourceImage });
      const approvedTraitBoost = approvedTraitWeightsEnabled
        ? computeApprovedTraitDecisionBoost({ parsed, imageAnalysis, record })
        : { value: 0, applied: [] };
      const categoryAdjustment = categoryScoreAdjustment(parsed?.category, record);
      const sourceImageBoost = includeSourceImage && isExactSourceImage ? 2 : 0;
      const roomScenePenalty = record.is_room_scene ? ROOM_SCENE_PENALTY : 0;
      const confidenceValue = confidenceRank(record.confidence_tier || deriveOverallConfidenceFromFields(record.field_confidence));
      const finalScore = Number((
        embeddingSimilarity +
        traitBoost.value +
        approvedTraitBoost.value +
        categoryAdjustment.value +
        sourceImageBoost +
        roomScenePenalty
      ).toFixed(6));

      return {
        ...record,
        score: finalScore,
        score_breakdown: [
          { label: "embedding similarity", value: Number(embeddingSimilarity.toFixed(4)) },
          ...(traitBoost.value
            ? [{ label: "selected bullet boost", value: Number(traitBoost.value.toFixed(4)) }]
            : []),
        ...approvedTraitBoost.applied,
        ...(categoryAdjustment.label
            ? [{ label: categoryAdjustment.label, value: Number(categoryAdjustment.value.toFixed(4)) }]
            : []),
          ...(confidenceValue
            ? [{ label: "confidence tier", value: Number((confidenceValue / 100).toFixed(4)) }]
            : []),
          ...(sourceImageBoost
            ? [{ label: "source image exact-match boost", value: 2 }]
            : []),
          ...(roomScenePenalty
            ? [{ label: "room scene penalty", value: Number(roomScenePenalty.toFixed(4)) }]
            : []),
          { label: "final score", value: Number(finalScore.toFixed(4)) }
        ],
        matched_traits: traitBoost.matched,
        mismatch_traits: [],
        is_exact_source_image: isExactSourceImage,
        is_room_scene: Boolean(record.is_room_scene),
        confidence_tier: record.confidence_tier || deriveOverallConfidenceFromFields(record.field_confidence),
        confidence_rank: confidenceValue
      };
    })
    .sort((a, b) => {
      if (includeSourceImage && a.is_exact_source_image !== b.is_exact_source_image) {
        return Number(b.is_exact_source_image) - Number(a.is_exact_source_image);
      }
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return b.confidence_rank - a.confidence_rank;
    });

  const productLookup = new Map((index.products || []).map((product) => [product.product_id, product]));
  const productMap = new Map();

  for (const image of scoredImages) {
    const product = productLookup.get(image.product_id) || image;
    const existing = productMap.get(image.product_id);
    const matchingImage = {
      image_id: image.image_id,
      image_url: image.image_url,
      stage_0_result: image.stage_0_result,
      seating_type: image.seating_type,
      score: image.score,
      score_breakdown: image.score_breakdown || [],
      confidence_tier: image.confidence_tier,
      matched_traits: image.matched_traits.slice(0, 4),
      field_confidence: image.field_confidence || {},
      free_text: image.free_text || {},
      enum_fields: image.enum_fields || image.image_traits || {},
      visual_summary_embedding: image.visual_summary_embedding || image.search_text_embedding || []
    };

    if (!existing) {
      productMap.set(image.product_id, {
        product_id: image.product_id,
        name: product.product_name || product.name || image.name,
        brand: image.brand,
        category: getCategoryDisplayLabel(product),
        category_tags: getLeafCategories(product),
        filter_categories: getAllCategoryTerms(product),
        ai_refreshed_at: getRefreshTimestamp(image) || index.generated_at || "",
        best_image_url: image.image_url,
        image_urls: (product.image_urls || []).length
          ? product.image_urls
          : buildProductImageUrls({
              bestImageUrl: image.image_url,
              record: image
            }),
        score: image.score,
        matched_traits: image.matched_traits.slice(0, 4),
        match_count: 1,
        matching_images: [matchingImage],
        hero_image: matchingImage,
        image_urls: [image.image_url],
        debug: {
          structured_caption: image.structured_caption || image.free_text?.structured_caption || "",
          visual_description: image.visual_summary || image.free_text?.visual_summary || image.stage2?.visual_summary || "",
          visual_highlights: image.visual_highlights || [],
          query_traits: parsed?.query_traits || null,
          score_breakdown: image.score_breakdown,
          mismatch_traits: image.mismatch_traits,
          detected_traits: formatDetectedTraits(image.image_traits, image.seating_type, 6),
          visual_traits: image.visual_traits,
          image_traits: image.image_traits || {},
          stage1: image.stage1 || { seating_type: image.seating_type || "other_seating" },
          stage2: image.stage2 || { visual_summary: image.visual_summary || "" }
        },
        contributing_images: 1,
        is_exact_source_image: image.is_exact_source_image,
        is_room_scene: Boolean(image.is_room_scene),
        scene_filter: buildSceneFilterBadge(image, image.image_url),
        scene_filter_results: getSceneFilterResults(image),
        visual_summary_embedding: image.visual_summary_embedding || image.search_text_embedding || [],
        confidence_tier: image.confidence_tier,
        confidence_rank: image.confidence_rank
      });
      continue;
    }

    existing.contributing_images += 1;
    existing.match_count += 1;
    existing.matching_images.push(matchingImage);
    if (!existing.image_urls.includes(image.image_url)) {
      existing.image_urls.push(image.image_url);
    }
    if (String(getRefreshTimestamp(image) || "") > String(existing.ai_refreshed_at || "")) {
      existing.ai_refreshed_at = getRefreshTimestamp(image);
    }
    if (image.score > existing.score || image.is_exact_source_image) {
      existing.best_image_url = image.image_url;
      existing.category = getCategoryDisplayLabel(product);
      existing.category_tags = getLeafCategories(product);
      existing.filter_categories = getAllCategoryTerms(product);
      existing.score = image.score;
      existing.matched_traits = image.matched_traits.slice(0, 4);
      existing.hero_image = matchingImage;
      existing.debug = {
        structured_caption: image.structured_caption || image.free_text?.structured_caption || "",
        visual_description: image.visual_summary || image.free_text?.visual_summary || image.stage2?.visual_summary || "",
        visual_highlights: image.visual_highlights || [],
        query_traits: parsed?.query_traits || null,
        score_breakdown: image.score_breakdown,
        mismatch_traits: image.mismatch_traits,
        detected_traits: formatDetectedTraits(image.image_traits, image.seating_type, 6),
        visual_traits: image.visual_traits,
        image_traits: image.image_traits || {},
        stage1: image.stage1 || { seating_type: image.seating_type || "other_seating" },
        stage2: image.stage2 || { visual_summary: image.visual_summary || "" }
      };
      existing.scene_filter = buildSceneFilterBadge(image, image.image_url);
      existing.scene_filter_results = getSceneFilterResults(image);
      existing.visual_summary_embedding = image.visual_summary_embedding || image.search_text_embedding || [];
      existing.confidence_tier = image.confidence_tier;
      existing.confidence_rank = image.confidence_rank;
    }
    if (image.is_exact_source_image) {
      existing.is_exact_source_image = true;
    }
    if (image.is_room_scene) {
      existing.is_room_scene = true;
    }
  }

  for (const product of productMap.values()) {
    product.matching_images.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return confidenceRank(b.confidence_tier) - confidenceRank(a.confidence_tier);
    });
    product.match_count = product.matching_images.length;
    product.image_urls = product.matching_images.map((image) => image.image_url).filter(Boolean);
    if (product.hero_image?.image_url) {
      product.best_image_url = product.hero_image.image_url;
    }
  }

  const sortedProducts = sortProducts([...productMap.values()], sort);
  const { products: rerankedProducts, rerankerUsed } = rerankerEnabled
    ? await rerankProducts(query, sortedProducts, apiKey)
    : { products: sortedProducts, rerankerUsed: false };
  const limitedProducts = rerankedProducts.slice(0, Number.isFinite(limit) ? limit : undefined);

  return {
    results: limitedProducts,
    reranker_used: rerankerUsed
  };
}
