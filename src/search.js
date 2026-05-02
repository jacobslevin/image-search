import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  cosineSimilarity,
  embedTextWithOpenAi,
  getAllCategoryTerms,
  getCategoryDisplayLabel,
  getEffectiveClassification,
  getLeafCategories
} from "./utils.js";
import { isSearchRecordEligible } from "./search-category-filter.js";

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
const seatingTypesConfig = JSON.parse(fs.readFileSync(seatingTypesPath, "utf8"));
const seatingTypes = seatingTypesConfig.types || {};
const defaultSeatingType = seatingTypesConfig.default_type || "";
const fallbackSeatingType = defaultSeatingType || Object.keys(seatingTypes)[0] || "";

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

function getTypeFields(typeKey) {
  return seatingTypes[typeKey]?.fields || seatingTypes[fallbackSeatingType]?.fields || [];
}

function getTraitFieldConfig(typeKey, fieldName) {
  const normalizedTypeKey = String(typeKey || "").trim();
  const normalizedFieldName = String(fieldName || "").trim();
  const resolvedTypeKey = traitFieldConfigIndex.has(normalizedTypeKey) ? normalizedTypeKey : fallbackSeatingType;
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

const STRUCTURED_BULLET_FIELD_ALIASES = new Map([
  ["arms", "arm_option"],
  ["arm_height", "arms_flush_with_back"],
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
  const normalizedField = normalizeBulletFieldLabel(fieldLabel);
  if (!normalizedField) {
    return "";
  }

  const typeFields = getTypeFields(typeKey);
  if (typeFields.some((field) => field.field === normalizedField)) {
    return normalizedField;
  }

  const schemaLabelMatch = typeFields.find((field) => (
    normalizeBulletFieldLabel(formatStructuredBulletFieldLabel(field.field)) === normalizedField
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

function normalizeSelectedBulletsByPriority(selectedBullets = [], typeKey = "") {
  if (Array.isArray(selectedBullets)) {
    const normalized = { essential: [], normal: [], low: [] };
    normalizePriorityBulletList(selectedBullets).forEach((bullet) => {
      const parsedBullet = parseStructuredTraitBullet(bullet, typeKey);
      const field = parsedBullet?.field || "";
      const priority = getFieldPriority(typeKey, field);
      if (priority === "essential") {
        normalized.essential.push(bullet);
      } else if (priority === "low") {
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

function parseStructuredTraitBullet(bullet = "", typeKey = "") {
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
  const field = resolveStructuredBulletField(typeKey, fieldLabel);
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

function essentialMissPenalty(bullet = "", options = {}) {
  const normalizedBullet = normalizeString(bullet);
  const hasNearMandatoryPhrase = NEAR_MANDATORY_TERMS.some((term) => normalizedBullet.includes(term));
  const grouped = Boolean(options.grouped);

  if (hasNearMandatoryPhrase) {
    return grouped ? -0.55 * 0.5 : -0.55;
  }

  return grouped ? -0.2 * 0.5 : -0.2;
}

function normalMissPenalty(options = {}) {
  return Boolean(options.grouped) ? -0.03 : -0.06;
}

function sharesGroup(typeKey = "", field = "", value1 = "", value2 = "") {
  const fieldConfig = getTraitFieldConfig(typeKey, field);
  const groups = Array.isArray(fieldConfig?.groups) ? fieldConfig.groups : [];
  const normalizedValue1 = normalizeString(value1);
  const normalizedValue2 = normalizeString(value2);

  if (!normalizedValue1 || !normalizedValue2 || normalizedValue1 === normalizedValue2 || !groups.length) {
    return false;
  }

  return groups.some((group) => {
    if (!Array.isArray(group)) {
      return false;
    }
    const normalizedGroup = group.map((value) => normalizeString(value)).filter(Boolean);
    return normalizedGroup.includes(normalizedValue1) && normalizedGroup.includes(normalizedValue2);
  });
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

function traitFieldWeightScale(typeKey = "", field = "") {
  const normalizedField = normalizeBulletFieldLabel(field);
  if (!normalizedField) {
    return 1;
  }
  const priority = getFieldPriority(typeKey, normalizedField);
  if (priority === "essential") {
    return 2;
  }
  if (priority === "low") {
    return 0.5;
  }
  return 1;
}

function computeTraitBoost(selectedBullets = [], record = {}, options = {}) {
  const enumFieldValues = collectEnumFieldValueMap(record);
  const enumFieldSource = record?.enum_fields || record?.image_traits || {};
  const priorityWeights = { essential: 0.35, normal: 0.1, low: 0.05 };
  const isExactSourceImage = Boolean(options.isExactSourceImage);
  const typeKey = String(record?.stage1?.seating_type || record?.seating_type || "").trim().toLowerCase();
  const bulletsByPriority = normalizeSelectedBulletsByPriority(selectedBullets, typeKey);

  const matched = [];
  const matchedFields = [];
  const contributions = new Map();
  const seen = new Set();

  for (const priority of ["essential", "normal", "low"]) {
    for (const bullet of bulletsByPriority[priority]) {
      const rawBullet = String(bullet || "").trim();
      const normalizedBullet = normalizeString(bullet);
      const parsedBullet = parseStructuredTraitBullet(rawBullet, typeKey);
      if (!normalizedBullet || seen.has(normalizedBullet)) {
        continue;
      }
      seen.add(normalizedBullet);
      const weightScale = parsedBullet ? traitFieldWeightScale(typeKey, parsedBullet.field) : (isBaseFinishBullet(rawBullet) ? 0.5 : 1);
      const storedValue = parsedBullet ? enumFieldValues.get(parsedBullet.field) : "";
      const rawStoredValue = parsedBullet ? String(enumFieldSource?.[parsedBullet.field] ?? "").trim() : "";
      const matchesTraitValue = Boolean(parsedBullet && storedValue === parsedBullet.value);
      let contributionValue = 0;
      let contributionState = "neutral";

      if (matchesTraitValue) {
        if (!isAbsenceStyleMatchReason(rawBullet)) {
          matched.push(rawBullet);
          matchedFields.push(parsedBullet.field);
        }
        contributionValue = priorityWeights[priority] * weightScale;
        contributionState = "hit";
      } else if ((priority === "essential" || priority === "normal") && !isExactSourceImage) {
        const groupedMiss = Boolean(
          parsedBullet &&
          storedValue &&
          sharesGroup(typeKey, parsedBullet.field, storedValue, parsedBullet.value)
        );
        contributionValue = (
          priority === "essential"
            ? essentialMissPenalty(rawBullet, { grouped: groupedMiss })
            : normalMissPenalty({ grouped: groupedMiss })
        ) * weightScale;
        contributionState = groupedMiss ? "near-miss" : "miss";
      }

      if (parsedBullet) {
        contributions.set(parsedBullet.field, {
          field: parsedBullet.field,
          raw_bullet: rawBullet,
          expected_value: parsedBullet.value,
          stored_value: rawStoredValue,
          priority,
          state: contributionState,
          contribution: contributionValue,
          bonus: 0
        });
      }
    }
  }

  const matchBonus = matched.length >= 3 ? 0.15 : 0;
  if (matchBonus && matchedFields.length) {
    const bonusField = matchedFields[0];
    const existing = contributions.get(bonusField);
    if (existing) {
      existing.contribution += matchBonus;
      existing.bonus += matchBonus;
      contributions.set(bonusField, existing);
    }
  }

  const contributionObject = Object.fromEntries(
    [...contributions.entries()].map(([field, detail]) => [
      field,
      {
        ...detail,
        contribution: Number(detail.contribution.toFixed(4)),
        bonus: Number(detail.bonus.toFixed(4))
      }
    ])
  );
  const totalValue = [...contributions.values()].reduce((sum, detail) => sum + Number(detail.contribution || 0), 0);

  return {
    value: Number(totalValue.toFixed(6)),
    matched,
    contributions: contributionObject,
    bonus: Number(matchBonus.toFixed(4))
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
    if (!isSearchRecordEligible(record)) {
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
      const categoryAdjustment = categoryScoreAdjustment(parsed?.category, record);
      const sourceImageBoost = includeSourceImage && isExactSourceImage ? 2 : 0;
      const roomScenePenalty = record.is_room_scene ? ROOM_SCENE_PENALTY : 0;
      const confidenceValue = confidenceRank(record.confidence_tier || deriveOverallConfidenceFromFields(record.field_confidence));
      // Approved trait decision system was removed 2026-04-23.
      // Historical data archived at archive/reranker-trait-decisions-2026-04-23.json.
      // If reintroducing a learned reranking system, consider interaction with
      // the trait grouping feature (see computeTraitBoost).
      const finalScore = Number((
        embeddingSimilarity +
        traitBoost.value +
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
        trait_contributions: traitBoost.contributions,
        trait_boost_bonus: traitBoost.bonus,
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
      effective_classification: getEffectiveClassification(image),
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
          plan_shape_reasoning: image.plan_shape_reasoning || image.reasoning || image.free_text?.reasoning || "",
          visual_highlights: image.visual_highlights || [],
          query_traits: parsed?.query_traits || null,
          score_breakdown: image.score_breakdown,
          mismatch_traits: image.mismatch_traits,
          detected_traits: formatDetectedTraits(image.image_traits, image.seating_type, 6),
          visual_traits: image.visual_traits,
          image_traits: image.image_traits || {},
          stage1: image.stage1 || { seating_type: image.seating_type || "" },
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
        plan_shape_reasoning: image.plan_shape_reasoning || image.reasoning || image.free_text?.reasoning || "",
        visual_highlights: image.visual_highlights || [],
        query_traits: parsed?.query_traits || null,
        score_breakdown: image.score_breakdown,
        mismatch_traits: image.mismatch_traits,
        detected_traits: formatDetectedTraits(image.image_traits, image.seating_type, 6),
        visual_traits: image.visual_traits,
        image_traits: image.image_traits || {},
        stage1: image.stage1 || { seating_type: image.seating_type || "" },
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
