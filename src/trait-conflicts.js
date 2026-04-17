const HIGH_WEIGHT_FIELDS = new Set([
  "body_construction",
  "arm_configuration",
  "configuration",
  "back_height",
  "base_visibility"
]);

const FIELD_PRIORITY = new Map([
  ["base_visibility", 100],
  ["body_construction", 90],
  ["arm_configuration", 80],
  ["configuration", 70],
  ["back_height", 60]
]);

const VISIBLE_BASE_PHRASES = [
  "four-pronged",
  "four pronged",
  "four-prong",
  "four prong",
  "four-star",
  "star base",
  "distinct base",
  "visible base",
  "chrome base",
  "wood base",
  "metal base",
  "powder coat base",
  "pedestal",
  "splayed",
  "sled",
  "legs"
];

const CONCEALED_BASE_PHRASES = [
  "no visible legs",
  "visually absorbed",
  "concealed base",
  "floating",
  "integrated base"
];

function normalizeText(value = "") {
  return String(value || "").trim().toLowerCase();
}

function extractTextSources(imageAnalysis = {}) {
  const visualSummary = String(
    imageAnalysis?.stage2?.visual_summary ||
    imageAnalysis?.visual_summary ||
    imageAnalysis?.free_text?.visual_summary ||
    ""
  ).trim();
  const structuredCaption = String(
    imageAnalysis?.structured_caption ||
    imageAnalysis?.stage3?.structured_caption ||
    imageAnalysis?.free_text?.structured_caption ||
    ""
  ).trim();

  return {
    visualSummary,
    structuredCaption,
    combined: `${visualSummary} ${structuredCaption}`.trim()
  };
}

function findEvidence(text = "", phrases = []) {
  const sourceText = String(text || "").trim();
  const haystack = normalizeText(sourceText);
  if (!haystack || !sourceText) {
    return "";
  }

  const ordered = [...phrases].sort((a, b) => b.length - a.length);
  for (const phrase of ordered) {
    const needle = normalizeText(phrase);
    const index = needle ? haystack.indexOf(needle) : -1;
    if (index !== -1) {
      return sourceText.slice(index, index + needle.length) || phrase;
    }
  }
  return "";
}

function getFieldConfidence(imageAnalysis = {}, field = "") {
  const normalizedField = String(field || "").trim();
  if (!normalizedField) {
    return "";
  }

  const imageTraitConfidence = imageAnalysis?.field_confidence?.image_traits;
  const directConfidence = imageAnalysis?.field_confidence;

  return normalizeText(
    imageTraitConfidence?.[normalizedField] ||
    directConfidence?.[normalizedField] ||
    imageAnalysis?.confidence?.[normalizedField] ||
    ""
  );
}

function buildBaseVisibilityConflict(extractedValue, conflictType, evidence = "") {
  return {
    field: "base_visibility",
    extracted_value: extractedValue,
    conflict_type: conflictType,
    evidence,
    clarification_question: "We weren't sure about the base on this chair — which best describes it?",
    options: [
      { label: "Concealed / integrated", value: "integrated" },
      { label: "Visible base", value: "exposed" }
    ]
  };
}

function detectBaseVisibilityTextConflict(imageAnalysis = {}) {
  const enumFields = imageAnalysis?.image_traits || imageAnalysis?.stage3?.image_traits || {};
  const extractedValue = normalizeText(enumFields?.base_visibility);
  if (!extractedValue) {
    return [];
  }

  const { visualSummary, structuredCaption, combined } = extractTextSources(imageAnalysis);
  const conflicts = [];

  if (extractedValue === "integrated") {
    const evidence = findEvidence(combined, VISIBLE_BASE_PHRASES);
    if (evidence) {
      conflicts.push(buildBaseVisibilityConflict(extractedValue, "text_contradicts_enum", evidence));
    }
  }

  if (extractedValue === "exposed") {
    const evidence = findEvidence(`${visualSummary} ${structuredCaption}`.trim(), CONCEALED_BASE_PHRASES);
    if (evidence) {
      conflicts.push(buildBaseVisibilityConflict(extractedValue, "text_contradicts_enum", evidence));
    }
  }

  return conflicts;
}

function detectLowConfidenceHighWeightConflict(imageAnalysis = {}) {
  const enumFields = imageAnalysis?.image_traits || imageAnalysis?.stage3?.image_traits || {};
  const conflicts = [];

  for (const field of HIGH_WEIGHT_FIELDS) {
    if (!enumFields?.[field]) {
      continue;
    }
    if (getFieldConfidence(imageAnalysis, field) !== "low") {
      continue;
    }
    if (field === "base_visibility") {
      conflicts.push(buildBaseVisibilityConflict(normalizeText(enumFields[field]), "low_confidence_high_weight", ""));
    }
  }

  return conflicts;
}

const CONFLICT_DETECTORS = [
  detectBaseVisibilityTextConflict,
  detectLowConfidenceHighWeightConflict
];

function compareConflicts(left, right) {
  const leftField = FIELD_PRIORITY.get(left?.field) || 0;
  const rightField = FIELD_PRIORITY.get(right?.field) || 0;
  if (leftField !== rightField) {
    return rightField - leftField;
  }

  const leftType = left?.conflict_type === "text_contradicts_enum" ? 2 : 1;
  const rightType = right?.conflict_type === "text_contradicts_enum" ? 2 : 1;
  return rightType - leftType;
}

export function detectTraitTextConflicts(imageAnalysis = {}) {
  const conflicts = [];
  for (const detector of CONFLICT_DETECTORS) {
    const detected = detector(imageAnalysis);
    if (Array.isArray(detected) && detected.length) {
      conflicts.push(...detected);
    }
  }
  return conflicts.sort(compareConflicts);
}

export function getHighestPriorityConflict(imageAnalysis = {}) {
  return detectTraitTextConflicts(imageAnalysis)[0] || null;
}
