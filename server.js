import fsSync from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeInspirationImage, generateCaption, generateSearchQuery } from "./src/captioning.js";
import { parseSearchQuery } from "./src/query-parser.js";
import { getRankingRulesSummary, normalizeEmbedding, resolveQueryEmbedding, searchIndex } from "./src/search.js";
import { readJson, writeJson } from "./src/utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envFiles = [
  path.join(__dirname, ".env.local"),
  path.join(__dirname, ".env")
];
const publicDir = path.join(__dirname, "public");
const normalizedPath = path.join(__dirname, "data", "normalized-catalog.json");
const indexPath = path.join(__dirname, "data", "image-index.json");
const seatingTypesPath = path.join(__dirname, "data", "seating-types.json");
const evalResultsPath = path.join(__dirname, "scripts", "eval-results.json");
const evalJudgmentsPath = path.join(__dirname, "scripts", "eval-judgments.json");
const traitSuggestionDecisionsPath = path.join(__dirname, "scripts", "reranker-trait-decisions.json");
const seatingTypesConfig = JSON.parse(fsSync.readFileSync(seatingTypesPath, "utf8"));
const seatingTypes = seatingTypesConfig.types || {};
const defaultSeatingType = seatingTypesConfig.default_type || "other_seating";

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
  "guest seating with chrome sled base and wood arms",
  "wood seating",
  "lounge chair with exposed wood frame",
  "upholstered guest chair with metal base"
];

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};
const BULK_REFRESH_BATCH_SIZE = 5;
const BULK_REFRESH_PRODUCT_DELAY_MS = 200;
const BULK_REFRESH_BATCH_DELAY_MS = 1000;
let reindexState = {
  running: false,
  total: 0,
  completed: 0,
  failed: 0,
  failed_products: [],
  current_product: "",
  current_batch: 0,
  total_batches: 0,
  log: [],
  done: false
};

