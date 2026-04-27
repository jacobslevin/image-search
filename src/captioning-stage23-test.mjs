import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  embedTextWithOpenAi,
  getEffectiveClassification,
  getPixelSeekType,
  normalizeImageClassification,
  normalizeWhitespace,
  readJson,
  sentenceCase,
  tokenize,
  uniqueStrings
} from "./utils.js";
import { extractQueryTraits } from "./query-traits.js";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const seatingTypesPath = path.join(__dirname, "..", "data", "seating-types.json");
const pdfExtractPath = path.join(__dirname, "..", "data", "pdf-text-extract.json");

const seatingTypesConfig = JSON.parse(fs.readFileSync(seatingTypesPath, "utf8"));
const seatingTypes = seatingTypesConfig.types || {};
const defaultSeatingType = seatingTypesConfig.default_type || "other_seating";
const stage1SeatingTypeEnum = [
  "task_collab_chair",
  "lounge_chair",
  "stool",
  "guest_chair",
  "bench",
  "other_seating"
];
const stage1ResultEnum = ["product", "product_detail", "scene"];
const stage0ResultEnum = ["product", "scene", "product_detail"];
const GPT_41_INPUT_COST_PER_TOKEN = 2 / 1_000_000;
const GPT_41_OUTPUT_COST_PER_TOKEN = 8 / 1_000_000;
const GPT_41_NANO_INPUT_COST_PER_TOKEN = 0.10 / 1_000_000;
const GPT_41_NANO_OUTPUT_COST_PER_TOKEN = 0.40 / 1_000_000;
const PIXELSEEK_TYPE_TO_ROUTING_KEY = Object.freeze({
  "Lounge Seating": "lounge_chair",
  "Multi-Use / Guest Chairs": "guest_chair",
  "Work Chairs": "task_collab_chair",
  "Stools": "stool",
  "Benches": "bench"
});

function buildImageDimensionFields(dimensions = null) {
  const width = Number(dimensions?.width);
  const height = Number(dimensions?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return {
      image_width: null,
      image_height: null,
      image_short_side: null
    };
  }

  return {
    image_width: width,
    image_height: height,
    image_short_side: Math.min(width, height)
  };
}

function buildClassificationFields({
  stage0Result = "",
  stage1Override = false,
  stage1OverrideResult = "",
  stage1OverrideReason = null,
  stage1 = {}
} = {}) {
  const normalizedStage0Result = normalizeImageClassification(stage0Result);
  const normalizedOverrideResult = normalizeImageClassification(stage1OverrideResult);
  const effectiveClassification = getEffectiveClassification({
    stage_0_result: normalizedStage0Result,
    stage_1_override_result: normalizedOverrideResult,
    stage1
  });

  return {
    stage_0_result: normalizedStage0Result,
    stage_1_override: Boolean(stage1Override),
    stage_1_override_result: normalizedOverrideResult,
    stage_1_override_reason: stage1OverrideReason || null,
    effective_classification: effectiveClassification
  };
}

function buildEmptyStage23Payload() {
  return {
    stage2: {
      silhouette: "",
      proportions: "",
      structure_type: "",
      back_geometry: "",
      seat_geometry: "",
      arm_geometry: "",
      surface_language: "",
      design_register: "",
      distinctive_elements: [],
      visual_summary: ""
    },
    stage3: {
      structured_caption: "",
      raw_visual_highlights: [],
      image_traits: {}
    }
  };
}

function buildStage1OverrideVoteResult(result = "", overrideReason = null, confidence = "low") {
  const normalizedResult = normalizeStage1Result(result);
  return {
    stage1: {
      result: normalizedResult,
      seating_type: "",
      override_reason: overrideReason || null
    },
    ...buildEmptyStage23Payload(),
    field_confidence: {
      stage1: {
        result: confidence,
        seating_type: 0
      },
      stage2: {
        design_register: 0
      },
      stage3: {
        image_traits: {}
      },
      image_traits: {}
    }
  };
}

function buildExcludedImageExtractionResult({
  baseRecord = {},
  categories = {},
  stage0Result = "",
  stage1OverrideResult = "",
  stage1OverrideReason = null,
  stage1 = {},
  tokens = {},
  cost = {},
  extractionTimestamp = "",
  imageDimensions = null,
  tiebreakerTriggered = false
} = {}) {
  return {
    ...baseRecord,
    ...categories,
    ...buildClassificationFields({
      stage0Result,
      stage1Override: Boolean(stage1OverrideResult),
      stage1OverrideResult,
      stage1OverrideReason,
      stage1
    }),
    seating_type: "",
    enum_fields: {},
    field_confidence: {},
    free_text: {},
    tiebreaker_triggered: tiebreakerTriggered,
    confidence_tier: "low",
    tokens,
    cost,
    extraction_timestamp: extractionTimestamp,
    excluded: true,
    image_traits: {},
    visual_summary: "",
    structured_caption: "",
    stage1,
    stage2: { visual_summary: "" },
    visual_summary_embedding: [],
    search_text: "",
    search_text_embedding: [],
    ...buildImageDimensionFields(imageDimensions)
  };
}

const LEGACY_TRAIT_DEFAULTS = {
  product_type: "",
  seating_category_visual: "",
  application_type: "",
  subject_prominence: "",
  dominant_color: "",
  secondary_colors: [],
  base_type: "",
  base_material: "",
  base_visibility: "",
  shape_character: "",
  plan_shape: "",
  base_finish: "",
  leg_material: "",
  leg_style: "",
  glide_type: "",
  caster_present: false,
  frame_material: "",
  frame_finish: "",
  shell_material: "",
  body_construction: "",
  shell_finish: "",
  arm_type: "",
  arm_material: "",
  arm_pad_present: false,
  arm_adjustability: "",
  back_construction: "",
  back_support_type: "",
  headrest_present: false,
  headrest_type: "",
  swivel_present: false,
  tilt_present: false,
  seat_material: "",
  back_material: "",
  upholstery_coverage: "",
  top_material: "",
  top_shape: "",
  dominant_materials: [],
  secondary_materials: [],
  minor_materials: [],
  material_details: [],
  notable_features: []
};

const TYPE_LABEL_TO_KEY = Object.entries(seatingTypes).reduce((acc, [key, value]) => {
  acc[String(value.label || "").toLowerCase()] = key;
  return acc;
}, {});

let pdfExtractCache = null;
export const MATCHING_SAFE_MIN_SHORT_SIDE = 591;

const LOUNGE_CHAIR_SHAPE_RULES = `- For lounge_chair shape_character: classify the overall silhouette character as either "Soft / tapered" or "Boxy". Use "Soft / tapered" if any major structural component curves, if the overall body or shell is curved, if the form deliberately tapers in straight lines as a design feature, or if the corners dissolve into generous arcs rather than retaining visible corner points. Use "Boxy" only when the back edge is straight, the arms are straight, the overall body is rectilinear with consistent width and depth, and the corners still read as visible corners. Ignore camera perspective and evaluate only the major structural components, not cushions, seams, or accessory details.
- For lounge_chair plan_shape: classify the plan view shape of this piece using this exact decision tree. Imagine looking straight down at the piece from above.
  Step 2 — Check for round / semicircular:
  Is the back edge of the piece curved rather than a straight line across? If yes, the plan footprint is round or semicircular — the back wraps rather than running straight. Classify as Round / semicircular and stop. Do not attempt width comparison on curved forms.
  Step 3 — Compare front width to back width:
  For pieces with a straight back edge, estimate the width of the piece at the front (seat front edge) versus the width at the back (back panel) when viewed from above:
  - Width at back roughly equal to width at front → Square / rectangular (sides run parallel)
  - Width at back narrower than width at front → Trapezoidal (piece widens toward the front, arms splay outward)
  - Width at back wider than width at front → Reverse trapezoidal (piece widens toward the back)
  If the photo angle makes it impossible to reliably determine the plan shape, return unknown.
  Return JSON only:
  {
    reasoning: 'brief explanation of what you observed',
    plan_shape: 'Round / semicircular' or 'Trapezoidal' or 'Reverse trapezoidal' or 'Square / rectangular' or 'unknown'
  }`;

export class ResolutionGateError extends Error {
  constructor(shortSide, width, height) {
    super(`Image rejected: short side ${shortSide}px is below the ${MATCHING_SAFE_MIN_SHORT_SIDE}px matching-safe minimum.`);
    this.name = "ResolutionGateError";
    this.code = "IMAGE_BELOW_MINIMUM_RESOLUTION";
    this.shortSide = shortSide;
    this.width = width;
    this.height = height;
  }
}

export class QueryImageAnalysisStageError extends Error {
  constructor(stage, message, options = {}) {
    super(message);
    this.name = "QueryImageAnalysisStageError";
    this.code = "QUERY_IMAGE_ANALYSIS_STAGE_FAILED";
    this.stage = String(stage || "").trim() || "unknown";
    this.cause = options.cause;
  }
}

function getTypeFields(typeKey) {
  return seatingTypes[typeKey]?.fields || seatingTypes[defaultSeatingType].fields || [];
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

function getTraitFieldConfig(typeKey, fieldName) {
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

function getFieldMap(typeKey) {
  return new Map(getTypeFields(typeKey).map((item) => [item.field, item]));
}

function parseDataUrlImage(imageUrl = "") {
  const match = String(imageUrl || "").match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.*)$/i);
  if (!match) {
    return null;
  }

  const mimeType = String(match[1] || "image/png").toLowerCase();
  const extension = mimeType.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "png";
  return {
    mimeType,
    extension,
    bytes: Buffer.from(match[2], "base64")
  };
}

