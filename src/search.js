import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cosineSimilarity, embedTextWithOpenAi } from "./utils.js";

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
    ["base_finish", "Base Finish"],
    ["frame", "Frame"],
    ["back_style", "Back"],
    ["arm_option", "Arms"],
    ["seat_upholstery", "Seat"],
    ["shell_material", "Shell"]
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

function normalizeCategory(value) {
  return String(value || "").toLowerCase().trim();
}

function normalizeTraitValue(value = "") {
  return String(value || "").toLowerCase().trim();
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

  if (record.category) {
    traitSet.add(`catalog.category:${normalizeTraitValue(record.category)}`);
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
    analysis.stage1?.seating_type ||
    analysis.seating_type ||
    parsed?.seating_type ||
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
  if (!queryBases.size) {
    return { value: 0, applied: [] };
  }

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
    const queryAligned = queryBases.has(base);
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

function categoryScoreAdjustment(parsedCategory, recordCategory) {
  const queryCategory = normalizeCategory(parsedCategory);
  const candidateCategory = normalizeCategory(recordCategory);

  if (!queryCategory || !candidateCategory) {
    return { value: 0, label: "" };
  }

  if (queryCategory === candidateCategory) {
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

function normalizeString(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeSimilarity(value) {
  return Number(Math.max(0, Math.min(1, (value + 1) / 2)).toFixed(6));
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

function collectTraitValues(record) {
  return new Set(
    Object.values(record?.image_traits || {})
      .map((value) => normalizeString(value))
      .filter((value) => value && value !== "unknown")
  );
}

function normalizePriorityBulletList(values = []) {
  const seen = new Set();
  const normalized = [];

  for (const value of values) {
    const bullet = String(value || "").trim();
    const key = normalizeString(bullet);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(bullet);
  }

  return normalized;
}

function normalizeSelectedBulletsByPriority(selectedBullets = []) {
  if (Array.isArray(selectedBullets)) {
    return {
      essential: [],
      normal: normalizePriorityBulletList(selectedBullets)
    };
  }

  if (!selectedBullets || typeof selectedBullets !== "object") {
    return { essential: [], normal: [] };
  }

  return {
    essential: normalizePriorityBulletList(selectedBullets.essential || []),
    normal: normalizePriorityBulletList(selectedBullets.normal || [])
  };
}

const BULLET_KEYWORD_WHITELIST = new Set([
  "wood",
  "wooden",
  "metal",
  "aluminum",
  "chrome",
  "fabric",
  "leather",
  "mesh",
  "plastic",
  "foam",
  "veneer",
  "upholstery",
  "frame",
  "base",
  "leg",
  "legs",
  "armrest",
  "armrests",
  "backrest",
  "shell",
  "pedestal",
  "sled",
  "cantilever",
  "cushion",
  "grain",
  "tufted",
  "woven",
  "ribbed",
  "molded",
  "perforated",
  "cantilevered"
]);

const HIGH_SPECIFICITY_STRUCTURE_TERMS = new Set([
  "mesh",
  "backrest",
  "armrest",
  "armrests",
  "leg",
  "legs",
  "base",
  "sled",
  "cantilever",
  "cantilevered",
  "cushion"
]);

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

function extractBulletKeywords(bullet = "") {
  return [...new Set(
    normalizeString(bullet)
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => BULLET_KEYWORD_WHITELIST.has(token))
  )];
}

function summaryKeywordMatch(bullet = "", visualSummary = "") {
  const keywords = extractBulletKeywords(bullet);
  if (!keywords.length || !visualSummary) {
    return false;
  }

  const summaryWords = normalizeString(visualSummary)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);

  return keywords.some((keyword) => summaryWords.some((word) => word.includes(keyword)));
}

function essentialMissPenalty(bullet = "") {
  const normalizedBullet = normalizeString(bullet);
  const keywords = extractBulletKeywords(bullet);
  const hasNearMandatoryPhrase = NEAR_MANDATORY_TERMS.some((term) => normalizedBullet.includes(term));
  const highSpecificityKeywordCount = keywords.filter((keyword) => HIGH_SPECIFICITY_STRUCTURE_TERMS.has(keyword)).length;

  if (hasNearMandatoryPhrase || highSpecificityKeywordCount >= 2) {
    return -0.55;
  }

  if (highSpecificityKeywordCount === 1 || keywords.length >= 2) {
    return -0.35;
  }

  return -0.2;
}

function computeTraitBoost(selectedBullets = [], record = {}, options = {}) {
  const traitValues = collectTraitValues(record);
  const visualSummary = String(record?.visual_summary || record?.stage2?.visual_summary || "").toLowerCase();
  const hasVisualSummary = Boolean(visualSummary);
  const bulletsByPriority = normalizeSelectedBulletsByPriority(selectedBullets);
  const priorityWeights = { essential: 0.35, normal: 0.1 };
  const isExactSourceImage = Boolean(options.isExactSourceImage);

  const matched = [];
  const seen = new Set();
  let weightedBoost = 0;

  for (const priority of ["essential", "normal"]) {
    for (const bullet of bulletsByPriority[priority]) {
      const rawBullet = String(bullet || "").trim();
      const normalizedBullet = normalizeString(bullet);
      if (!normalizedBullet || seen.has(normalizedBullet)) {
        continue;
      }
      seen.add(normalizedBullet);
      const matchesTraitValue = traitValues.has(normalizedBullet);
      const matchesVisualSummary = summaryKeywordMatch(rawBullet, visualSummary);

      if (matchesTraitValue || matchesVisualSummary) {
        matched.push(rawBullet);
        weightedBoost += priorityWeights[priority];
        continue;
      }

      if (priority === "essential" && hasVisualSummary && !isExactSourceImage) {
        weightedBoost += essentialMissPenalty(rawBullet);
      }
    }
  }

  return {
    value: Math.min(0.5, weightedBoost) + (matched.length >= 3 ? 0.15 : 0),
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
    return b.score - a.score;
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
  const stage1Type = String(analysis?.stage1?.seating_type || analysis?.seating_type || "").trim().toLowerCase();
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
  imageAnalysis = null,
  selectedBullets = [],
  apiKey = "",
  embeddingModel = process.env.EMBEDDING_MODEL || "text-embedding-3-small"
}) {
  const searchContext = resolveImageSearchContext({
    parsed: null,
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
        name: "type filter",
        summary: "Hard filter only for image-led searches with a non-other seating_type."
      },
      {
        name: "embedding similarity",
        summary: "Primary signal is cosine similarity between the query embedding and each product visual_summary embedding."
      },
      {
        name: "bullet boost",
        summary: "Add +0.35 per matched essential bullet and +0.10 per matched normal bullet against stored image_traits or visual_summary, capped at +0.50, plus +0.15 when 3 or more bullets match. Missing essential structural bullets now incur stronger specificity-sensitive penalties, with near-mandatory traits like mesh backs, casters, and angled metal legs penalized most heavily."
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
  rerankerEnabled = RERANKER_ENABLED
}) {
  const canonicalSourceImageUrl = canonicalizeImageUrl(sourceImageUrl);
  const searchContext = resolveImageSearchContext({ parsed, imageAnalysis, selectedBullets });
  const resolvedQueryEmbedding = Array.isArray(queryEmbedding) && queryEmbedding.length
    ? normalizeEmbedding(queryEmbedding)
    : await resolveQueryEmbedding({
        query,
        imageAnalysis,
        selectedBullets,
        apiKey,
        embeddingModel
      });

  if (!resolvedQueryEmbedding.length) {
    return [];
  }

  const filteredImages = (index.images || []).filter((record) => {
    const isExactSourceImage = canonicalSourceImageUrl
      ? canonicalizeImageUrl(record.image_url) === canonicalSourceImageUrl
      : false;

    if (parsed?.brand && record.brand !== parsed.brand) {
      return false;
    }

    if (
      searchContext.stage1Type &&
      searchContext.stage1Type !== "other_seating" &&
      !isExactSourceImage &&
      String(record.stage1?.seating_type || record.seating_type || "").trim().toLowerCase() !== searchContext.stage1Type
    ) {
      return false;
    }

    return true;
  });

  const scoredImages = filteredImages
    .map((record) => {
      if (!Array.isArray(record.visual_summary_embedding) || !record.visual_summary_embedding.length) {
        throw new Error("Index is missing visual_summary embeddings. Re-run the indexing pipeline.");
      }

      const embeddingSimilarity = normalizeSimilarity(cosineSimilarity(resolvedQueryEmbedding, record.visual_summary_embedding));
      const isExactSourceImage = canonicalSourceImageUrl
        ? canonicalizeImageUrl(record.image_url) === canonicalSourceImageUrl
        : false;
      const traitBoost = computeTraitBoost(searchContext.selectedBullets, record, { isExactSourceImage });
      const approvedTraitBoost = computeApprovedTraitDecisionBoost({ parsed, imageAnalysis, record });
      const categoryAdjustment = categoryScoreAdjustment(parsed?.category, record.category);
      const sourceImageBoost = isExactSourceImage ? 2 : 0;
      const roomScenePenalty = record.is_room_scene ? ROOM_SCENE_PENALTY : 0;
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
        is_room_scene: Boolean(record.is_room_scene)
      };
    })
    .sort((a, b) => {
      if (a.is_exact_source_image !== b.is_exact_source_image) {
        return Number(b.is_exact_source_image) - Number(a.is_exact_source_image);
      }
      return b.score - a.score;
    });

  const productMap = new Map();

  for (const image of scoredImages) {
    const existing = productMap.get(image.product_id);
    if (!existing) {
      productMap.set(image.product_id, {
        product_id: image.product_id,
        name: image.name,
        brand: image.brand,
        category: image.category,
        ai_refreshed_at: image.ai_refreshed_at || index.generated_at || "",
        best_image_url: image.image_url,
        image_urls: [image.image_url],
        score: image.score,
        matched_traits: image.matched_traits.slice(0, 4),
        debug: {
          structured_caption: image.structured_caption,
          visual_description: image.visual_summary || image.stage2?.visual_summary || "",
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
        is_room_scene: Boolean(image.is_room_scene)
      });
      continue;
    }

    existing.contributing_images += 1;
    if (!existing.image_urls.includes(image.image_url)) {
      existing.image_urls.push(image.image_url);
    }
    if (String(image.ai_refreshed_at || "") > String(existing.ai_refreshed_at || "")) {
      existing.ai_refreshed_at = image.ai_refreshed_at;
    }
    if (image.score > existing.score || image.is_exact_source_image) {
      existing.best_image_url = image.image_url;
      existing.score = image.score;
      existing.matched_traits = image.matched_traits.slice(0, 4);
      existing.debug = {
        structured_caption: image.structured_caption,
        visual_description: image.visual_summary || image.stage2?.visual_summary || "",
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
    }
    if (image.is_exact_source_image) {
      existing.is_exact_source_image = true;
    }
    if (image.is_room_scene) {
      existing.is_room_scene = true;
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