function json(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function buildTraitSuggestionReport(judgments = [], decisions = []) {
  const stats = new Map();
  const decisionMap = new Map(
    (Array.isArray(decisions) ? decisions : [])
      .filter((entry) => entry && typeof entry === "object" && entry.trait)
      .map((entry) => [String(entry.trait), entry])
  );

  for (const judgment of Array.isArray(judgments) ? judgments : []) {
    if (!judgment?.was_corrected) {
      continue;
    }

    for (const pair of judgment.preference_pairs || []) {
      const queryAlignedPreferred = new Set(pair.query_aligned_preferred_traits || []);
      const queryAlignedDemoted = new Set(pair.query_aligned_demoted_traits || []);

      for (const trait of pair.preferred_only_traits || []) {
        const entry = stats.get(trait) || {
          trait,
          up_count: 0,
          down_count: 0,
          query_aligned_up_count: 0,
          query_aligned_down_count: 0,
          supporting_pairs: 0
        };
        entry.up_count += 1;
        entry.supporting_pairs += 1;
        if (queryAlignedPreferred.has(trait)) {
          entry.query_aligned_up_count += 1;
        }
        stats.set(trait, entry);
      }

      for (const trait of pair.demoted_only_traits || []) {
        const entry = stats.get(trait) || {
          trait,
          up_count: 0,
          down_count: 0,
          query_aligned_up_count: 0,
          query_aligned_down_count: 0,
          supporting_pairs: 0
        };
        entry.down_count += 1;
        entry.supporting_pairs += 1;
        if (queryAlignedDemoted.has(trait)) {
          entry.query_aligned_down_count += 1;
        }
        stats.set(trait, entry);
      }
    }
  }

  const suggestions = [...stats.values()]
    .map((entry) => {
      const queryAlignedEvidence = entry.query_aligned_up_count + entry.query_aligned_down_count;
      // If a trait is present on the query product, seeing it on irrelevant results is not
      // sufficient evidence to push it down. Query alignment should protect against
      // over-generalizing a shared trait as a negative signal.
      const weightedUp =
        entry.up_count +
        (entry.query_aligned_up_count * 2) +
        entry.query_aligned_down_count;
      const weightedDown = Math.max(0, entry.down_count - entry.query_aligned_down_count);
      const netScore = weightedUp - weightedDown;
      const evidence = entry.up_count + entry.down_count;
      let direction = "neutral";
      if (netScore > 0) {
        direction = "up";
      } else if (netScore < 0 && queryAlignedEvidence === 0) {
        direction = "down";
      }
      const proposedWeight = direction === "neutral"
        ? 0
        : Number(Math.min(0.2, 0.02 * Math.max(1, Math.abs(netScore))).toFixed(3));
      const qualifies = direction !== "neutral" && evidence >= 2 && Math.abs(netScore) >= 2;
      const decision = decisionMap.get(entry.trait) || null;

      return {
        trait: entry.trait,
        direction,
        proposed_weight: proposedWeight,
        evidence,
        net_score: netScore,
        weighted_up: weightedUp,
        weighted_down: weightedDown,
        up_count: entry.up_count,
        down_count: entry.down_count,
        query_aligned_up_count: entry.query_aligned_up_count,
        query_aligned_down_count: entry.query_aligned_down_count,
        status: decision?.status || "pending",
        decided_at: decision?.decided_at || "",
        qualifies
      };
    })
    .filter((entry) => entry.qualifies)
    .sort((a, b) => {
      if (Math.abs(b.net_score) !== Math.abs(a.net_score)) {
        return Math.abs(b.net_score) - Math.abs(a.net_score);
      }
      if (b.evidence !== a.evidence) {
        return b.evidence - a.evidence;
      }
      return a.trait.localeCompare(b.trait);
    });

  return {
    generated_at: new Date().toISOString(),
    corrected_judgments: (Array.isArray(judgments) ? judgments : []).filter((judgment) => judgment?.was_corrected).length,
    suggestions,
    suggested_up: suggestions.filter((entry) => entry.direction === "up"),
    suggested_down: suggestions.filter((entry) => entry.direction === "down"),
    approved: suggestions.filter((entry) => entry.status === "approved"),
    rejected: suggestions.filter((entry) => entry.status === "rejected"),
    pending: suggestions.filter((entry) => entry.status === "pending"),
    note: "Suggestion mode only. Query-aligned traits are protected from automatic downweighting; approved trait weights are saved for review and are not applied to live ranking yet."
  };
}

async function loadEvalData() {
  const [evalResults, index, judgments, traitDecisions] = await Promise.all([
    readJson(evalResultsPath),
    readJson(indexPath),
    readJson(evalJudgmentsPath, []),
    readJson(traitSuggestionDecisionsPath, [])
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
    judgments: Array.isArray(judgments) ? judgments : [],
    trait_report: buildTraitSuggestionReport(judgments, traitDecisions)
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

function normalizeStructuredBullets(bullets = []) {
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
    return {
      essential: [],
      normal: normalizeList(bullets)
    };
  }

  if (!bullets || typeof bullets !== "object") {
    return { essential: [], normal: [] };
  }

  return {
    essential: normalizeList(bullets.essential || []),
    normal: normalizeList(bullets.normal || [])
  };
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
  return readJson(seatingTypesPath, { types: {}, default_type: "other_seating" });
}

function buildIndexedImageRecord(image, generated, refreshedAt = new Date().toISOString()) {
  return {
    ...image,
    stage1: {
      seating_type: generated.stage1?.seating_type || generated.seating_type || "other_seating"
    },
    stage2: {
      visual_summary: generated.stage2?.visual_summary || ""
    },
    structured_caption: generated.structured_caption,
    raw_visual_highlights: generated.raw_visual_highlights || [],
    visual_summary: generated.stage2?.visual_summary || "",
    visual_highlights: generated.visual_highlights,
    seating_type: generated.seating_type || "other_seating",
    image_traits: generated.image_traits || {},
    spec_traits: generated.spec_traits || {},
    merged_traits: generated.merged_traits || {},
    trait_provenance: generated.trait_provenance || {},
    visual_traits: generated.visual_traits,
    caption_embedding: generated.caption_embedding,
    visual_description_embedding: generated.visual_description_embedding,
    visual_summary_embedding: generated.visual_summary_embedding,
    caption_model_version: generated.caption_model_version,
    embedding_model_version: generated.embedding_model_version,
    ai_refreshed_at: refreshedAt
  };
}

function buildIndexOutput(index, catalog, mergedImages) {
  const indexedBrands = [...new Set(mergedImages.map((image) => image.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const indexedCategories = [...new Set(mergedImages.map((image) => image.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const indexedProducts = new Set(mergedImages.map((image) => image.product_id)).size;

  return {
    ...index,
    generated_at: new Date().toISOString(),
    provider: "openai",
    totals: {
      products: indexedProducts,
      images: mergedImages.length
    },
    brands: indexedBrands.length ? indexedBrands : catalog.brands,
    categories: indexedCategories.length ? indexedCategories : catalog.categories,
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
    images: []
  };
}

function mergeRefreshedImages(index, catalog, refreshedImages = []) {
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

  return buildIndexOutput(index, catalog, mergedImages);
}

async function generateProductRefreshPayload(productId, matchingImages = []) {
  const productImages = [];
  const refreshedAt = new Date().toISOString();

  for (const image of matchingImages) {
    const generated = await generateCaption(image, {
      provider: "openai",
      apiKey: process.env.OPENAI_API_KEY,
      visionModel: process.env.VISION_MODEL
    });
    productImages.push(buildIndexedImageRecord(image, generated, refreshedAt));
  }

  return {
    product_id: productId,
    refreshed_images: productImages.length,
    caption_model_version: productImages[0]?.caption_model_version || "",
    ai_refreshed_at: refreshedAt,
    images: productImages
  };
}

function resetReindexState(productIds = []) {
  const uniqueProductIds = [...new Set((productIds || []).map((value) => String(value || "").trim()).filter(Boolean))];
  reindexState = {
    running: true,
    total: uniqueProductIds.length,
    completed: 0,
    failed: 0,
    failed_products: [],
    current_product: "",
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

    for (let productIndex = 0; productIndex < batchProductIds.length; productIndex += 1) {
      const productId = batchProductIds[productIndex];
      const matchingImages = productImageMap.get(productId) || [];
      const productName = matchingImages[0]?.name || productId;
      reindexState.current_product = productName;

      try {
        if (!matchingImages.length) {
          throw new Error("Product not found in normalized catalog.");
        }

        const productPayload = await generateProductRefreshPayload(productId, matchingImages);
        batchRefreshedImages.push(...productPayload.images);
        reindexState.log.unshift({
          name: productName,
          status: "success",
          type: productPayload.images[0]?.seating_type || ""
        });
        reindexState.completed += 1;
      } catch (error) {
        reindexState.failed += 1;
        reindexState.failed_products.push({
          name: productName,
          product_id: productId,
          error: error.message || "Product refresh failed."
        });
        reindexState.log.unshift({
          name: productName,
          status: "failed"
        });
        reindexState.completed += 1;
      }

      reindexState.log = reindexState.log.slice(0, 8);
      reindexState.current_product = batchProductIds[productIndex + 1]
        ? (productImageMap.get(batchProductIds[productIndex + 1]) || [])[0]?.name || batchProductIds[productIndex + 1]
        : batches[batchIndex + 1]?.[0]
          ? (productImageMap.get(batches[batchIndex + 1][0]) || [])[0]?.name || batches[batchIndex + 1][0]
          : "";

      if (reindexState.completed < reindexState.total) {
        await sleep(BULK_REFRESH_PRODUCT_DELAY_MS);
      }
    }

    if (batchRefreshedImages.length) {
      workingIndex = mergeRefreshedImages(workingIndex, catalog, batchRefreshedImages);
      await writeJson(indexPath, workingIndex);
    }

    if (batchIndex < batches.length - 1) {
      await sleep(BULK_REFRESH_BATCH_DELAY_MS);
    }
  }

  reindexState.running = false;
  reindexState.current_product = "";
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
  const output = mergeRefreshedImages(workingIndex, catalog, productPayload.images);
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
      const productImages = [];
      const refreshedAt = new Date().toISOString();
      for (const image of matchingImages) {
        const generated = await generateCaption(image, {
          provider: "openai",
          apiKey: process.env.OPENAI_API_KEY,
          visionModel: process.env.VISION_MODEL
        });
        const indexedRecord = buildIndexedImageRecord(image, generated, refreshedAt);
        refreshedImages.push(indexedRecord);
        productImages.push(indexedRecord);
      }

      refreshedProducts.push({
        product_id: productId,
        refreshed_images: productImages.length,
        caption_model_version: productImages[0]?.caption_model_version || "",
        ai_refreshed_at: refreshedAt,
        images: productImages
      });
    } catch (error) {
      errors.push({ product_id: productId, error: error.message || "Product refresh failed." });
    }
  }

  if (refreshedImages.length) {
    const refreshedMap = new Map(refreshedImages.map((image) => [image.image_id || image.image_url, image]));
    const mergedImages = (index.images || []).map((image) => {
      const key = image.image_id || image.image_url;
      return refreshedMap.get(key) || image;
    });
    const indexedBrands = [...new Set(mergedImages.map((image) => image.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const indexedCategories = [...new Set(mergedImages.map((image) => image.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const indexedProducts = new Set(mergedImages.map((image) => image.product_id)).size;

    const output = {
      ...index,
      generated_at: new Date().toISOString(),
      provider: "openai",
      totals: {
        products: indexedProducts,
        images: mergedImages.length
      },
      brands: indexedBrands.length ? indexedBrands : catalog.brands,
      categories: indexedCategories.length ? indexedCategories : catalog.categories,
      images: mergedImages
    };

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

function buildBrowseResults(catalog, index, limit = Infinity, sort = "auto") {
  const indexedByProductId = new Map();

  for (const image of index?.images || []) {
    if (!indexedByProductId.has(image.product_id)) {
      indexedByProductId.set(image.product_id, []);
    }
    indexedByProductId.get(image.product_id).push(image);
  }

  return (catalog?.products || [])
    .map((product) => {
      const indexedImages = indexedByProductId.get(product.product_id) || [];
      const primaryIndexedImage = indexedImages[0] || null;
      const catalogImageUrls = Array.isArray(product.image_urls) ? product.image_urls.filter(Boolean) : [];
      const imageUrls = indexedImages.length
        ? indexedImages.map((image) => image.image_url).filter(Boolean)
        : catalogImageUrls.length
          ? catalogImageUrls
          : [product.product_image].filter(Boolean);

      return {
        product_id: product.product_id,
        name: product.name,
        brand: product.brand,
        category: product.primary_category || product.category || product.designer_category || "",
        ai_refreshed_at: primaryIndexedImage?.ai_refreshed_at || primaryIndexedImage?.generated_at || "",
        best_image_url: primaryIndexedImage?.image_url || imageUrls[0] || "",
        image_urls: imageUrls,
        score: 1,
        matched_traits: primaryIndexedImage
          ? (primaryIndexedImage.visual_traits?.material_details || [])
              .concat(primaryIndexedImage.visual_traits?.notable_features || [])
              .concat(primaryIndexedImage.visual_traits?.dominant_materials || [])
              .filter(Boolean)
              .slice(0, 3)
          : [],
        debug: {
          structured_caption: primaryIndexedImage?.structured_caption || "",
          visual_description: primaryIndexedImage?.structured_caption || "",
          visual_highlights: primaryIndexedImage?.visual_highlights || [],
          detected_traits: primaryIndexedImage
            ? formatDetectedTraits(primaryIndexedImage.image_traits, primaryIndexedImage.seating_type, 6)
            : []
        },
        image_count: imageUrls.length
      };
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
  const url = new URL(request.url, "http://localhost");

  if (url.pathname === "/eval") {
    return serveStatic("/eval.html", response);
  }

  if (url.pathname === "/api/health") {
    return json(response, 200, { ok: true });
  }

  if (url.pathname === "/api/bootstrap") {
    const [{ catalog, index }, seatingTypes] = await Promise.all([loadCatalog(), loadSeatingTypes()]);
    return json(response, 200, {
      has_index: Boolean(index?.images?.length),
      seed_queries: seedQueries,
      brands: catalog?.brands || [],
      categories: catalog?.categories || [],
      stats: catalog?.totals || { products: 0, images: 0 },
      image_analysis_available: Boolean(process.env.OPENAI_API_KEY),
      ranking_rules: getRankingRulesSummary(),
      seating_types: seatingTypes
    });
  }

  if (url.pathname === "/api/search") {
    const { catalog, index } = await loadCatalog();

    const body = request.method === "POST" ? await readRequestJson(request) : {};
    const query = String((request.method === "POST" ? body.q : url.searchParams.get("q")) || "").trim();
    const matchMode = String((request.method === "POST" ? body.match_mode : url.searchParams.get("match_mode")) || "balanced").trim();
    const sourceImageUrl = String((request.method === "POST" ? body.source_image_url : url.searchParams.get("source_image_url")) || "").trim();
    const sort = String((request.method === "POST" ? body.sort : url.searchParams.get("sort")) || "auto").trim();
    const imageAnalysis = body.image_analysis && typeof body.image_analysis === "object" ? body.image_analysis : null;
    const selectedBullets = normalizeStructuredBullets(body.selected_bullets);
    if (!query) {
      const results = buildBrowseResults(catalog, index, Infinity, sort);
      return json(response, 200, {
        query,
        sort,
        parsed: {
          category: null,
          brand: null,
          visual_query: "",
          query_traits: null
        },
        total_results: results.length,
        browse_mode: true,
        results
      });
    }

    if (!index?.images?.length) {
      return json(response, 409, {
        error: "Search index not found. Browsing works from the catalog, but visual search needs `npm run index`."
      });
    }

    const parsed = await parseSearchQuery(query, index.brands || [], {
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.QUERY_MODEL
    });
    const queryEmbedding = await resolveQueryEmbedding({
      query,
      imageAnalysis,
      selectedBullets,
      apiKey: process.env.OPENAI_API_KEY
    });
    const searchResponse = await searchIndex({
      query,
      parsed,
      index,
      sourceImageUrl,
      sort,
      imageAnalysis,
      selectedBullets,
      queryEmbedding,
      apiKey: process.env.OPENAI_API_KEY
    });
    const results = searchResponse.results;

    return json(response, 200, {
      query,
      sort,
      match_mode: matchMode,
      source_image_url: sourceImageUrl,
      parsed,
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
      const selectedBullets = normalizeStructuredBullets(body.selected_bullets);
      const seatingType = String(body.seating_type || "").trim();
      const action = String(body.action || "").trim();
      const productId = String(body.product_id || "").trim();

      if (!queryEmbedding.length) {
        return json(response, 400, { error: "query_embedding is required." });
      }
      let blendedQueryEmbedding = normalizeEmbedding(queryEmbedding);

      if (action || productId) {
        if (!productId) {
          return json(response, 400, { error: "product_id is required." });
        }
        if (!["more", "less"].includes(action)) {
          return json(response, 400, { error: "action must be 'more' or 'less'." });
        }

        const targetRecord = (index.images || []).find((record) => record.product_id === productId);
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
      const imageAnalysis = seatingType
        ? { stage1: { seating_type: seatingType } }
        : null;
      const searchResponse = await searchIndex({
        query: "",
        parsed,
        index,
        sort: "auto",
        imageAnalysis,
        selectedBullets,
        queryEmbedding: blendedQueryEmbedding,
        apiKey: process.env.OPENAI_API_KEY
      });
      const results = searchResponse.results;

      return json(response, 200, {
        action,
        product_id: productId,
        query_embedding: blendedQueryEmbedding,
        parsed,
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
      const [judgments, decisions] = await Promise.all([
        readJson(evalJudgmentsPath, []),
        readJson(traitSuggestionDecisionsPath, [])
      ]);
      const report = buildTraitSuggestionReport(judgments, decisions);
      const snapshot = {
        exported_at: new Date().toISOString(),
        trait_suggestion_report: {
          generated_at: report.generated_at,
          corrected_judgments: report.corrected_judgments,
          note: report.note,
          suggestions: report.suggestions.map((entry) => ({
            trait: entry.trait,
            direction: entry.direction,
            proposed_weight: entry.proposed_weight,
            evidence: entry.evidence,
            net_score: entry.net_score,
            weighted_up: entry.weighted_up,
            weighted_down: entry.weighted_down,
            raw_up: entry.up_count,
            raw_down: entry.down_count,
            query_aligned_up: entry.query_aligned_up_count,
            query_aligned_down: entry.query_aligned_down_count,
            status: entry.status
          }))
        },
        eval_judgments: Array.isArray(judgments) ? judgments : [],
        reranker_trait_decisions: Array.isArray(decisions) ? decisions : []
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

  if (url.pathname === "/api/reranker-trait-report" && request.method === "GET") {
    try {
      const [judgments, decisions] = await Promise.all([
        readJson(evalJudgmentsPath, []),
        readJson(traitSuggestionDecisionsPath, [])
      ]);
      return json(response, 200, buildTraitSuggestionReport(judgments, decisions));
    } catch (error) {
      return json(response, 500, { error: error.message || "Trait report unavailable." });
    }
  }

  if (url.pathname === "/api/reranker-trait-decision" && request.method === "POST") {
    try {
      const body = await readRequestJson(request);
      const trait = String(body.trait || "").trim();
      const status = String(body.status || "").trim().toLowerCase();
      if (!trait) {
        return json(response, 400, { error: "trait is required." });
      }
      if (!["approved", "rejected", "pending"].includes(status)) {
        return json(response, 400, { error: "status must be approved, rejected, or pending." });
      }

      const [decisions, judgments] = await Promise.all([
        readJson(traitSuggestionDecisionsPath, []),
        readJson(evalJudgmentsPath, [])
      ]);
      const nextDecision = {
        trait,
        status,
        direction: String(body.direction || "").trim(),
        proposed_weight: Number(body.proposed_weight || 0),
        evidence: Number(body.evidence || 0),
        net_score: Number(body.net_score || 0),
        decided_at: new Date().toISOString()
      };
      const nextDecisions = (Array.isArray(decisions) ? decisions : []).filter((entry) => String(entry?.trait || "") !== trait);
      nextDecisions.push(nextDecision);
      await writeJson(traitSuggestionDecisionsPath, nextDecisions);

      return json(response, 200, {
        ok: true,
        report: buildTraitSuggestionReport(judgments, nextDecisions)
      });
    } catch (error) {
      return json(response, 500, { error: error.message || "Failed to save trait decision." });
    }
  }

  if (url.pathname === "/api/analyze-image" && request.method === "POST") {
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

      if (!imageSource) {
        return json(response, 400, { error: "Upload an image file or paste an image URL to analyze." });
      }

      if (!process.env.OPENAI_API_KEY) {
        return json(response, 409, { error: "Image analysis requires OPENAI_API_KEY on the local server." });
      }

      const analysis = await analyzeInspirationImage(imageSource, {
        provider: "openai",
        apiKey: process.env.OPENAI_API_KEY,
        visionModel: process.env.VISION_MODEL,
        fileName,
        matchMode,
        focusArea
      });

      return json(response, 200, {
        analysis: {
          ...analysis,
          image_preview_url: imageSource
        }
      });
    } catch (error) {
      return json(response, 500, { error: error.message || "Image analysis failed." });
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
        images: refreshedImages
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

  if (url.pathname === "/api/compose-query" && request.method === "POST") {
    try {
      const body = await readRequestJson(request);
      const bullets = normalizeStructuredBullets(body.bullets);
      const seatingType = String(body.seating_type || "seating").trim() || "seating";
      const query = await generateSearchQuery(seatingType, bullets, {
        apiKey: process.env.OPENAI_API_KEY,
        visionModel: process.env.VISION_MODEL
      });
      return json(response, 200, { query });
    } catch (error) {
      return json(response, 500, { error: error.message || "Query composition failed." });
    }
  }

  return serveStatic(url.pathname, response);
});

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";

await loadLocalEnv();

server.listen(port, host, () => {
  console.log(`Image Search prototype running at http://${host}:${port}`);
});