async function loadImageAsset(imageUrl = "") {
  const inlineAsset = parseDataUrlImage(imageUrl);
  if (inlineAsset) {
    return inlineAsset;
  }

  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to download image (${response.status}) for ${imageUrl}`);
  }

  const mimeType = String(response.headers.get("content-type") || "image/jpeg")
    .split(";")[0]
    .toLowerCase();
  const extension = mimeType.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "jpg";
  return {
    mimeType,
    extension,
    bytes: Buffer.from(await response.arrayBuffer())
  };
}

async function measureImageDimensionsFromSource(imageUrl = "") {
  const asset = await loadImageAsset(imageUrl);
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "image-resolution-"));
  const tempPath = path.join(tempDir, `source.${asset.extension}`);

  try {
    await fs.promises.writeFile(tempPath, asset.bytes);
    const { stdout } = await execFileAsync("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", tempPath]);
    const width = Number((stdout.match(/pixelWidth:\s*(\d+)/) || [])[1] || 0);
    const height = Number((stdout.match(/pixelHeight:\s*(\d+)/) || [])[1] || 0);
    return {
      width,
      height,
      shortSide: Math.min(width || 0, height || 0)
    };
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}

async function enforceMatchingSafeResolution(imageUrl = "", options = {}) {
  const dimensions = await measureImageDimensionsFromSource(imageUrl);
  if (!dimensions.width || !dimensions.height) {
    throw new Error("Failed to determine image dimensions.");
  }

  if (dimensions.shortSide < MATCHING_SAFE_MIN_SHORT_SIDE) {
    const error = new ResolutionGateError(dimensions.shortSide, dimensions.width, dimensions.height);
    if (options.logFailures !== false) {
      console.error(error.message);
    }
    throw error;
  }

  return dimensions;
}

export async function evaluateImageCandidates(imageRecords = [], options = {}) {
  const attempts = [];
  const maxPassing = Number.isFinite(options.maxPassing) ? Number(options.maxPassing) : Infinity;
  const logFailures = options.logFailures !== false;
  let passingCount = 0;

  for (const imageRecord of imageRecords) {
    const imageUrl = String(imageRecord?.image_url || "").trim();
    if (!imageUrl) {
      continue;
    }

    try {
      const dimensions = await enforceMatchingSafeResolution(imageUrl, { logFailures });
      passingCount += 1;
      attempts.push({
        image: imageRecord,
        image_url: imageUrl,
        passed: true,
        dimensions
      });
      if (passingCount >= maxPassing) {
        break;
      }
    } catch (error) {
      if (error instanceof ResolutionGateError) {
        if (!logFailures) {
          error.message = "";
        }
        attempts.push({
          image: imageRecord,
          image_url: imageUrl,
          passed: false,
          dimensions: {
            width: error.width,
            height: error.height,
            shortSide: error.shortSide
          },
          error
        });
        continue;
      }

      attempts.push({
        image: imageRecord,
        image_url: imageUrl,
        passed: false,
        dimensions: null,
        error
      });
    }
  }

  const passed = attempts.filter((attempt) => attempt.passed);
  return {
    totalImages: imageRecords.length,
    checkedCount: attempts.length,
    passingCount: passed.length,
    selectedAttempt: passed[0] || null,
    selectedImage: passed[0]?.image || null,
    selectedDimensions: passed[0]?.dimensions || null,
    attempts
  };
}

function normalizeEnum(value, allowedValues = []) {
  const allowed = new Set((allowedValues || []).map((entry) => String(entry || "").toLowerCase()));
  let raw = String(value ?? "").trim().toLowerCase();
  if (!raw) {
    return allowed.has("unknown") ? "unknown" : "";
  }
  const aliases = new Map([
    ["none - backless", "backless"],
    ["none — backless", "backless"],
    ["non-upholstered", "unupholstered shell"],
    ["unupholstered", "unupholstered shell"],
    ["no visible base / skirted", "skirted / concealed base"],
    ["none visible", "integrated base"],
    ["molded plywood veneer", "molded plywood shell"],
    ["molded plastic", "molded plastic shell"],
    ["aluminum frame / suspended", "suspended / sling"],
    ["upholstered foam", "upholstered"],
    ["fabric wrapped", "upholstered"],
    ["monolithic upholstered shell", "upholstered"],
    ["wrapped shell", "upholstered"],
    ["frame and cushion", "upholstered"],
    ["black enamel", "black"],
    ["natural / wood", "wood"],
    ["natural wood", "wood"],
    ["natural timber", "wood"],
    ["graphite", "painted / powder coat"],
    ["painted color", "painted / powder coat"],
    ["painted finish", "painted / powder coat"],
    ["powder coat", "painted / powder coat"],
    ["white enamel", "painted / powder coat"],
    ["pedestal base", "pedestal"],
    ["square plate / plinth base", "square plate / plinth"],
    ["concealed / integrated base", "integrated base"],
    ["concealed / integrated", "integrated base"],
    ["integrated base", "integrated base"],
    ["concealed", "integrated"],
    ["visible", "exposed"],
    ["no arms", "armless"],
    ["without arms", "armless"],
    ["open arms", "open arm"],
    ["open-arm", "open arm"],
    ["closed arms", "closed arm"],
    ["closed-arm", "closed arm"],
    ["integrated arms", "integrated"],
    ["integrated arm", "integrated"],
    ["exposed shell / no upholstery", "unupholstered shell"],
    ["plastic back", "plastic back"],
    ["mesh / net back", "mesh / net"],
    ["upholstered back", "upholstered"],
    ["knit back", "knit"],
    ["angled perch", "angled / perch"],
    ["perch", "angled / perch"],
    ["perch seat", "angled / perch"],
    ["wobble", "wobble / balance"],
    ["balance", "wobble / balance"],
    ["balance stool", "wobble / balance"],
    ["rounded", "rounded / curved"],
    ["curved", "rounded / curved"],
    ["angular", "square / angular"],
    ["square", "square / angular"],
    ["casters", "casters"],
    ["fabric (specify category)", "fabric"],
    ["com", "unknown"],
    ["col", "unknown"]
  ]);
  raw = aliases.get(raw) || raw;
  if (raw === "unknown") {
    return "unknown";
  }
  if (allowed.has(raw)) {
    return raw;
  }
  if (raw === "true" && allowed.has("yes")) return "yes";
  if (raw === "false" && allowed.has("no")) return "no";
  return allowed.has("unknown") ? "unknown" : "";
}

function ensureTypeKey(candidate) {
  const raw = String(candidate || "").trim().toLowerCase();
  if (seatingTypes[raw]) return raw;
  if (TYPE_LABEL_TO_KEY[raw]) return TYPE_LABEL_TO_KEY[raw];
  return defaultSeatingType;
}

function normalizeStage1Result(result = "") {
  const normalized = String(result || "").trim().toLowerCase();
  return stage1ResultEnum.includes(normalized) ? normalized : "product";
}

function isStage1OverrideResult(stage1 = {}) {
  return ["product_detail", "scene"].includes(normalizeStage1Result(stage1?.result));
}

function isStage1ProductDetail(stage1 = {}) {
  return normalizeStage1Result(stage1?.result) === "product_detail";
}

function isStage1Scene(stage1 = {}) {
  return normalizeStage1Result(stage1?.result) === "scene";
}

function classifySeatingTypeHeuristic(context = "") {
  const value = String(context || "").toLowerCase();
  if (/task|office|ergonomic|lumbar|headrest|executive chair|collaborative|conference chair|meeting chair|stacking chair|nesting chair/.test(value)) return "task_collab_chair";
  if (/guest|side chair|multi-use|multipurpose/.test(value)) return "guest_chair";
  if (/lounge|club|accent/.test(value)) return "lounge_chair";
  if (/stool|counter stool|bar stool|perch|active stool|wobble|balance stool|saddle stool/.test(value)) return "stool";
  if (/bench/.test(value)) return "bench";
  return defaultSeatingType;
}

function classifySchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      result: {
        type: "string",
        enum: stage1ResultEnum
      },
      override_reason: {
        type: "string"
      },
      seating_type: {
        type: "string",
        enum: [...stage1SeatingTypeEnum, ""]
      }
    },
    required: ["result", "override_reason", "seating_type"]
  };
}

function stage0Schema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      result: {
        type: "string",
        enum: stage0ResultEnum
      }
    },
    required: ["result"]
  };
}

function visualDescriptionSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      silhouette: { type: "string" },
      proportions: { type: "string" },
      structure_type: { type: "string" },
      back_geometry: { type: "string" },
      seat_geometry: { type: "string" },
      arm_geometry: { type: "string" },
      surface_language: { type: "string" },
      design_register: {
        type: "string",
        enum: ["minimal", "organic", "industrial", "traditional", "sculptural", "utilitarian"]
      },
      distinctive_elements: {
        type: "array",
        items: { type: "string" }
      },
      visual_summary: { type: "string" }
    },
    required: [
      "silhouette",
      "proportions",
      "structure_type",
      "back_geometry",
      "seat_geometry",
      "arm_geometry",
      "surface_language",
      "design_register",
      "distinctive_elements",
      "visual_summary"
    ]
  };
}

function combinedStage23SchemaForType(typeKey) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      ...visualDescriptionSchema().properties,
      reasoning: { type: "string" },
      structured_caption: { type: "string" },
      raw_visual_highlights: {
        type: "array",
        items: { type: "string" }
      },
      image_traits: extractionSchemaForType(typeKey).properties.image_traits
    },
    required: [
      ...visualDescriptionSchema().required,
      "reasoning",
      "structured_caption",
      "raw_visual_highlights",
      "image_traits"
    ]
  };
}

function extractionSchemaForType(typeKey) {
  const fields = getTypeFields(typeKey).filter((entry) => entry.detectability !== "no");
  const traitProperties = {};
  const required = [];

  for (const field of fields) {
    traitProperties[field.field] = {
      type: "string",
      enum: field.allowed_values
    };
    required.push(field.field);
  }

  return {
    type: "object",
    additionalProperties: false,
    properties: {
      reasoning: { type: "string" },
      structured_caption: { type: "string" },
      raw_visual_highlights: {
        type: "array",
        items: { type: "string" }
      },
      image_traits: {
        type: "object",
        additionalProperties: false,
        properties: traitProperties,
        required
      }
    },
    required: ["reasoning", "structured_caption", "raw_visual_highlights", "image_traits"]
  };
}

function buildUnifiedDetectableFieldMap() {
  const merged = new Map();

  for (const [typeKey, typeConfig] of Object.entries(seatingTypes)) {
    for (const field of typeConfig?.fields || []) {
      if (field.detectability === "no") {
        continue;
      }

      const existing = merged.get(field.field) || {
        field: field.field,
        allowed_values: new Set(),
        typeKeys: new Set()
      };

      for (const value of field.allowed_values || []) {
        existing.allowed_values.add(String(value));
      }
      existing.typeKeys.add(typeKey);
      merged.set(field.field, existing);
    }
  }

  return merged;
}

function consolidatedAttributeSchema() {
  const unifiedFields = buildUnifiedDetectableFieldMap();
  const properties = {};

  for (const [fieldName, config] of [...unifiedFields.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    properties[fieldName] = {
      type: "string",
      enum: [...config.allowed_values].sort((a, b) => a.localeCompare(b))
    };
  }

  return {
    type: "object",
    additionalProperties: false,
    properties
  };
}

function consolidatedExtractionSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      result: {
        type: "string",
        enum: stage1ResultEnum
      },
      override_reason: {
        type: "string"
      },
      seating_type: {
        type: "string",
        enum: stage1SeatingTypeEnum
      },
      visual_form: {
        type: "string"
      },
      attributes: consolidatedAttributeSchema()
    },
    required: ["result"],
    anyOf: [
      {
        properties: {
          result: { const: "product" }
        },
        required: ["result", "seating_type", "visual_form", "attributes"]
      },
      {
        properties: {
          result: { const: "product_detail" }
        },
        required: ["result", "override_reason"]
      },
      {
        properties: {
          result: { const: "scene" }
        },
        required: ["result", "override_reason"]
      }
    ]
  };
}

function buildPerTypeFieldGuide() {
  return Object.entries(seatingTypes)
    .map(([typeKey, typeConfig]) => {
      const fields = getTypeFields(typeKey).filter((entry) => entry.detectability !== "no");
      const fieldLines = fields
        .map((entry) => {
          const valueDefinitions = entry.value_definitions && typeof entry.value_definitions === "object"
            ? Object.entries(entry.value_definitions)
              .map(([value, definition]) => `${value}: ${definition}`)
              .join("; ")
            : "";
          return `  - ${entry.field} (photo-detectable: ${String(entry.detectability || "").toUpperCase()}) => [${entry.allowed_values.join(", ")}]${valueDefinitions ? `\n    definitions: ${valueDefinitions}` : ""}`;
        })
        .join("\n");
      return `${typeConfig.label} (${typeKey})\n${fieldLines}`;
    })
    .join("\n\n");
}

function buildFieldGuideForType(typeKey) {
  const typeConfig = seatingTypes[typeKey] || seatingTypes[defaultSeatingType];
  const fields = getTypeFields(typeKey).filter((entry) => entry.detectability !== "no");
  const fieldLines = fields
    .map((entry) => {
      const valueDefinitions = entry.value_definitions && typeof entry.value_definitions === "object"
        ? Object.entries(entry.value_definitions)
          .map(([value, definition]) => `${value}: ${definition}`)
          .join("; ")
        : "";
      return `- ${entry.field} (photo-detectable: ${String(entry.detectability || "").toUpperCase()}) => [${entry.allowed_values.join(", ")}]${valueDefinitions ? `\n  definitions: ${valueDefinitions}` : ""}`;
    })
    .join("\n");
  return `${typeConfig.label} (${typeKey})\n${fieldLines}`;
}

export function consolidatedStage123Prompt() {
  return `You are a furniture vision analyst. Analyze the primary seating product in one image and reason through the steps internally in order.

Step 1: First decide whether this is a product_detail shot.
- Before category classification, determine whether at least approximately 75% of the full product is visible.
- Check specifically:
  - Is the base visible?
- Is the full silhouette of the product visible?
- Is this a close-up of a single component such as fabric, stitching, an arm, a leg, or a headrest?
- If less than approximately 75% of the full product is visible, return "result": "product_detail" plus an "override_reason" that briefly explains why this is a detail shot, then stop. Do not classify seating_type. Do not fill visual_form. Do not fill attributes.

Step 2: If this is not a product_detail shot, assess whether the image should be treated as a scene.
- If more than one seating product is substantially visible and the non-primary seating is not just faint background presence, return scene.
- Do not call it scene merely because it is photographed in a real room. A hero shot in a real room is still product if one seating product is clearly dominant and the room is secondary.
- If this is a scene, return "result": "scene" plus an "override_reason" that briefly explains why this is a scene, then stop. Do not classify seating_type. Do not fill visual_form. Do not fill attributes.

Step 3: Determine the seating_type when result is product.
- Choose exactly one seating_type from this enum:
  [${stage1SeatingTypeEnum.join(", ")}]
- Use catalog context only as a disambiguation hint, never as an override.

Step 4: Based on that seating_type, write visual_form.
- visual_form must be a concise but information-dense paragraph describing only the primary seating product's visible form.
- Focus on silhouette, proportions, support structure, back geometry, seat geometry, arm geometry, surface character, and distinctive visual elements.
- Ignore room context, secondary objects, styling props, people, and brand/model names.
- State structural absences explicitly when relevant, such as armless or backless.
- Never infer material from color alone.

Step 5: Based on both seating_type and visual_form, fill attributes.
- Include only the photo-detectable attributes relevant to the chosen seating_type.
- Use only fields defined for that seating_type below.
- Only fill fields marked YES. Fill MAYBE only if clearly visible.
- If a relevant trait is not visible or not applicable, use "unknown".
- If a feature is structurally absent, use "none" rather than "unknown" when "none" is an allowed value.
- Never invent values outside the allowed enums.
- Ignore spec-only traits and any field not listed for the selected seating_type.

Special rules:
- For lounge_chair body_construction: use "Upholstered" for any upholstered lounge chair body, including both continuous shell forms and traditional frame-and-cushion constructions. Use "Panel / privacy enclosure" for high side-panel lounge forms that enclose the user above shoulder or head level.
- For lounge_chair base_type: use "Integrated base" when the base is visually absorbed into the shell with no discrete leg structure. Use "Pedestal" for a central column or star base, "Square plate / plinth" for a square or plate-like base, "4-leg" for four discrete legs, "Sled" for a continuous sled frame, and "Casters" only when visible wheels are present.
- For lounge_chair base_finish: classify only the visible finish of the base or support structure using [Black, Polished aluminum, Wood, Painted / powder coat].
- For lounge_chair seat_upholstery: use "None / unupholstered" only when the visible seat surface is bare plastic, wood, or another molded hard surface rather than upholstered.
- ${LOUNGE_CHAIR_SHAPE_RULES}
- For stool: the back field refers to presence of a physical backrest. A backless stool must return "Backless". Use seat_geometry "Flat" for standard flat seats, "Angled / perch" for forward-tilted perch seats, "Saddle" for saddle seats, and "Wobble / balance" for active stools designed to flex or rock.
- For task_collab_chair arm_option: visible adjustment hardware means "Adjustable arms", not fixed.
- For task_collab_chair back_profile: use "Rounded / curved" for visibly curved or softened backs and "Square / angular" for rectilinear backs.
- For task_collab_chair base_finish: classify the visible base finish/color using [Black, White, Polished aluminum, Painted color, Natural wood].
- For task_collab_chair frame: return "Plastic" only when the visible structural frame is visibly and predominantly plastic with no visible metal structure.
- For guest_chair arm_option: use "Open arm" for visually open side arms, "Closed arm" for side enclosures, and "Integrated" when the arm flows directly from the shell or frame.
- For guest_chair frame_openness: use "Open / see-through" when the chair body or frame has obvious negative space and "Closed / solid" when it reads as continuous solid surfaces.
- For guest_chair mobility: use "Casters" when wheels are visible on the base. Use "Non-mobile" when wheels are not visible.

Relevant attribute fields by seating type:
${buildPerTypeFieldGuide()}

Return strict JSON only in this shape:
{
  "result": "product" or "product_detail" or "scene",
  "override_reason": "...",
  "seating_type": "...",
  "visual_form": "...",
  "attributes": {
    "...": "..."
  }
}`;
}

async function callOpenAiJson({ apiKey, model, systemPrompt, userParts, schemaName, schema }) {
  const result = await callOpenAiJsonWithMeta({ apiKey, model, systemPrompt, userParts, schemaName, schema });
  return result.data;
}

function normalizeOpenAiUsage(usage = {}) {
  const promptTokens = Number(usage?.input_tokens ?? usage?.prompt_tokens ?? 0) || 0;
  const completionTokens = Number(usage?.output_tokens ?? usage?.completion_tokens ?? 0) || 0;
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens
  };
}

async function callOpenAiJsonWithMeta({ apiKey, model, systemPrompt, userParts, schemaName, schema }) {
  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || 60000);
  const attempts = Number(process.env.OPENAI_MAX_RETRIES || 3);
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          model: model || "gpt-4.1-mini",
          temperature: 0,
          input: [
            {
              role: "system",
              content: [{ type: "input_text", text: systemPrompt }]
            },
            {
              role: "user",
              content: userParts
            }
          ],
          text: {
            format: {
              type: "json_schema",
              name: schemaName,
              strict: true,
              schema
            }
          }
        })
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`OpenAI error ${response.status}: ${errorBody}`);
        throw new Error(`OpenAI request failed with ${response.status}.`);
      }

      const payload = await response.json();
      const outputText = payload.output_text || payload.output?.[0]?.content?.[0]?.text;
      if (!outputText) {
        throw new Error("OpenAI response did not include JSON output.");
      }
      return {
        data: JSON.parse(outputText),
        usage: normalizeOpenAiUsage(payload.usage)
      };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        const backoffMs = Math.min(5000, attempt * 1000);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  throw lastError || new Error("OpenAI request failed.");
}

async function callOpenAiJsonLoose({ apiKey, model, systemPrompt, userParts }) {
  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || 60000);
  const attempts = Number(process.env.OPENAI_MAX_RETRIES || 3);
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          model: model || "gpt-4.1-mini",
          temperature: 0,
          input: [
            {
              role: "system",
              content: [{ type: "input_text", text: systemPrompt }]
            },
            {
              role: "user",
              content: userParts
            }
          ]
        })
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`OpenAI error ${response.status}: ${errorBody}`);
        throw new Error(`OpenAI request failed with ${response.status}.`);
      }

      const payload = await response.json();
      const outputText = String(payload.output_text || payload.output?.[0]?.content?.[0]?.text || "").trim();
      if (!outputText) {
        throw new Error("OpenAI response did not include JSON output.");
      }
      return JSON.parse(outputText);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        const backoffMs = Math.min(5000, attempt * 1000);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  throw lastError || new Error("OpenAI request failed.");
}

export async function generateSearchQuery(seatingType, selectedBullets, options = {}) {
  const normalizePriorityList = (values = []) => [...new Set(
    (values || []).map((value) => String(value || "").trim()).filter(Boolean)
  )];
  const isComposableBullet = (bullet = "") => {
    const text = String(bullet || "").trim();
    const separatorIndex = text.indexOf(":");
    if (separatorIndex === -1) {
      return true;
    }
    const field = text
      .slice(0, separatorIndex)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return field !== "base_material";
  };
  const bulletsByPriority = Array.isArray(selectedBullets)
    ? { essential: [], normal: normalizePriorityList(selectedBullets).filter((bullet) => isComposableBullet(bullet)) }
    : {
        essential: normalizePriorityList(selectedBullets?.essential || []).filter((bullet) => isComposableBullet(bullet)),
        normal: normalizePriorityList(selectedBullets?.normal || []).filter((bullet) => isComposableBullet(bullet))
      };
  const essential = bulletsByPriority.essential;
  const normal = bulletsByPriority.normal;
  const cleanBullets = [...essential, ...normal];

  if (!cleanBullets.length) {
    return "";
  }

  if (!options.apiKey) {
    return cleanBullets.join(", ");
  }

  const response = await callOpenAiJson({
    apiKey: options.apiKey,
    model: options.visionModel,
    systemPrompt: `You are a furniture search query writer. Given a seating type and a list of visual characteristics selected by a user, write a single natural language search query that describes what the user is looking for. 

Rules:
- Write one fluent sentence or short paragraph, not a list
- Sound like a human describing a chair they are looking for
- Lead with the most distinctive visual characteristics
- Do not use field names or technical schema terms
- Never use furniture category or type names in the query. Do not use words like: collaborative, task chair, lounge, guest chair, stool, bench, perch, or any other seating category name. Describe only what is visually observable — form, geometry, materials, and structure.
- Do not mention brand names
- Keep it under 50 words`,
    userParts: [
      {
        type: "input_text",
        text: `Seating type: ${seatingType}

Essential visual characteristics (lead with these, make them the primary focus of the query):
${essential.map((b) => `- ${b}`).join("\n")}

Secondary characteristics (include naturally if space allows):
${normal.map((b) => `- ${b}`).join("\n")}

Write a natural language search query that emphasizes the essential characteristics above all else. The query should read like a human describing exactly what they are looking for. No category names. No brand names. Under 50 words.`
      }
    ],
    schemaName: "search_query",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string" }
      },
      required: ["query"]
    }
  });
  return String(response.query || "").trim();
}

async function classifySeatingTypeOpenAi(imageInput, options = {}) {
  if (!options.apiKey) {
    const heuristic = classifySeatingTypeHeuristic(`${imageInput.catalogContext || ""} ${imageInput.image_url || ""}`);
    return { result: "product", seating_type: heuristic };
  }

  const parsed = await callOpenAiJson({
    apiKey: options.apiKey,
    model: options.visionModel,
    systemPrompt: buildStage1ClassificationPrompt(),
    userParts: [
      ...(imageInput.catalogContext
        ? [{ type: "input_text", text: imageInput.catalogContext }]
        : []),
      { type: "input_image", image_url: imageInput.image_url, detail: "high" }
    ],
    schemaName: "seating_type_classifier",
    schema: classifySchema()
  });

  return normalizeStage1Classification(parsed);
}

function visualDescriptionPrompt() {
  return `You are a furniture visual analyst. Describe the physical form of the primary seating item in the image in precise, searchable language.

Rules:
- Do not name the brand or model under any circumstances.
- Do not describe the room, background, or any secondary objects.
- Focus entirely on the object's visual geometry and material character.
- If the image is a lifestyle or environment shot with multiple objects, focus exclusively on the primary seating product. Ignore tables, other furniture, people, room decor, walls, floors, and background elements entirely. Describe only the chair or seating item itself.
- If a feature is not present (e.g. no arms, no back), state its absence explicitly.
- Never infer material from color alone — only describe what is structurally observable.

Return JSON only with these fields:
- silhouette: overall outline and negative space when viewed from the front (1-2 sentences)
- proportions: height-to-width ratio, seat depth impression, back height relative to seat
- structure_type: how it holds itself up — describe the skeleton visually (legs, base, cantilever, sled, pedestal, etc.)
- back_geometry: shape, curvature, openness, taper, lumbar region description. If absent, return "none — backless"
- seat_geometry: shape, edge treatment, depth impression, cushion vs shell
- arm_geometry: present or absent, shape if present, how they meet the back and seat. If absent, return "none — armless"
- surface_language: texture, sheen, material character visible on dominant surfaces
- design_register: one of [minimal, organic, industrial, traditional, sculptural, utilitarian]
- distinctive_elements: up to 5 short visual details that would distinguish this from similar items. Each item must be 8 words or fewer. Focus on what is visually unique — do not describe standard ergonomic features that appear on most task or collaborative chairs.
- visual_summary: 2-3 sentence embedding-ready description combining the above. No brand names. Lead with form, not color.`;
}

function extractionPrompt(typeKey) {
  const type = seatingTypes[typeKey] || seatingTypes[defaultSeatingType];
  const fields = getTypeFields(typeKey).filter((entry) => entry.detectability !== "no");
  const fieldLines = fields
    .map((entry) => `- ${entry.field} (photo-detectable: ${String(entry.detectability || "").toUpperCase()}) => [${entry.allowed_values.join(", ")}]`)
    .join("\n");
  const stoolBackRule = typeKey === "stool"
    ? `- For stool type only: the back field refers to whether a physical backrest is present on the stool, not the material of the seat or legs. A stool with no backrest must return "Backless" regardless of what materials are visible. Use seat_geometry "Flat" for standard flat seats, "Angled / perch" for forward-tilted perch seats, "Saddle" for saddle-like seats, and "Wobble / balance" for active stools designed to flex or rock.\n`
    : "";
  const loungeChairBaseRule = typeKey === "lounge_chair"
    ? `- For lounge_chair type: use body_construction "Upholstered" for any upholstered lounge chair body, including both continuous shell forms and traditional frame-and-cushion constructions. Use "Panel / privacy enclosure" for high side-panel lounge forms that enclose the user above shoulder or head level. For arm_configuration, use "Integrated / sculpted" whenever the arms flow continuously from the shell or backrest as part of the same sculpted form, even if seam lines are visible in the upholstery. Use "Armless" when no discrete armrests are present. Use "Two arms" only when the arms read as distinct attached arm elements with their own visible structure separate from the shell/body. Use base_type "Integrated base" when the base is visually absorbed into the shell with no discrete leg structure. Use "Pedestal" for a central column or star base, "Square plate / plinth" for a square or plate-like base, "4-leg" for four discrete legs, "Sled" for a continuous sled frame, and "Casters" only when visible wheels are present. For base_finish, classify only the visible finish of the base or support structure using [Black, Polished aluminum, Wood, Painted / powder coat]. For back_upholstery, use "Unupholstered shell" when the outer shell/back surface is exposed rather than upholstered. For seat_upholstery, use "None / unupholstered" only when the visible seat surface is bare plastic, wood, or another molded hard surface rather than upholstered. For configuration, choose exactly one of [Single seat, Multi-seat / sofa, Modular component, Corner unit, Ottoman]. Use "Single seat" for one clearly defined seating position such as a lounge chair, club chair, or armchair. Use "Multi-seat / sofa" for a non-modular sofa or loveseat with two or more attached seating positions. Use "Modular component" for a piece designed to combine or reconfigure with other modules. Use "Corner unit" for an L-shaped or corner-specific modular piece. Use "Ottoman" for a backless, typically low upholstered seat or footrest with no arms or back. ${LOUNGE_CHAIR_SHAPE_RULES}\n`
    : "";
  const taskCollabChairRule = typeKey === "task_collab_chair"
    ? `- For task_collab_chair type: use back_style [Mesh / net, Upholstered, Plastic back, Knit]. Use back_profile "Square / angular" for rectilinear backs with straight-edged geometry and "Rounded / curved" for visibly curved or softened back outlines. For arm_option, look for visible adjustment mechanisms on the arm supports; if any adjustment hardware is visible, return "Adjustable arms". Only return "Fixed arms" if the arms are rigid with no visible adjustment hardware. For base_finish, classify the visible finish using [Black, White, Polished aluminum, Painted color, Natural wood]. For frame, return "Plastic" only when the visible structural frame is predominantly plastic with no visible metal structure.\n`
    : "";
  const guestChairRule = typeKey === "guest_chair"
    ? `- For guest_chair type: use arm_option "Open arm" when the arm is visually separate and leaves space beneath or beside it, "Closed arm" when the arm and side panel read as a closed side, and "Integrated" when the arm flows directly from the shell or frame. Use frame_openness "Open / see-through" when the chair body or frame has visible negative space and "Closed / solid" when the side/back surfaces read as continuous solids. For mobility, infer "Casters" when wheels are visible on the base and "Non-mobile" when they are not. Use seat_finish and back_finish to describe the visible finished surface rather than the internal structure.\n`
    : "";

  return `Analyze one furniture image and answer only schema-routed questions. Type route: ${type.label} (${typeKey}). Return strict JSON only.

Rules:
- Fill image_traits fields only for the listed fields.
- Only attempt fields marked (photo-detectable: YES). Set (photo-detectable: MAYBE) fields only if clearly visible. Omit (photo-detectable: NO) fields entirely — these must come from spec data.
- If a trait is not visible or not applicable, use "unknown". Never guess. Never infer material from color alone.
- If a feature is structurally absent (e.g. no back, no arms), use "none" not "unknown".
- Never invent values outside allowed enum values.
- Ignore non-primary products and scene decor.
${stoolBackRule}${loungeChairBaseRule}${taskCollabChairRule}${guestChairRule}- structured_caption: write a 1-2 sentence product caption. No brand or model names. Lead with form and distinctive geometry. This replaces the previous visual_description field.
- raw_visual_highlights is optional debug only, max 8 bullets.
Fields: ${fieldLines}`;
}

function normalizeImageTraits(typeKey, imageTraits = {}) {
  const normalized = {};
  for (const field of getTypeFields(typeKey)) {
    if (field.detectability === "no") {
      continue;
    }
    normalized[field.field] = normalizeEnum(imageTraits[field.field], field.allowed_values);
  }
  return normalized;
}

function applyLoungeChairPlanShapeGuardrails(typeKey, imageTraits = {}) {
  if (String(typeKey || "").trim().toLowerCase() !== "lounge_chair") {
    return imageTraits;
  }

  const configuration = String(imageTraits?.configuration || "").trim().toLowerCase();
  if (["multi-seat / sofa", "modular component", "corner unit"].includes(configuration)) {
    return {
      ...imageTraits,
      plan_shape: "N/A"
    };
  }

  return imageTraits;
}

function normalizeStage2(stage2 = {}) {
  return {
    silhouette: normalizeWhitespace(stage2.silhouette || ""),
    proportions: normalizeWhitespace(stage2.proportions || ""),
    structure_type: normalizeWhitespace(stage2.structure_type || ""),
    back_geometry: normalizeWhitespace(stage2.back_geometry || ""),
    seat_geometry: normalizeWhitespace(stage2.seat_geometry || ""),
    arm_geometry: normalizeWhitespace(stage2.arm_geometry || ""),
    surface_language: normalizeWhitespace(stage2.surface_language || ""),
    design_register: normalizeEnum(stage2.design_register, ["minimal", "organic", "industrial", "traditional", "sculptural", "utilitarian"]) || "utilitarian",
    distinctive_elements: uniqueStrings(Array.isArray(stage2.distinctive_elements) ? stage2.distinctive_elements : []).slice(0, 5),
    visual_summary: normalizeWhitespace(stage2.visual_summary || "")
  };
}

function deriveBaseMaterialFromBaseFinish(seatingType = "", enumFields = {}) {
  if (String(seatingType || "").trim().toLowerCase() !== "lounge_chair") {
    return "";
  }

  const baseFinish = String(enumFields?.base_finish || "").trim().toLowerCase();
  if (!baseFinish || baseFinish === "unknown") {
    return "unknown";
  }

  return baseFinish === "wood" ? "wood" : "other";
}

function deriveBaseVisibilityFromBaseType(seatingType = "", enumFields = {}) {
  if (String(seatingType || "").trim().toLowerCase() !== "lounge_chair") {
    return "";
  }

  const baseType = String(enumFields?.base_type || "").trim().toLowerCase();
  if (!baseType || baseType === "unknown") {
    return "unknown";
  }

  return baseType === "integrated base" ? "integrated" : "exposed";
}

function applyStage3EnumGuardrails(typeKey, stage3Response = {}) {
  const fieldMap = getFieldMap(typeKey);
  const guardedResponse = {
    ...stage3Response,
    image_traits: {
      ...(stage3Response.image_traits || {})
    }
  };

  for (const [field, value] of Object.entries(guardedResponse.image_traits || {})) {
    const schemaField = fieldMap.get(field);
    if (!schemaField || !Array.isArray(schemaField.allowed_values)) {
      continue;
    }

    const normalizedAllowed = new Set(
      schemaField.allowed_values.map((entry) => String(entry || "").trim().toLowerCase())
    );
    const normalizedValue = String(value ?? "").trim().toLowerCase();

    if (!normalizedAllowed.has(normalizedValue)) {
      console.warn(`Enum guardrail: invalid value "${value}" for field "${field}" on type "${typeKey}" — replaced with "unknown"`);
      guardedResponse.image_traits[field] = "unknown";
    }
  }

  return guardedResponse;
}

function heuristicImageTraits(typeKey, context = "", metadata = {}) {
  const source = String(context || "").toLowerCase();
  const productId = String(metadata.productId || metadata.product_id || "unknown").trim() || "unknown";
  console.log(`[heuristic-image-traits] product_id=${productId} seating_category=${typeKey}`);
  const output = {};
  const fields = getTypeFields(typeKey).filter((entry) => entry.detectability !== "no");
  const inferred = {};

  if (typeKey === "task_collab_chair") {
    inferred.back_style = /knit/.test(source)
      ? "knit"
      : /mesh|net/.test(source)
        ? "mesh / net"
        : /plastic/.test(source)
          ? "plastic back"
          : /upholster|fabric|leather|cushion/.test(source)
            ? "upholstered"
            : "unknown";
    inferred.back_profile = /curved|rounded|wrap/.test(source) ? "rounded / curved" : /square|angular|rectilinear|straight/.test(source) ? "square / angular" : "unknown";
    inferred.arm_option = /armless|no arms|without arms/.test(source) ? "armless" : /adjustable arms|adjustable arm|4d arms|height-adjustable arms/.test(source) ? "adjustable arms" : /arms?/.test(source) ? "fixed arms" : "unknown";
    inferred.base_type = /caster|wheel/.test(source)
      ? "5-star with casters"
      : /glide/.test(source)
        ? "5-star with glides"
        : /sled/.test(source)
          ? "sled base"
          : /four[- ]leg|4-leg|legs/.test(source)
            ? "4-leg"
            : "unknown";
    inferred.base_finish = /polished aluminum|chrome|brushed aluminum/.test(source)
      ? "polished aluminum"
      : /natural wood|oak|walnut|ash|maple/.test(source)
        ? "natural wood"
        : /white/.test(source)
          ? "white"
          : /black|charcoal/.test(source)
            ? "black"
            : /painted|powder coat|color/.test(source)
              ? "painted color"
              : "unknown";
    inferred.frame = /aluminum|aluminium/.test(source)
      ? "aluminum"
      : /metal|steel|chrome/.test(source)
        ? "metal"
        : /plastic|poly/.test(source)
          ? "plastic"
          : "unknown";
    inferred.seat_upholstery = /mesh|net/.test(source)
      ? "mesh / net"
      : /leather/.test(source)
        ? "leather"
        : /fabric|upholster|textile/.test(source)
          ? "fabric"
          : "unknown";
  } else if (typeKey === "stool") {
    inferred.seat_geometry = /wobble|balance|rock/.test(source)
      ? "wobble / balance"
      : /saddle/.test(source)
        ? "saddle"
        : /angled|perch|forward tilt/.test(source)
          ? "angled / perch"
          : /flat/.test(source)
            ? "flat"
            : "unknown";
    inferred.back = /backless|no back|without back/.test(source) ? "backless" : /low back/.test(source) ? "low back" : /full back|high back/.test(source) ? "full back" : "unknown";
    inferred.base_type = /caster|wheel/.test(source)
      ? "5-star with casters"
      : /glide/.test(source)
        ? "5-star with glides"
        : /molded one-piece|one-piece/.test(source)
          ? "molded one-piece"
          : /pedestal/.test(source)
            ? "pedestal"
            : /four[- ]leg|4-leg|legs/.test(source)
              ? "4-leg"
              : "unknown";
    inferred.base_frame_finish = /polished aluminum|chrome|brushed aluminum/.test(source)
      ? "polished aluminum"
      : /natural wood|oak|walnut|ash|maple/.test(source)
        ? "natural wood"
        : /white/.test(source)
          ? "white"
          : /black|charcoal/.test(source)
            ? "black"
            : /painted|powder coat|color/.test(source)
              ? "painted color"
              : "unknown";
    inferred.seat_material = /upholster|fabric|leather|cushion/.test(source)
      ? "upholstered"
      : /solid wood|wooden/.test(source)
        ? "solid wood"
        : /plastic|poly/.test(source)
          ? "molded plastic"
          : "unknown";
  } else if (typeKey === "guest_chair") {
    inferred.base_type = /cantilever/.test(source)
      ? "cantilever"
      : /pedestal/.test(source)
        ? "pedestal"
        : /sled/.test(source)
          ? "sled"
          : /four[- ]leg|4-leg|legs/.test(source)
            ? "4-leg"
            : "unknown";
    inferred.base_finish = /natural wood|oak|walnut|ash|maple/.test(source)
      ? "natural wood"
      : /polished|chrome|aluminum|aluminium/.test(source)
        ? "polished"
        : /black|charcoal/.test(source)
          ? "black"
          : "unknown";
    inferred.arm_option = /armless|no arms|without arms/.test(source) ? "armless" : /closed arm|panel arm|closed side/.test(source) ? "closed arm" : /open arm|open side arm/.test(source) ? "open arm" : /integrated/.test(source) ? "integrated" : /arms?/.test(source) ? "open arm" : "unknown";
    inferred.back_profile = /curved|rounded|wrap/.test(source) ? "rounded / curved" : /square|angular|rectilinear|straight/.test(source) ? "square / angular" : "unknown";
    inferred.frame_openness = /solid side|closed side|panel side|privacy/.test(source) ? "closed / solid" : /open frame|open side|open back|see-through|wire/.test(source) ? "open / see-through" : "unknown";
    inferred.mobility = /caster|wheel/.test(source) ? "casters" : /glide|four[- ]leg|4-leg|legs|sled|cantilever|pedestal/.test(source) ? "non-mobile" : "unknown";
    inferred.seat_finish = /leather/.test(source)
      ? "leather"
      : /fabric|upholster|textile/.test(source)
        ? "fabric"
        : /plastic|poly/.test(source)
          ? "molded plastic"
          : /wood/.test(source)
            ? "wood"
            : "unknown";
    inferred.back_finish = /mesh|net/.test(source)
      ? "mesh / net"
      : /leather/.test(source)
        ? "leather"
        : /fabric|upholster|textile/.test(source)
          ? "fabric"
          : /plastic|poly/.test(source)
            ? "molded plastic"
            : /wood/.test(source)
              ? "wood"
              : /unupholster|bare shell/.test(source)
                ? "unupholstered"
                : "unknown";
  } else if (typeKey === "lounge_chair") {
    inferred.body_construction = /panel|privacy|enclosure|hood/.test(source)
      ? "panel / privacy enclosure"
      : /sling|suspended/.test(source)
        ? "suspended / sling"
        : /molded plywood|bent plywood/.test(source)
          ? "molded plywood shell"
          : /plastic|poly/.test(source)
            ? "molded plastic shell"
            : /upholster|fabric|leather|cushion/.test(source)
              ? "upholstered"
              : "unknown";
    inferred.arm_configuration = /armless|no arms|without arms/.test(source) ? "armless" : /one arm/.test(source) ? "one arm" : /integrated|wrap arm|sculpted arm/.test(source) ? "integrated / sculpted" : /arms?/.test(source) ? "two arms" : "unknown";
    inferred.base_type = /caster|wheel/.test(source)
      ? "casters"
      : /integrated base|concealed base|monolithic base/.test(source)
        ? "integrated base"
        : /plinth/.test(source)
          ? "square plate / plinth"
          : /pedestal/.test(source)
            ? "pedestal"
            : /sled/.test(source)
              ? "sled"
              : /four[- ]leg|4-leg|legs/.test(source)
                ? "4-leg"
                : "unknown";
    inferred.base_finish = /polished aluminum|chrome|brushed aluminum/.test(source)
      ? "polished aluminum"
      : /wood|oak|walnut|ash|maple/.test(source)
        ? "wood"
        : /painted|powder coat|color|white/.test(source)
          ? "painted / powder coat"
          : /black|charcoal/.test(source)
            ? "black"
            : "unknown";
    inferred.seat_upholstery = /leather/.test(source)
      ? "leather"
      : /plastic|wood|shell/.test(source) && !/upholster|fabric|leather|cushion/.test(source)
        ? "none / unupholstered"
        : /fabric|upholster|textile|cushion/.test(source)
          ? "fabric"
          : "unknown";
    inferred.back_upholstery = /unupholster|bare shell/.test(source)
      ? "unupholstered shell"
      : /independent fabric|contrasting back/.test(source)
        ? "independent fabric"
        : /upholster|fabric|leather|cushion/.test(source)
          ? "matches seat"
          : "unknown";
    inferred.back_height = /full enclosure|privacy/.test(source) ? "full enclosure" : /high back/.test(source) ? "high" : /mid back|medium back/.test(source) ? "mid" : /low back/.test(source) ? "low" : "unknown";
    inferred.configuration = /sofa|loveseat|settee/.test(source) ? "multi-seat / sofa" : /modular/.test(source) ? "modular component" : /corner/.test(source) ? "corner unit" : /ottoman|pouf|footrest/.test(source) ? "ottoman" : /chair|lounge/.test(source) ? "single seat" : "unknown";
    inferred.shape_character = /boxy|rectilinear|straight/.test(source) ? "boxy" : /curved|rounded|tapered|organic/.test(source) ? "soft / tapered" : "unknown";
    inferred.plan_shape = /round|semicircular|curved back/.test(source) ? "round / semicircular" : /reverse trapezoid/.test(source) ? "reverse trapezoidal" : /trapezoid/.test(source) ? "trapezoidal" : /rectangular|square/.test(source) ? "square / rectangular" : "unknown";
  }

  inferred.design_register = /organic|soft sculptural/.test(source)
    ? "organic"
    : /industrial|utilitarian/.test(source)
      ? /industrial/.test(source) ? "industrial" : "utilitarian"
      : /traditional/.test(source)
        ? "traditional"
        : /sculptural/.test(source)
          ? "sculptural"
          : /minimal|clean-lined|minimalist/.test(source)
            ? "minimal"
            : "unknown";

  for (const field of fields) {
    output[field.field] = normalizeEnum(inferred[field.field], field.allowed_values);
  }

  return output;
}

async function extractImageTraitsOpenAi(imageInput, typeKey, stage1, stage2, options = {}) {
  if (!options.apiKey) {
    const heuristicTraits = heuristicImageTraits(
      typeKey,
      `${imageInput.catalogContext || ""} ${imageInput.image_url || ""}`,
      { productId: imageInput.product_id || imageInput.productId || options.productId || options.product_id }
    );
    return {
      reasoning: "",
      structured_caption: sentenceCase(`${seatingTypes[typeKey]?.label || "Seating"} from inspiration image.`).replace(/\.*$/, "."),
      raw_visual_highlights: cleanVisualHighlights(buildDeterministicBulletsFromMergedTraits(typeKey, heuristicTraits)),
      image_traits: normalizeImageTraits(typeKey, heuristicTraits)
    };
  }

  if (typeKey === "stool") {
    const fieldsBeforeFilter = getTypeFields(typeKey);
    const fieldsAfterFilter = fieldsBeforeFilter.filter((entry) => entry.detectability !== "no");
    console.log("DEBUG fieldLines stool fields before filter:", fieldsBeforeFilter.map((entry) => ({
      field: entry.field,
      detectability: entry.detectability,
      allowed_values: entry.allowed_values
    })));
    console.log("DEBUG fieldLines stool fields after filter:", fieldsAfterFilter.map((entry) => ({
      field: entry.field,
      detectability: entry.detectability,
      allowed_values: entry.allowed_values
    })));
  }

  const debugFieldLines = extractionPrompt(typeKey).match(/Fields:\s([\s\S]*)$/)?.[1] || "";
  if (typeKey === "stool") {
    console.log("DEBUG fieldLines for type:", typeKey);
    console.log(debugFieldLines);
  }

  const parsed = await callOpenAiJson({
    apiKey: options.apiKey,
    model: options.visionModel,
    systemPrompt: extractionPrompt(typeKey),
    userParts: [
      ...(imageInput.catalogContext
        ? [{ type: "input_text", text: imageInput.catalogContext }]
        : []),
      {
        type: "input_text",
        text: options.typeRoutingSource === "mapping_v1"
          ? `Resolved PixelSeek type is: ${typeKey}. Visual context: ${stage2.visual_summary}. Extract structured traits and write the structured_caption from the image.`
          : `Seating type: ${stage1.seating_type}. Visual context: ${stage2.visual_summary}. Extract structured traits and write the structured_caption from the image.`
      },
      { type: "input_image", image_url: imageInput.image_url, detail: "high" }
    ],
    schemaName: `seating_traits_${typeKey}`,
    schema: extractionSchemaForType(typeKey)
  });
  if (process.env.DEBUG_CAPTION_HANDOFF === "1") {
    console.log("HANDOFF 1 - raw parsed image_traits:", JSON.stringify(parsed.image_traits, null, 2));
  }
  const guardedParsed = applyStage3EnumGuardrails(typeKey, parsed);
  if (process.env.DEBUG_CAPTION_HANDOFF === "1") {
    console.log("HANDOFF 2 - post-guardrail image_traits:", JSON.stringify(guardedParsed.image_traits, null, 2));
  }
  const finalTraits = applyLoungeChairPlanShapeGuardrails(
    typeKey,
    normalizeImageTraits(typeKey, guardedParsed.image_traits || {})
  );
  if (process.env.DEBUG_CAPTION_HANDOFF === "1") {
    console.log("HANDOFF 3 - post-normalization image_traits:", JSON.stringify(finalTraits, null, 2));
  }

  return {
    reasoning: normalizeWhitespace(guardedParsed.reasoning || ""),
    structured_caption: sentenceCase(guardedParsed.structured_caption || "Structured seating result.").replace(/\.*$/, "."),
    raw_visual_highlights: uniqueStrings(Array.isArray(guardedParsed.raw_visual_highlights) ? guardedParsed.raw_visual_highlights : []).slice(0, 8),
    image_traits: finalTraits
  };
}

export function combinedStage23Prompt(typeKey) {
  const typeConfig = seatingTypes[typeKey] || seatingTypes[defaultSeatingType];
  const stoolBackRule = typeKey === "stool"
    ? `- For stool only: if there is no physical backrest, set back to "Backless". Use seat_geometry "Flat" for standard flat seats, "Angled / perch" for forward-tilted perch seats, "Saddle" for saddle seats, and "Wobble / balance" for active stools designed to flex or rock.\n`
    : "";
  const loungeChairBaseRule = typeKey === "lounge_chair"
    ? `- For lounge_chair only: use body_construction "Upholstered" for any upholstered lounge chair body, including both continuous shell forms and traditional frame-and-cushion constructions. Use "Panel / privacy enclosure" for high side-panel lounge forms that enclose the user above shoulder or head level. For arm_configuration, use "Integrated / sculpted" whenever the arms flow continuously from the shell or backrest as part of the same sculpted form, even if seam lines are visible in the upholstery. Use "Armless" when no discrete armrests are present. Use "Two arms" only when the arms read as distinct attached arm elements with their own visible structure separate from the shell/body. Use base_type "Integrated base" when the base is visually absorbed into the shell with no discrete leg structure. Use "Pedestal" for a central column or star base, "Square plate / plinth" for a square or plate-like base, "4-leg" for four discrete legs, "Sled" for a continuous sled frame, and "Casters" only when visible wheels are present. For base_finish, classify only the visible finish of the base or support structure using [Black, Polished aluminum, Wood, Painted / powder coat]. For back_upholstery, use "Unupholstered shell" when the outer shell/back surface is exposed rather than upholstered. For seat_upholstery, use "None / unupholstered" only when the visible seat surface is bare plastic, wood, or another molded hard surface rather than upholstered. For configuration, choose exactly one of [Single seat, Multi-seat / sofa, Modular component, Corner unit, Ottoman]. Use "Single seat" for one clearly defined seating position such as a lounge chair, club chair, or armchair. Use "Multi-seat / sofa" for a non-modular sofa or loveseat with two or more attached seating positions. Use "Modular component" for a piece designed to combine or reconfigure with other modules. Use "Corner unit" for an L-shaped or corner-specific modular piece. Use "Ottoman" for a backless, typically low upholstered seat or footrest with no arms or back. ${LOUNGE_CHAIR_SHAPE_RULES}\n`
    : "";
  const taskCollabChairRules = typeKey === "task_collab_chair"
    ? `- For task_collab_chair arm_option: visible adjustment hardware means adjustable, not fixed.\n- For task_collab_chair back_profile: use "Rounded / curved" for visibly curved or softened backs and "Square / angular" for rectilinear backs.\n- For task_collab_chair base_finish: classify the visible base finish/color using [Black, White, Polished aluminum, Painted color, Natural wood].\n- For task_collab_chair frame: use "Plastic" only when the visible structural frame is predominantly plastic with no visible metal structure.\n`
    : "";
  const guestChairRules = typeKey === "guest_chair"
    ? `- For guest_chair arm_option: use "Open arm" for visually open side arms, "Closed arm" for side enclosures, and "Integrated" when the arm flows directly from the shell or frame.\n- For guest_chair frame_openness: use "Open / see-through" when the chair body or frame has obvious negative space and "Closed / solid" when it reads as continuous solid surfaces.\n- For guest_chair mobility: use "Casters" when wheels are visible on the base and "Non-mobile" when they are not.\n`
    : "";

  return `You are a furniture visual analyst. Analyze only the primary seating product in the image. The seating type has already been determined by stage 1: ${typeConfig.label} (${typeKey}).

Return strict JSON only.

Stage 2: visual form
- Describe only the primary seating product.
- Ignore the room, props, people, and secondary objects.
- No brand or model names.
- Focus on silhouette, proportions, support structure, back geometry, seat geometry, arm geometry, surface character, design register, and distinctive elements.
- State structural absences explicitly, such as armless or backless.
- Never infer material from color alone.

Stage 3: attributes
- Fill only the attributes listed below for this seating type.
- Set YES fields when visible. Set MAYBE fields only if clearly visible.
- If a trait is not visible or not applicable, use "unknown".
- If a feature is structurally absent, use "none" when "none" is an allowed value.
- Never invent values outside the allowed enums.
${stoolBackRule}${loungeChairBaseRule}${taskCollabChairRules}${guestChairRules}Relevant attribute fields for this seating type only:
${buildFieldGuideForType(typeKey)}

Return JSON with:
- silhouette
- proportions
- structure_type
- back_geometry
- seat_geometry
- arm_geometry
- surface_language
- design_register
- distinctive_elements
- visual_summary
- structured_caption
- raw_visual_highlights
- image_traits`;
}

async function extractStage23CombinedOpenAi(imageInput, typeKey, stage1, options = {}) {
  if (!options.apiKey) {
    const stage2 = await describeVisualFormOpenAi(imageInput, options);
    const stage3 = await extractImageTraitsOpenAi(imageInput, typeKey, stage1, stage2, options);
    return {
      stage2,
      stage3,
      usage: normalizeOpenAiUsage()
    };
  }

  const { data: parsed, usage } = await callOpenAiJsonWithMeta({
    apiKey: options.apiKey,
    model: options.visionModel || "gpt-4.1",
    systemPrompt: combinedStage23Prompt(typeKey),
    userParts: [
      ...(imageInput.catalogContext
        ? [{ type: "input_text", text: imageInput.catalogContext }]
        : []),
      {
        type: "input_text",
        text: options.typeRoutingSource === "mapping_v1"
          ? `Resolved PixelSeek type is: ${typeKey}. Use this as the routing type for all stage 2 and stage 3 outputs.`
          : `Stage 1 seating_type result: ${stage1.seating_type}. Use this as the routing type for all stage 2 and stage 3 outputs.`
      },
      { type: "input_image", image_url: imageInput.image_url, detail: "high" }
    ],
    schemaName: `seating_stage23_${typeKey}`,
    schema: combinedStage23SchemaForType(typeKey)
  });

  const stage2 = normalizeStage2(parsed);
  const guardedParsed = applyStage3EnumGuardrails(typeKey, parsed);
  const finalTraits = applyLoungeChairPlanShapeGuardrails(
    typeKey,
    normalizeImageTraits(typeKey, guardedParsed.image_traits || {})
  );
  const stage3 = {
    reasoning: normalizeWhitespace(guardedParsed.reasoning || ""),
    structured_caption: sentenceCase(guardedParsed.structured_caption || "Structured seating result.").replace(/\.*$/, "."),
    raw_visual_highlights: uniqueStrings(Array.isArray(guardedParsed.raw_visual_highlights) ? guardedParsed.raw_visual_highlights : []).slice(0, 8),
    image_traits: finalTraits
  };

  return { stage2, stage3, usage };
}

async function describeVisualFormOpenAi(imageInput, options = {}) {
  if (!options.apiKey) {
    return {
      silhouette: "Primary seating object with a readable front-facing outline and conservative inferred geometry.",
      proportions: "Proportions are estimated conservatively from the visible view.",
      structure_type: "Visible support structure is described conservatively from the image.",
      back_geometry: "Back geometry is summarized only at a high level.",
      seat_geometry: "Seat geometry is summarized only at a high level.",
      arm_geometry: "Arm geometry is noted conservatively based on visible evidence.",
      surface_language: "Dominant surface character is inferred conservatively from visible materials.",
      design_register: "utilitarian",
      distinctive_elements: [],
      visual_summary: "Primary seating object detected with conservative visual-form description. Geometry and support structure are summarized only from clearly visible cues."
    };
  }

  const parsed = await callOpenAiJson({
    apiKey: options.apiKey,
    model: options.visionModel,
    systemPrompt: visualDescriptionPrompt(),
    userParts: [
      ...(imageInput.catalogContext
        ? [{ type: "input_text", text: imageInput.catalogContext }]
        : []),
      { type: "input_image", image_url: imageInput.image_url, detail: "high" }
    ],
    schemaName: "seating_visual_description",
    schema: visualDescriptionSchema()
  });

  return normalizeStage2(parsed);
}

async function analyzeImageStage123OpenAi(imageInput, options = {}) {
  if (!options.apiKey) {
    const stage1 = await classifySeatingTypeOpenAi(imageInput, options);
    if (isStage1OverrideResult(stage1)) {
      return {
        result: normalizeStage1Result(stage1?.result),
        override_reason: stage1.override_reason || null,
        seating_type: "",
        visual_form: "",
        attributes: {}
      };
    }
    const seatingType = ensureTypeKey(stage1.seating_type);
    const stage2 = await describeVisualFormOpenAi(imageInput, options);
    const stage3 = await extractImageTraitsOpenAi(imageInput, seatingType, stage1, stage2, options);

    return {
      result: "product",
      override_reason: null,
      seating_type: seatingType,
      visual_form: stage2.visual_summary,
      attributes: stage3.image_traits
    };
  }

  const parsed = await callOpenAiJsonLoose({
    apiKey: options.apiKey,
    model: options.visionModel || "gpt-4.1",
    systemPrompt: consolidatedStage123Prompt(),
    userParts: [
      ...(imageInput.catalogContext
        ? [{ type: "input_text", text: imageInput.catalogContext }]
        : []),
      { type: "input_image", image_url: imageInput.image_url, detail: "high" }
    ]
  });

  if (isStage1OverrideResult(parsed)) {
    return {
      result: normalizeStage1Result(parsed?.result),
      override_reason: normalizeWhitespace(parsed?.override_reason || "") || null,
      seating_type: "",
      visual_form: "",
      attributes: {}
    };
  }

  const seatingType = ensureTypeKey(parsed.seating_type);
  return {
    result: "product",
    override_reason: null,
    seating_type: seatingType,
    visual_form: normalizeWhitespace(parsed.visual_form || ""),
    attributes: normalizeImageTraits(seatingType, parsed.attributes || {})
  };
}

async function loadPdfExtract() {
  if (pdfExtractCache) {
    return pdfExtractCache;
  }
  pdfExtractCache = await readJson(pdfExtractPath, { results: [] });
  return pdfExtractCache;
}

function textToSpecValue(fieldName, text) {
  const source = String(text || "").toLowerCase();
  if (!source) {
    return "unknown";
  }

  if (fieldName === "arm_adjustability") {
    if (/4d arms|four-way arms|fully adjustable arms/.test(source)) return "fully adjustable";
    if (/height[- ]adjustable arms|adjustable arms/.test(source)) return "height-adjustable";
    if (/fixed arms/.test(source)) return "fixed";
    if (/armless|no arms/.test(source)) return "none";
  }

  if (fieldName === "tilt_present") {
    if (/tilt|recline|synchron/.test(source)) return "yes";
    if (/no tilt|non-tilt/.test(source)) return "no";
  }

  if (fieldName === "swivel_present") {
    if (/swivel/.test(source)) return "yes";
    if (/non-swivel|stationary/.test(source)) return "no";
  }

  if (fieldName === "seat_count_band") {
    if (/\b2[- ]seat\b/.test(source)) return "2-seat";
    if (/\b3[- ]seat\b/.test(source)) return "3-seat";
    if (/\b4[- ]seat\b/.test(source)) return "4-seat";
    if (/\b5[- ]seat\b/.test(source)) return "5-seat";
    if (/\b6[- ]seat\b/.test(source)) return "6-seat";
  }

  if (fieldName === "upholstery_coverage") {
    if (/fully upholstered/.test(source)) return "fully upholstered";
    if (/seat and back/.test(source)) return "seat and back";
    if (/seat only/.test(source)) return "seat only";
    if (/without upholstery|no upholstery/.test(source)) return "none";
  }

  return "unknown";
}

function findSpecTextForRecord(pdfResults = [], imageRecord = {}) {
  const nameTokens = tokenize(imageRecord.name || "").slice(0, 6);
  if (!nameTokens.length) return "";

  let best = { score: 0, text: "" };
  for (const item of pdfResults) {
    const text = String(item?.text || "").toLowerCase();
    if (!text) continue;
    const score = nameTokens.reduce((sum, token) => sum + (text.includes(token) ? 1 : 0), 0);
    if (score > best.score) {
      best = { score, text };
    }
  }

  return best.score >= 2 ? best.text : "";
}

async function extractSpecTraits(typeKey, imageRecord = {}) {
  const pdfPayload = await loadPdfExtract();
  const sourceText = findSpecTextForRecord(pdfPayload.results || [], imageRecord);
  const fields = getTypeFields(typeKey).filter((entry) => entry.detectability === "no");
  const output = {};

  for (const field of fields) {
    output[field.field] = normalizeEnum(textToSpecValue(field.field, sourceText), field.allowed_values);
  }

  return output;
}

function isNegativeValue(value = "") {
  return ["no", "none", "false", "no arms"].includes(String(value || "").toLowerCase());
}

function mergeTraits(typeKey, imageTraits = {}, specTraits = {}) {
  const fields = getTypeFields(typeKey);
  const merged = {};
  const provenance = {};

  for (const field of fields) {
    const imageValue = normalizeEnum(imageTraits[field.field], field.allowed_values);
    const specValue = normalizeEnum(specTraits[field.field], field.allowed_values);

    let mergedValue = "unknown";
    let source = "merged";

    if (specValue !== "unknown" && isNegativeValue(specValue)) {
      mergedValue = specValue;
      source = imageValue !== "unknown" ? "merged" : "spec";
    } else if (imageValue !== "unknown") {
      mergedValue = imageValue;
      source = specValue !== "unknown" && specValue !== imageValue ? "merged" : "image";
    } else if (specValue !== "unknown") {
      mergedValue = specValue;
      source = "spec";
    }

    merged[field.field] = mergedValue;
    provenance[field.field] = {
      source,
      image_value: imageValue,
      spec_value: specValue,
      merged_value: mergedValue,
      status: mergedValue === "unknown" ? "unknown" : source
    };
  }

  return { merged_traits: merged, trait_provenance: provenance };
}

function toLegacyVisualTraits(typeKey, mergedTraits = {}) {
  const productType = mergedTraits.product_type === "unknown" ? "" : mergedTraits.product_type;
  const dominantColor = mergedTraits.dominant_color === "unknown" ? "" : mergedTraits.dominant_color;
  const baseType = mergedTraits.base_type === "unknown" ? "" : mergedTraits.base_type;
  const frameMaterial = (mergedTraits.frame === "unknown" ? "" : mergedTraits.frame) || (mergedTraits.frame_material === "unknown" ? "" : mergedTraits.frame_material);
  const seatMaterial = (mergedTraits.seat_material === "unknown" ? "" : mergedTraits.seat_material) || (mergedTraits.seat_finish === "unknown" ? "" : mergedTraits.seat_finish) || (mergedTraits.seat_upholstery === "unknown" ? "" : mergedTraits.seat_upholstery);
  const backConstruction = (mergedTraits.back_style === "unknown" ? "" : mergedTraits.back_style) || (mergedTraits.back_finish === "unknown" ? "" : mergedTraits.back_finish) || (mergedTraits.body_construction === "unknown" ? "" : mergedTraits.body_construction);
  const armOption = (mergedTraits.arm_option === "unknown" ? "" : mergedTraits.arm_option) || (mergedTraits.arm_configuration === "unknown" ? "" : mergedTraits.arm_configuration);
  const armsPresent = Boolean(armOption) && !["armless", "none"].includes(String(armOption).toLowerCase());
  const armType = String(armOption || "").toLowerCase();

  const mapped = {
    ...LEGACY_TRAIT_DEFAULTS,
    product_type: productType,
    seating_category_visual:
      typeKey === "task_collab_chair"
        ? "task seating"
        : typeKey === "guest_chair"
          ? "guest seating"
          : typeKey === "lounge_chair"
            ? "lounge seating"
            : typeKey === "stool"
              ? "stools"
              : typeKey === "bench"
                ? "bench seating"
                : typeKey === "sofa"
                  ? "lounge seating"
                  : "seating",
    application_type:
      typeKey === "task_collab_chair"
        ? "task seating"
        : typeKey === "guest_chair"
          ? "guest seating"
          : typeKey === "lounge_chair"
            ? "lounge seating"
            : "seating",
    subject_prominence: "dominant product in scene",
    dominant_color: dominantColor,
    base_type: baseType,
    frame_material: frameMaterial,
    seat_material: seatMaterial,
    back_material: seatMaterial,
    back_construction: backConstruction,
    arm_type: !armOption ? "" : !armsPresent ? "no arms" : armType.includes("adjustable") ? "adjustable arms" : armOption,
    arm_adjustability: armType.includes("adjustable") ? "height-adjustable" : "",
    tilt_present: mergedTraits.tilt_present === "yes",
    swivel_present: mergedTraits.swivel_present === "yes",
    upholstery_coverage: mergedTraits.upholstery_coverage && mergedTraits.upholstery_coverage !== "unknown" ? mergedTraits.upholstery_coverage : ""
  };

  mapped.base_material = frameMaterial || "";
  mapped.leg_material = frameMaterial === "wood" || frameMaterial === "metal" ? frameMaterial : "";
  mapped.caster_present = String(baseType).includes("caster");
  mapped.material_details = uniqueStrings([
    frameMaterial ? `${frameMaterial} frame` : "",
    seatMaterial ? `${seatMaterial} seat` : "",
    backConstruction || ""
  ]);
  mapped.notable_features = uniqueStrings([
    mergedTraits.silhouette && mergedTraits.silhouette !== "unknown" ? `${mergedTraits.silhouette} silhouette` : "",
    mapped.swivel_present ? "swivel" : "",
    mapped.tilt_present ? "tilt" : ""
  ]);
  mapped.dominant_materials = uniqueStrings([seatMaterial, frameMaterial]).slice(0, 2);

  return mapped;
}

function buildDeterministicBulletsFromMergedTraits(typeKey, mergedTraits = {}) {
  const ordered = [
    ["product_type", (value) => value],
    ["silhouette", (value) => `${value} silhouette`],
    ["base_type", (value) => `${value} base`],
    ["frame_material", (value) => `${value} frame`],
    ["seat_material", (value) => `${value} seat`],
    ["back_construction", (value) => `${value} back`],
    ["dominant_color", (value) => `${value} color`],
    ["upholstery_coverage", (value) => value],
    ["swivel_present", (value) => (value === "yes" ? "swivel" : "")],
    ["tilt_present", (value) => (value === "yes" ? "tilt mechanism" : "")],
    ["arm_option", (value) => value],
    ["arm_configuration", (value) => value]
  ];

  const bullets = [];
  for (const [field, formatter] of ordered) {
    const value = mergedTraits[field];
    if (!value || value === "unknown") {
      continue;
    }
    const phrase = normalizeWhitespace(formatter(value));
    if (phrase) {
      bullets.push(phrase);
    }
  }

  const typeLabel = (seatingTypes[typeKey]?.label || "Seating").toLowerCase();
  const cleaned = cleanVisualHighlights(uniqueStrings([`${typeLabel} silhouette`, ...bullets])).slice(0, 8);
  if (cleaned.length) {
    return cleaned;
  }
  return [`${typeLabel} silhouette`];
}

const LOW_VALUE_BULLET_BLOCKLIST = new Set([
  "chair",
  "table",
  "sofa",
  "stool",
  "bench",
  "desk",
  "furniture",
  "modern design",
  "contemporary design",
  "minimalist design",
  "four legs",
  "4 legs"
]);

const OBJECT_NOUNS = new Set(["chair", "table", "sofa", "stool", "bench", "desk", "seat", "furniture"]);
const COMPONENT_NOUNS = new Set([
  "leg",
  "legs",
  "base",
  "frame",
  "back",
  "backrest",
  "arm",
  "arms",
  "armrest",
  "armrests",
  "seat",
  "shell",
  "top",
  "panel",
  "panels",
  "cushion",
  "cushions"
]);
const MATERIAL_WORDS = new Set([
  "wood",
  "wooden",
  "metal",
  "steel",
  "aluminum",
  "aluminium",
  "chrome",
  "fabric",
  "textile",
  "leather",
  "mesh",
  "glass",
  "stone",
  "plastic",
  "upholstered"
]);
const QUALIFIER_WORDS = new Set([
  "angled",
  "curved",
  "rounded",
  "tapered",
  "slender",
  "thick",
  "thin",
  "tubular",
  "integrated",
  "wraparound",
  "open",
  "closed",
  "compact",
  "monolithic",
  "floating"
]);
const ABSTRACT_TERMS = new Set(["design", "aesthetic", "style", "silhouette", "presence", "look", "appearance", "feel"]);
const STOP_WORDS = new Set(["a", "an", "and", "or", "the", "with", "without", "of", "on", "in", "to", "for"]);

function normalizeBulletText(bullet) {
  const text = String(bullet || "")
    .toLowerCase()
    .trim()
    .replace(/[;:,.!?]{2,}/g, ".")
    .replace(/\s+/g, " ")
    .replace(/^[,.;:!?]+|[,.;:!?]+$/g, "");

  return text
    .replace(/\blegs\b/g, "leg")
    .replace(/\bwooden\b/g, "wood")
    .replace(/\barmrests\b/g, "armrest")
    .replace(/\bbackrests\b/g, "backrest")
    .replace(/\bsides\b/g, "side")
    .replace(/\bpanels\b/g, "panel")
    .replace(/\bcushions\b/g, "cushion")
    .replace(/\b(\w+)\s+\1\b/g, "$1");
}

function tokenizeForCompare(text) {
  return normalizeWhitespace(String(text || ""))
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((token) => {
      if (token === "backrest") return "back";
      if (token === "armrest") return "arm";
      if (token === "curved") return "curve";
      if (token === "rounded") return "round";
      if (token === "angled") return "angle";
      if (token === "tall") return "high";
      return token;
    })
    .filter((token) => token && !STOP_WORDS.has(token));
}

function countSharedTokens(aTokens, bTokens) {
  const bSet = new Set(bTokens);
  return aTokens.filter((token) => bSet.has(token)).length;
}

function detectComponentGroup(bullet) {
  if (/\bleg\b/.test(bullet)) return "legs";
  if (/\bbase\b|\bplinth\b|\bpedestal\b/.test(bullet)) return "base";
  if (/\bframe\b/.test(bullet)) return "frame";
  if (/\bback\b|\bbackrest\b/.test(bullet)) return "back";
  if (/\barm\b|\barms\b|\barmrest\b/.test(bullet)) return "arms";
  if (/\bseat\b|\bcushion\b/.test(bullet)) return "seat";
  if (/\bshell\b/.test(bullet)) return "shell";
  if (/\btop\b|\btabletop\b/.test(bullet)) return "top";
  if (/\bmaterial\b|\bwood\b|\bmetal\b|\bfabric\b|\bleather\b|\bmesh\b/.test(bullet)) return "material";
  if (/\bcurved\b|\brounded\b|\bboxy\b|\bangular\b|\bmonolithic\b|\bfloating\b|\bcompact\b|\btall\b/.test(bullet)) return "form";
  return "misc";
}

function isLowValueBullet(bullet) {
  if (!bullet) return true;
  if (LOW_VALUE_BULLET_BLOCKLIST.has(bullet)) return true;

  if (/\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b.*\b(leg|caster|wheel|arm)\b/.test(bullet)) {
    return true;
  }

  const words = bullet.split(" ").filter(Boolean);
  if (words.length <= 2 && words.some((word) => OBJECT_NOUNS.has(word))) {
    return true;
  }

  const hasMaterial = words.some((word) => MATERIAL_WORDS.has(word));
  const componentCount = words.filter((word) => COMPONENT_NOUNS.has(word)).length;
  const hasAbstract = words.some((word) => ABSTRACT_TERMS.has(word));
  if (hasAbstract && !hasMaterial && componentCount <= 1 && words.length >= 3) {
    return true;
  }

  return false;
}

function bulletScore(bullet) {
  const words = bullet.split(" ").filter(Boolean);
  let score = 0;
  for (const word of words) {
    if (MATERIAL_WORDS.has(word)) score += 3;
    if (COMPONENT_NOUNS.has(word)) score += 3;
    if (QUALIFIER_WORDS.has(word)) score += 2;
  }
  if (words.length >= 3) score += 1;
  if (words.length >= 5) score += 1;
  return score;
}

function strongOverlap(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;

  const aTokens = tokenizeForCompare(a);
  const bTokens = tokenizeForCompare(b);
  const shared = countSharedTokens(aTokens, bTokens);

  if (a.includes(b) || b.includes(a)) {
    return true;
  }

  const sameGroup = detectComponentGroup(a) === detectComponentGroup(b) && detectComponentGroup(a) !== "misc";
  if (sameGroup && shared >= 2) {
    return true;
  }

  const denom = Math.max(aTokens.length, bTokens.length, 1);
  return shared / denom >= 0.7;
}

export function cleanVisualHighlights(bullets = []) {
  const normalized = uniqueStrings((bullets || []).map((value) => normalizeBulletText(value)).filter(Boolean));
  const filtered = normalized.filter((bullet) => !isLowValueBullet(bullet));

  const deduped = [];
  for (const bullet of filtered) {
    const overlapIndex = deduped.findIndex((kept) => strongOverlap(bullet, kept));
    if (overlapIndex === -1) {
      deduped.push(bullet);
      continue;
    }
    if (bulletScore(bullet) > bulletScore(deduped[overlapIndex])) {
      deduped[overlapIndex] = bullet;
    }
  }

  return deduped.slice(0, 8);
}

function traitsToPhrasesTyped(visualTraits = {}) {
  return uniqueStrings([
    visualTraits.base_type,
    visualTraits.base_material ? `${visualTraits.base_material} base` : "",
    visualTraits.leg_material ? `${visualTraits.leg_material} legs` : "",
    visualTraits.leg_style,
    visualTraits.frame_material ? `${visualTraits.frame_material} frame` : "",
    visualTraits.frame_finish ? `${visualTraits.frame_finish} finish` : "",
    visualTraits.back_construction,
    visualTraits.back_support_type,
    visualTraits.arm_adjustability,
    visualTraits.arm_material ? `${visualTraits.arm_material} arms` : visualTraits.arm_type && visualTraits.arm_type !== "no arms" ? "arms" : visualTraits.arm_type === "no arms" ? "armless" : "",
    visualTraits.seat_material,
    visualTraits.back_material,
    ...(visualTraits.dominant_materials || []),
    ...(visualTraits.secondary_materials || []),
    ...(visualTraits.material_details || []),
    ...(visualTraits.notable_features || [])
  ]).map((phrase) => normalizeWhitespace(phrase));
}

async function createTypedCaption(imageInput, options = {}, imageRecord = {}) {
  const imageDimensions = options.precomputedImageDimensions || await enforceMatchingSafeResolution(imageInput.image_url, options);
  const requestedRuns = Number.isFinite(Number(options.extractionRuns))
    ? Math.max(2, Number(options.extractionRuns))
    : 3;
  const run1 = await runStage123Extraction(imageInput, options, imageRecord, "run_1");
  if (isStage1OverrideResult(run1.stage1)) {
    return {
      image_dimensions: imageDimensions,
      stage1: {
        result: normalizeStage1Result(run1.stage1?.result),
        seating_type: "",
        override_reason: run1.stage1?.override_reason || null
      },
      stage2: {
        silhouette: "",
        proportions: "",
        structure_type: "",
        back_geometry: "",
        seat_geometry: "",
        arm_geometry: "",
        surface_language: "",
        design_register: "",
        distinctive_elements: [],
        visual_summary: ""
      },
      stage3: {
        structured_caption: "",
        raw_visual_highlights: [],
        image_traits: {}
      },
      structured_caption: "",
      raw_visual_highlights: [],
      visual_highlights: [],
      seating_type: "",
      image_traits: {},
      spec_traits: {},
      merged_traits: {},
      trait_provenance: {},
      visual_traits: toLegacyVisualTraits("", {}),
      field_confidence: {
        stage1: {
          result: 1,
          seating_type: 0
        }
      },
      extraction_runs: 1,
      extraction_consensus: {
        tiebreaker_used: false,
        runs: [
          {
            run: run1.run_label,
            stage1: run1.usage.stage1,
            stage23: run1.usage.stage23,
            total: run1.usage.total,
            estimated_cost_usd: run1.usage.estimated_cost_usd
          }
        ],
        total_usage: {
          ...run1.usage.total,
          estimated_cost_usd: estimateUsageCostUsd(run1.usage.total)
        }
      }
    };
  }
  const run2 = await runStage123Extraction(imageInput, options, imageRecord, "run_2");
  const selectedRuns = [run1, run2];
  if (!allFieldsAgree(run1, run2) && requestedRuns >= 3) {
    selectedRuns.push(await runStage123Extraction(imageInput, options, imageRecord, "run_3"));
  }

  const voted = voteStage123Runs(selectedRuns);
  const stage1 = voted.stage1;
  const seatingType = ensureTypeKey(stage1.seating_type);
  const stage2 = voted.stage2;
  const stage3 = voted.stage3;

  const fieldMap = getFieldMap(seatingType);
  const imageTraits = {};
  for (const [fieldName, value] of Object.entries(stage3.image_traits || {})) {
    const field = fieldMap.get(fieldName);
    if (!field) continue;
    imageTraits[fieldName] = normalizeEnum(value, field.allowed_values);
  }

  const specTraits = await extractSpecTraits(seatingType, imageRecord);
  const { merged_traits, trait_provenance } = mergeTraits(seatingType, imageTraits, specTraits);

  const visualTraits = toLegacyVisualTraits(seatingType, merged_traits);
  const deterministicBullets = buildDeterministicBulletsFromMergedTraits(seatingType, merged_traits);
  const perRunUsage = selectedRuns.map((run) => ({
    run: run.run_label,
    stage1: run.usage.stage1,
    stage23: run.usage.stage23,
    total: run.usage.total,
    estimated_cost_usd: run.usage.estimated_cost_usd
  }));
  const totalUsage = sumUsage(...perRunUsage.map((entry) => entry.total));

  return {
    image_dimensions: imageDimensions,
    stage1,
    stage2,
    stage3,
    structured_caption: stage3.structured_caption,
    raw_visual_highlights: stage3.raw_visual_highlights,
    visual_highlights: deterministicBullets,
    seating_type: seatingType,
    image_traits: imageTraits,
    spec_traits: specTraits,
    merged_traits,
    trait_provenance,
    visual_traits: visualTraits,
    field_confidence: voted.field_confidence,
    extraction_runs: selectedRuns.length,
    extraction_consensus: {
      tiebreaker_used: selectedRuns.length === 3,
      runs: perRunUsage,
      total_usage: {
        ...totalUsage,
        estimated_cost_usd: estimateUsageCostUsd(totalUsage)
      }
    }
  };
}

export async function generateCaption(imageRecord, options = {}) {
  const provider = options.provider || "demo";
  const usedOpenAi = provider === "openai" && Boolean(options.apiKey);
  const caption = await createTypedCaption(
    {
      image_url: imageRecord.image_url,
      catalogContext: `Catalog context: name="${imageRecord.name}", brand="${imageRecord.brand}", category="${imageRecord.category}".`
    },
    {
      ...options,
      apiKey: provider === "openai" ? options.apiKey : null
    },
    imageRecord
  );
  const visualSummary = caption.stage2?.visual_summary || "";
  const visualSummaryEmbedding = usedOpenAi
    ? await embedTextWithOpenAi(visualSummary, {
        apiKey: options.apiKey,
        model: options.embeddingModel || process.env.EMBEDDING_MODEL || "text-embedding-3-small"
      })
    : [];

  return {
    ...caption,
    caption_embedding: visualSummaryEmbedding,
    visual_description_embedding: visualSummaryEmbedding,
    visual_summary_embedding: visualSummaryEmbedding,
    caption_model_version: usedOpenAi ? `openai:${options.visionModel || "gpt-4.1"}` : "demo:typed-v1",
    embedding_model_version: usedOpenAi
      ? `openai:${options.embeddingModel || process.env.EMBEDDING_MODEL || "text-embedding-3-small"}`
      : "missing"
  };
}

function sortValueForVote(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortValueForVote(item)).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort((a, b) => a.localeCompare(b))
        .map((key) => [key, sortValueForVote(value[key])])
    );
  }
  if (typeof value === "string") {
    return normalizeWhitespace(value);
  }
  return value;
}

function fieldConfidenceLabel(agreeingVotes, totalVotes) {
  if (totalVotes === 2 && agreeingVotes === 2) return "high";
  if (totalVotes === 3 && agreeingVotes === 3) return "high";
  if (totalVotes === 3 && agreeingVotes === 2) return "medium";
  return "low";
}

function cloneKnownValue(value) {
  return sortValueForVote(value);
}

function isUnknownVoteValue(value) {
  if (value == null) return true;
  if (typeof value === "string") {
    const normalized = normalizeWhitespace(value).toLowerCase();
    return !normalized || normalized === "unknown";
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (typeof value === "object") {
    return Object.keys(value).length === 0;
  }
  return false;
}

function voteFieldValues(values = []) {
  const tally = new Map();

  for (const value of values) {
    const sorted = sortValueForVote(value);
    const key = valueVoteKey(sorted);
    if (!tally.has(key)) {
      tally.set(key, { count: 0, value: sorted });
    }
    tally.get(key).count += 1;
  }

  const ranked = [...tally.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return JSON.stringify(a.value).localeCompare(JSON.stringify(b.value));
  });
  const winner = ranked[0];
  const totalVotes = values.length;
  const unanimousDisagreement = totalVotes === 3 && winner?.count === 1 && ranked.length === 3;
  const value = unanimousDisagreement ? "unknown" : cloneKnownValue(winner?.value);
  return {
    value,
    confidence: fieldConfidenceLabel(unanimousDisagreement ? 1 : (winner?.count || 0), totalVotes),
    agreed_votes: unanimousDisagreement ? 1 : (winner?.count || 0),
    total_votes: totalVotes
  };
}

function buildEnumComparisonSnapshot(run = {}) {
  return {
    result: run.stage1?.result || "product",
    seating_type: run.stage1?.seating_type || "other_seating",
    design_register: run.stage2?.design_register || "unknown",
    image_traits: run.stage3?.image_traits || {}
  };
}

function voteNamedFields(keys = [], runs = [], selector) {
  const values = {};
  const confidence = {};

  for (const key of keys) {
    const vote = voteFieldValues(runs.map((run) => selector(run, key)));
    values[key] = vote.value;
    confidence[key] = vote.confidence;
  }

  return { values, confidence };
}

function estimateUsageCostUsd(usage = {}) {
  return Number((((usage.prompt_tokens || 0) * GPT_41_INPUT_COST_PER_TOKEN) + ((usage.completion_tokens || 0) * GPT_41_OUTPUT_COST_PER_TOKEN)).toFixed(6));
}

function estimateNanoUsageCostUsd(usage = {}) {
  return Number((((usage.prompt_tokens || 0) * GPT_41_NANO_INPUT_COST_PER_TOKEN) + ((usage.completion_tokens || 0) * GPT_41_NANO_OUTPUT_COST_PER_TOKEN)).toFixed(6));
}

function sumUsage(...entries) {
  return entries.reduce((acc, usage) => ({
    prompt_tokens: acc.prompt_tokens + Number(usage?.prompt_tokens || 0),
    completion_tokens: acc.completion_tokens + Number(usage?.completion_tokens || 0),
    total_tokens: acc.total_tokens + Number(usage?.total_tokens || 0)
  }), { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
}

export function buildStage1ClassificationPrompt() {
  return `Classify the primary furniture item in the image.
Return JSON only.
Use the catalog context only as a disambiguation hint, not as override.

Step 1: First assess whether this is a product_detail shot.
- Determine whether at least approximately 75% of the full product is visible.
- Check specifically:
  - Is the base visible?
- Is the full silhouette of the product visible?
- Is this a close-up of a single component such as fabric, stitching, an arm, a leg, or a headrest?
- If less than approximately 75% of the full product is visible, return {"result":"product_detail","seating_type":"","override_reason":"..."} and stop. The override_reason must briefly explain why this is a detail shot.

Step 2: If this is not a product_detail shot, assess whether the image should be treated as a scene.
- If more than one seating product is substantially visible and the non-primary seating is not just faint background presence, return scene.
- Do not call it scene merely because it is photographed in a real room. A hero shot in a real room is still product if one seating product is clearly dominant and the room is secondary.
- If this is a scene, return {"result":"scene","seating_type":"","override_reason":"..."} and stop. The override_reason must briefly explain why this is a scene.

Step 3: If this is neither product_detail nor scene, classify the image into a seating type.
- Return {"result":"product","seating_type":"...","override_reason":""}.
- Choose exactly one seating_type from the enum.

Type hints:
- task_collab_chair: task, conference, classroom, or collaborative chair with a 5-star, sled, or 4-leg base and moderate to high adjustability
- lounge_chair: low or relaxed seating including single lounge chairs, sofas, modular lounge pieces, wrapped-shell lounge forms, pedestal lounge chairs, high-back privacy chairs, and backless upholstered companion pieces such as poufs or footrests
- stool: elevated, perch, saddle, or wobble stool with no back or a low back, for counter, bar, drafting, or active seating
- guest_chair: side chair or visitor chair, 4-leg or sled base, minimal adjustability
- bench: multi-person seat without individual back support, long seat surface
- other_seating: use only if the item genuinely does not fit any of the above types.`;
}

async function classifySeatingTypeOpenAiWithMeta(imageInput, options = {}) {
  if (!options.apiKey) {
    return {
      data: await classifySeatingTypeOpenAi(imageInput, options),
      usage: normalizeOpenAiUsage()
    };
  }

  const result = await callOpenAiJsonWithMeta({
    apiKey: options.apiKey,
    model: options.visionModel || "gpt-4.1",
    systemPrompt: buildStage1ClassificationPrompt(),
    userParts: [
      ...(imageInput.catalogContext
        ? [{ type: "input_text", text: imageInput.catalogContext }]
        : []),
      { type: "input_image", image_url: imageInput.image_url, detail: "high" }
    ],
    schemaName: "seating_type_classifier",
    schema: classifySchema()
  });

  return {
    data: normalizeStage1Classification(result.data),
    usage: result.usage
  };
}

function normalizeStage1Classification(parsed = {}) {
  const result = normalizeStage1Result(parsed?.result);
  const overrideReason = result === "product_detail" || result === "scene"
    ? normalizeWhitespace(parsed?.override_reason || "")
    : "";
  return {
    result,
    seating_type: result === "product" ? ensureTypeKey(parsed?.seating_type) : "",
    override_reason: overrideReason || null
  };
}

async function classifyStage0ProductSceneWithMeta(imageInput, options = {}) {
  if (!options.apiKey) {
    return {
      data: { result: "product" },
      usage: normalizeOpenAiUsage()
    };
  }

  const result = await callOpenAiJsonWithMeta({
    apiKey: options.apiKey,
    model: options.stage0Model || "gpt-4.1-nano",
    systemPrompt: `Look at the image. Answer two questions in order.
Question 1: Is there exactly one complete furniture product visible that is clearly the main subject of the image?
A furniture product is a substantial standalone furniture piece - chair, sofa, stool, bench, table, desk, shelving, cabinet, storage piece, workstation, booth, pod, or similar. Not small accessories (lamps, vases, plants, cushions, artwork).
"Complete" means you can see the whole product - its full silhouette, base or legs, and structural form - not a close-up of one component.
A product counts as one even if it has integrated parts (e.g., a chair with an attached side table, a modular sofa with multiple cushions). Multiple cushions on one sofa is one product. A separate companion footrest shown alongside a chair counts as two products.
If yes -> return {"result": "product"} and stop.
If no, continue to Question 2.
Question 2: Is the "no" because the image is a close-up showing only part of a single product (for example, a detail shot of fabric, stitching, an arm, a leg, hardware, or a joint), rather than the whole product?
If yes -> return {"result": "product_detail"} and stop.
If no (the image shows multiple products, or shows no product clearly, or focuses on an environment/room rather than a single product) -> return {"result": "scene"} and stop.
Return JSON only, no additional commentary.`,
    userParts: [
      ...(imageInput.catalogContext
        ? [{ type: "input_text", text: imageInput.catalogContext }]
        : []),
      { type: "input_image", image_url: imageInput.image_url, detail: "low" }
    ],
    schemaName: "stage0_scene_filter",
    schema: stage0Schema()
  });

  return {
    data: {
      result: stage0ResultEnum.includes(result.data?.result) ? result.data.result : "scene"
    },
    usage: result.usage
  };
}

export async function classifyImageStage0Only(imageRecord = {}, options = {}) {
  const categories = normalizeCategories(imageRecord);
  const imageDimensions = options.precomputedImageDimensions ||
    (imageRecord.image_width && imageRecord.image_height
      ? { width: Number(imageRecord.image_width), height: Number(imageRecord.image_height) }
      : await enforceMatchingSafeResolution(imageRecord.image_url, options));
  const imageInput = {
    image_url: imageRecord.image_url,
    catalogContext: `Catalog context: name="${imageRecord.name || imageRecord.product_name || ""}", brand="${imageRecord.brand || ""}", categories="${[...categories.a_level, ...categories.b_level, ...categories.c_level].join(" | ")}".`
  };
  const { data, usage } = await classifyStage0ProductSceneWithMeta(imageInput, {
    ...options,
    precomputedImageDimensions: imageDimensions
  });
  return {
    stage0_result: data.result,
    usage,
    estimated_cost_usd: estimateNanoUsageCostUsd(usage),
    image_dimensions: imageDimensions
  };
}

function flattenFieldConfidence(voted = {}) {
  return {
    seating_type: String(voted?.field_confidence?.stage1?.seating_type || "high"),
    design_register: String(voted?.field_confidence?.stage2?.design_register || "high"),
    ...(voted?.field_confidence?.image_traits || {})
  };
}

function buildSinglePassFieldConfidence(seatingType = "", enumFields = {}) {
  const normalizedSeatingType = String(seatingType || "").trim();
  const confidence = {
    seating_type: normalizedSeatingType ? "high" : "low"
  };

  Object.keys(enumFields || {}).forEach((field) => {
    confidence[field] = "high";
  });

  return confidence;
}

function buildFreeText(stage2 = {}, stage3 = {}) {
  return {
    reasoning: String(stage3?.reasoning || "").trim(),
    visual_summary: String(stage2?.visual_summary || "").trim(),
    structured_caption: String(stage3?.structured_caption || "").trim(),
    silhouette: String(stage2?.silhouette || "").trim(),
    proportions: String(stage2?.proportions || "").trim(),
    structure_type: String(stage2?.structure_type || "").trim(),
    back_geometry: String(stage2?.back_geometry || "").trim(),
    seat_geometry: String(stage2?.seat_geometry || "").trim(),
    arm_geometry: String(stage2?.arm_geometry || "").trim(),
    surface_language: String(stage2?.surface_language || "").trim(),
    distinctive_elements: uniqueStrings(Array.isArray(stage2?.distinctive_elements) ? stage2.distinctive_elements : [])
  };
}

function buildSearchableText({ productName = "", brand = "", seatingType = "", enumFields = {}, freeText = {} }) {
  const enumParts = Object.entries(enumFields || {})
    .map(([field, value]) => {
      const normalized = String(value || "").trim();
      return !normalized || normalized.toLowerCase() === "unknown" ? "" : `${field.replace(/_/g, " ")} ${normalized}`;
    })
    .filter(Boolean);

  return normalizeWhitespace([
    productName,
    brand,
    seatingType ? `seating type ${seatingType.replace(/_/g, " ")}` : "",
    ...enumParts,
    freeText.visual_summary,
    freeText.structured_caption,
    freeText.silhouette,
    freeText.proportions,
    freeText.structure_type,
    freeText.back_geometry,
    freeText.seat_geometry,
    freeText.arm_geometry,
    freeText.surface_language,
    ...(Array.isArray(freeText.distinctive_elements) ? freeText.distinctive_elements : [])
  ].filter(Boolean).join(". "));
}

const SEARCH_TIME_BULLET_FIELD_PRIORITY = [
  "body_construction",
  "arm_configuration",
  "arm_option",
  "back_height",
  "back_style",
  "back_profile",
  "back",
  "configuration",
  "seat_upholstery",
  "seat_geometry",
  "seat_material",
  "seat_finish",
  "back_upholstery",
  "back_finish",
  "design_register",
  "frame",
  "frame_openness",
  "shape_character",
  "plan_shape",
  "base_material",
  "base_visibility",
  "base_type",
  "base_finish",
  "base_frame_finish"
];

function buildSearchTimeBullets(enumFields = {}, typeKey = "") {
  const priorityIndex = new Map(
    SEARCH_TIME_BULLET_FIELD_PRIORITY.map((field, index) => [field, index])
  );

  const selectedBullets = {
    essential: [],
    normal: [],
    low: []
  };

  Object.entries(enumFields || {})
    .sort(([fieldA], [fieldB]) => {
      const aIndex = priorityIndex.has(fieldA) ? priorityIndex.get(fieldA) : Number.MAX_SAFE_INTEGER;
      const bIndex = priorityIndex.has(fieldB) ? priorityIndex.get(fieldB) : Number.MAX_SAFE_INTEGER;
      if (aIndex !== bIndex) {
        return aIndex - bIndex;
      }
      return fieldA.localeCompare(fieldB);
    })
    .map(([field, value]) => {
      const normalized = String(value || "").trim();
      if (!normalized || ["unknown", "n/a"].includes(normalized.toLowerCase())) {
        return "";
      }
      if (/\b(no|none|not visible|concealed|unknown|without|absent|hidden)\b/i.test(normalized)) {
        return "";
      }
      return `${field.replace(/_/g, " ")}: ${normalized}`;
    })
    .filter(Boolean)
    .forEach((bullet) => {
      const field = bullet.split(":")[0].trim().replace(/\s+/g, "_");
      const priority = getFieldPriority(typeKey, field);
      if (priority === "essential") {
        selectedBullets.essential.push(bullet);
      } else if (priority === "low") {
        selectedBullets.low.push(bullet);
      } else {
        selectedBullets.normal.push(bullet);
      }
    });

  return selectedBullets;
}

function buildDeterministicTextQueryEnumFields(query = "", seatingType = "") {
  const normalizedSeatingType = String(seatingType || "").trim();
  const heuristicTraits = extractQueryTraits(query);
  const enumFields = {};

  if (normalizedSeatingType) {
    enumFields.seating_type = normalizedSeatingType;
  }

  if (normalizedSeatingType === "lounge_chair") {
    if (heuristicTraits.arms_present === false) {
      enumFields.arm_configuration = "Armless";
    } else if (heuristicTraits.arms_present === true) {
      enumFields.arm_configuration = "Two arms";
    }
  } else if (normalizedSeatingType === "task_collab_chair" || normalizedSeatingType === "guest_chair") {
    if (heuristicTraits.arms_present === false) {
      enumFields.arm_option = "Armless";
    } else if (heuristicTraits.arm_adjustability === "fully adjustable" || heuristicTraits.arm_adjustability === "height-adjustable") {
      enumFields.arm_option = "Adjustable arms";
    } else if (heuristicTraits.arms_present === true) {
      enumFields.arm_option = normalizedSeatingType === "guest_chair" ? "Open arm" : "Fixed arms";
    }
  }

  return enumFields;
}

const TEXT_QUERY_TRAIT_SYSTEM_PROMPT = `You are a furniture attribute extractor. Given a text description or search query for seating, extract any structured traits that are clearly stated or strongly implied. Return JSON only with these fields. Only populate traits relevant to the described seating_type. Return unknown for anything not mentioned or strongly implied. Never guess.

Fields to extract:
- seating_type: task_collab_chair | lounge_chair | stool | guest_chair | bench | other_seating
- back_style: Mesh / net | Upholstered | Plastic back | Knit
- back_profile: Square / angular | Rounded / curved
- arm_option: Armless | Fixed arms | Adjustable arms | Open arm | Closed arm | Integrated
- body_construction: Upholstered | Molded plastic shell | Molded plywood shell | Suspended / sling | Panel / privacy enclosure
- arm_configuration: Armless | One arm | Two arms | Integrated / sculpted
- back_height: Low | Mid | High | Full enclosure
- back: Backless | Low back | Full back
- configuration: Single seat | Multi-seat / sofa | Modular component | Corner unit
- seat_upholstery: Fabric | Leather | None / unupholstered
- seat_geometry: Flat | Angled / perch | Saddle | Wobble / balance
- seat_material: Upholstered | Solid wood | Molded plastic
- seat_finish: Fabric | Leather | Molded plastic | Wood
- back_upholstery: Matches seat | Independent fabric | Unupholstered shell
- back_finish: Fabric | Leather | Mesh / net | Molded plastic | Wood | Unupholstered
- mobility: Casters | Non-mobile
- design_register: Minimal | Organic | Industrial | Traditional | Sculptural | Utilitarian
- frame: Plastic | Aluminum | Metal
- frame_openness: Open / see-through | Closed / solid
- base_visibility: Exposed | Integrated
- base_type: 5-star with casters | 5-star with glides | Sled base | 4-leg | Sled | Cantilever | Pedestal | Molded one-piece | Square plate / plinth | Integrated base | Casters
- base_material: Wood | Other
- base_finish: Black | White | Polished aluminum | Painted color | Natural wood | Polished | Wood | Painted / powder coat
- base_frame_finish: Black | White | Polished aluminum | Painted color | Natural wood
- shape_character: Soft / tapered | Boxy
- plan_shape: Round / semicircular | Trapezoidal | Reverse trapezoidal | Square / rectangular | N/A

Mapping guidance:
- "no base", "without base", "floating", "no visible legs", "concealed base", "integrated base" -> Integrated
- "visible base", "exposed legs" -> Exposed
- Not mentioned -> unknown`;

const TEXT_QUERY_TRAIT_FIELDS = new Set([
  "seating_type",
  "back_style",
  "back_profile",
  "arm_option",
  "body_construction",
  "arm_configuration",
  "back_height",
  "back",
  "configuration",
  "seat_upholstery",
  "seat_geometry",
  "seat_material",
  "seat_finish",
  "back_upholstery",
  "back_finish",
  "mobility",
  "design_register",
  "frame",
  "frame_openness",
  "base_visibility",
  "base_type",
  "base_material",
  "base_finish",
  "base_frame_finish",
  "shape_character",
  "plan_shape"
]);

export const TEXT_QUERY_CATEGORY_KEYS = [
  "task_collab_chair",
  "guest_chair",
  "lounge_chair",
  "bench",
  "stool",
  "other_seating"
];

function textQueryCategoryInferenceSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      category_key: {
        type: "string",
        enum: [...TEXT_QUERY_CATEGORY_KEYS, "category_required"]
      }
    },
    required: ["category_key"]
  };
}

function buildTextQueryCategoryInferencePrompt() {
  return `Determine which seating category a user query most likely refers to.

Available categories:
- task_collab_chair: Task & Collaborative Chair. Desk, office, conference, classroom, or ergonomic work chairs, often upright and may have casters or adjustability.
- guest_chair: Side & Guest Chair. Visitor, reception, side, stacking, nesting, or multipurpose guest seating with limited adjustability.
- lounge_chair: Lounge Chair. Lounge chairs, club chairs, accent chairs, sofas, modular lounge pieces, privacy lounge seating, and backless upholstered companion pieces such as poufs or footrests for relaxed posture.
- bench: Bench. Benches and banquettes intended for multiple people on one continuous seat.
- stool: Stool. Bar stools, counter stools, drafting stools, perch stools, saddle stools, and active stools.
- other_seating: Other Seating. Seating-related products that genuinely do not fit the categories above, such as booths, meeting pods, or unusual seating systems.

Return a single high-confidence category_key when the query clearly points to one category.
Return category_required only when the query is genuinely ambiguous or too generic to resolve confidently.

Return JSON only.`;
}

export async function inferTextQueryCategory(query = "", options = {}) {
  const normalizedQuery = normalizeWhitespace(query).toLowerCase();
  if (!normalizedQuery) {
    return {
      status: "category_required",
      confidence: "low",
      options: [...TEXT_QUERY_CATEGORY_KEYS]
    };
  }

  if (!options.apiKey) {
    return {
      status: "category_required",
      confidence: "low",
      options: [...TEXT_QUERY_CATEGORY_KEYS]
    };
  }

  try {
    const result = await callOpenAiJsonWithMeta({
      apiKey: options.apiKey,
      model: options.model || "gpt-4o-mini",
      systemPrompt: buildTextQueryCategoryInferencePrompt(),
      userParts: [
        { type: "input_text", text: normalizedQuery }
      ],
      schemaName: "text_query_category_inference",
      schema: textQueryCategoryInferenceSchema()
    });

    const categoryKey = String(result.data?.category_key || "").trim().toLowerCase();
    if (!categoryKey || categoryKey === "category_required" || !TEXT_QUERY_CATEGORY_KEYS.includes(categoryKey)) {
      return {
        status: "category_required",
        confidence: "low",
        options: [...TEXT_QUERY_CATEGORY_KEYS]
      };
    }

    return {
      status: "resolved",
      confidence: "high",
      category_key: categoryKey,
      options: [...TEXT_QUERY_CATEGORY_KEYS],
      matched_terms: []
    };
  } catch {
    return {
      status: "category_required",
      confidence: "low",
      options: [...TEXT_QUERY_CATEGORY_KEYS]
    };
  }
}

export async function extractTextQueryTraits(query = "", options = {}) {
  const normalizedQuery = normalizeWhitespace(query);
  const deterministicEnumFields = buildDeterministicTextQueryEnumFields(
    normalizedQuery,
    options.seatingType
  );
  if (!normalizedQuery || !options.apiKey) {
    return {
      enum_fields: deterministicEnumFields,
      search_bullets: buildSearchTimeBullets(deterministicEnumFields)
    };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.apiKey}`
      },
      body: JSON.stringify({
        model: options.model || "gpt-4.1-mini",
        response_format: {
          type: "json_object"
        },
        messages: [
          {
            role: "system",
            content: TEXT_QUERY_TRAIT_SYSTEM_PROMPT
          },
          {
            role: "user",
            content: normalizedQuery
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI text-query trait extraction failed with ${response.status}.`);
    }

    const payload = await response.json();
    const raw = String(payload?.choices?.[0]?.message?.content || "").trim();
    if (!raw) {
      throw new Error("OpenAI text-query trait extraction returned empty output.");
    }
    const parsed = JSON.parse(raw);
    const enumFields = {};

    for (const field of TEXT_QUERY_TRAIT_FIELDS) {
      const value = normalizeWhitespace(parsed?.[field]);
      if (!value || value.toLowerCase() === "unknown") {
        continue;
      }
      enumFields[field] = value;
    }

    const mergedEnumFields = {
      ...deterministicEnumFields,
      ...enumFields
    };

    return {
      enum_fields: mergedEnumFields,
      search_bullets: buildSearchTimeBullets(mergedEnumFields)
    };
  } catch (error) {
    console.error("Text-query trait extraction failed; continuing without generated bullets:", error);
    return {
      enum_fields: deterministicEnumFields,
      search_bullets: buildSearchTimeBullets(deterministicEnumFields)
    };
  }
}

function deriveOverallConfidence(fieldConfidence = {}) {
  const values = Object.values(fieldConfidence || {}).map((value) => String(value || "").toLowerCase()).filter(Boolean);
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

function normalizeCategories(record = {}) {
  return {
    a_level: uniqueStrings(record.a_level || []),
    b_level: uniqueStrings(record.b_level || []),
    c_level: uniqueStrings(record.c_level || [])
  };
}

async function embedSearchText(searchText = "", options = {}) {
  if (!options.apiKey || !String(searchText || "").trim()) {
    return [];
  }

  return embedTextWithOpenAi(searchText, {
    apiKey: options.apiKey,
    model: options.embeddingModel || process.env.EMBEDDING_MODEL || "text-embedding-3-small"
  });
}

export async function generateImageExtractionRecord(imageRecord = {}, options = {}) {
  const extractionTimestamp = new Date().toISOString();
  const categories = normalizeCategories(imageRecord);
  const imageDimensions = await enforceMatchingSafeResolution(imageRecord.image_url, options);
  const optionsWithDimensions = {
    ...options,
    precomputedImageDimensions: imageDimensions
  };
  const imageInput = {
    image_url: imageRecord.image_url,
    catalogContext: `Catalog context: name="${imageRecord.name || imageRecord.product_name || ""}", brand="${imageRecord.brand || ""}", categories="${[...categories.a_level, ...categories.b_level, ...categories.c_level].join(" | ")}".`
  };

  if (typeof options.progressCallback === "function") {
    options.progressCallback({
      type: "image_start",
      image_url: imageRecord.image_url,
      product_id: imageRecord.product_id || "",
      product_name: imageRecord.name || imageRecord.product_name || ""
    });
  }

  const { data: stage0, usage: stage0Usage } = await classifyStage0ProductSceneWithMeta(imageInput, optionsWithDimensions);
  const stage0Cost = estimateNanoUsageCostUsd(stage0Usage);

  if (typeof options.progressCallback === "function") {
    options.progressCallback({
      type: "stage0_complete",
      image_url: imageRecord.image_url,
      product_id: imageRecord.product_id || "",
      product_name: imageRecord.name || imageRecord.product_name || "",
      stage_0_result: stage0.result
    });
  }

  if (stage0.result === "scene" || stage0.result === "product_detail") {
    return buildExcludedImageExtractionResult({
      baseRecord: {
        image_id: imageRecord.image_id,
        image_url: imageRecord.image_url,
        product_id: imageRecord.product_id,
        product_name: imageRecord.name || imageRecord.product_name || "",
        name: imageRecord.name || imageRecord.product_name || "",
        brand: imageRecord.brand || ""
      },
      categories,
      stage0Result: stage0.result,
      stage1: { result: "", seating_type: "", override_reason: null },
      tokens: {
        stage_0: stage0Usage,
        total: stage0Usage
      },
      cost: {
        stage_0_usd: stage0Cost,
        total_usd: stage0Cost
      },
      extractionTimestamp,
      imageDimensions
    });
  }

  const pixelSeekType = getPixelSeekType(imageRecord);
  const routingTypeKey = resolveCatalogRoutingTypeKey(pixelSeekType);
  if (pixelSeekType === "SKIP" || !routingTypeKey) {
    return {
      ...buildExcludedImageExtractionResult({
      baseRecord: {
        image_id: imageRecord.image_id,
        image_url: imageRecord.image_url,
        product_id: imageRecord.product_id,
        product_name: imageRecord.name || imageRecord.product_name || "",
        name: imageRecord.name || imageRecord.product_name || "",
        brand: imageRecord.brand || ""
      },
      categories,
      stage0Result: stage0.result,
      stage1: buildCatalogRoutingStage1Stub(""),
      tokens: {
        stage_0: stage0Usage,
        total: stage0Usage
      },
      cost: {
        stage_0_usd: stage0Cost,
        total_usd: stage0Cost
      },
      extractionTimestamp,
      imageDimensions
      }),
      excluded_reason: "unmapped_category_grouping",
      pixelseek_type: null,
      type_routing_source: "mapping_v1"
    };
  }

  const run1 = await runStage23ExtractionWithType(imageInput, routingTypeKey, optionsWithDimensions, imageRecord, "run_1");
  const run2 = await runStage23ExtractionWithType(imageInput, routingTypeKey, optionsWithDimensions, imageRecord, "run_2");
  const runs = [run1, run2];
  const tiebreakerTriggered = !allFieldsAgree(run1, run2);

  if (tiebreakerTriggered) {
    runs.push(await runStage23ExtractionWithType(imageInput, routingTypeKey, optionsWithDimensions, imageRecord, "run_3"));
  }

  const voted = voteStage123Runs(runs);
  const freeText = buildFreeText(run1.stage2, run1.stage3);
  const enumFields = {
    design_register: String(voted.stage2?.design_register || "unknown"),
    ...(voted.stage3?.image_traits || {})
  };
  const derivedBaseMaterial = deriveBaseMaterialFromBaseFinish(routingTypeKey, enumFields);
  if (derivedBaseMaterial) {
    enumFields.base_material = derivedBaseMaterial;
  }
  const derivedBaseVisibility = deriveBaseVisibilityFromBaseType(routingTypeKey, enumFields);
  if (derivedBaseVisibility) {
    enumFields.base_visibility = derivedBaseVisibility;
  }
  const fieldConfidence = flattenFieldConfidence(voted);
  if (derivedBaseMaterial) {
    fieldConfidence.base_material = fieldConfidence.base_finish || "high";
  }
  if (derivedBaseVisibility) {
    fieldConfidence.base_visibility = fieldConfidence.base_type || "high";
  }
  const confidenceTier = deriveOverallConfidence(fieldConfidence);
  const usageTotal = sumUsage(stage0Usage, ...runs.map((run) => run.usage?.total));
  const searchText = buildSearchableText({
    productName: imageRecord.name || imageRecord.product_name || "",
    brand: imageRecord.brand || "",
    seatingType: routingTypeKey,
    enumFields,
    freeText
  });
  const searchTextEmbedding = await embedSearchText(searchText, options);
  const totalCostUsd = Number((
    stage0Cost +
    runs.reduce((sum, run) => sum + Number(run.usage?.estimated_cost_usd || 0), 0)
  ).toFixed(6));

  const result = {
    image_id: imageRecord.image_id,
    image_url: imageRecord.image_url,
    product_id: imageRecord.product_id,
    product_name: imageRecord.name || imageRecord.product_name || "",
    name: imageRecord.name || imageRecord.product_name || "",
    brand: imageRecord.brand || "",
    ...categories,
    ...buildClassificationFields({
      stage0Result: stage0.result,
      stage1Override: false,
      stage1: buildCatalogRoutingStage1Stub(routingTypeKey)
    }),
    stage_1_override: false,
    stage_1_override_result: null,
    stage_1_override_reason: null,
    seating_type: String(routingTypeKey || "other_seating"),
    pixelseek_type: String(pixelSeekType || "other_seating"),
    type_routing_source: "mapping_v1",
    enum_fields: enumFields,
    field_confidence: fieldConfidence,
    free_text: freeText,
    tiebreaker_triggered: tiebreakerTriggered,
    confidence_tier: confidenceTier,
    tokens: {
      stage_0: stage0Usage,
      runs: runs.map((run) => ({
        run: run.run_label,
        usage: run.usage?.total || normalizeOpenAiUsage()
      })),
      total: usageTotal
    },
    cost: {
      stage_0_usd: stage0Cost,
      runs: runs.map((run) => ({
        run: run.run_label,
        estimated_cost_usd: Number(run.usage?.estimated_cost_usd || 0)
      })),
      total_usd: totalCostUsd
    },
    extraction_timestamp: extractionTimestamp,
    excluded: false,
    image_traits: enumFields,
    visual_summary: freeText.visual_summary,
    structured_caption: freeText.structured_caption,
    stage1: buildCatalogRoutingStage1Stub(routingTypeKey),
    stage2: {
      visual_summary: freeText.visual_summary
    },
    visual_summary_embedding: searchTextEmbedding,
    search_text: searchText,
    search_text_embedding: searchTextEmbedding,
    ...buildImageDimensionFields(imageDimensions)
  };

  if (typeof options.progressCallback === "function") {
    options.progressCallback({
      type: "image_complete",
      image_url: imageRecord.image_url,
      product_id: imageRecord.product_id || "",
      product_name: imageRecord.name || imageRecord.product_name || "",
      tiebreaker_used: tiebreakerTriggered,
      estimated_cost_usd: totalCostUsd,
      extraction_runs: runs.length,
      confidence_tier: confidenceTier
    });
  }

  return result;
}

export async function regenerateImageExtractionRecordWithExistingStage0(imageRecord = {}, existingRecord = {}, options = {}) {
  const extractionTimestamp = new Date().toISOString();
  const categories = normalizeCategories(imageRecord);
  const imageDimensions = options.precomputedImageDimensions ||
    (existingRecord.image_width && existingRecord.image_height
      ? { width: Number(existingRecord.image_width), height: Number(existingRecord.image_height) }
      : await enforceMatchingSafeResolution(imageRecord.image_url, options));
  const optionsWithDimensions = {
    ...options,
    precomputedImageDimensions: imageDimensions
  };
  const productName = imageRecord.name || imageRecord.product_name || existingRecord.product_name || existingRecord.name || "";
  const brand = imageRecord.brand || existingRecord.brand || "";
  const normalizedStage0Result = String(existingRecord.stage_0_result || imageRecord.stage_0_result || "").trim().toLowerCase();
  const stage0Result = stage0ResultEnum.includes(normalizedStage0Result)
    ? normalizedStage0Result
    : "product";
  const imageInput = {
    image_url: imageRecord.image_url,
    catalogContext: `Catalog context: name="${productName}", brand="${brand}", categories="${[...categories.a_level, ...categories.b_level, ...categories.c_level].join(" | ")}".`
  };
  const preservedStage0Usage = existingRecord?.tokens?.stage_0 || normalizeOpenAiUsage();
  const preservedStage0Cost = Number(existingRecord?.cost?.stage_0_usd || 0);

  if (typeof options.progressCallback === "function") {
    options.progressCallback({
      type: "image_start",
      image_url: imageRecord.image_url,
      product_id: imageRecord.product_id || existingRecord.product_id || "",
      product_name: productName
    });
  }

  if (stage0Result === "scene" || stage0Result === "product_detail") {
    return buildExcludedImageExtractionResult({
      baseRecord: {
        ...existingRecord,
        image_id: imageRecord.image_id || existingRecord.image_id,
        image_url: imageRecord.image_url || existingRecord.image_url,
        product_id: imageRecord.product_id || existingRecord.product_id,
        product_name: productName,
        name: productName,
        brand
      },
      categories,
      stage0Result,
      stage1: existingRecord.stage1 || { result: "", seating_type: "", override_reason: null },
      tokens: existingRecord.tokens || {},
      cost: existingRecord.cost || {},
      extractionTimestamp,
      imageDimensions
    });
  }

  const pixelSeekType = getPixelSeekType(imageRecord) !== "SKIP"
    ? getPixelSeekType(imageRecord)
    : getPixelSeekType(existingRecord);
  const routingTypeKey = resolveCatalogRoutingTypeKey(pixelSeekType);
  if (pixelSeekType === "SKIP" || !routingTypeKey) {
    return {
      ...buildExcludedImageExtractionResult({
      baseRecord: {
        image_id: imageRecord.image_id || existingRecord.image_id,
        image_url: imageRecord.image_url || existingRecord.image_url,
        product_id: imageRecord.product_id || existingRecord.product_id,
        product_name: productName,
        name: productName,
        brand
      },
      categories,
      stage0Result,
      stage1: buildCatalogRoutingStage1Stub(""),
      tokens: existingRecord.tokens || {},
      cost: existingRecord.cost || {},
      extractionTimestamp,
      imageDimensions
      }),
      excluded_reason: "unmapped_category_grouping",
      pixelseek_type: null,
      type_routing_source: "mapping_v1"
    };
  }

  const run1 = await runStage23ExtractionWithType(imageInput, routingTypeKey, optionsWithDimensions, imageRecord, "run_1");
  const run2 = await runStage23ExtractionWithType(imageInput, routingTypeKey, optionsWithDimensions, imageRecord, "run_2");
  const runs = [run1, run2];
  const tiebreakerTriggered = !allFieldsAgree(run1, run2);

  if (tiebreakerTriggered) {
    runs.push(await runStage23ExtractionWithType(imageInput, routingTypeKey, optionsWithDimensions, imageRecord, "run_3"));
  }

  const voted = voteStage123Runs(runs);
  const freeText = buildFreeText(run1.stage2, run1.stage3);
  const enumFields = {
    design_register: String(voted.stage2?.design_register || "unknown"),
    ...(voted.stage3?.image_traits || {})
  };
  const derivedBaseMaterial = deriveBaseMaterialFromBaseFinish(routingTypeKey, enumFields);
  if (derivedBaseMaterial) {
    enumFields.base_material = derivedBaseMaterial;
  }
  const derivedBaseVisibility = deriveBaseVisibilityFromBaseType(routingTypeKey, enumFields);
  if (derivedBaseVisibility) {
    enumFields.base_visibility = derivedBaseVisibility;
  }
  const fieldConfidence = flattenFieldConfidence(voted);
  if (derivedBaseMaterial) {
    fieldConfidence.base_material = fieldConfidence.base_finish || "high";
  }
  if (derivedBaseVisibility) {
    fieldConfidence.base_visibility = fieldConfidence.base_type || "high";
  }
  const confidenceTier = deriveOverallConfidence(fieldConfidence);
  const usageTotal = sumUsage(preservedStage0Usage, ...runs.map((run) => run.usage?.total));
  const searchText = buildSearchableText({
    productName,
    brand,
    seatingType: routingTypeKey,
    enumFields,
    freeText
  });
  const searchTextEmbedding = await embedSearchText(searchText, options);
  const rerunCostUsd = Number(runs.reduce((sum, run) => sum + Number(run.usage?.estimated_cost_usd || 0), 0).toFixed(6));
  const totalCostUsd = Number((preservedStage0Cost + rerunCostUsd).toFixed(6));

  const result = {
    image_id: imageRecord.image_id || existingRecord.image_id,
    image_url: imageRecord.image_url || existingRecord.image_url,
    product_id: imageRecord.product_id || existingRecord.product_id,
    product_name: productName,
    name: productName,
    brand,
    ...categories,
    ...buildClassificationFields({
      stage0Result,
      stage1Override: false,
      stage1: buildCatalogRoutingStage1Stub(routingTypeKey)
    }),
    stage_1_override: false,
    stage_1_override_result: null,
    stage_1_override_reason: null,
    seating_type: String(routingTypeKey || "other_seating"),
    pixelseek_type: String(pixelSeekType || "other_seating"),
    type_routing_source: "mapping_v1",
    enum_fields: enumFields,
    field_confidence: fieldConfidence,
    free_text: freeText,
    tiebreaker_triggered: tiebreakerTriggered,
    confidence_tier: confidenceTier,
    tokens: {
      stage_0: preservedStage0Usage,
      runs: runs.map((run) => ({
        run: run.run_label,
        usage: run.usage?.total || normalizeOpenAiUsage()
      })),
      total: usageTotal
    },
    cost: {
      stage_0_usd: preservedStage0Cost,
      runs: runs.map((run) => ({
        run: run.run_label,
        estimated_cost_usd: Number(run.usage?.estimated_cost_usd || 0)
      })),
      total_usd: totalCostUsd
    },
    extraction_timestamp: extractionTimestamp,
    excluded: false,
    image_traits: enumFields,
    visual_summary: freeText.visual_summary,
    structured_caption: freeText.structured_caption,
    stage1: buildCatalogRoutingStage1Stub(routingTypeKey),
    stage2: {
      visual_summary: freeText.visual_summary
    },
    visual_summary_embedding: searchTextEmbedding,
    search_text: searchText,
    search_text_embedding: searchTextEmbedding,
    ...buildImageDimensionFields(imageDimensions)
  };

  if (typeof options.progressCallback === "function") {
    options.progressCallback({
      type: "image_complete",
      image_url: imageRecord.image_url,
      product_id: imageRecord.product_id || existingRecord.product_id || "",
      product_name: productName,
      tiebreaker_used: tiebreakerTriggered,
      estimated_cost_usd: rerunCostUsd,
      extraction_runs: runs.length,
      confidence_tier: confidenceTier
    });
  }

  return result;
}

async function runStage123Extraction(imageInput, options = {}, imageRecord = {}, runLabel = "run_1") {
  if (typeof options.progressCallback === "function") {
    options.progressCallback({
      type: "run_start",
      run_label: runLabel,
      image_url: imageInput.image_url,
      product_id: imageRecord?.product_id || "",
      product_name: imageRecord?.name || ""
    });
  }
  const { data: stage1, usage: stage1Usage } = await classifySeatingTypeOpenAiWithMeta(imageInput, options);
  if (isStage1OverrideResult(stage1)) {
    const usageTotal = sumUsage(stage1Usage, normalizeOpenAiUsage());
    return {
      run_label: runLabel,
      stage1,
      stage2: {
        silhouette: "",
        proportions: "",
        structure_type: "",
        back_geometry: "",
        seat_geometry: "",
        arm_geometry: "",
        surface_language: "",
        design_register: "",
        distinctive_elements: [],
        visual_summary: ""
      },
      stage3: {
        structured_caption: "",
        raw_visual_highlights: [],
        image_traits: {}
      },
      usage: {
        stage1: stage1Usage,
        stage23: normalizeOpenAiUsage(),
        total: usageTotal,
        estimated_cost_usd: estimateUsageCostUsd(usageTotal)
      }
    };
  }
  const seatingType = ensureTypeKey(stage1.seating_type);
  const { stage2, stage3, usage: stage23Usage } = await extractStage23CombinedOpenAi(imageInput, seatingType, stage1, options);

  const fieldMap = getFieldMap(seatingType);
  const imageTraits = {};
  for (const [fieldName, value] of Object.entries(stage3.image_traits || {})) {
    const field = fieldMap.get(fieldName);
    if (!field) continue;
    imageTraits[fieldName] = normalizeEnum(value, field.allowed_values);
  }

  const usageTotal = sumUsage(stage1Usage, stage23Usage);
  return {
    run_label: runLabel,
    stage1,
    stage2,
    stage3: {
      ...stage3,
      image_traits: imageTraits
    },
    usage: {
      stage1: stage1Usage,
      stage23: stage23Usage,
      total: usageTotal,
      estimated_cost_usd: estimateUsageCostUsd(usageTotal)
    }
  };
}

function buildCatalogRoutingStage1Stub(typeKey = "") {
  return {
    result: "product",
    seating_type: String(typeKey || "other_seating"),
    override_reason: null
  };
}

function resolveCatalogRoutingTypeKey(pixelSeekType = "") {
  const resolved = PIXELSEEK_TYPE_TO_ROUTING_KEY[String(pixelSeekType || "").trim()];
  return resolved || "";
}

async function runStage23ExtractionWithType(imageInput, typeKey, options = {}, imageRecord = {}, runLabel = "run_1") {
  if (typeof options.progressCallback === "function") {
    options.progressCallback({
      type: "run_start",
      run_label: runLabel,
      image_url: imageInput.image_url,
      product_id: imageRecord?.product_id || "",
      product_name: imageRecord?.name || ""
    });
  }

  const stage1 = buildCatalogRoutingStage1Stub(typeKey);
  const { stage2, stage3, usage: stage23Usage } = await extractStage23CombinedOpenAi(
    imageInput,
    typeKey,
    stage1,
    {
      ...options,
      typeRoutingSource: "mapping_v1"
    }
  );

  const fieldMap = getFieldMap(typeKey);
  const imageTraits = {};
  for (const [fieldName, value] of Object.entries(stage3.image_traits || {})) {
    const field = fieldMap.get(fieldName);
    if (!field) continue;
    imageTraits[fieldName] = normalizeEnum(value, field.allowed_values);
  }

  return {
    run_label: runLabel,
    stage1,
    stage2,
    stage3: {
      ...stage3,
      image_traits: imageTraits
    },
    usage: {
      stage1: normalizeOpenAiUsage(),
      stage23: stage23Usage,
      total: stage23Usage,
      estimated_cost_usd: estimateUsageCostUsd(stage23Usage)
    }
  };
}

function allFieldsAgree(runA, runB) {
  return valueVoteKey(buildEnumComparisonSnapshot(runA)) === valueVoteKey(buildEnumComparisonSnapshot(runB));
}

function voteStage123Runs(runs = []) {
  const stage1ResultVote = voteFieldValues(runs.map((run) => normalizeStage1Result(run.stage1?.result)));
  if (stage1ResultVote.value === "product_detail" || stage1ResultVote.value === "scene") {
    const winningRun = runs.find((run) => normalizeStage1Result(run.stage1?.result) === stage1ResultVote.value) || {};
    return buildStage1OverrideVoteResult(
      stage1ResultVote.value,
      winningRun.stage1?.override_reason || null,
      stage1ResultVote.confidence
    );
  }
  const primary = runs[0] || {};
  const seatingTypeVote = voteFieldValues(runs.map((run) => run.stage1?.seating_type || "other_seating"));
  const designRegisterVote = voteFieldValues(runs.map((run) => run.stage2?.design_register || "unknown"));
  const imageTraitKeys = [...new Set(runs.flatMap((run) => Object.keys(run.stage3?.image_traits || {})))].sort((a, b) => a.localeCompare(b));
  const imageTraitVote = voteNamedFields(imageTraitKeys, runs, (run, key) => run.stage3?.image_traits?.[key] ?? "unknown");

  return {
    stage1: {
      result: "product",
      seating_type: seatingTypeVote.value || "other_seating",
      override_reason: null
    },
    stage2: {
      silhouette: primary.stage2?.silhouette || "",
      proportions: primary.stage2?.proportions || "",
      structure_type: primary.stage2?.structure_type || "",
      back_geometry: primary.stage2?.back_geometry || "",
      seat_geometry: primary.stage2?.seat_geometry || "",
      arm_geometry: primary.stage2?.arm_geometry || "",
      surface_language: primary.stage2?.surface_language || "",
      design_register: designRegisterVote.value || "unknown",
      distinctive_elements: Array.isArray(primary.stage2?.distinctive_elements) ? primary.stage2.distinctive_elements : [],
      visual_summary: primary.stage2?.visual_summary || ""
    },
    stage3: {
      reasoning: primary.stage3?.reasoning || "",
      structured_caption: primary.stage3?.structured_caption || "",
      raw_visual_highlights: Array.isArray(primary.stage3?.raw_visual_highlights) ? primary.stage3.raw_visual_highlights : [],
      image_traits: imageTraitVote.values
    },
    field_confidence: {
      stage1: {
        result: stage1ResultVote.confidence,
        seating_type: seatingTypeVote.confidence
      },
      stage2: {
        design_register: designRegisterVote.confidence
      },
      stage3: {
        image_traits: imageTraitVote.confidence
      },
      image_traits: imageTraitVote.confidence
    }
  };
}

function valueVoteKey(value) {
  return JSON.stringify(sortValueForVote(value));
}

function pickMajorityValue(values = [], totalVotes = values.length) {
  const tallies = new Map();

  for (const value of values) {
    const key = valueVoteKey(value);
    if (!tallies.has(key)) {
      tallies.set(key, { count: 0, value: sortValueForVote(value) });
    }
    tallies.get(key).count += 1;
  }

  const winner = [...tallies.values()].sort((a, b) => {
    if (b.count !== a.count) {
      return b.count - a.count;
    }
    return JSON.stringify(a.value).localeCompare(JSON.stringify(b.value));
  })[0];

  return {
    value: winner?.value,
    confidence: totalVotes ? Number(((winner?.count || 0) / totalVotes).toFixed(4)) : 0
  };
}

function voteObjectFields(objects = []) {
  const keys = new Set(objects.flatMap((object) => Object.keys(object || {})));
  const values = {};
  const confidence = {};

  for (const key of keys) {
    const vote = pickMajorityValue(objects.map((object) => object?.[key]), objects.length);
    values[key] = vote.value;
    confidence[key] = vote.confidence;
  }

  return { values, confidence };
}

function voteHighlightList(lists = []) {
  const totalVotes = lists.length || 1;
  const counts = new Map();

  for (const list of lists) {
    for (const item of uniqueStrings((list || []).map((value) => normalizeWhitespace(value)).filter(Boolean))) {
      counts.set(item, (counts.get(item) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .filter(([, count]) => count / totalVotes >= 0.5)
    .sort((a, b) => {
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }
      return a[0].localeCompare(b[0]);
    })
    .map(([item]) => item);
}

function scoreRepresentative(entry, consensus) {
  let score = 0;

  if (entry.generated.seating_type === consensus.seating_type) {
    score += 1;
  }

  for (const [field, value] of Object.entries(consensus.merged_traits || {})) {
    if (valueVoteKey(entry.generated.merged_traits?.[field]) === valueVoteKey(value)) {
      score += 1;
    }
  }

  return score;
}

export function aggregateCaptionResults(entries = []) {
  if (!entries.length) {
    return null;
  }

  const seatingTypeVote = pickMajorityValue(entries.map((entry) => entry.generated.seating_type), entries.length);
  const imageTraitVote = voteObjectFields(entries.map((entry) => entry.generated.image_traits || {}));
  const specTraitVote = voteObjectFields(entries.map((entry) => entry.generated.spec_traits || {}));
  const mergedTraitVote = voteObjectFields(entries.map((entry) => entry.generated.merged_traits || {}));
  const visualTraitVote = voteObjectFields(entries.map((entry) => entry.generated.visual_traits || {}));
  const reasoningVote = pickMajorityValue(
    entries.map((entry) => normalizeWhitespace(
      entry.generated?.plan_shape_reasoning ||
      entry.generated?.reasoning ||
      entry.generated?.free_text?.reasoning ||
      ""
    )),
    entries.length
  );

  const consensus = {
    seating_type: seatingTypeVote.value || "other_seating",
    image_traits: applyLoungeChairPlanShapeGuardrails(seatingTypeVote.value, imageTraitVote.values),
    spec_traits: specTraitVote.values,
    merged_traits: applyLoungeChairPlanShapeGuardrails(seatingTypeVote.value, mergedTraitVote.values),
    visual_traits: applyLoungeChairPlanShapeGuardrails(seatingTypeVote.value, visualTraitVote.values)
  };

  const representativeEntry = [...entries]
    .sort((a, b) => scoreRepresentative(b, consensus) - scoreRepresentative(a, consensus))[0];
  const representative = representativeEntry.generated;
  const visualHighlights = voteHighlightList(entries.map((entry) => entry.generated.visual_highlights || []));
  const rawVisualHighlights = voteHighlightList(entries.map((entry) => entry.generated.raw_visual_highlights || []));

  return {
    ...representative,
    stage1: { seating_type: consensus.seating_type },
    seating_type: consensus.seating_type,
    image_traits: consensus.image_traits,
    spec_traits: consensus.spec_traits,
    merged_traits: consensus.merged_traits,
    visual_traits: consensus.visual_traits,
    reasoning: reasoningVote.value || representative.reasoning || "",
    plan_shape_reasoning: reasoningVote.value || representative.plan_shape_reasoning || "",
    visual_highlights: visualHighlights.length ? visualHighlights : representative.visual_highlights || [],
    raw_visual_highlights: rawVisualHighlights.length ? rawVisualHighlights : representative.raw_visual_highlights || [],
    consensus_source_image_url: representativeEntry.image.image_url,
    field_confidence: {
      seating_type: seatingTypeVote.confidence,
      image_traits: imageTraitVote.confidence,
      spec_traits: specTraitVote.confidence,
      merged_traits: mergedTraitVote.confidence,
      visual_traits: visualTraitVote.confidence
    }
  };
}

export async function generateProductConsensus(imageRecords = [], options = {}) {
  const evaluation = await evaluateImageCandidates(imageRecords);
  const passingAttempts = evaluation.attempts.filter((attempt) => attempt.passed);
  if (typeof options.progressCallback === "function") {
    options.progressCallback({
      type: "product_stage0",
      total_images: evaluation.totalImages,
      passing_count: passingAttempts.length,
      product_id: imageRecords[0]?.product_id || "",
      product_name: imageRecords[0]?.name || ""
    });
  }

  if (!passingAttempts.length) {
    return {
      excluded: true,
      exclusion_status: "excluded: no image above minimum resolution",
      exclusion_reason: "no image above minimum resolution",
      totalImages: evaluation.totalImages,
      passingCount: 0,
      passingImages: [],
      attempts: evaluation.attempts,
      aggregate: null
    };
  }

  const generatedEntries = [];
  for (const attempt of passingAttempts) {
    if (typeof options.progressCallback === "function") {
      options.progressCallback({
        type: "image_start",
        image_url: attempt.image?.image_url || "",
        product_id: attempt.image?.product_id || "",
        product_name: attempt.image?.name || ""
      });
    }
    const generated = await generateCaption(attempt.image, {
      ...options,
      precomputedImageDimensions: attempt.dimensions
    });
    if (typeof options.progressCallback === "function") {
      options.progressCallback({
        type: "image_complete",
        image_url: attempt.image?.image_url || "",
        product_id: attempt.image?.product_id || "",
        product_name: attempt.image?.name || "",
        tiebreaker_used: Boolean(generated?.extraction_consensus?.tiebreaker_used),
        estimated_cost_usd: Number(generated?.extraction_consensus?.total_usage?.estimated_cost_usd || 0),
        extraction_runs: Number(generated?.extraction_runs || 0)
      });
    }
    generatedEntries.push({
      image: attempt.image,
      generated
    });
  }

  return {
    excluded: false,
    totalImages: evaluation.totalImages,
    passingCount: passingAttempts.length,
    passingImages: passingAttempts.map((attempt) => attempt.image),
    attempts: evaluation.attempts,
    aggregate: aggregateCaptionResults(generatedEntries)
  };
}

export async function analyzeInspirationImage(imageUrl, options = {}) {
  const provider = options.provider || "openai";
  const focusArea = options.focusArea && typeof options.focusArea === "object" ? options.focusArea : null;
  const focusAreaInstruction = focusArea
    ? `User-selected focus area (normalized): left=${Number(focusArea.x || 0).toFixed(3)}, top=${Number(focusArea.y || 0).toFixed(3)}, width=${Number(focusArea.width || 1).toFixed(3)}, height=${Number(focusArea.height || 1).toFixed(3)}.`
    : "";
  const imageInput = {
    image_url: imageUrl,
    catalogContext: focusAreaInstruction
  };
  const runOptions = {
    ...options,
    apiKey: provider === "openai" ? options.apiKey : null
  };

  let stage1;
  try {
    const stage1Result = await classifySeatingTypeOpenAiWithMeta(imageInput, {
      ...runOptions,
      visionModel: runOptions.visionModel || "gpt-4.1"
    });
    stage1 = stage1Result?.data || null;
  } catch (error) {
    throw new QueryImageAnalysisStageError("stage1", "Stage 1 query-time image analysis failed.", { cause: error });
  }

  if (!stage1 || isStage1OverrideResult(stage1)) {
    throw new QueryImageAnalysisStageError(
      "stage1",
      "Stage 1 query-time image analysis failed to produce a valid seating type."
    );
  }

  const seatingType = ensureTypeKey(stage1.seating_type);
  if (!seatingTypes[seatingType]) {
    throw new QueryImageAnalysisStageError(
      "stage1",
      `Stage 1 returned unsupported seating type "${stage1.seating_type}".`
    );
  }

  let stage23;
  try {
    stage23 = await extractStage23CombinedOpenAi(imageInput, seatingType, stage1, {
      ...runOptions,
      visionModel: runOptions.visionModel || "gpt-4.1"
    });
  } catch (error) {
    throw new QueryImageAnalysisStageError("stage23", "Stage 2+3 query-time image analysis failed.", { cause: error });
  }

  if (!stage23?.stage2 || !stage23?.stage3) {
    throw new QueryImageAnalysisStageError(
      "stage23",
      "Stage 2+3 query-time image analysis returned incomplete output."
    );
  }

  const visualSummary = normalizeWhitespace(stage23.stage2.visual_summary || "");
  const imageTraits = normalizeImageTraits(seatingType, stage23.stage3.image_traits || {});
  const derivedBaseMaterial = deriveBaseMaterialFromBaseFinish(seatingType, imageTraits);
  if (derivedBaseMaterial) {
    imageTraits.base_material = derivedBaseMaterial;
  }
  const derivedBaseVisibility = deriveBaseVisibilityFromBaseType(seatingType, imageTraits);
  if (derivedBaseVisibility) {
    imageTraits.base_visibility = derivedBaseVisibility;
  }
  const fieldConfidence = buildSinglePassFieldConfidence(seatingType, imageTraits);
  if (derivedBaseMaterial) {
    fieldConfidence.base_material = fieldConfidence.base_finish || "high";
  }
  if (derivedBaseVisibility) {
    fieldConfidence.base_visibility = fieldConfidence.base_type || "high";
  }
  const searchText = buildSearchableText({
    productName: "",
    brand: "",
    seatingType,
    enumFields: imageTraits,
    freeText: {
      visual_summary: visualSummary,
      structured_caption: stage23.stage3.structured_caption || "",
      silhouette: stage23.stage2.silhouette || "",
      proportions: stage23.stage2.proportions || "",
      structure_type: stage23.stage2.structure_type || "",
      back_geometry: stage23.stage2.back_geometry || "",
      seat_geometry: stage23.stage2.seat_geometry || "",
      arm_geometry: stage23.stage2.arm_geometry || "",
      surface_language: stage23.stage2.surface_language || "",
      distinctive_elements: Array.isArray(stage23.stage2.distinctive_elements) ? stage23.stage2.distinctive_elements : []
    }
  });
  const queryEmbedding = await embedSearchText(searchText, runOptions);

  return {
    seating_type: seatingType,
    stage1: { seating_type: seatingType },
    stage2: {
      visual_summary: visualSummary,
      design_register: String(imageTraits.design_register || "").trim()
    },
    stage3: {
      reasoning: stage23.stage3.reasoning || "",
      image_traits: imageTraits
    },
    enum_fields: imageTraits,
    field_confidence: fieldConfidence,
    image_traits: imageTraits,
    reasoning: stage23.stage3.reasoning || "",
    plan_shape_reasoning: stage23.stage3.reasoning || "",
    visual_form: visualSummary,
    search_text: searchText,
    search_bullets: buildSearchTimeBullets(imageTraits),
    query_embedding: queryEmbedding,
    visual_summary_embedding: queryEmbedding,
    raw_visual_highlights: Array.isArray(stage23.stage3.raw_visual_highlights) ? stage23.stage3.raw_visual_highlights : [],
    structured_caption: stage23.stage3.structured_caption || "",
    extraction_runs: 2,
    analysis_api_call_count: 2,
    api_call_count: 3
  };
}

export async function debugInspirationImageRuns(imageUrl, options = {}) {
  const provider = options.provider || "openai";
  const imageInput = {
    image_url: imageUrl,
    catalogContext: options.catalogContext || "Inspiration image analysis for visual search."
  };
  const runOptions = {
    ...options,
    apiKey: provider === "openai" ? options.apiKey : null
  };

  const run1 = await runStage123Extraction(imageInput, runOptions, { name: options.fileName || "Inspiration image" }, "run_1");
  const run2 = await runStage123Extraction(imageInput, runOptions, { name: options.fileName || "Inspiration image" }, "run_2");
  const runs = [run1, run2];
  if (!allFieldsAgree(run1, run2)) {
    runs.push(await runStage123Extraction(imageInput, runOptions, { name: options.fileName || "Inspiration image" }, "run_3"));
  }

  return {
    image_url: imageUrl,
    runs,
    voted: voteStage123Runs(runs)
  };
}

export async function analyzeImageStage123SingleCall(imageUrl, options = {}) {
  return analyzeImageStage123OpenAi(
    {
      image_url: imageUrl,
      catalogContext: options.catalogContext || "Single-pass seating analysis for validation."
    },
    {
      ...options,
      visionModel: options.visionModel || "gpt-4.1"
    }
  );
}

export function traitsToPhrases(visualTraits) {
  return traitsToPhrasesTyped(visualTraits);
}

export function selectMatchedTraits(visualQuery, visualTraits, limit = 3) {
  const queryTokens = new Set(tokenize(visualQuery));
  const phrases = traitsToPhrasesTyped(visualTraits);

  const ranked = phrases
    .map((phrase) => {
      const phraseTokens = tokenize(phrase);
      const overlap = phraseTokens.filter((token) => queryTokens.has(token)).length;
      const salienceBonus = /\bbase|frame|wood|metal|chrome|sled|upholster|leather|fabric\b/.test(phrase) ? 1 : 0;
      return { phrase, score: overlap * 3 + salienceBonus + phraseTokens.length * 0.1 };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (ranked.length) {
    return ranked.slice(0, limit).map((item) => item.phrase);
  }

  return phrases
    .filter((phrase) => /\bbase|frame|wood|metal|upholster|leather|fabric\b/.test(phrase))
    .slice(0, limit);
}

export { combinedStage23SchemaForType, callOpenAiJsonWithMeta, normalizeStage2, applyStage3EnumGuardrails, normalizeImageTraits, extractStage23CombinedOpenAi };
