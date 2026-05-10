import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  embedTextWithOpenAi,
  EXTRACTION_IMAGE_HARD_CAP,
  getEffectiveExtractionImageCap,
  getEffectiveClassification,
  getPixelSeekType,
  resolveVisualType,
  normalizeVisualTypeKey,
  normalizeImageClassification,
  normalizeWhitespace,
  readJson,
  sentenceCase,
  tokenize,
  uniqueStrings
} from "./utils.js";
import { loadSeatingTypesAdapter } from "./seating-types-adapter.js";
import { loadVisualTypesRegistry } from "./visual-types-registry.js";
import { extractQueryTraits } from "./query-traits.js";
import {
  getLoungeSofaTraitApplicability,
  hasAnyApplicableLoungeSofaTraits,
  hasIntegratedBase,
  isArmlessLoungeSofa,
  isLoungeSofaTraitEligible
} from "./lounge-sofa-traits.js";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pdfExtractPath = path.join(__dirname, "..", "data", "pdf-text-extract.json");

const visualTypesRegistry = loadVisualTypesRegistry();
const visualTypesConfig = visualTypesRegistry.getRegistry();
const visualTypeEntries = visualTypesRegistry.listVisualTypes();
const visualTypeConfigByKey = Object.freeze(
  Object.fromEntries(
    visualTypeEntries.map((entry) => {
      const familyConfig = visualTypesConfig.families?.[entry.family] || {};
      const categoryConfig = familyConfig.categories?.[entry.visual_type] || {};
      return [entry.visual_type, {
        ...entry,
        ...categoryConfig
      }];
    })
  )
);
const VISUAL_TYPE_LABEL_TO_KEY = visualTypeEntries.reduce((acc, entry) => {
  acc[String(entry.label || "").toLowerCase()] = entry.visual_type;
  return acc;
}, {});
const textQueryCategoryKeys = Object.freeze(visualTypeEntries.map((entry) => entry.visual_type));
const inferableTextQueryCategoryEntries = Object.freeze(visualTypeEntries);
const seatingVisualTypeKeys = Object.freeze(
  visualTypeEntries
    .filter((entry) => entry.family === "seating")
    .map((entry) => entry.visual_type)
);

const seatingTypesConfig = loadSeatingTypesAdapter();
const seatingTypes = seatingTypesConfig.types || {};
const defaultSeatingType = seatingTypesConfig.default_type || "";
const fallbackSeatingType = defaultSeatingType || Object.keys(seatingTypes)[0] || "";
const stage1VisualTypeEnum = seatingVisualTypeKeys;
const stage1ResultEnum = ["product", "product_detail", "scene"];
const stage0ResultEnum = ["product", "scene", "product_detail"];
const GPT_41_INPUT_COST_PER_TOKEN = 2 / 1_000_000;
const GPT_41_OUTPUT_COST_PER_TOKEN = 8 / 1_000_000;
const GPT_41_NANO_INPUT_COST_PER_TOKEN = 0.10 / 1_000_000;
const GPT_41_NANO_OUTPUT_COST_PER_TOKEN = 0.40 / 1_000_000;
const IMAGE_EXTRACTION_TRANSIENT_RETRY_LIMIT = 1;
const PIXELSEEK_TYPE_TO_VISUAL_TYPE = Object.freeze({
  lounge_chair: "lounge_chair",
  guest_chair: "guest_chair",
  task_collab_chair: "task_collab_chair",
  stool: "stool",
  bench: "bench",
  conference: "conference",
  occasional: "occasional",
  cafe_dining: "cafe_dining",
  training: "training",
  huddle_collaborative: "huddle_collaborative",
  "Lounge Seating": "lounge_chair",
  "Multi-Use / Guest Chairs": "guest_chair",
  "Work Chairs": "task_collab_chair",
  "Stools": "stool",
  "Benches": "bench",
  "Conference Tables": "conference",
  "Occasional Tables": "occasional",
  "Cafe/Dining Tables": "cafe_dining",
  "Training Tables": "training",
  "Huddle/Collaborative Tables": "huddle_collaborative"
});
const LOUNGE_SOFA_NARROW_ARMS_THRESHOLD_PCT = 18;
const LOUNGE_SOFA_FLUSH_WITH_BACK_MAX_DROP_PCT = 5;
const LOUNGE_SOFA_TRAIT_PROMPT_HEADER = `Analyze the sofa image and report the following:

Note on pillows:
Ignore decorative or toss pillows when measuring. Toss pillows
typically sit on top of the seat cushion or in front of the back,
are square or accent-patterned, and are not structurally part of
the sofa. Back cushions, by contrast, sit flush against the sofa's
back frame, match the sofa's primary upholstery, and align with
the seat segments below.

For arm_top_pct and back_top_pct, if the back is fully obscured
by toss pillows, treat the top of the pillows as the back height.`;

const LOUNGE_SOFA_SEAT_CONSTRUCTION_PROMPT = `Trait 1: Seat Construction (raw observations)
Look at the area between the seat cushion and the floor. Answer
the following questions about what you see below the cushion.
Do not classify the result — just describe what is there.

1. Is there a horizontal element below the seat cushion that is
   wrapped in upholstery (fabric or leather)? Answer Yes or No.

   - Metal legs, metal frames, metal stretchers, metal crossbars,
     wire frames, wood legs, wood frames, wood rails, sled bases,
     metal X-stretchers, dowel legs, and other structural elements
     are NOT upholstered, regardless of how substantial they look.
     Answer No if all you see is metal or wood structure.

   - The bottom edge of the seat cushion itself does not count.
     Answer No if there is no separate upholstered element below
     the cushion.

2. If there is an upholstered element below the cushion: is it
   wrapped in the same fabric or leather as the seat cushion?
   Answer Yes, No, or N/A (if no upholstered element exists).

3. If there is an upholstered element below the cushion: is it
   visually distinct from the cushion, separated by a visible
   horizontal seam? Answer Yes, No, or N/A.

4. If there is an upholstered element below the cushion:
   approximately how tall is it, in inches? Use the 2-8 inch
   range as a typical guideline. Return null if no upholstered
   element exists.`;

const LOUNGE_SOFA_ARM_PANEL_THICKNESS_PROMPT = `Trait 2: Arm Panel Thickness (numeric, percentage of sofa height)
Estimate the arm panel thickness as a percentage of total sofa
height (where the floor is 0% and the highest point of the sofa
is 100%).

By "arm panel thickness" we mean the dimension that determines
whether the arm reads as a thin panel or a chunky block. From
the front view, this is the side-to-side thickness of the arm
panel (how wide the arm appears as you look at the sofa head-on).
From a side view, this would be the height of the arm form.

We do NOT mean the front-to-back depth of the arm (how far the
arm extends from the front of the sofa to the back).

If the arm panel changes thickness from top to bottom — for
example, the arm has a thin upper edge that widens as it
descends to the seat — measure at the THICKEST visible point
of the arm. The relevant arm thickness is the maximum visual
mass of the arm, not the slim top edge.

Curved-shell sofas: When the arm is part of a continuous curved
shell wrapping from the seat up to the back, measure the
THICKNESS OF THE SHELL WALL ITSELF — how thick is the upholstered
wall of the shell, not the overall horizontal extent of the
curved shape. A thin curved shell wall reads as a narrow arm
even if the shell wraps a substantial area.

Return as a number 0-100. Do not classify the arm as narrow or
wide.`;

const LOUNGE_SOFA_ARM_TOP_POSITION_PROMPT = `Trait 3: Arm Top Position (numeric, percentage of sofa height)
At what vertical position does the highest visible structural
top of the arm sit?

Use the actual top edge of the arm itself, not the outer side
panel silhouette and not a perspective continuation of the side
panel up toward the back line.

Curved-shell sofas: When the arm and back are part of one
continuous curved shell, measure the arm top at the HIGHEST
POINT of the curve — typically where the side curve joins the
top of the back. Do not measure at the lower or intermediate
point of the curve where it dips down toward the seat. On a
continuous shell, the side termination meets the back at the
same height — both points are at the top of the shell.

Return as a number 0-100. Do not classify whether the arm is
flush with the back.`;

const LOUNGE_SOFA_BACK_TOP_POSITION_PROMPT = `Trait 4: Back Top Position (numeric, percentage of sofa height)
At what vertical position does the top of the back cushion sit?

When back cushions project above the structural back and are
clearly the back's top termination, use the visible cushion top.

Return as a number 0-100.`;

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

function buildResolvedRoutingStage1Stub(typeKey = "", routingSource = "mapping_v1") {
  const visualTypeInfo = getVisualTypeInfo(typeKey, "");
  const visualType = String(visualTypeInfo?.visual_type || typeKey || "").trim();
  const family = String(visualTypeInfo?.family || "").trim();
  return {
    result: "product",
    seating_type: visualType,
    visual_type: visualType,
    family,
    type_routing_source: routingSource,
    override_reason: null
  };
}

function resolveRequestedCaptionVisualTypeInfo(imageRecord = {}, options = {}) {
  return getVisualTypeInfo(
    options.visual_type ||
    options.visualType ||
    options.seating_type ||
    options.seatingType ||
    imageRecord.visual_type ||
    imageRecord.seating_type ||
    "",
    ""
  );
}

function shouldUseCallerProvidedRouting(typeInfo = null) {
  return String(typeInfo?.family || "").trim().toLowerCase() !== "seating" && Boolean(typeInfo?.visual_type);
}

function buildCallerProvidedTypedCaptionResult(imageDimensions = null, requestedTypeInfo = null, stage2 = null, usage = {}, analysisApiCallCount = 0) {
  const stage1 = buildResolvedRoutingStage1Stub(requestedTypeInfo?.visual_type || "", "caller_provided");
  const normalizedStage2 = stage2 ? normalizeStage2(stage2) : buildEmptyStage23Payload().stage2;
  const totalUsage = normalizeOpenAiUsage(usage);
  const apiCallCount = Number.isFinite(Number(analysisApiCallCount)) ? Number(analysisApiCallCount) : 0;
  return {
    image_dimensions: imageDimensions,
    stage1,
    stage2: normalizedStage2,
    stage3: buildEmptyStage23Payload().stage3,
    structured_caption: "",
    raw_visual_highlights: [],
    visual_highlights: [],
    seating_type: String(stage1.seating_type || "").trim(),
    visual_type: String(stage1.visual_type || "").trim(),
    family: String(stage1.family || "").trim(),
    image_traits: {},
    spec_traits: {},
    merged_traits: {},
    trait_provenance: {},
    visual_traits: toLegacyVisualTraits("", {}),
    field_confidence: {
      stage1: {
        result: 1,
        seating_type: 1
      }
    },
    extraction_runs: 0,
    analysis_api_call_count: apiCallCount,
    api_call_count: apiCallCount,
    type_routing_source: "caller_provided",
    extraction_consensus: {
      tiebreaker_used: false,
      runs: [],
      total_usage: {
        ...totalUsage,
        estimated_cost_usd: estimateUsageCostUsd(totalUsage)
      }
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
  const normalizedTokens = tokens && typeof tokens === "object" ? tokens : {};
  const normalizedCost = cost && typeof cost === "object" ? cost : {};
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
    tokens: {
      ...normalizedTokens,
      stage_4: normalizedTokens.stage_4 || normalizeOpenAiUsage()
    },
    cost: {
      ...normalizedCost,
      stage_4_usd: Number(normalizedCost.stage_4_usd || 0)
    },
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

function buildSyntheticUnmappedProductSkipRecord(productImage = {}, options = {}) {
  const extractionTimestamp = String(options.extractionTimestamp || new Date().toISOString()).trim();
  const categories = normalizeCategories(productImage);
  return {
    ...buildExcludedImageExtractionResult({
      baseRecord: {
        image_id: `${String(productImage.product_id || "").trim()}__synthetic_unmapped`,
        image_url: "",
        product_id: productImage.product_id,
        product_name: productImage.name || productImage.product_name || "",
        name: productImage.name || productImage.product_name || "",
        brand: productImage.brand || ""
      },
      categories,
      stage0Result: "",
      stage1: {
        result: "",
        seating_type: "",
        visual_type: "",
        family: "",
        type_routing_source: "mapping_v1",
        override_reason: null
      },
      tokens: {
        stage_0: normalizeOpenAiUsage(),
        total: normalizeOpenAiUsage()
      },
      cost: {
        stage_0_usd: 0,
        total_usd: 0
      },
      extractionTimestamp,
      imageDimensions: null
    }),
    excluded_reason: "unmapped_category_grouping",
    pixelseek_type: null,
    type_routing_source: "mapping_v1",
    is_synthetic_skip: true
  };
}

function resolveSupportedQueryImageVisualType(value = "") {
  const normalized = normalizeVisualTypeKey(value);
  if (!normalized) {
    return "";
  }
  const entry = visualTypesRegistry.resolveRoutingKey(normalized);
  if (!entry) {
    return "";
  }
  return entry.family === "seating" || entry.family === "tables"
    ? normalized
    : "";
}

function sleepMs(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientImageExtractionError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  if (!message) {
    return false;
  }
  return (
    /\b429\b/.test(message) ||
    /\b408\b/.test(message) ||
    /\b500\b|\b502\b|\b503\b|\b504\b/.test(message) ||
    /timed? out|timeout|network|fetch failed|econnreset|socket hang up|temporar|overloaded|rate limit|connection/i.test(message)
  );
}

async function retryImageOperation(operation, options = {}) {
  const retryLimit = Number(options.retryLimit ?? IMAGE_EXTRACTION_TRANSIENT_RETRY_LIMIT) || 0;
  let attempt = 0;
  let lastError = null;

  while (attempt <= retryLimit) {
    try {
      const value = await operation(attempt + 1);
      return {
        value,
        attempts: attempt + 1,
        retried: attempt > 0
      };
    } catch (error) {
      lastError = error;
      if (attempt >= retryLimit || !isTransientImageExtractionError(error)) {
        break;
      }
      attempt += 1;
      await sleepMs(Math.min(2000, attempt * 500));
      continue;
    }
  }

  throw Object.assign(lastError || new Error("Image extraction failed."), {
    __image_attempts: attempt + 1
  });
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

let pdfExtractCache = null;
export const MATCHING_SAFE_MIN_SHORT_SIDE = 591;

const LOUNGE_CHAIR_SHAPE_RULES = `- For lounge_chair shape_character: classify the overall silhouette character as either "Soft / tapered" or "Boxy". Use "Soft / tapered" if any major structural component curves, if the overall body or shell is curved, if the form deliberately tapers in straight lines as a design feature, or if the corners dissolve into generous arcs rather than retaining visible corner points. Use "Boxy" only when the back edge is straight, the arms are straight, the overall body is rectilinear with consistent width and depth, and the corners still read as visible corners. Ignore camera perspective and evaluate only the major structural components, not cushions, seams, or accessory details.
- For lounge_chair plan_shape: classify the plan view shape of this piece using this exact decision tree. Imagine looking straight down at the piece from above.
  Step 1 — Check for round / semicircular:
  Is the back edge of the piece curved rather than a straight line across? If yes, the plan footprint is round or semicircular — the back wraps rather than running straight. Classify as Round / semicircular and stop. Do not attempt width comparison on curved forms.
  Step 2 — Compare front width to back width:
  For pieces with a straight back edge, estimate the width of the piece at the front (seat front edge) versus the width at the back (back panel) when viewed from above:
  - Width at back roughly equal to width at front → Square / rectangular (sides run parallel)
  - Width at back narrower than width at front → Trapezoidal (piece widens toward the front, arms splay outward)
  - Width at back wider than width at front → Reverse trapezoidal (piece widens toward the back)
  If the photo angle makes it impossible to reliably determine the plan shape, return unknown.`;

const LOUNGE_CHAIR_CONFIGURATION_RULES = `Single seat: A standalone single-occupant lounge piece. Single seats are typically as deep as they are wide, or deeper than they are wide. They have one arm on each side (or no arms) with no continuous seating space between distinct seating zones.
Double seat: A non-modular piece clearly proportioned for two occupants. This includes two-person lounge pieces with a clearly shared seating span. It does not need visible cushion divisions or seams; many modern double seats have a single continuous upholstered surface.
Triple seat (or larger): A non-modular piece clearly proportioned for three or more occupants. This includes sofas and larger lounge pieces. Visual indicators include width substantially greater than depth, multiple occupant zones, and overall proportions where three adults could reasonably sit side by side.
Modular component: A piece designed to combine or reconfigure with other modules. Modular components often have asymmetric or non-standard arm configurations (one arm only, no arms, or arms only on certain sides), flat sides where they would join other modules, or proportions that suggest they are part of a larger sectional or system rather than a complete standalone seat. Products that appear to be part of a system, collection, or sectional set should be classified as Modular component even if the individual piece looks chair-like or sofa-like in isolation. If a piece appears designed to combine with other pieces rather than stand alone as a complete seating element, classify it as Modular component, not Single seat, Double seat, or Triple seat (or larger).
Corner unit: An L-shaped or corner-specific modular piece designed to fit at the intersection of other seating elements.
Ottoman: A backless, typically low upholstered seat or footrest with no arms or back.
Decision rule for ambiguous cases: when a piece could plausibly be either a wide single seat or a compact two-person lounge piece, default to Double seat if the width-to-depth ratio is greater than roughly 1.5:1 and the seat surface is wide enough to comfortably seat two adults. Use Triple seat (or larger) only when the piece clearly reads as a sofa or otherwise proportioned for three or more adults. Only classify as Single seat if the piece reads proportionally as deeper than wide, or as roughly square in plan view, indicating it is designed for one occupant. When choosing between Single seat and Modular component for a piece that could read as either, prefer Modular component if the piece has structural cues suggesting it is part of a larger system, such as asymmetric arms, flat joinable sides, or unusual proportions for a standalone piece.`;

const LOUNGE_CHAIR_CANONICAL_RULES = `- For lounge_chair arm_option: use "Integrated / sculpted" whenever the arms flow continuously from the shell or backrest as part of the same sculpted form, even if seam lines are visible in the upholstery. Use "Armless" when no discrete armrests are present. Use "Two arms" only when the arms read as distinct attached arm elements with their own visible structure separate from the shell or body.
- For lounge_chair body_construction: use "Upholstered" for any upholstered lounge chair body, including both continuous shell forms and traditional frame-and-cushion constructions. Use "Panel / privacy enclosure" for high side-panel lounge forms that enclose the user above shoulder or head level.
- For lounge_chair base_type: use "Integrated base" when the base is visually absorbed into the shell with no discrete leg structure. Use "Pedestal" for a central column or star base, "Square plate / plinth" for a square or plate-like base, "4-leg" for four discrete legs, "Sled" for a continuous sled frame, and "Casters" only when visible wheels are present.
- For lounge_chair base_finish: classify only the visible finish of the base or support structure using [Black, White, Polished chrome / aluminum, Painted color, Natural wood]. Use "Natural wood" for visible wood legs, wood bases, oak, walnut, ash, maple, or other natural wood tones. Use "Polished chrome / aluminum" for bright reflective chrome or polished aluminum bases. Use "White" for visibly white bases or legs. Use "Painted color" for non-black painted or powder-coated finishes and colored coated metal bases. Return "unknown" only when the base or support structure is genuinely not visible in the image.
- For lounge_chair back_finish: use "Unupholstered shell" when the visible outer shell or back surface is exposed rather than upholstered. Use "Matches seat" when the visible back finish clearly matches the seat upholstery. Use "Independent fabric" when the back surface is upholstered in a visibly distinct fabric treatment from the seat.
- For lounge_chair seat_finish: use "Unupholstered" only when the visible seat surface is bare plastic, exposed wood, molded shell, or another non-upholstered hard surface rather than upholstered. Use "Fabric" or "Leather" only when that finish is clearly visible.
- For lounge_chair configuration: choose exactly one of [Single seat, Double seat, Triple seat (or larger), Modular component, Corner unit, Ottoman]. Use "Double seat" for a non-modular piece clearly proportioned for two occupants. Use "Triple seat (or larger)" for sofas or other non-modular pieces clearly proportioned for three or more occupants. Use "Modular component" for pieces designed to connect with other modules. Use "Corner unit" for an L-shaped or corner-specific modular piece. Use "Ottoman" for a backless, typically low upholstered seat or footrest with no arms or back.`;

const STOOL_CANONICAL_RULES = `- For stool only: if there is no physical backrest, set back to "Backless". Use "Low back" when a physical back support rises only modestly above the seat, and "Full back" when the back support rises substantially above the seat.
- For stool seat_geometry: use "Flat" for standard flat seats, "Angled / perch" for forward-tilted perch seats, "Saddle" for saddle seats, and "Wobble / balance" for active stools designed to flex or rock.
- For stool base_finish: classify only the visible finish of the base, legs, or support frame using [Black, White, Polished chrome / aluminum, Painted color, Natural wood]. Use "Natural wood" for visible wood legs or wood base structures. Use "Polished chrome / aluminum" for bright reflective chrome or polished aluminum bases. Use "White" for visibly white bases or legs. Use "Painted color" for coated or powder-coated colored finishes that are neither black nor natural wood. Return "unknown" only when the base or support structure is genuinely not visible in the image.
- For stool seat_finish: classify the visible seat surface finish using [Fabric, Leather, Molded plastic, Natural wood]. Use "Natural wood" when the visible seat surface is solid or exposed wood. Use "Molded plastic" only when the visible seat surface is clearly plastic. Use "Fabric" or "Leather" only when that finish is clearly visible on the seat.`;

const TASK_COLLAB_CHAIR_CANONICAL_RULES = `- For task_collab_chair back_finish: use [Mesh / net, Upholstered, Plastic, Knit]. Use "Plastic" when the visible back surface is a hard plastic back rather than mesh, knit, or upholstered.
- For task_collab_chair back_profile: use "Rounded / curved" for visibly curved or softened backs and "Square / angular" for rectilinear backs.
- For task_collab_chair arm_option: visible adjustment hardware means "Adjustable arms", not fixed. Use "Integrated" only when the arms are formed directly out of the same seat or back shell with no distinct arm-post, side support, or separate side member. Use "Fixed arms" for any rigid non-adjustable arms carried by distinct side supports or side members.
- For task_collab_chair base_type: use "Sled" for a continuous sled frame and never return "Sled base".
- For task_collab_chair base_finish: classify the visible base finish using [Black, White, Polished chrome / aluminum, Painted color, Natural wood]. Use "Natural wood" for visible wood bases or legs. Use "Polished chrome / aluminum" for bright reflective chrome or polished aluminum bases. Use "White" for visibly white bases or legs. Use "Painted color" for coated or powder-coated colored finishes that are neither black nor natural wood. Return "unknown" only when the base is genuinely not visible.
- For task_collab_chair seat_finish: use [Fabric, Leather, Molded plastic, Mesh / net]. Use "Mesh / net" only when the visible seat surface itself is mesh or netting. Use "Molded plastic" when the visible seat surface is a hard molded plastic shell rather than upholstered or mesh.`;

const GUEST_CHAIR_CANONICAL_RULES = `- For guest_chair arm_option: use "Open arm" when the arm is visually separate and leaves space beneath or beside it, "Closed arm" when the arm and side panel read as a closed side, and "Integrated" when the arm flows directly from the shell or frame.
- For guest_chair frame_openness: use "Open / see-through" when the chair body or frame has obvious negative space and "Closed / solid" when the side or back surfaces read as continuous solid surfaces.
- For guest_chair mobility: use "Casters" when wheels are visible on the base and "Non-mobile" when they are not.
- For guest_chair base_finish: classify only the visible finish of the base, legs, or support frame using [Black, White, Polished chrome / aluminum, Painted color, Natural wood]. Use "Natural wood" when the visible base or legs are wood or read as a natural wood finish, including oak, walnut, ash, maple, or other natural wood tones. Use "Polished chrome / aluminum" when the visible base reads as chrome, polished metal, or another bright reflective aluminum finish. Use "White" when the visible base, legs, or support frame read as white. Use "Painted color" when the visible base, legs, or support frame read as painted or powder-coated color rather than black, white, polished metal, or natural wood. Use "Black" when the visible base, legs, or support frame read as black or very dark coated metal. Return "unknown" only when the base or support structure is genuinely not visible in the image.
- For guest_chair seat_finish: use [Fabric, Leather, Molded plastic, Natural wood]. Use "Natural wood" when the visible seat surface is exposed wood. Use "Molded plastic" only when the visible seat surface is clearly molded plastic.
- For guest_chair back_finish: use [Fabric, Leather, Mesh / net, Molded plastic, Natural wood, Unupholstered]. Use "Natural wood" when the visible back surface is wood. Use "Unupholstered" when the visible back surface is a bare shell with no upholstery.`;

const BENCH_CANONICAL_RULES = `- For bench configuration: choose exactly one of [Double seat, Triple seat (or larger), Custom width]. Use "Double seat" for benches clearly sized for two occupants, "Triple seat (or larger)" for benches clearly sized for three or more occupants, and "Custom width" only when the bench reads as custom-length or unusually extended without a clear standard occupancy count.
- For bench frame_material: use [Steel tube, Solid wood, Wood + steel, Upholstered, Metal sheet]. Use "Steel tube" for exposed tubular steel or rod frames. Use "Solid wood" for benches whose visible supporting structure is wood only. Use "Wood + steel" when both wood and steel are clearly part of the structural frame. Use "Upholstered" when the supporting structure reads as fully upholstered volumes or upholstered pedestals rather than an exposed frame. Use "Metal sheet" for planar metal panel supports, folded metal plate legs, or monolithic sheet-metal bench bodies rather than tubular frames.
- For bench base_finish: classify only the visible finish of the base or support structure using [Black, White, Polished chrome / aluminum, Painted color, Natural wood]. Use "Natural wood" for exposed wood bases or legs. Use "Polished chrome / aluminum" for bright reflective chrome or polished aluminum bases. Use "White" for visibly white bases or legs. Use "Painted color" for coated or powder-coated colored finishes that are neither black nor natural wood. Return "unknown" only when the base or support structure is genuinely not visible.
- For bench seat_finish: use [Fabric, Leather, Natural wood, Metal]. Use "Natural wood" when the visible seat surface is exposed wood. Use "Metal" when the visible seat surface is metal, including perforated, slatted, or solid steel, aluminum, or iron seats common in outdoor or architectural benches. Use "Fabric" or "Leather" only when that finish is clearly visible on the seat.
- For bench back_height: classify the physical back support height using [Backless, Low back, Full back]. Use "Backless" when no physical back support is present. Use "Low back" when a back support rises only modestly above the seat. Use "Full back" when the back support rises substantially above the seat and reads as a full backrest.
- For bench back_finish: classify the visible finish of the back surface using [Upholstered, Natural wood, Unupholstered]. Use "Natural wood" when the back surface is exposed wood. Use "Unupholstered" when the back support is a bare shell or hard surface with no upholstery.`;

function getVisualSummaryCategoryList(typeKey = "") {
  const categories = seatingTypes[String(typeKey || "").trim()]?.visual_summary_categories;
  return Array.isArray(categories)
    ? categories.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
}

const TABLE_STAGE2_CROSS_CUTTING_FIELD_ORDER = [
  "top_shape",
  "top_material",
  "base_type",
  "base_visual_weight",
  "design_register",
  "base_finish",
  "mobility",
  "top_thickness",
  "edge_profile"
];

function getVisualTypeFamily(typeKey = "") {
  return String(getVisualTypeInfo(typeKey, "")?.family || "").trim().toLowerCase();
}

function getResolvedRegistryFieldsForVisualType(typeKey = "") {
  const typeInfo = getVisualTypeInfo(typeKey, "");
  if (!typeInfo?.visual_type || !typeInfo.family) {
    return [];
  }

  try {
    return visualTypesRegistry.getCategoryFields(typeInfo.family, typeInfo.visual_type);
  } catch {
    return [];
  }
}

function getVisualTypeConfig(typeKey = "") {
  const normalizedTypeKey = String(typeKey || "").trim();
  if (seatingTypes[normalizedTypeKey]) {
    return seatingTypes[normalizedTypeKey];
  }

  const typeInfo = getVisualTypeInfo(normalizedTypeKey, "");
  if (!typeInfo?.visual_type) {
    return null;
  }

  return {
    label: typeInfo.label || typeInfo.visual_type,
    fields: getResolvedRegistryFieldsForVisualType(typeInfo.visual_type)
  };
}

function getVisualTypeLabel(typeKey = "") {
  return String(getVisualTypeConfig(typeKey)?.label || typeKey || "Unknown type").trim();
}

function getTablesStage2FieldDefinitions(typeKey = "") {
  if (getVisualTypeFamily(typeKey) !== "tables") {
    return [];
  }

  const fieldMap = new Map(
    getResolvedRegistryFieldsForVisualType(typeKey).map((fieldConfig = {}) => [fieldConfig.field, fieldConfig])
  );

  return TABLE_STAGE2_CROSS_CUTTING_FIELD_ORDER
    .map((fieldName) => fieldMap.get(fieldName))
    .filter(Boolean);
}

function buildTablesVisualSummaryInstruction(typeKey = "") {
  const typeInfo = getVisualTypeInfo(typeKey, "");
  const typeLabel = String(typeInfo?.label || typeKey || "table").trim();
  const fieldDefinitions = getTablesStage2FieldDefinitions(typeKey);
  const fieldLines = fieldDefinitions.length
    ? fieldDefinitions.map((fieldConfig = {}) => {
        const fieldName = String(fieldConfig.field || "").trim();
        const allowedValues = Array.isArray(fieldConfig.allowed_values)
          ? fieldConfig.allowed_values.filter((value) => String(value || "").trim().toLowerCase() !== "unknown")
          : [];
        return `  - ${fieldName}: ${allowedValues.join(", ")}`;
      }).join("\n")
    : "  - top_shape\n  - top_material\n  - base_type\n  - base_visual_weight\n  - design_register";

  return `- visual_summary: A 2-3 sentence description of this ${typeLabel.toLowerCase()} for use in semantic search. Follow these rules strictly:

  CATEGORY COMMITMENT: Begin with a specific table noun appropriate to the routed table type. Commit to what you see; avoid generic phrases like "furniture piece."

  STRUCTURE: After the category noun, follow this order:
  1. Tabletop shape and footprint read
  2. Support structure and base relationship
  3. Surface/material character of the top and base
  4. One proportional or construction detail that distinguishes this table from similar products

  FOCUS FIELDS FROM THE ROUTED TABLE SCHEMA:
${fieldLines}

  TABLE-SPECIFIC GUIDANCE:
  - Treat tabletop shape, edge read, thickness impression, and base structure as the primary visual cues.
  - Describe support structure precisely when visible: pedestal, 4-leg, trestle, T-leg, X-base, tripod, or panel-slab.
  - Use base_visual_weight to explain whether the support reads light/airy or heavy/grounded.
  - Mention mobility only if it is visually obvious.
  - Do not include height_register or power_data_integration in the summary; those are structured extraction traits, not summary prose.
  - If chairs or other furniture appear around the table, ignore them and describe only the table product itself.

  LANGUAGE:
  - Use specific, observable descriptors: "round top," "rectilinear slab," "central pedestal," "splayed legs," "thin eased edge."
  - Avoid vague style words without specifics.
  - Avoid hedging: "appears to be," "looks like," "seemingly." Commit to what you observe.
  - Avoid marketing language.
  - Lead with form and structure, not color. Use color only when it clarifies finish or material character.

  EXTERNAL CONTEXT: If catalog context is provided (product name, brand, categories), use it only to resolve genuine visual ambiguity, not to override visual evidence.`;
}

const VISUAL_SUMMARY_PROMPT_CONFIG = {
  lounge_chair: {
    decision_rules: [
      "Use a strict configuration-first cascade. If configuration = Ottoman, use \"ottoman.\" If configuration = Corner unit, use \"corner unit.\" If configuration = Modular component, use \"modular component.\"",
      "If configuration = Double seat or Triple seat (or larger), choose only among \"sofa,\" \"modular sofa,\" and \"modular seating.\" Use \"modular sofa\" only when the piece is multi-seat and visually reads as a sofa with clear modular cues such as asymmetric arms, flat join sides, or system-style sectional construction. Use \"sofa\" for standard multi-seat lounge seating. Use \"modular seating\" when the piece is clearly multi-person but does not visually read as a standard sofa. \"Modular component\" and \"modular sofa\" are not interchangeable: the first requires the Modular component enum, the second requires a multi-seat configuration plus visual modular cues.",
      "If configuration = Single seat, continue the cascade in this order: use \"privacy lounge chair\" for back_height = Full enclosure, \"high-back lounge chair\" for back_height = High, otherwise choose the most specific arm-based form: \"armless lounge chair,\" \"one-arm lounge chair,\" \"two-arm lounge chair,\" or \"integrated lounge chair.\" Fall back to \"lounge chair\" only when none of those more specific single-seat categories apply."
    ],
    good_example: "A high-back lounge chair with a softly tapered upholstered body, integrated arms, and a compact four-leg base. The back rises well above the seat in one continuous shell, giving it a more enveloping profile than a standard lounge chair."
  },
  task_collab_chair: {
    decision_rules: [
      "Choose category from base_type only. Map \"5-star with casters\" to \"five-star task chair,\" \"5-star with glides\" to \"five-star glide chair,\" \"Sled\" to \"sled work chair,\" and \"4-leg\" to \"four-leg work chair.\"",
      "Do not mix arm treatment into the category noun for this type. Keep arms, back finish, and seat finish in the later prose instead.",
      "When multiple visual traits are present, let base_type control category selection rather than choosing between unrelated trait families."
    ],
    good_example: "A five-star task chair with a tall mesh back, adjustable arms, and a compact rolling base. The silhouette is upright and work-focused, with a technical frame and a tightly upholstered seat."
  },
  guest_chair: {
    decision_rules: [
      "Choose category from base_type only. Map \"4-leg\" to \"four-leg guest chair,\" \"Sled\" to \"sled guest chair,\" \"Cantilever\" to \"cantilever guest chair,\" and \"Pedestal\" to \"pedestal guest chair.\"",
      "Do not use generic nouns like \"guest chair\" or \"side chair\" when a schema-backed base category is available.",
      "Keep arm treatment, frame openness, mobility, seat finish, and back finish in the prose rather than the category noun."
    ],
    good_example: "A cantilever guest chair with a rounded upholstered seat and back on a polished tubular side frame. The body reads open and lightweight, with gentle curves and no heavy enclosure around the sitter."
  },
  stool: {
    decision_rules: [
      "Use a strict ordered cascade and stop at the first match. First check seat_geometry: if it is \"Angled / perch,\" use \"perching stool.\" If it is \"Saddle,\" use \"saddle stool.\" If it is \"Wobble / balance,\" use \"wobble stool.\" Do not continue to back or base_type once one of these matches.",
      "If no seat_geometry category matched, check back next. Map \"Backless\" to \"backless stool,\" \"Low back\" to \"low-back stool,\" and \"Full back\" to \"full-back stool.\" Do not continue to base_type once one of these matches.",
      "Only if neither seat_geometry nor back matched, fall back to base_type: \"pedestal stool,\" \"four-leg stool,\" \"five-star caster stool,\" \"five-star glide stool,\" or \"molded one-piece stool.\" Do not re-evaluate earlier steps."
    ],
    good_example: "A perching stool with a forward-tilted seat, slim pedestal support, and compact footprint. The seat reads as designed for leaning support rather than deep sitting, which distinguishes it from a conventional flat stool."
  },
  bench: {
    decision_rules: [
      "Use configuration first. Map \"Double seat\" to \"double-seat bench,\" \"Triple seat (or larger)\" to \"triple-seat bench,\" and \"Custom width\" to \"custom-width bench.\" If one of these configuration categories applies, keep it even when the bench is backless and mention the backlessness in the prose instead of changing the category noun.",
      "If configuration is unknown, fall back to back_height. Map \"Backless\" to \"backless bench,\" \"Low back\" to \"low-back bench,\" and \"Full back\" to \"full-back bench.\"",
      "Keep upholstery and material distinctions in the prose rather than the category noun."
    ],
    good_example: "A double-seat bench with a long rectilinear seat, slim exposed steel frame, and lightly upholstered top. The profile is low and linear, with clean edges that keep it distinct from a lounge sofa."
  }
};

function buildVisualSummaryInstruction(typeKey = "") {
  if (getVisualTypeFamily(typeKey) === "tables") {
    return buildTablesVisualSummaryInstruction(typeKey);
  }
  const categoryList = getVisualSummaryCategoryList(typeKey);
  const config = VISUAL_SUMMARY_PROMPT_CONFIG[String(typeKey || "").trim()] || {};
  const categoryCommitmentLine = categoryList.length
    ? `  CATEGORY COMMITMENT: Begin with a specific category noun chosen from the list below. Use the most accurate term based on what you see, not a generic hedge. Available categories for this seating type: ${categoryList.map((value) => `"${value}"`).join(", ")}.`
    : `  CATEGORY COMMITMENT: Begin with a specific category noun appropriate to this seating type. Use the most accurate term based on what you see, not a generic hedge. Avoid the generic word "seat" when a more specific category applies.`;
  const decisionRules = Array.isArray(config.decision_rules) && config.decision_rules.length
    ? config.decision_rules
    : [
      "Prefer the most structurally specific category noun that is clearly supported by the image.",
      "Avoid the generic word \"seat\" when a more specific category applies."
    ];
  const goodExample = String(config.good_example || "A clearly categorized seating piece with a distinct silhouette, observable support structure, and one specific detail that distinguishes it from similar products.").trim();

  return `- visual_summary: A 2-3 sentence description of this seating product for use in semantic search. Follow these rules strictly:

${categoryCommitmentLine}

  When choosing between categories, decide based on visual evidence:
${decisionRules.map((rule) => `  - ${rule}`).join("\n")}

  STRUCTURE: After the category, follow this order:
  1. Overall silhouette and proportional character (one phrase)
  2. Seat and back character (one phrase)
  3. Arm style and base or support relationship (one phrase)
  4. One distinctive surface, material, or proportional detail that distinguishes this from similar products

  LANGUAGE:
  - Use specific, observable descriptors: "low-slung," "wide-set," "tapered," "splayed," "continuous curved," "tightly upholstered."
  - Avoid vague style words without specifics. "Modern," "contemporary," and "stylish" are filler unless paired with a specific descriptor.
  - Avoid hedging: "appears to be," "looks like," "seemingly." Commit to what you observe.
  - Avoid marketing language: "stunning," "elegant," "timeless." Describe what is visible.
  - Lead with form, not color. Color may appear at the end if structurally relevant (such as "exposed black metal base"), but do not lead with it.

  EXTERNAL CONTEXT: If catalog context is provided (product name, brand, categories), use it only to resolve genuine visual ambiguity, not to override visual evidence. If the image clearly shows a sofa but the product name suggests a chair, describe what you see, not what the name says.

  EXAMPLE (good): "${goodExample}"

  EXAMPLE (bad — do not produce output like this): "A modern, stylish seating piece with a soft, rounded silhouette and a metal base." This is too vague: no commitment to a specific category, "modern" and "stylish" are filler, and "soft, rounded" lacks specificity.`;
}

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
  const typeConfig = getVisualTypeConfig(typeKey);
  if (Array.isArray(typeConfig?.fields) && typeConfig.fields.length) {
    return typeConfig.fields;
  }
  return seatingTypes[fallbackSeatingType]?.fields || [];
}

function getTraitFieldConfig(typeKey, fieldName) {
  const resolvedTypeKey = resolveTextQueryTraitType(typeKey);
  const normalizedFieldName = String(fieldName || "").trim();
  if (!normalizedFieldName) {
    return null;
  }

  const fieldMap = new Map(
    getTypeFields(resolvedTypeKey).map((fieldConfig = {}) => [String(fieldConfig.field || "").trim(), fieldConfig])
  );
  return fieldMap.get(normalizedFieldName) || null;
}

function getFieldPriority(typeKey = "", fieldName = "") {
  const priority = String(getTraitFieldConfig(typeKey, fieldName)?.priority || "")
    .trim()
    .toLowerCase();
  return priority === "essential" || priority === "low" || priority === "normal"
    ? priority
    : "normal";
}

function resolveTextQueryTraitType(typeKey = "") {
  const normalized = normalizeVisualTypeKey(typeKey);
  const resolved = getVisualTypeInfo(normalized, "");
  if (resolved?.visual_type) {
    return resolved.visual_type;
  }
  return fallbackSeatingType;
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
  const allowedMap = new Map(
    (allowedValues || []).map((entry) => {
      const canonical = String(entry || "").trim();
      return [canonical.toLowerCase(), canonical];
    })
  );
  const allowed = new Set(allowedMap.keys());
  let raw = String(value ?? "").trim().toLowerCase();
  const getCanonical = (candidate = "") => allowedMap.get(String(candidate || "").trim().toLowerCase()) || "";
  if (!raw) {
    return getCanonical("unknown") || "";
  }
  if (allowed.has(raw)) {
    return getCanonical(raw);
  }
  const aliases = new Map([
    ["none - backless", "backless"],
    ["none — backless", "backless"],
    ["non-upholstered", "unupholstered shell"],
    ["unupholstered", "unupholstered shell"],
    ["none / unupholstered", "unupholstered"],
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
    ["wood", "natural wood"],
    ["natural / wood", "natural wood"],
    ["natural wood", "natural wood"],
    ["natural timber", "natural wood"],
    ["solid wood", "natural wood"],
    ["graphite", "painted color"],
    ["painted / powder coat", "painted color"],
    ["painted finish", "painted color"],
    ["powder coat", "painted color"],
    ["white enamel", "white"],
    ["polished aluminum", "polished chrome / aluminum"],
    ["pedestal base", "pedestal"],
    ["sled base", "sled"],
    ["square plate / plinth base", "square plate / plinth"],
    ["concealed / integrated base", "integrated base"],
    ["concealed / integrated", "integrated base"],
    ["integrated base", "integrated base"],
    ["concealed", "integrated base"],
    ["visible", "exposed"],
    ["none", "armless"],
    ["no arms", "armless"],
    ["without arms", "armless"],
    ["open arms", "open arm"],
    ["open-arm", "open arm"],
    ["closed arms", "closed arm"],
    ["closed-arm", "closed arm"],
    ["integrated arms", "integrated"],
    ["integrated arm", "integrated"],
    ["exposed shell / no upholstery", "unupholstered shell"],
    ["plastic back", "plastic"],
    ["mesh", "mesh / net"],
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
    ["2-person", "double seat"],
    ["3-person", "triple seat (or larger)"],
    ["custom / specify width", "custom width"],
    ["fabric (specify category)", "fabric"],
    ["com", "unknown"],
    ["col", "unknown"]
  ]);
  const aliased = aliases.get(raw);
  if (aliased && allowed.has(aliased)) {
    raw = aliased;
  }
  if (raw === "unknown") {
    return getCanonical("unknown") || "";
  }
  if (allowed.has(raw)) {
    return getCanonical(raw);
  }
  if (raw === "true" && allowed.has("yes")) return getCanonical("yes");
  if (raw === "false" && allowed.has("no")) return getCanonical("no");
  return getCanonical("unknown") || "";
}

function getVisualTypeInfo(candidate, fallbackTypeKey = "") {
  const raw = normalizeVisualTypeKey(candidate);
  const resolvedVisualType = raw && visualTypeConfigByKey[raw]
    ? raw
    : "";
  if (resolvedVisualType) {
    return cloneKnownValue(visualTypeConfigByKey[resolvedVisualType]);
  }

  const normalizedLabel = String(candidate || "").trim().toLowerCase();
  const labelMatch = VISUAL_TYPE_LABEL_TO_KEY[normalizedLabel];
  if (labelMatch && visualTypeConfigByKey[labelMatch]) {
    return cloneKnownValue(visualTypeConfigByKey[labelMatch]);
  }

  const fallback = normalizeVisualTypeKey(fallbackTypeKey);
  if (fallback && visualTypeConfigByKey[fallback]) {
    return cloneKnownValue(visualTypeConfigByKey[fallback]);
  }

  return null;
}

function ensureTypeKey(candidate) {
  return getVisualTypeInfo(candidate, fallbackSeatingType)?.visual_type || fallbackSeatingType;
}

function resolveStage1VisualTypeInfo(stage1 = {}) {
  return getVisualTypeInfo(stage1?.visual_type || stage1?.seating_type || "", fallbackSeatingType);
}

function resolveStage1VisualType(stage1 = {}) {
  return resolveStage1VisualTypeInfo(stage1)?.visual_type || fallbackSeatingType;
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
  return "";
}

function isStage23DetectableField(field = {}) {
  const detectability = String(field?.detectability || "").trim().toLowerCase();
  return Boolean(field?.type === "enum" && detectability && detectability !== "no" && detectability !== "stage4");
}

function getStage23TypeFields(typeKey = "") {
  return getTypeFields(typeKey).filter((entry) => isStage23DetectableField(entry));
}

function countApplicableLoungeSofaTraits(applicability = {}) {
  return ["seat_construction", "narrow_arms", "arms_flush_with_back"]
    .reduce((sum, key) => sum + (applicability?.[key] ? 1 : 0), 0);
}

function buildLoungeSofaTraitPrompt(applicability = {}) {
  const sections = [LOUNGE_SOFA_TRAIT_PROMPT_HEADER];
  if (applicability?.seat_construction) {
    sections.push(LOUNGE_SOFA_SEAT_CONSTRUCTION_PROMPT);
  }
  if (applicability?.narrow_arms || applicability?.arms_flush_with_back) {
    sections.push(LOUNGE_SOFA_ARM_PANEL_THICKNESS_PROMPT);
  }
  if (applicability?.arms_flush_with_back) {
    sections.push(LOUNGE_SOFA_ARM_TOP_POSITION_PROMPT);
    sections.push(LOUNGE_SOFA_BACK_TOP_POSITION_PROMPT);
  }

  const requestedTraits = [];
  if (applicability?.seat_construction) {
    requestedTraits.push('  "upholstered_base_present": "Yes" | "No"');
    requestedTraits.push('  "upholstered_base_same_material": "Yes" | "No" | "N/A"');
    requestedTraits.push('  "upholstered_base_seam_visible": "Yes" | "No" | "N/A"');
    requestedTraits.push('  "upholstered_base_height_inches": <number 2-8 or null>');
  }
  if (applicability?.narrow_arms || applicability?.arms_flush_with_back) {
    requestedTraits.push('  "arm_panel_thickness_pct": <number 0-100>');
  }
  if (applicability?.arms_flush_with_back) {
    requestedTraits.push('  "arm_top_pct": <number 0-100>');
    requestedTraits.push('  "back_top_pct": <number 0-100>');
  }

  sections.push(`Output as JSON:

{
${requestedTraits.join(",\n")}
}`);

  return sections.join("\n\n");
}

function loungeSofaTraitSchema(applicability = {}) {
  const properties = {};
  const required = [];

  if (applicability?.seat_construction) {
    properties.upholstered_base_present = {
      type: "string",
      enum: ["Yes", "No"]
    };
    properties.upholstered_base_same_material = {
      type: "string",
      enum: ["Yes", "No", "N/A"]
    };
    properties.upholstered_base_seam_visible = {
      type: "string",
      enum: ["Yes", "No", "N/A"]
    };
    properties.upholstered_base_height_inches = {
      anyOf: [
        {
          type: "number",
          minimum: 2,
          maximum: 8
        },
        {
          type: "null"
        }
      ]
    };
    required.push(
      "upholstered_base_present",
      "upholstered_base_same_material",
      "upholstered_base_seam_visible",
      "upholstered_base_height_inches"
    );
  }
  if (applicability?.narrow_arms || applicability?.arms_flush_with_back) {
    properties.arm_panel_thickness_pct = {
      type: "number",
      minimum: 0,
      maximum: 100
    };
  }
  if (applicability?.arms_flush_with_back) {
    properties.arm_top_pct = {
      type: "number",
      minimum: 0,
      maximum: 100
    };
    properties.back_top_pct = {
      type: "number",
      minimum: 0,
      maximum: 100
    };
  }
  if (applicability?.narrow_arms || applicability?.arms_flush_with_back) {
    required.push("arm_panel_thickness_pct");
  }
  if (applicability?.arms_flush_with_back) {
    required.push("arm_top_pct", "back_top_pct");
  }

  return {
    type: "object",
    additionalProperties: false,
    properties,
    required
  };
}

function normalizeLoungeSofaMeasurement(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Number(Math.max(0, Math.min(100, numeric)).toFixed(2));
}

function normalizeLoungeSofaBaseHeightInches(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Number(Math.max(2, Math.min(8, numeric)).toFixed(2));
}

function classifyLoungeSofaSeatConstruction(rawObservations = {}) {
  return rawObservations?.upholstered_base_present === "Yes"
    && rawObservations?.upholstered_base_same_material === "Yes"
    && rawObservations?.upholstered_base_seam_visible === "Yes"
    && Number.isFinite(Number(rawObservations?.upholstered_base_height_inches))
    && Number(rawObservations?.upholstered_base_height_inches) >= 2.5
    ? "Cushion on Platform"
    : "Cushion Only";
}

function classifyLoungeSofaNarrowArms(thicknessPct = null) {
  if (!Number.isFinite(Number(thicknessPct))) {
    return null;
  }
  return Number(thicknessPct) <= LOUNGE_SOFA_NARROW_ARMS_THRESHOLD_PCT ? "Narrower" : "Wider";
}

function classifyLoungeSofaFlushWithBack(armTopPct = null, backTopPct = null) {
  const armTop = Number(armTopPct);
  const backTop = Number(backTopPct);
  if (!Number.isFinite(armTop) || !Number.isFinite(backTop)) {
    return null;
  }
  return (backTop - armTop) <= LOUNGE_SOFA_FLUSH_WITH_BACK_MAX_DROP_PCT ? "Flush with Back" : "Below Back";
}

function normalizeLoungeSofaTraits(typeKey = "", stage4Traits = {}, stage3Traits = {}) {
  const applicability = getLoungeSofaTraitApplicability(typeKey, stage3Traits);
  if (!hasAnyApplicableLoungeSofaTraits(applicability)) {
    return {
      image_traits: {},
      measurements: {}
    };
  }

  const normalized = {};
  const measurements = {};
  const fieldMap = getFieldMap(typeKey);
  const seatConstructionField = fieldMap.get("seat_construction");
  const narrowArmsField = fieldMap.get("narrow_arms");
  const armsFlushField = fieldMap.get("arms_flush_with_back");

  if (applicability.seat_construction && seatConstructionField) {
    const rawSeatObservations = {
      upholstered_base_present: normalizeEnum(stage4Traits?.upholstered_base_present, ["Yes", "No"]),
      upholstered_base_same_material: normalizeEnum(stage4Traits?.upholstered_base_same_material, ["Yes", "No", "N/A"]),
      upholstered_base_seam_visible: normalizeEnum(stage4Traits?.upholstered_base_seam_visible, ["Yes", "No", "N/A"]),
      upholstered_base_height_inches: normalizeLoungeSofaBaseHeightInches(stage4Traits?.upholstered_base_height_inches)
    };
    measurements.upholstered_base_present = rawSeatObservations.upholstered_base_present;
    measurements.upholstered_base_same_material = rawSeatObservations.upholstered_base_same_material;
    measurements.upholstered_base_seam_visible = rawSeatObservations.upholstered_base_seam_visible;
    measurements.upholstered_base_height_inches = rawSeatObservations.upholstered_base_height_inches;
    const normalizedValue = normalizeEnum(stage4Traits?.seat_construction, seatConstructionField.allowed_values);
    const computedValue = normalizeEnum(
      classifyLoungeSofaSeatConstruction(rawSeatObservations),
      seatConstructionField.allowed_values
    );
    if (computedValue) {
      normalized.seat_construction = computedValue;
    } else if (normalizedValue) {
      normalized.seat_construction = normalizedValue;
    }
  }

  if (applicability.narrow_arms) {
    measurements.arm_panel_thickness_pct = normalizeLoungeSofaMeasurement(stage4Traits?.arm_panel_thickness_pct);
    if (narrowArmsField) {
      const normalizedValue = normalizeEnum(
        classifyLoungeSofaNarrowArms(measurements.arm_panel_thickness_pct),
        narrowArmsField.allowed_values
      );
      if (normalizedValue) {
        normalized.narrow_arms = normalizedValue;
      }
    }
  }
  if (applicability.arms_flush_with_back) {
    measurements.arm_top_pct = normalizeLoungeSofaMeasurement(stage4Traits?.arm_top_pct);
    measurements.back_top_pct = normalizeLoungeSofaMeasurement(stage4Traits?.back_top_pct);
    if (armsFlushField) {
      const normalizedValue = normalizeEnum(
        classifyLoungeSofaFlushWithBack(measurements.arm_top_pct, measurements.back_top_pct),
        armsFlushField.allowed_values
      );
      if (normalizedValue) {
        normalized.arms_flush_with_back = normalizedValue;
      }
    }
  }

  return {
    image_traits: normalized,
    measurements
  };
}

function applyLoungeSofaTraitApplicability(typeKey = "", imageTraits = {}) {
  const normalizedTraits = imageTraits && typeof imageTraits === "object" ? { ...imageTraits } : {};
  const applicability = getLoungeSofaTraitApplicability(typeKey, normalizedTraits);

  if (!applicability.eligible) {
    delete normalizedTraits.seat_construction;
    delete normalizedTraits.narrow_arms;
    delete normalizedTraits.arms_flush_with_back;
    return normalizedTraits;
  }

  if (!applicability.seat_construction) {
    normalizedTraits.seat_construction = null;
  }
  if (!applicability.narrow_arms) {
    normalizedTraits.narrow_arms = null;
  }
  if (!applicability.arms_flush_with_back) {
    normalizedTraits.arms_flush_with_back = null;
  }

  return normalizedTraits;
}

function applyLoungeSofaMeasurementApplicability(typeKey = "", measurements = {}, imageTraits = {}) {
  const normalizedMeasurements = measurements && typeof measurements === "object" ? { ...measurements } : {};
  const applicability = getLoungeSofaTraitApplicability(typeKey, imageTraits);

  if (!applicability.eligible) {
    delete normalizedMeasurements.upholstered_base_present;
    delete normalizedMeasurements.upholstered_base_same_material;
    delete normalizedMeasurements.upholstered_base_seam_visible;
    delete normalizedMeasurements.upholstered_base_height_inches;
    delete normalizedMeasurements.arm_panel_thickness_pct;
    delete normalizedMeasurements.arm_top_pct;
    delete normalizedMeasurements.back_top_pct;
    return normalizedMeasurements;
  }

  if (!applicability.seat_construction) {
    normalizedMeasurements.upholstered_base_present = null;
    normalizedMeasurements.upholstered_base_same_material = null;
    normalizedMeasurements.upholstered_base_seam_visible = null;
    normalizedMeasurements.upholstered_base_height_inches = null;
  }
  if (!applicability.narrow_arms) {
    normalizedMeasurements.arm_panel_thickness_pct = null;
  }
  if (!applicability.arms_flush_with_back) {
    normalizedMeasurements.arm_top_pct = null;
    normalizedMeasurements.back_top_pct = null;
  }

  return normalizedMeasurements;
}

function medianNumericValues(values = []) {
  const numericValues = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (!numericValues.length) {
    return null;
  }
  const midpoint = Math.floor(numericValues.length / 2);
  if (numericValues.length % 2 === 1) {
    return Number(numericValues[midpoint].toFixed(2));
  }
  return Number((((numericValues[midpoint - 1] + numericValues[midpoint]) / 2)).toFixed(2));
}

function aggregateLoungeSofaMeasurements(applicability = {}, runMeasurements = []) {
  const measurements = {};

  if (applicability?.seat_construction) {
    measurements.upholstered_base_present = voteFieldValues(
      runMeasurements.map((entry) => entry?.upholstered_base_present)
    );
    measurements.upholstered_base_same_material = voteFieldValues(
      runMeasurements.map((entry) => entry?.upholstered_base_same_material)
    );
    measurements.upholstered_base_seam_visible = voteFieldValues(
      runMeasurements.map((entry) => entry?.upholstered_base_seam_visible)
    );
    measurements.upholstered_base_height_inches = medianNumericValues(
      runMeasurements.map((entry) => entry?.upholstered_base_height_inches)
    );
  } else {
    measurements.upholstered_base_present = null;
    measurements.upholstered_base_same_material = null;
    measurements.upholstered_base_seam_visible = null;
    measurements.upholstered_base_height_inches = null;
  }
  if (applicability?.narrow_arms) {
    measurements.arm_panel_thickness_pct = medianNumericValues(
      runMeasurements.map((entry) => entry?.arm_panel_thickness_pct)
    );
  } else {
    measurements.arm_panel_thickness_pct = null;
  }
  if (applicability?.arms_flush_with_back) {
    measurements.arm_top_pct = medianNumericValues(
      runMeasurements.map((entry) => entry?.arm_top_pct)
    );
    measurements.back_top_pct = medianNumericValues(
      runMeasurements.map((entry) => entry?.back_top_pct)
    );
  } else {
    measurements.arm_top_pct = null;
    measurements.back_top_pct = null;
  }

  return measurements;
}

function hasExtractedLoungeSofaTraits(imageTraits = {}) {
  return ["seat_construction", "narrow_arms", "arms_flush_with_back"].some((field) => {
    const value = imageTraits?.[field];
    const normalized = String(value ?? "").trim().toLowerCase();
    return Boolean(normalized && !["unknown", "n/a", "null", "undefined"].includes(normalized));
  });
}

function deriveLoungeSofaTraitStageStatus(applicability = {}, imageTraits = {}, triggered = false) {
  if (!applicability?.eligible) {
    return "out_of_scope";
  }
  if (!hasAnyApplicableLoungeSofaTraits(applicability)) {
    return "not_applicable";
  }
  if (hasExtractedLoungeSofaTraits(imageTraits)) {
    return "extracted";
  }
  return triggered ? "failed" : "failed";
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
        enum: [...stage1VisualTypeEnum, ""]
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

export function extractionSchemaForType(typeKey) {
  const fields = getStage23TypeFields(typeKey);
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
      if (!isStage23DetectableField(field)) {
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
        enum: stage1VisualTypeEnum
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
      const fields = getStage23TypeFields(typeKey);
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
  const typeConfig = getVisualTypeConfig(typeKey) || seatingTypes[fallbackSeatingType] || { label: typeKey || "Unknown type" };
  const fields = getStage23TypeFields(typeKey);
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
  [${stage1VisualTypeEnum.join(", ")}]
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
- ${LOUNGE_CHAIR_CANONICAL_RULES}
- ${LOUNGE_CHAIR_SHAPE_RULES}
- ${STOOL_CANONICAL_RULES}
- ${TASK_COLLAB_CHAIR_CANONICAL_RULES}
- ${GUEST_CHAIR_CANONICAL_RULES}
- ${BENCH_CANONICAL_RULES}
- ${OTHER_SEATING_CANONICAL_RULES}

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

function parseOpenAiErrorBody(errorBody = "") {
  const raw = String(errorBody || "").trim();
  if (!raw) {
    return {
      openai_type: "",
      openai_code: "",
      openai_message: ""
    };
  }
  try {
    const parsed = JSON.parse(raw);
    const error = parsed?.error && typeof parsed.error === "object" ? parsed.error : {};
    return {
      openai_type: String(error.type || "").trim(),
      openai_code: String(error.code || "").trim(),
      openai_message: String(error.message || raw).trim()
    };
  } catch {
    return {
      openai_type: "",
      openai_code: "",
      openai_message: raw
    };
  }
}

function classifyLlmFailureGroup({ status = 0, kind = "", error = null } = {}) {
  const normalizedKind = String(kind || "").trim().toLowerCase();
  if (normalizedKind === "parse") {
    return { group: "malformed_model_output", retryable: false, ambiguous: true };
  }
  if (normalizedKind === "empty_output") {
    return { group: "empty_model_output", retryable: false, ambiguous: true };
  }
  if (normalizedKind === "network" || normalizedKind === "timeout") {
    return { group: "network_or_timeout", retryable: true, ambiguous: false };
  }

  const numericStatus = Number(status || 0);
  if (numericStatus === 429) {
    return { group: "openai_rate_limited", retryable: true, ambiguous: false };
  }
  if (numericStatus >= 500 && numericStatus <= 599) {
    return { group: "openai_server_error", retryable: true, ambiguous: false };
  }
  if (numericStatus === 400) {
    return { group: "openai_bad_request", retryable: false, ambiguous: false };
  }
  if (numericStatus === 401 || numericStatus === 403) {
    return { group: "openai_auth_or_config", retryable: false, ambiguous: false };
  }

  const errorName = String(error?.name || "").trim().toLowerCase();
  const errorMessage = String(error?.message || "").trim().toLowerCase();
  if (errorName === "timeouterror" || errorName === "aborterror" || /timed? out|timeout/.test(errorMessage)) {
    return { group: "network_or_timeout", retryable: true, ambiguous: false };
  }
  if (
    errorName === "typeerror" ||
    /network|fetch failed|failed to fetch|socket|econnreset|econnrefused|enotfound/.test(errorMessage)
  ) {
    return { group: "network_or_timeout", retryable: true, ambiguous: false };
  }

  return { group: "unknown_llm_failure", retryable: false, ambiguous: true };
}

export function buildLlmFailureMeta({ source = "", status = 0, kind = "", errorBody = "", error = null } = {}) {
  const numericStatus = Number(status || 0) || 0;
  const details = parseOpenAiErrorBody(errorBody);
  const classification = classifyLlmFailureGroup({
    status: numericStatus,
    kind,
    error
  });
  return {
    source: String(source || "").trim(),
    kind: String(kind || "").trim().toLowerCase() || (
      numericStatus ? "http" : classification.group === "network_or_timeout" ? "network" : "unknown"
    ),
    status: numericStatus || null,
    group: classification.group,
    retryable: Boolean(classification.retryable),
    ambiguous: Boolean(classification.ambiguous),
    openai_type: details.openai_type || "",
    openai_code: details.openai_code || "",
    openai_message: details.openai_message || ""
  };
}

export function createLlmFailureError(message = "OpenAI request failed.", meta = {}) {
  const error = new Error(message);
  error.llm_failure = {
    ...meta
  };
  return error;
}

export function normalizeLlmFailureMeta(error = null, fallback = {}) {
  const existing = error?.llm_failure && typeof error.llm_failure === "object"
    ? error.llm_failure
    : null;
  if (existing) {
    return {
      ...existing,
      source: String(existing.source || fallback.source || "").trim()
    };
  }
  return buildLlmFailureMeta({
    source: fallback.source,
    status: fallback.status || 0,
    kind: fallback.kind || "",
    errorBody: fallback.errorBody || "",
    error
  });
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

function isDevFailureInjectionEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.PIXELSEEK_DEV_FAILURE_INJECTION === "1";
}

function getDevFailureInjectionMode(flagName = "") {
  if (!isDevFailureInjectionEnabled()) {
    return "";
  }
  return String(process.env[flagName] || "").trim().toLowerCase();
}

function maybeThrowInjectedLlmFailure(flagName = "", source = "") {
  const mode = getDevFailureInjectionMode(flagName);
  if (!mode) {
    return "";
  }

  if (mode === "rate_limited") {
    throw createLlmFailureError("Injected OpenAI rate limit failure.", buildLlmFailureMeta({
      source,
      status: 429,
      kind: "http",
      errorBody: JSON.stringify({ error: { type: "rate_limit_error", code: "rate_limit_exceeded", message: "Injected rate limit failure." } })
    }));
  }
  if (mode === "server_error") {
    throw createLlmFailureError("Injected OpenAI server failure.", buildLlmFailureMeta({
      source,
      status: 503,
      kind: "http",
      errorBody: JSON.stringify({ error: { type: "server_error", code: "server_error", message: "Injected server failure." } })
    }));
  }
  if (mode === "bad_request") {
    throw createLlmFailureError("Injected OpenAI bad request failure.", buildLlmFailureMeta({
      source,
      status: 400,
      kind: "http",
      errorBody: JSON.stringify({ error: { type: "invalid_request_error", code: "invalid_prompt", message: "Injected bad request failure." } })
    }));
  }
  if (mode === "network_or_timeout") {
    throw createLlmFailureError("Injected OpenAI timeout failure.", buildLlmFailureMeta({
      source,
      kind: "timeout"
    }));
  }
  if (mode === "empty_output") {
    throw createLlmFailureError("Injected OpenAI empty output failure.", buildLlmFailureMeta({
      source,
      kind: "empty_output"
    }));
  }
  if (mode === "malformed") {
    throw createLlmFailureError("Injected OpenAI malformed output failure.", buildLlmFailureMeta({
      source,
      kind: "parse"
    }));
  }
  if (mode === "unknown") {
    throw createLlmFailureError("Injected unknown OpenAI failure.", buildLlmFailureMeta({
      source,
      kind: "unknown"
    }));
  }

  return mode;
}

async function callOpenAiJsonWithMeta({ apiKey, model, systemPrompt, userParts, schemaName, schema, source = "" }) {
  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || 60000);
  const attempts = Number(process.env.OPENAI_MAX_RETRIES || 3);
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (source === "category_inference") {
        maybeThrowInjectedLlmFailure("PIXELSEEK_FAIL_CATEGORY_INFERENCE", source);
      }
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
        throw createLlmFailureError(`OpenAI request failed with ${response.status}.`, buildLlmFailureMeta({
          source,
          status: response.status,
          kind: "http",
          errorBody
        }));
      }

      const payload = await response.json();
      const outputText = payload.output_text || payload.output?.[0]?.content?.[0]?.text;
      if (!outputText) {
        throw createLlmFailureError("OpenAI response did not include JSON output.", buildLlmFailureMeta({
          source,
          kind: "empty_output"
        }));
      }
      let parsedOutput;
      try {
        parsedOutput = JSON.parse(outputText);
      } catch (error) {
        throw createLlmFailureError("OpenAI response returned malformed JSON output.", buildLlmFailureMeta({
          source,
          kind: "parse",
          error
        }));
      }
      return {
        data: parsedOutput,
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
  const isComposableBullet = () => true;
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

export function visualDescriptionPrompt(typeKey = "") {
  if (getVisualTypeFamily(typeKey) === "tables") {
    return `You are a furniture visual analyst. Describe the physical form of the primary table in the image in precise, searchable language.

Rules:
- Do not name the brand or model under any circumstances.
- Do not describe the room, background, or any secondary objects.
- Focus entirely on the table's visual geometry, support structure, and material character.
- If the image is a lifestyle or environment shot with multiple objects, focus exclusively on the primary table product. Ignore chairs, people, room decor, walls, floors, and background elements entirely. Describe only the table itself.
- If a feature is not present, state its absence explicitly.
- Never infer material from color alone — only describe what is structurally observable.

Return JSON only with these fields:
- silhouette: overall tabletop outline and negative space when viewed from the front or main angle (1-2 sentences)
- proportions: span, top thickness impression, and overall lightness/heaviness
- structure_type: how it holds itself up — describe the support skeleton visually (pedestal, 4-leg, trestle, T-leg, X-base, tripod, panel-slab, etc.)
- back_geometry: return "none — not applicable to tables"
- seat_geometry: describe the tabletop geometry, edge profile, and thickness read
- arm_geometry: return "none — no arms on tables"
- surface_language: texture, sheen, and material character visible on dominant top and base surfaces
- design_register: one of [minimal, organic, industrial, traditional, sculptural, utilitarian]
- distinctive_elements: up to 5 short visual details that would distinguish this from similar tables. Each item must be 8 words or fewer.
${buildVisualSummaryInstruction(typeKey)}`;
  }

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
${buildVisualSummaryInstruction(typeKey)}`;
}

function extractionPrompt(typeKey) {
  const type = getVisualTypeConfig(typeKey) || seatingTypes[fallbackSeatingType] || { label: typeKey || "Unknown type" };
  const fields = getStage23TypeFields(typeKey);
  const fieldLines = fields
    .map((entry) => `- ${entry.field} (photo-detectable: ${String(entry.detectability || "").toUpperCase()}) => [${entry.allowed_values.join(", ")}]`)
    .join("\n");
  if (getVisualTypeFamily(typeKey) === "tables") {
    return `Analyze one furniture image and answer only schema-routed questions. Type route: ${type.label} (${typeKey}). Return strict JSON only.

Rules:
- Fill image_traits fields only for the listed fields.
- Use the stage 2 visual summary plus the image itself to choose enum values.
- If a trait is not visible or not applicable, use "unknown". Never guess. Never infer material from color alone.
- Never invent values outside allowed enum values.
- Ignore chairs, people, and non-primary scene objects.
- For conditional traits, only answer the fields listed for this routed table type.
- structured_caption: write a 1-2 sentence product caption. No brand or model names. Lead with table form, support structure, and the most distinctive visual trait.
- raw_visual_highlights is optional debug only, max 8 bullets.
Fields: ${fieldLines}`;
  }
  const stoolBackRule = typeKey === "stool"
    ? `${STOOL_CANONICAL_RULES}\n`
    : "";
  const loungeChairBaseRule = typeKey === "lounge_chair"
    ? `${LOUNGE_CHAIR_CANONICAL_RULES} ${LOUNGE_CHAIR_CONFIGURATION_RULES}\n${LOUNGE_CHAIR_SHAPE_RULES}\n`
    : "";
  const taskCollabChairRule = typeKey === "task_collab_chair"
    ? `${TASK_COLLAB_CHAIR_CANONICAL_RULES}\n`
    : "";
  const guestChairRule = typeKey === "guest_chair"
    ? `${GUEST_CHAIR_CANONICAL_RULES}\n`
    : "";
  const benchRule = typeKey === "bench"
    ? `${BENCH_CANONICAL_RULES}\n`
    : "";
  return `Analyze one furniture image and answer only schema-routed questions. Type route: ${type.label} (${typeKey}). Return strict JSON only.

Rules:
- Fill image_traits fields only for the listed fields.
- Only attempt fields marked (photo-detectable: YES). Set (photo-detectable: MAYBE) fields only if clearly visible. Omit (photo-detectable: NO) fields entirely — these must come from spec data.
- If a trait is not visible or not applicable, use "unknown". Never guess. Never infer material from color alone.
- If a feature is structurally absent (e.g. no back, no arms), use "none" not "unknown".
- Never invent values outside allowed enum values.
- Ignore non-primary products and scene decor.
${stoolBackRule}${loungeChairBaseRule}${taskCollabChairRule}${guestChairRule}${benchRule}- structured_caption: write a 1-2 sentence product caption. No brand or model names. Lead with form and distinctive geometry. This replaces the previous visual_description field.
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

function buildStage23RoutingInstruction(typeKey, stage1 = {}, options = {}) {
  const visualTypeLabel = getVisualTypeLabel(typeKey);
  const routedVisualType = String(typeKey || "").trim();
  const family = getVisualTypeFamily(typeKey);

  if (options.typeRoutingSource === "mapping_v1") {
    return family === "tables"
      ? `Resolved visual_type is: ${routedVisualType}. Family: tables. Use this routed table type (${visualTypeLabel}) for all stage 2 and stage 3 outputs.`
      : `Resolved PixelSeek type is: ${routedVisualType}. Use this as the routing type for all stage 2 and stage 3 outputs.`;
  }

  if (family === "tables") {
    return `Routed visual_type: ${routedVisualType}. Family: tables. Use this routed table type (${visualTypeLabel}) for all stage 2 and stage 3 outputs.`;
  }

  return `Stage 1 seating_type result: ${stage1.seating_type}. Use this as the routing type for all stage 2 and stage 3 outputs.`;
}

function buildSingleRunFieldConfidence(typeKey = "", stage1 = {}, stage2 = {}, imageTraits = {}) {
  const normalizedTypeKey = String(typeKey || "").trim();
  const stage3Confidence = Object.fromEntries(
    Object.keys(imageTraits || {}).map((fieldName) => [fieldName, "high"])
  );

  return {
    stage1: {
      result: normalizeStage1Result(stage1?.result) === "product" ? "high" : "low",
      seating_type: normalizedTypeKey ? "high" : "low"
    },
    stage2: {
      design_register: String(stage2?.design_register || "").trim() ? "high" : "low"
    },
    stage3: {
      image_traits: stage3Confidence
    },
    image_traits: stage3Confidence
  };
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
  const fields = getStage23TypeFields(typeKey);
  const inferred = {};

  if (typeKey === "task_collab_chair") {
    inferred.back_finish = /knit/.test(source)
      ? "knit"
      : /mesh|net/.test(source)
        ? "mesh / net"
        : /plastic/.test(source)
          ? "plastic"
          : /upholster|fabric|leather|cushion/.test(source)
            ? "upholstered"
            : "unknown";
    inferred.back_profile = /curved|rounded|wrap/.test(source) ? "rounded / curved" : /square|angular|rectilinear|straight/.test(source) ? "square / angular" : "unknown";
    inferred.arm_option = /armless|no arms|without arms/.test(source) ? "armless" : /adjustable arms|adjustable arm|4d arms|height-adjustable arms/.test(source) ? "adjustable arms" : /integrated arms|integrated arm|one-piece arm|arms? flow from (the )?(shell|back|seat)|continuous arms?/.test(source) ? "integrated" : /arms?/.test(source) ? "fixed arms" : "unknown";
    inferred.base_type = /caster|wheel/.test(source)
      ? "5-star with casters"
      : /glide/.test(source)
        ? "5-star with glides"
        : /sled/.test(source)
          ? "sled"
          : /four[- ]leg|4-leg|legs/.test(source)
            ? "4-leg"
            : "unknown";
    inferred.base_finish = /polished aluminum|chrome|brushed aluminum/.test(source)
      ? "polished chrome / aluminum"
      : /natural wood|oak|walnut|ash|maple/.test(source)
        ? "natural wood"
        : /white/.test(source)
          ? "white"
          : /black|charcoal/.test(source)
            ? "black"
            : /painted|powder coat|color/.test(source)
            ? "painted color"
              : "unknown";
    inferred.seat_finish = /mesh|net/.test(source)
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
    inferred.base_finish = /polished aluminum|chrome|brushed aluminum/.test(source)
      ? "polished chrome / aluminum"
      : /natural wood|oak|walnut|ash|maple/.test(source)
        ? "natural wood"
        : /white/.test(source)
          ? "white"
          : /black|charcoal/.test(source)
            ? "black"
            : /painted|powder coat|color/.test(source)
            ? "painted color"
              : "unknown";
    inferred.seat_finish = /leather/.test(source)
      ? "leather"
      : /upholster|fabric|cushion|textile/.test(source)
        ? "fabric"
      : /solid wood|wooden/.test(source)
        ? "natural wood"
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
        ? "polished chrome / aluminum"
        : /white/.test(source)
          ? "white"
          : /painted|powder coat|color/.test(source)
            ? "painted color"
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
            ? "natural wood"
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
              ? "natural wood"
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
    inferred.arm_option = /armless|no arms|without arms/.test(source) ? "armless" : /one arm/.test(source) ? "one arm" : /integrated|wrap arm|sculpted arm/.test(source) ? "integrated / sculpted" : /arms?/.test(source) ? "two arms" : "unknown";
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
      ? "polished chrome / aluminum"
      : /wood|oak|walnut|ash|maple/.test(source)
        ? "natural wood"
        : /white/.test(source)
          ? "white"
          : /painted|powder coat|color/.test(source)
            ? "painted color"
          : /black|charcoal/.test(source)
            ? "black"
            : "unknown";
    inferred.seat_finish = /leather/.test(source)
      ? "leather"
      : /plastic|wood|shell/.test(source) && !/upholster|fabric|leather|cushion/.test(source)
        ? "unupholstered"
        : /fabric|upholster|textile|cushion/.test(source)
          ? "fabric"
          : "unknown";
    inferred.back_finish = /unupholster|bare shell/.test(source)
      ? "unupholstered shell"
      : /independent fabric|contrasting back/.test(source)
        ? "independent fabric"
        : /upholster|fabric|leather|cushion/.test(source)
          ? "matches seat"
          : "unknown";
    inferred.back_height = /full enclosure|privacy/.test(source) ? "full enclosure" : /high back/.test(source) ? "high" : /mid back|medium back/.test(source) ? "mid" : /low back/.test(source) ? "low" : "unknown";
    inferred.configuration = /sectional sofa|three-seat|3-seat|three seater|sofa/.test(source) ? "triple seat (or larger)" : /loveseat|two-seat|2-seat|settee/.test(source) ? "double seat" : /modular/.test(source) ? "modular component" : /corner/.test(source) ? "corner unit" : /ottoman|pouf|footrest/.test(source) ? "ottoman" : /chair|lounge/.test(source) ? "single seat" : "unknown";
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

function applyGuestChairBaseFinishFallback(typeKey, imageTraits = {}, imageInput = {}) {
  if (typeKey !== "guest_chair") {
    return imageTraits;
  }

  const currentValue = String(imageTraits.base_finish || "").trim().toLowerCase();
  if (currentValue && currentValue !== "unknown") {
    return imageTraits;
  }

  const source = `${imageInput.catalogContext || ""} ${imageInput.image_url || ""}`.toLowerCase();
  const inferredValue = /natural wood|wood base|wood legs|wooden|oak|walnut|ash|maple|reclaimed|4legwood/.test(source)
    ? "Natural wood"
    : /polished|chrome|aluminum|aluminium/.test(source)
      ? "Polished chrome / aluminum"
      : /white/.test(source)
        ? "White"
        : /painted|powder coat|color/.test(source)
          ? "Painted color"
      : /black|charcoal/.test(source)
        ? "Black"
        : "";
  if (!inferredValue || inferredValue.toLowerCase() === "unknown") {
    return imageTraits;
  }

  return {
    ...imageTraits,
    base_finish: inferredValue
  };
}

function applyGuestChairBaseFinishRecordFallback(typeKey, enumFields = {}, imageRecord = {}, productName = "") {
  if (typeKey !== "guest_chair") {
    return enumFields;
  }

  const currentValue = String(enumFields.base_finish || "").trim().toLowerCase();
  if (currentValue && currentValue !== "unknown") {
    return enumFields;
  }

  const source = `${productName || ""} ${imageRecord.image_url || ""}`.toLowerCase();
  const inferredValue = /natural wood|wood base|wood legs|wooden|oak|walnut|ash|maple|reclaimed|4legwood/.test(source)
    ? "Natural wood"
    : /polished|chrome|aluminum|aluminium/.test(source)
      ? "Polished chrome / aluminum"
      : /white/.test(source)
        ? "White"
        : /painted|powder coat|color/.test(source)
          ? "Painted color"
      : /black|charcoal/.test(source)
        ? "Black"
        : "";

  if (!inferredValue) {
    return enumFields;
  }

  return {
    ...enumFields,
    base_finish: inferredValue
  };
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
      structured_caption: sentenceCase(`${getVisualTypeLabel(typeKey) || "Furniture"} from inspiration image.`).replace(/\.*$/, "."),
      raw_visual_highlights: cleanVisualHighlights(buildDeterministicBulletsFromMergedTraits(typeKey, heuristicTraits)),
      image_traits: normalizeImageTraits(typeKey, heuristicTraits)
    };
  }

  if (typeKey === "stool") {
    const fieldsBeforeFilter = getTypeFields(typeKey);
    const fieldsAfterFilter = getStage23TypeFields(typeKey);
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
        text: `${buildStage23RoutingInstruction(typeKey, stage1, options)} Visual context: ${stage2.visual_summary}. Extract structured traits and write the structured_caption from the image.`
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
  const finalTraitsWithFallbacks = applyGuestChairBaseFinishFallback(typeKey, finalTraits, imageInput);
  if (process.env.DEBUG_CAPTION_HANDOFF === "1") {
    console.log("HANDOFF 3 - post-normalization image_traits:", JSON.stringify(finalTraitsWithFallbacks, null, 2));
  }

  return {
    reasoning: normalizeWhitespace(guardedParsed.reasoning || ""),
    structured_caption: sentenceCase(guardedParsed.structured_caption || "Structured seating result.").replace(/\.*$/, "."),
    raw_visual_highlights: uniqueStrings(Array.isArray(guardedParsed.raw_visual_highlights) ? guardedParsed.raw_visual_highlights : []).slice(0, 8),
    image_traits: finalTraitsWithFallbacks
  };
}

export function combinedStage23Prompt(typeKey) {
  const typeConfig = getVisualTypeConfig(typeKey) || seatingTypes[fallbackSeatingType] || { label: typeKey || "Unknown type" };
  if (getVisualTypeFamily(typeKey) === "tables") {
    return `You are a furniture visual analyst. Analyze only the primary table product in the image. The visual_type has already been routed: ${typeConfig.label} (${typeKey}).

Return strict JSON only.

Stage 2: visual form
- Describe only the primary table product.
- Ignore the room, chairs, props, people, and secondary objects.
- No brand or model names.
- Focus on tabletop shape, proportions, support structure, surface character, design register, and distinctive details.
- Use back_geometry = "none — not applicable to tables".
- Use arm_geometry = "none — no arms on tables".

Stage 3: attributes
- Fill only the attributes listed below for this routed table type.
- If a trait is not visible or not applicable, use "unknown".
- Never invent values outside the allowed enums.
- Use the image and stage 2 visual summary together to resolve the structured traits.

Relevant attribute fields for this routed table type only:
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
${buildVisualSummaryInstruction(typeKey)}
- structured_caption
- raw_visual_highlights
- image_traits`;
  }
  const stoolBackRule = typeKey === "stool"
    ? `${STOOL_CANONICAL_RULES}\n`
    : "";
  const loungeChairBaseRule = typeKey === "lounge_chair"
    ? `${LOUNGE_CHAIR_CANONICAL_RULES} ${LOUNGE_CHAIR_CONFIGURATION_RULES}\n${LOUNGE_CHAIR_SHAPE_RULES}\n`
    : "";
  const taskCollabChairRules = typeKey === "task_collab_chair"
    ? `${TASK_COLLAB_CHAIR_CANONICAL_RULES}\n`
    : "";
  const guestChairRules = typeKey === "guest_chair"
    ? `${GUEST_CHAIR_CANONICAL_RULES}\n`
    : "";
  const benchRules = typeKey === "bench"
    ? `${BENCH_CANONICAL_RULES}\n`
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
${stoolBackRule}${loungeChairBaseRule}${taskCollabChairRules}${guestChairRules}${benchRules}Relevant attribute fields for this seating type only:
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
${buildVisualSummaryInstruction(typeKey)}
- structured_caption
- raw_visual_highlights
- image_traits`;
}

export async function extractStage23CombinedOpenAi(imageInput, typeKey, stage1, options = {}) {
  if (!options.apiKey) {
    const stage2 = await describeVisualFormOpenAi(imageInput, { ...options, typeKey });
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
        text: buildStage23RoutingInstruction(typeKey, stage1, options)
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
  const finalTraitsWithFallbacks = applyGuestChairBaseFinishFallback(typeKey, finalTraits, imageInput);
  const stage3 = {
    reasoning: normalizeWhitespace(guardedParsed.reasoning || ""),
    structured_caption: sentenceCase(guardedParsed.structured_caption || "Structured seating result.").replace(/\.*$/, "."),
    raw_visual_highlights: uniqueStrings(Array.isArray(guardedParsed.raw_visual_highlights) ? guardedParsed.raw_visual_highlights : []).slice(0, 8),
    image_traits: finalTraitsWithFallbacks
  };

  return { stage2, stage3, usage };
}

async function extractLoungeSofaTraitsOpenAi(imageInput, typeKey, stage3ImageTraits = {}, options = {}) {
  const applicability = getLoungeSofaTraitApplicability(typeKey, stage3ImageTraits);
  if (!options.apiKey || !hasAnyApplicableLoungeSofaTraits(applicability)) {
    return {
      image_traits: {},
      raw_measurements: applyLoungeSofaMeasurementApplicability(typeKey, {}, stage3ImageTraits),
      usage: normalizeOpenAiUsage(),
      triggered: false,
      applicability
    };
  }

  const { data: parsed, usage } = await callOpenAiJsonWithMeta({
    apiKey: options.apiKey,
    model: options.visionModel,
    systemPrompt: buildLoungeSofaTraitPrompt(applicability),
    userParts: [
      { type: "input_image", image_url: imageInput.image_url, detail: "high" }
    ],
    schemaName: "lounge_sofa_trait_stage",
    schema: loungeSofaTraitSchema(applicability)
  });

  const normalizedStage4 = normalizeLoungeSofaTraits(typeKey, parsed, stage3ImageTraits);

  return {
    image_traits: normalizedStage4.image_traits,
    raw_measurements: applyLoungeSofaMeasurementApplicability(typeKey, normalizedStage4.measurements, stage3ImageTraits),
    usage,
    triggered: true,
    applicability
  };
}

async function describeVisualFormOpenAi(imageInput, options = {}) {
  const isTablesType = getVisualTypeFamily(options.typeKey || "") === "tables";
  if (!options.apiKey) {
    return isTablesType
      ? {
          silhouette: "Primary table object with a readable tabletop outline and conservative inferred geometry.",
          proportions: "Proportions are estimated conservatively from the visible span, top thickness, and support stance.",
          structure_type: "Visible support structure is described conservatively from the image.",
          back_geometry: "none — not applicable to tables",
          seat_geometry: "Tabletop geometry and edge treatment are summarized only at a high level.",
          arm_geometry: "none — no arms on tables",
          surface_language: "Dominant top and base surface character is inferred conservatively from visible materials.",
          design_register: "utilitarian",
          distinctive_elements: [],
          visual_summary: "Primary table object detected with conservative visual-form description. Tabletop geometry and support structure are summarized only from clearly visible cues."
        }
      : {
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
    systemPrompt: visualDescriptionPrompt(options.typeKey || ""),
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
    const seatingType = resolveStage1VisualType(stage1);
    const stage2 = await describeVisualFormOpenAi(imageInput, { ...options, typeKey: seatingType });
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

  const seatingType = ensureTypeKey(parsed.visual_type || parsed.seating_type);
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
  const seatMaterial = (mergedTraits.seat_finish === "unknown" ? "" : mergedTraits.seat_finish) || (mergedTraits.seat_material === "unknown" ? "" : mergedTraits.seat_material) || (mergedTraits.seat_upholstery === "unknown" ? "" : mergedTraits.seat_upholstery);
  const backConstruction = (mergedTraits.back_finish === "unknown" ? "" : mergedTraits.back_finish) || (mergedTraits.back_style === "unknown" ? "" : mergedTraits.back_style) || (mergedTraits.body_construction === "unknown" ? "" : mergedTraits.body_construction);
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

export function resolveStage0RoutingContext(imageRecord = {}, options = {}) {
  const explicitRouting = resolveVisualType({
    visual_type:
      options.visual_type ||
      options.visualType ||
      options.visual_type_override ||
      options.visualTypeOverride ||
      imageRecord.visual_type,
    seating_type:
      options.seating_type ||
      options.seatingType ||
      options.seating_type_override ||
      options.seatingTypeOverride ||
      imageRecord.seating_type
  });
  if (explicitRouting) {
    return explicitRouting;
  }

  const pixelSeekType = getPixelSeekType(imageRecord);
  const catalogVisualType = resolveCatalogVisualTypeKey(pixelSeekType);
  if (catalogVisualType) {
    return resolveVisualType({ visual_type: catalogVisualType });
  }

  return null;
}

export function buildStage0FurnitureCountPrompt(routingContext = null) {
  const family = String(routingContext?.family || "").trim().toLowerCase();
  if (family === "tables") {
    return `Count the distinct primary furniture pieces in this photo. Furniture means: tables, desks, cabinets, shelving, benches, stools, chairs, sofas, or beds.

Multiple of the same type count as 1 only when they read as a single tightly presented catalog grouping rather than a real room scene.

The intended product family for this image is tables.

Use these rules carefully:
- A clean studio, cutout, or plain-background product presentation of one table counts as 1.
- A clean catalog presentation of one table with its immediately accompanying chairs can still count as 1 when the image reads like a product lineup or showroom-style isolated grouping rather than a fully realized room.
- If the image reads as a real environment or lifestyle scene, do NOT collapse it to 1 just because one table is dominant.
- Environmental scene indicators include architectural context such as walls, windows, ceilings, floors, outdoor views, lighting that defines a real space, decor or plants, circulation space, multiple room zones, or multiple independently usable furniture pieces distributed through the space.
- In a conference room, cafe, restaurant, lounge, or other fully realized environment, count surrounding independent chairs as additional furniture pieces rather than as part of the table.
- If the image clearly shows a room or lifestyle setting built around the table, count more than 1.
- Do not count faint background furniture only when it is truly negligible and the image still reads as a clean product presentation rather than a room.

Return only a number.`;
  }

  return `Count the furniture in this photo. Furniture means: chairs, sofas,
tables, desks, cabinets, shelving, benches, stools, or beds.

Multiple of the same type count as 1.

A seating product with an integrated or attached table, tablet, or worksurface counts as one furniture product when that surface is structurally attached to the seating product itself or shares the same base or frame.

Count it as a separate furniture item only when the table or worksurface stands on its own independent support structure or is clearly a separate companion piece.

Return only a number.`;
}

export function buildStage0CompletenessPrompt(routingContext = null) {
  const family = String(routingContext?.family || "").trim().toLowerCase();
  if (family === "tables") {
    return `Assess the primary table product in this photo.

Return one of exactly three answers:
- "full" if the full silhouette of the primary table is visible and the image reads like a clean product presentation
- "partial" if only part of the primary table is visible or key parts of the silhouette are cropped/missing
- "environmental" if the full table may be visible but the image reads as a fully realized room, lifestyle, hospitality, workplace, or outdoor environment rather than a clean product shot

Environmental indicators include visible architecture, windows, ceilings, flooring, decor, plants, multiple furniture zones, or a scene that reads as an occupied/styled room rather than isolated product photography.

Return only "full", "partial", or "environmental".`;
  }

  return `Can you see the full silhouette of the furniture piece in this photo,
or only part of it?

Return "full" or "partial".`;
}

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
  const requestedTypeInfo = resolveRequestedCaptionVisualTypeInfo(imageRecord, options);
  if (shouldUseCallerProvidedRouting(requestedTypeInfo)) {
    if (typeof options.progressCallback === "function") {
      options.progressCallback({
        type: "stage1_stubbed",
        visual_type: requestedTypeInfo.visual_type,
        family: requestedTypeInfo.family,
        type_routing_source: "caller_provided"
      });
    }
    const stage1 = buildResolvedRoutingStage1Stub(requestedTypeInfo.visual_type || "", "caller_provided");
    const { stage2, stage3, usage: stage23Usage } = await extractStage23CombinedOpenAi(
      imageInput,
      requestedTypeInfo.visual_type,
      stage1,
      {
        ...options,
        typeRoutingSource: "caller_provided"
      }
    );
    const fieldMap = getFieldMap(requestedTypeInfo.visual_type);
    const imageTraits = {};
    for (const [fieldName, value] of Object.entries(stage3.image_traits || {})) {
      const field = fieldMap.get(fieldName);
      if (!field) continue;
      imageTraits[fieldName] = normalizeEnum(value, field.allowed_values);
    }

    const specTraits = await extractSpecTraits(requestedTypeInfo.visual_type, imageRecord);
    const { merged_traits, trait_provenance } = mergeTraits(requestedTypeInfo.visual_type, imageTraits, specTraits);
    const visualTraits = toLegacyVisualTraits(requestedTypeInfo.visual_type, merged_traits);
    const visualHighlights = buildDeterministicBulletsFromMergedTraits(requestedTypeInfo.visual_type, merged_traits);
    const fieldConfidence = buildSingleRunFieldConfidence(requestedTypeInfo.visual_type, stage1, stage2, imageTraits);
    const totalUsage = normalizeOpenAiUsage(stage23Usage);

    return {
      image_dimensions: imageDimensions,
      stage1,
      stage2,
      stage3: {
        ...stage3,
        image_traits: imageTraits
      },
      structured_caption: stage3.structured_caption,
      raw_visual_highlights: stage3.raw_visual_highlights,
      visual_highlights: visualHighlights,
      seating_type: String(stage1.seating_type || "").trim(),
      visual_type: String(stage1.visual_type || "").trim(),
      family: String(stage1.family || "").trim(),
      image_traits: imageTraits,
      spec_traits: specTraits,
      merged_traits,
      trait_provenance,
      visual_traits: visualTraits,
      field_confidence: fieldConfidence,
      extraction_runs: 1,
      analysis_api_call_count: options.apiKey ? 1 : 0,
      api_call_count: options.apiKey ? 1 : 0,
      type_routing_source: "caller_provided",
      extraction_consensus: {
        tiebreaker_used: false,
        runs: [
          {
            run: "run_1",
            stage1: normalizeOpenAiUsage(),
            stage23: totalUsage,
            total: totalUsage,
            estimated_cost_usd: estimateUsageCostUsd(totalUsage)
          }
        ],
        total_usage: {
          ...totalUsage,
          estimated_cost_usd: estimateUsageCostUsd(totalUsage)
        }
      }
    };
  }
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
  const seatingType = resolveStage1VisualType(stage1);
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
    seating_type: run.stage1?.seating_type || "",
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
- bench: multi-person seat without individual back support, long seat surface`;
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

  const model = options.stage0Model || "gpt-4.1";
  const routingContext = options.stage0RoutingContext || null;
  const { data: countData, usage: countUsage } = await callOpenAiJsonWithMeta({
    apiKey: options.apiKey,
    model,
    systemPrompt: buildStage0FurnitureCountPrompt(routingContext),
    userParts: [
      ...(imageInput.catalogContext
        ? [{ type: "input_text", text: imageInput.catalogContext }]
        : []),
      { type: "input_image", image_url: imageInput.image_url, detail: "low" }
    ],
    schemaName: "stage0_product_count",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        answer: { type: "string" }
      },
      required: ["answer"]
    }
  });

  const rawCount = String(countData?.answer || "").trim();
  const parsedCountMatch = rawCount.match(/\d+/);
  const parsedCount = parsedCountMatch ? Number(parsedCountMatch[0]) : Number.NaN;
  if (!Number.isFinite(parsedCount)) {
    return {
      data: { result: "scene" },
      usage: countUsage
    };
  }

  if (parsedCount > 1) {
    return {
      data: { result: "scene" },
      usage: countUsage
    };
  }

  const { data: completenessData, usage: completenessUsage } = await callOpenAiJsonWithMeta({
    apiKey: options.apiKey,
    model,
    systemPrompt: buildStage0CompletenessPrompt(routingContext),
    userParts: [
      ...(imageInput.catalogContext
        ? [{ type: "input_text", text: imageInput.catalogContext }]
        : []),
      { type: "input_image", image_url: imageInput.image_url, detail: "low" }
    ],
    schemaName: "stage0_product_completeness",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        answer: { type: "string" }
      },
      required: ["answer"]
    }
  });

  const rawCompleteness = String(completenessData?.answer || "").trim().toLowerCase();
  const result = rawCompleteness.includes("environmental")
    ? "scene"
    : rawCompleteness.includes("partial")
    ? "product_detail"
    : rawCompleteness.includes("full")
      ? "product"
      : "product";

  return {
    data: { result },
    usage: sumUsage(countUsage, completenessUsage)
  };
}

export async function classifyImageStage0Only(imageRecord = {}, options = {}) {
  const categories = normalizeCategories(imageRecord);
  const stage0RoutingContext = resolveStage0RoutingContext(imageRecord, options);
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
    stage0RoutingContext,
    precomputedImageDimensions: imageDimensions
  });
  return {
    stage0_result: data.result,
    usage,
    estimated_cost_usd: estimateUsageCostUsd(usage),
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
  "arm_option",
  "seat_construction",
  "narrow_arms",
  "arms_flush_with_back",
  "back_height",
  "back_finish",
  "back_profile",
  "back",
  "configuration",
  "seat_geometry",
  "seat_finish",
  "design_register",
  "frame_openness",
  "shape_character",
  "plan_shape",
  "base_type",
  "base_finish"
];

function getSearchTimeBulletFieldPriority(typeKey = "") {
  const resolvedType = resolveTextQueryTraitType(typeKey);
  if (getVisualTypeFamily(resolvedType) === "tables") {
    return getTypeFields(resolvedType).map((field) => field.field).filter(Boolean);
  }
  return SEARCH_TIME_BULLET_FIELD_PRIORITY;
}

function buildSearchTimeBullets(enumFields = {}, typeKey = "") {
  const priorityIndex = new Map(
    getSearchTimeBulletFieldPriority(typeKey).map((field, index) => [field, index])
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
      // Structured yes/no traits must use affirmative descriptors (e.g.,
      // narrow_arms uses "Narrower"/"Wider", not "Yes"/"No") so legitimate
      // negative answers don't match this filter. See narrow_arms and
      // arms_flush_with_back for canonical examples.
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
  const normalizedSeatingType = resolveTextQueryTraitType(seatingType);
  const family = getVisualTypeFamily(normalizedSeatingType);
  const heuristicTraits = extractQueryTraits(query);
  const enumFields = {};

  if (normalizedSeatingType === "lounge_chair") {
    if (heuristicTraits.arms_present === false) {
      enumFields.arm_option = "Armless";
    } else if (heuristicTraits.arms_present === true) {
      enumFields.arm_option = "Two arms";
    }
  } else if (normalizedSeatingType === "task_collab_chair" || normalizedSeatingType === "guest_chair") {
    if (heuristicTraits.arms_present === false) {
      enumFields.arm_option = "Armless";
    } else if (heuristicTraits.arm_adjustability === "fully adjustable" || heuristicTraits.arm_adjustability === "height-adjustable") {
      enumFields.arm_option = "Adjustable arms";
    } else if (/integrated arms|integrated arm|one-piece arm|arms flow from shell|arms flow from back|arms flow from seat|continuous arms|sculpted arm|wrap arm/.test(query)) {
      enumFields.arm_option = "Integrated";
    } else if (heuristicTraits.arms_present === true) {
      enumFields.arm_option = normalizedSeatingType === "guest_chair" ? "Open arm" : "Fixed arms";
    }
  }

  if (family === "tables") {
    const normalizedQuery = normalizeWhitespace(query).toLowerCase();
    const shapeRules = [
      { pattern: /\bsoft[-\s]?organic\b|\borganic\b/, value: "Soft-organic" },
      { pattern: /\boval\b/, value: "Oval" },
      { pattern: /\bround\b/, value: "Round" },
      { pattern: /\bsquare\b/, value: "Square" },
      { pattern: /\brectangular\b|\brectangle\b/, value: "Rectangle" }
    ];
    const baseTypeRules = [
      { pattern: /\bpanel[-\s]?slab\b|\bplinth\b/, value: "Panel-slab" },
      { pattern: /\btripod\b/, value: "Tripod" },
      { pattern: /\btrestle\b/, value: "Trestle" },
      { pattern: /\bt[-\s]?leg\b/, value: "T-leg" },
      { pattern: /\bx[-\s]?base\b/, value: "X-base" },
      { pattern: /\b4[-\s]?leg\b|\bfour[-\s]?leg\b|\bfour legs\b/, value: "4-leg" },
      { pattern: /\bpedestal\b/, value: "Pedestal" }
    ];
    const topMaterialRules = [
      { pattern: /\bmarble\b|\bgranite\b|\bquartz\b|\bterrazzo\b|\bstone\b/, value: "Stone-look" },
      { pattern: /\bglass\b/, value: "Glass" },
      { pattern: /\bmetal\b/, value: "Metal" },
      { pattern: /\bwood\b|\bwooden\b|\boak\b|\bwalnut\b|\bash\b|\bmaple\b/, value: "Wood-look" }
    ];

    const firstMatch = (rules = []) => {
      const matched = rules.find((rule) => rule.pattern.test(normalizedQuery));
      return matched ? matched.value : "";
    };

    const topShape = firstMatch(shapeRules);
    if (topShape) {
      enumFields.top_shape = topShape;
    }

    const baseType = firstMatch(baseTypeRules);
    if (baseType) {
      enumFields.base_type = baseType;
    }

    const topMaterial = firstMatch(topMaterialRules);
    if (topMaterial) {
      enumFields.top_material = topMaterial;
    }

    if (/\bcasters?\b|\bwheels?\b|\brolling\b|\bmobile\b/.test(normalizedQuery)) {
      enumFields.mobility = "Casters";
    }
    if (/\bthin\b|\bslim\b/.test(normalizedQuery)) {
      enumFields.top_thickness = "Thin";
    } else if (/\bthick\b|\bslab\b/.test(normalizedQuery)) {
      enumFields.top_thickness = "Thick-slab";
    }
    if (/\bbeveled\b/.test(normalizedQuery)) {
      enumFields.edge_profile = "Beveled";
    } else if (/\beased\b|\brounded edge\b/.test(normalizedQuery)) {
      enumFields.edge_profile = "Eased";
    } else if (/\bsquare edge\b|\bsharp edge\b/.test(normalizedQuery)) {
      enumFields.edge_profile = "Square";
    }
    if (/\blightweight\b|\bairy\b|\bopen base\b/.test(normalizedQuery)) {
      enumFields.base_visual_weight = "Light/airy";
    } else if (/\bgrounded\b|\bsubstantial\b|\bchunky\b|\bheavy\b/.test(normalizedQuery)) {
      enumFields.base_visual_weight = "Heavy/grounded";
    }
    if (/\bminimal\b|\bclean[-\s]?lined\b/.test(normalizedQuery)) {
      enumFields.design_register = "Minimal";
    } else if (/\bsculptural\b/.test(normalizedQuery)) {
      enumFields.design_register = "Sculptural";
    } else if (/\butilitarian\b|\bflip[-\s]?top\b|\bnesting\b/.test(normalizedQuery)) {
      enumFields.design_register = "Utilitarian";
    }
    if (normalizedSeatingType === "occasional") {
      if (/\bcoffee table\b/.test(normalizedQuery)) {
        enumFields.height_register = "Coffee";
      } else if (/\bend table\b|\bside table\b/.test(normalizedQuery)) {
        enumFields.height_register = "End/Side";
      }
    }
    if (normalizedSeatingType === "cafe_dining" || normalizedSeatingType === "training" || normalizedSeatingType === "huddle_collaborative") {
      if (/\bbar[-\s]?height\b|\bcounter[-\s]?height\b|\bstanding\b|\bstanding height\b/.test(normalizedQuery)) {
        enumFields.height_register = "Standing";
      } else if (/\bsitting\b|\bdining height\b|\bseated\b/.test(normalizedQuery)) {
        enumFields.height_register = "Sitting";
      }
    }
    if (normalizedSeatingType === "conference" || normalizedSeatingType === "training" || normalizedSeatingType === "huddle_collaborative") {
      if (/\bpower\b|\bpowered\b|\boutlet\b|\bgrommet\b|\bdata\b|\busb\b/.test(normalizedQuery)) {
        enumFields.power_data_integration = "Present";
      }
    }
  }

  return enumFields;
}

function getTextQueryTraitFields(typeKey = "") {
  return uniqueStrings(getTypeFields(resolveTextQueryTraitType(typeKey)).map((field) => String(field.field || "").trim()).filter(Boolean));
}

const TEXT_QUERY_MAPPING_GUIDANCE_BY_FIELD = Object.freeze({});

function buildTextQueryTraitPrompt(seatingType = "") {
  const resolvedType = resolveTextQueryTraitType(seatingType);
  const family = getVisualTypeFamily(resolvedType) || "seating";
  const typeLabel = getVisualTypeLabel(resolvedType);
  const fields = getTypeFields(resolvedType);
  const fieldSet = new Set(fields.map((field) => field.field));
  const fieldLines = fields.map((field) => `- ${field.field}: ${(field.allowed_values || []).join(" | ")}`);
  const mappingGuidance = [];

  for (const [field, lines] of Object.entries(TEXT_QUERY_MAPPING_GUIDANCE_BY_FIELD)) {
    if (!fieldSet.has(field)) {
      continue;
    }
    mappingGuidance.push(...lines);
  }
  mappingGuidance.push("- Not mentioned -> unknown");

  const familySpecificExamples = family === "tables"
    ? [
        "- Example table mappings: 'round cafe table' -> top_shape may be Round; 'training table with casters' -> mobility may be Casters; 'bar-height cafe table' -> height_register may be Standing."
      ]
    : [
        "- Example seating mappings: 'armless lounge chair' -> arm_option may be Armless; 'mesh task chair' -> back_finish may be Mesh / net."
      ];

  return [
    `You are a furniture attribute extractor. Given a text description or search query for a ${family === "tables" ? "table" : "seating"} product, extract any structured traits that are clearly stated or strongly implied. Return JSON only with the fields listed below plus display_string. Only populate traits valid for the specified visual_type. Return unknown for anything not mentioned or strongly implied. Never guess.`,
    "",
    "The routing context is fixed for this request:",
    `- visual_type: ${resolvedType} (${typeLabel})`,
    `- family: ${family}`,
    `- category_display_label: ${typeLabel}`,
    "",
    `Fields to extract for ${resolvedType} only:`,
    "- display_string: short UI display text that must include the literal token [CATEGORY]",
    ...fieldLines,
    "",
    "Mapping guidance:",
    ...mappingGuidance,
    ...familySpecificExamples,
    "",
    "display_string rules:",
    "- Use the literal token [CATEGORY] where the category pill should render.",
    "- display_string is additional output, not a replacement for trait extraction.",
    "- Still populate every applicable structured trait field alongside display_string whenever the query states or strongly implies it.",
    "- Preserve subtype nouns like sofas, sectionals, loveseats, and barstools when they materially narrow the query.",
    "- Avoid awkward repetition such as '[CATEGORY] with sofas with concealed bases'.",
    "- Keep display_string under 120 characters.",
    "- Return JSON only.",
    "",
    "Display examples:",
    `- Query: "lounge seating with wood arms" -> {"display_string":"[CATEGORY] with wood arms"}`,
    `- Query: "sofas with concealed bases" -> {"display_string":"[CATEGORY], specifically sofas with concealed bases"}`,
    `- Query: "counter height barstools" -> {"display_string":"[CATEGORY], specifically barstools, at counter height"}`,
    `- Query: "barstools" -> {"display_string":"[CATEGORY] barstools"}`,
    `- Query: "armless lounge chairs" -> {"display_string":"[CATEGORY] without arms"}`,
    `- Query: "modern sectional with leather" -> {"display_string":"[CATEGORY], specifically sectionals, in modern style with leather"}`,
    "",
    "Full extraction examples:",
    `- Query: "backless sofas with wood legs" -> {"display_string":"[CATEGORY], specifically sofas without backs with wood legs","back_height":"Low","back_finish":"Unupholstered shell","base_finish":"Natural wood"}`,
    `- Query: "counter stools with wood seats" -> {"display_string":"[CATEGORY], specifically counter stools with wood seats","back":"Backless","seat_finish":"Natural wood"}`
  ].join("\n");
}

function looksJsonLikeDisplayString(value = "") {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return false;
  }
  return (
    /^\{/.test(normalized) ||
    /^\[(?!CATEGORY\])/.test(normalized) ||
    /^```/.test(normalized) ||
    /"[^"]+"\s*:/.test(normalized) ||
    /\b(display_string|category_key|visual_type|enum_fields)\b\s*:/.test(normalized)
  );
}

export function validateTextQueryDisplayString(value = "") {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return "";
  }
  if (normalized.length > 120) {
    return "";
  }
  if (looksJsonLikeDisplayString(normalized)) {
    return "";
  }
  const categoryMatches = normalized.match(/\[CATEGORY\]/g) || [];
  if (categoryMatches.length !== 1) {
    return "";
  }
  const remainder = normalizeWhitespace(normalized.replace(/\[CATEGORY\]/g, " "));
  if (!remainder) {
    return "";
  }
  return normalized;
}

function normalizeDisplayStringForQuery(displayString = "", query = "") {
  const validated = validateTextQueryDisplayString(displayString);
  if (!validated) {
    return "";
  }
  const normalizedQuery = normalizeWhitespace(query).toLowerCase();
  if (!normalizedQuery) {
    return validated;
  }
  const specificallyMatch = /^\[CATEGORY\], specifically (.+)$/i.exec(validated);
  if (specificallyMatch) {
    const specificallyPhrase = normalizeWhitespace(specificallyMatch[1]).toLowerCase();
    if (specificallyPhrase === normalizedQuery) {
      return `[CATEGORY] ${specificallyMatch[1].trim()}`;
    }
  }
  return validated;
}

export const TEXT_QUERY_CATEGORY_KEYS = textQueryCategoryKeys;

const TEXT_QUERY_CATEGORY_PHRASES = Object.freeze({
  task_collab_chair: ["task chair", "task chairs", "work chair", "work chairs", "collaborative chair", "collaborative chairs"],
  guest_chair: ["guest seating", "guest chair", "guest chairs", "multi-use guest seating", "multi-use guest chair", "multi-use guest chairs"],
  lounge_chair: [
    "lounge seating",
    "lounge chair",
    "lounge chairs",
    "lounge",
    "sofa",
    "sofas",
    "sectional",
    "sectionals",
    "loveseat",
    "loveseats",
    "couch",
    "couches"
  ],
  bench: ["bench seating", "bench", "benches"],
  stool: ["stool", "stools", "bar stool", "bar stools", "counter stool", "counter stools"],
  conference: ["conference table", "conference tables", "boardroom table", "boardroom tables"],
  occasional: ["occasional table", "occasional tables", "side table", "side tables", "end table", "end tables", "accent table", "accent tables", "coffee table", "coffee tables"],
  cafe_dining: ["cafe table", "cafe tables", "dining table", "dining tables", "bistro table", "bistro tables", "kitchen table", "kitchen tables", "restaurant table", "restaurant tables"],
  training: ["training table", "training tables", "flip table", "flip tables", "flip-top table", "flip-top tables", "folding table", "folding tables", "seminar table", "seminar tables", "classroom table", "classroom tables"],
  huddle_collaborative: ["huddle table", "huddle tables", "collaboration table", "collaboration tables", "team table", "team tables"],
  kitchen_faucet: ["kitchen faucet", "kitchen faucets", "pull-down faucet", "pull-down faucets", "pull out faucet", "pull out faucets"],
  bathroom_lavatory_faucet: ["bathroom faucet", "bathroom faucets", "lavatory faucet", "lavatory faucets", "sink faucet", "sink faucets"]
});

const AMBIGUOUS_SPATIAL_QUERY_PATTERNS = [
  /\bconference room\b/,
  /\bmeeting room\b/,
  /\bboardroom\b/,
  /\boffice\b/,
  /\boffice setting\b/,
  /\boffice environment\b/,
  /\bworkspace\b/,
  /\bworkplace\b/,
  /\brestaurant\b/,
  /\bcafe environment\b/,
  /\bdining room\b/,
  /\bshowroom\b/,
  /\blobby\b/,
  /\blounge area\b/,
  /\benvironment\b/,
  /\broom\b/,
  /\bspace\b/
];

const CLARIFICATION_FAMILY_RULES = Object.freeze([
  { family: "seating", patterns: [/\bchair\b/, /\bchairs\b/, /\bseating\b/, /\bbench\b/, /\bbenches\b/, /\bstool\b/, /\bstools\b/, /\blounge\b/, /\blobby\b/] },
  { family: "tables", patterns: [/\btable\b/, /\btables\b/, /\bdesk\b/, /\bdesks\b/, /\bconference\b/, /\bboardroom\b/, /\bmeeting\b/, /\bdining\b/, /\bcafe\b/, /\btraining\b/, /\bhuddle\b/, /\bcollaboration\b/] },
  { family: "faucets", patterns: [/\bfaucet\b/, /\bfaucets\b/, /\btap\b/, /\btaps\b/, /\bspigot\b/, /\bspigots\b/, /\bsink\b/, /\bsinks\b/, /\blavatory\b/, /\bkitchen\b/, /\bbathroom\b/] }
]);

const SPATIAL_QUERY_OPTION_RULES = Object.freeze([
  {
    patterns: [/\bconference room\b/, /\bmeeting room\b/, /\bboardroom\b/],
    visualTypes: ["conference", "huddle_collaborative", "task_collab_chair", "guest_chair", "bench"]
  },
  {
    patterns: [/\boffice\b/, /\bopen office\b/, /\bworkspace\b/, /\bworkplace\b/],
    visualTypes: ["conference", "training", "huddle_collaborative", "task_collab_chair", "guest_chair", "lounge_chair", "bench", "stool"]
  },
  {
    patterns: [/\bkitchen\b/],
    visualTypes: ["kitchen_faucet", "cafe_dining", "occasional", "stool", "bench", "guest_chair"]
  },
  {
    patterns: [/\bbathroom\b/, /\bwashroom\b/, /\brestroom\b/],
    visualTypes: ["bathroom_lavatory_faucet", "bench", "stool", "guest_chair"]
  },
  {
    patterns: [/\blobby\b/, /\blounge\b/, /\breception\b/, /\bwaiting area\b/],
    visualTypes: ["lounge_chair", "guest_chair", "bench", "stool"]
  },
  {
    patterns: [/\brestaurant\b/, /\bcafe environment\b/, /\bdining room\b/],
    visualTypes: ["cafe_dining", "guest_chair", "stool", "bench"]
  }
]);

function getFamilyVisualTypeOptions(family = "") {
  const normalizedFamily = String(family || "").trim().toLowerCase();
  return inferableTextQueryCategoryEntries
    .filter((entry) => String(entry.family || "").trim().toLowerCase() === normalizedFamily)
    .map((entry) => entry.visual_type);
}

function getPlausibleClarificationOptions(query = "") {
  const normalizedQuery = normalizeWhitespace(query).toLowerCase();
  const directPhraseMatch = inferCategoryFromPhrases(normalizedQuery);
  if (directPhraseMatch.categoryKey) {
    return [directPhraseMatch.categoryKey];
  }

  const spatialRule = SPATIAL_QUERY_OPTION_RULES.find((rule) => rule.patterns.some((pattern) => pattern.test(normalizedQuery)));
  if (spatialRule) {
    return [...spatialRule.visualTypes];
  }

  const matchedFamilies = CLARIFICATION_FAMILY_RULES
    .filter((rule) => rule.patterns.some((pattern) => pattern.test(normalizedQuery)))
    .map((rule) => rule.family);
  if (matchedFamilies.length === 1) {
    return getFamilyVisualTypeOptions(matchedFamilies[0]);
  }
  if (matchedFamilies.length > 1) {
    return uniqueStrings(matchedFamilies.flatMap((family) => getFamilyVisualTypeOptions(family)));
  }

  return [];
}

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
  return `Determine which product category a user query most likely refers to.

Choose the single best category_key when the query is mainly describing one kind of product, even if the wording is informal or uses synonyms. Use category_required only when the query is genuinely ambiguous across product families, could reasonably map to multiple different category groups, or primarily describes a room, environment, or space rather than a product.

Available categories:
- task_collab_chair: Task & Collaborative Chair. Covers office task chairs, desk chairs, work chairs, ergonomic chairs, conference/workplace swivel chairs, and other performance-oriented single-seat work seating.
- lounge_chair: Lounge Seating. Covers lounge chairs, sofas, sectionals, loveseats, settees, daybeds, chaise-style lounge pieces, modular lounge seating, privacy lounge seating, ottomans used within lounge collections, and other relaxed lounge-style seating.
- stool: Stool. Covers stools, bar stools, counter stools, backless stools, perch stools, and fixed-height or casual seating stools.
- guest_chair: Side & Guest Chair. Covers guest chairs, side chairs, waiting-room chairs, reception chairs, visitor chairs, multi-use guest seating, and other upright occasional seating that is not task seating or lounge seating.
- bench: Bench. Covers benches, bench seating, banquettes without table emphasis, and linear multi-person bench-style seating.
- conference: Conference Tables. Covers conference tables, boardroom tables, meeting tables, and large collaboration tables primarily used for conference or meeting settings.
- occasional: Occasional Tables. Covers side tables, end tables, coffee tables, lounge tables, and other small occasional-use tables.
- cafe_dining: Cafe/Dining Tables. Covers dining tables, cafe tables, bistro tables, restaurant tables, and similar eating-height hospitality tables.
- training: Training Tables. Covers training tables, flip-top tables, folding tables, classroom tables, seminar tables, and other reconfigurable learning/training tables.
- huddle_collaborative: Huddle/Collaborative Tables. Covers huddle tables, collaboration tables, team tables, touchdown tables, and smaller shared-work tables.
- kitchen_faucet: Kitchen Faucet. Covers kitchen faucets, pull-down faucets, pull-out faucets, and other kitchen sink faucet types.
- bathroom_lavatory_faucet: Bathroom Lavatory Faucet. Covers bathroom sink faucets, lavatory faucets, vanity faucets, and other bathroom basin faucet types.

Use category_required when:
- the query mainly describes a room, environment, or space rather than a product
- the query is truly cross-family and could reasonably refer to multiple families (for example seating vs tables vs faucets)
- there is not enough signal to choose one category

Do not use category_required just because the query is short, uses a synonym, or describes a familiar product type in plain language.
If the query clearly names a type of product (e.g., "sofa," "stool," "dining table"), choose that product's category even if the query is brief.

Examples:
- Query: "sofas with concealed bases"
  Output: {"category_key":"lounge_chair"}

- Query: "backless sofas with wood legs"
  Output: {"category_key":"lounge_chair"}

- Query: "counter stools with wood seats"
  Output: {"category_key":"stool"}

- Query: "round conference table"
  Output: {"category_key":"conference"}

- Query: "workspace furniture"
  Output: {"category_key":"category_required"}

- Query: "lounge area with tables and chairs"
  Output: {"category_key":"category_required"}

Return JSON only.`;
}

function inferCategoryFromPhrases(query = "") {
  const matches = [];

  Object.entries(TEXT_QUERY_CATEGORY_PHRASES).forEach(([categoryKey, phrases]) => {
    phrases.forEach((phrase) => {
      const escapedPhrase = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = new RegExp(`\\b${escapedPhrase}\\b`, "i").exec(query);
      if (match && typeof match.index === "number") {
        matches.push({
          categoryKey,
          phrase,
          index: match.index,
          length: match[0].length
        });
      }
    });
  });

  matches.sort((left, right) => {
    if (right.length !== left.length) {
      return right.length - left.length;
    }
    return left.index - right.index;
  });

  return {
    categoryKey: matches[0]?.categoryKey || "",
    matchedPhrase: matches[0]?.phrase || "",
    matches
  };
}

export async function inferTextQueryCategory(query = "", options = {}) {
  const normalizedQuery = normalizeWhitespace(query).toLowerCase();
  const defaultOptions = getPlausibleClarificationOptions(normalizedQuery);
  const fallbackOptions = defaultOptions.length ? defaultOptions : [...TEXT_QUERY_CATEGORY_KEYS];
  const logPrefix = "[inferTextQueryCategory]";
  let openAiAttempted = false;
  let catchPathFired = false;

  console.log(logPrefix, "start", {
    query: String(query || ""),
    normalized_query: normalizedQuery
  });
  if (!normalizedQuery) {
    const result = {
      status: "category_required",
      confidence: "low",
      options: fallbackOptions,
      clarification_reason: "semantic_ambiguity",
      llm_failure: null
    };
    console.log(logPrefix, "empty-query", {
      openai_attempted: openAiAttempted,
      catch_path_fired: catchPathFired,
      final_status: result.status,
      options: result.options
    });
    return result;
  }

  const phraseMatch = inferCategoryFromPhrases(normalizedQuery);
  const hasSpatialAmbiguity = AMBIGUOUS_SPATIAL_QUERY_PATTERNS.some((pattern) => pattern.test(normalizedQuery));
  console.log(logPrefix, "preflight", {
    phrase_match_category: phraseMatch.categoryKey || "",
    phrase_match_phrase: phraseMatch.matchedPhrase || "",
    has_spatial_ambiguity: hasSpatialAmbiguity,
    fallback_options: fallbackOptions
  });

  if (phraseMatch.categoryKey && !hasSpatialAmbiguity) {
    const result = {
      status: "resolved",
      confidence: "high",
      category_key: phraseMatch.categoryKey,
      options: fallbackOptions,
      matched_terms: [phraseMatch.matchedPhrase]
    };
    console.log(logPrefix, "resolved-via-phrase-match", {
      openai_attempted: openAiAttempted,
      catch_path_fired: catchPathFired,
      final_status: result.status,
      category_key: result.category_key,
      matched_terms: result.matched_terms
    });
    return result;
  }

  if (hasSpatialAmbiguity) {
    const result = {
      status: "category_required",
      confidence: "low",
      options: fallbackOptions,
      clarification_reason: "semantic_ambiguity",
      llm_failure: null
    };
    console.log(logPrefix, "category-required-via-spatial-ambiguity", {
      openai_attempted: openAiAttempted,
      catch_path_fired: catchPathFired,
      final_status: result.status,
      options: result.options
    });
    return result;
  }

  if (!options.apiKey) {
    const failureMeta = buildLlmFailureMeta({
      source: "category_inference",
      kind: "config"
    });
    const result = {
      status: "category_required",
      confidence: "low",
      options: fallbackOptions,
      clarification_reason: "llm_failure",
      llm_failure: failureMeta
    };
    console.log(logPrefix, "category-required-no-api-key", {
      openai_attempted: openAiAttempted,
      catch_path_fired: catchPathFired,
      final_status: result.status,
      options: result.options
    });
    return result;
  }

  try {
    openAiAttempted = true;
    console.log(logPrefix, "openai-request-attempted", {
      model: options.model || "gpt-4o-mini",
      query: normalizedQuery
    });
    const result = await callOpenAiJsonWithMeta({
      apiKey: options.apiKey,
      model: options.model || "gpt-4o-mini",
      systemPrompt: buildTextQueryCategoryInferencePrompt(),
      userParts: [
        { type: "input_text", text: normalizedQuery }
      ],
      schemaName: "text_query_category_inference",
      schema: textQueryCategoryInferenceSchema(),
      source: "category_inference"
    });
    console.log(logPrefix, "openai-request-succeeded", {
      raw_result: result
    });

    const categoryKey = String(result.data?.category_key || "").trim().toLowerCase();
    if (!categoryKey || categoryKey === "category_required" || !TEXT_QUERY_CATEGORY_KEYS.includes(categoryKey)) {
      const response = {
        status: "category_required",
        confidence: "low",
        options: fallbackOptions,
        clarification_reason: "semantic_ambiguity",
        llm_failure: null
      };
      console.log(logPrefix, "openai-returned-category-required", {
        openai_attempted: openAiAttempted,
        catch_path_fired: catchPathFired,
        parsed_category_key: categoryKey,
        final_status: response.status,
        options: response.options
      });
      return response;
    }

    const response = {
      status: "resolved",
      confidence: "high",
      category_key: categoryKey,
      options: fallbackOptions,
      matched_terms: []
    };
    console.log(logPrefix, "openai-returned-resolved-category", {
      openai_attempted: openAiAttempted,
      catch_path_fired: catchPathFired,
      parsed_category_key: categoryKey,
      final_status: response.status,
      options: response.options
    });
    return response;
  } catch (error) {
    catchPathFired = true;
    const failureMeta = normalizeLlmFailureMeta(error, {
      source: "category_inference"
    });
    console.error(logPrefix, "openai-request-failed", {
      openai_attempted: openAiAttempted,
      catch_path_fired: catchPathFired,
      failure_meta: failureMeta,
      error_name: error?.name || "",
      error_message: error?.message || String(error || ""),
      error_stack: error?.stack || ""
    });
    const response = {
      status: "category_required",
      confidence: "low",
      options: fallbackOptions,
      clarification_reason: "llm_failure",
      llm_failure: failureMeta
    };
    console.log(logPrefix, "returning-category-required-from-catch", {
      openai_attempted: openAiAttempted,
      catch_path_fired: catchPathFired,
      final_status: response.status,
      options: response.options
    });
    return response;
  }
}

export async function extractTextQueryTraits(query = "", options = {}) {
  const normalizedQuery = normalizeWhitespace(query);
  const requestedType = options.visualType || options.seatingType || "";
  const resolvedType = resolveTextQueryTraitType(requestedType);
  const family = getVisualTypeFamily(resolvedType) || "seating";
  const deterministicEnumFields = applyLoungeChairPlanShapeGuardrails(
    resolvedType,
    buildDeterministicTextQueryEnumFields(
      normalizedQuery,
      resolvedType
    )
  );
  if (!normalizedQuery || !options.apiKey) {
    return {
      visual_type: resolvedType,
      family,
      seating_type: resolvedType,
      enum_fields: deterministicEnumFields,
      search_bullets: buildSearchTimeBullets(deterministicEnumFields, resolvedType),
      display_string: "",
      fallback_meta: null
    };
  }

  try {
    const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || 60000);
    maybeThrowInjectedLlmFailure("PIXELSEEK_FAIL_TEXT_QUERY_TRAITS", "trait_extraction");
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.apiKey}`
      },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: options.model || "gpt-4.1-mini",
        response_format: {
          type: "json_object"
        },
        messages: [
          {
            role: "system",
            content: buildTextQueryTraitPrompt(resolvedType)
          },
          {
            role: "user",
            content: normalizedQuery
          }
        ]
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw createLlmFailureError(`OpenAI text-query trait extraction failed with ${response.status}.`, buildLlmFailureMeta({
        source: "trait_extraction",
        status: response.status,
        kind: "http",
        errorBody
      }));
    }

    const payload = await response.json();
    const raw = String(payload?.choices?.[0]?.message?.content || "").trim();
    if (!raw) {
      throw createLlmFailureError("OpenAI text-query trait extraction returned empty output.", buildLlmFailureMeta({
        source: "trait_extraction",
        kind: "empty_output"
      }));
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw createLlmFailureError("OpenAI text-query trait extraction returned malformed output.", buildLlmFailureMeta({
        source: "trait_extraction",
        kind: "parse",
        error
      }));
    }
    const displayString = normalizeDisplayStringForQuery(parsed?.display_string, normalizedQuery);
    const enumFields = {};
    const allowedFields = new Set(getTextQueryTraitFields(resolvedType));

    for (const field of allowedFields) {
      if (!allowedFields.has(field)) {
        continue;
      }
      const value = normalizeWhitespace(parsed?.[field]);
      if (!value || value.toLowerCase() === "unknown") {
        continue;
      }
      enumFields[field] = value;
    }

    const mergedEnumFields = applyLoungeChairPlanShapeGuardrails(
      resolvedType,
      {
        ...deterministicEnumFields,
        ...enumFields
      }
    );

    return {
      visual_type: resolvedType,
      family,
      seating_type: resolvedType,
      enum_fields: mergedEnumFields,
      search_bullets: buildSearchTimeBullets(mergedEnumFields, resolvedType),
      display_string: displayString,
      fallback_meta: null
    };
  } catch (error) {
    const failureMeta = normalizeLlmFailureMeta(error, {
      source: "trait_extraction"
    });
    console.error("Text-query trait extraction failed; continuing without generated bullets:", {
      failure_meta: failureMeta,
      error
    });
    return {
      visual_type: resolvedType,
      family,
      seating_type: resolvedType,
      enum_fields: deterministicEnumFields,
      search_bullets: buildSearchTimeBullets(deterministicEnumFields, resolvedType),
      display_string: "",
      fallback_meta: failureMeta
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

export async function classifyImageStage0(imageRecord = {}, options = {}) {
  const categories = normalizeCategories(imageRecord);
  const stage0RoutingContext = resolveStage0RoutingContext(imageRecord, options);
  const imageDimensions = options.precomputedImageDimensions ||
    await enforceMatchingSafeResolution(imageRecord.image_url, options);
  const optionsWithDimensions = {
    ...options,
    stage0RoutingContext,
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
  const stage0Cost = estimateUsageCostUsd(stage0Usage);

  if (typeof options.progressCallback === "function") {
    options.progressCallback({
      type: "stage0_complete",
      image_url: imageRecord.image_url,
      product_id: imageRecord.product_id || "",
      product_name: imageRecord.name || imageRecord.product_name || "",
      stage_0_result: stage0.result
    });
  }

  return {
    categories,
    imageDimensions,
    imageInput,
    optionsWithDimensions,
    stage0,
    stage0Usage,
    stage0Cost
  };
}

export async function generateImageExtractionRecordFromStage0(imageRecord = {}, stage0Payload = {}, options = {}) {
  const extractionTimestamp = new Date().toISOString();
  const categories = stage0Payload.categories || normalizeCategories(imageRecord);
  const productName = imageRecord.name || imageRecord.product_name || "";
  const imageDimensions = stage0Payload.imageDimensions ||
    options.precomputedImageDimensions ||
    await enforceMatchingSafeResolution(imageRecord.image_url, options);
  const optionsWithDimensions = {
    ...options,
    ...(stage0Payload.optionsWithDimensions || {}),
    precomputedImageDimensions: imageDimensions
  };
  const imageInput = stage0Payload.imageInput || {
    image_url: imageRecord.image_url,
    catalogContext: `Catalog context: name="${imageRecord.name || imageRecord.product_name || ""}", brand="${imageRecord.brand || ""}", categories="${[...categories.a_level, ...categories.b_level, ...categories.c_level].join(" | ")}".`
  };
  const stage0 = stage0Payload.stage0 || { result: "" };
  const stage0Usage = stage0Payload.stage0Usage || normalizeOpenAiUsage();
  const stage0Cost = Number(stage0Payload.stage0Cost || estimateUsageCostUsd(stage0Usage) || 0);

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
  const routingTypeKey = resolveCatalogVisualTypeKey(pixelSeekType);
  if (pixelSeekType === "SKIP" || pixelSeekType === "INTENTIONALLY_EXCLUDED" || !routingTypeKey) {
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
      excluded_reason: pixelSeekType === "INTENTIONALLY_EXCLUDED"
        ? "intentionally_excluded"
        : "unmapped_category_grouping",
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
  const enumFields = applyGuestChairBaseFinishRecordFallback(routingTypeKey, {
    design_register: String(voted.stage2?.design_register || "unknown"),
    ...(voted.stage3?.image_traits || {})
  }, imageRecord, productName);
  const fieldConfidence = flattenFieldConfidence(voted);
  const confidenceTier = deriveOverallConfidence(fieldConfidence);
  const usageTotal = sumUsage(stage0Usage, ...runs.map((run) => run.usage?.total));
  const stage4UsageTotal = sumUsage(...runs.map((run) => run.usage?.stage4));
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
  const stage4CostUsd = Number(runs.reduce(
    (sum, run) => sum + Number(estimateUsageCostUsd(run.usage?.stage4 || normalizeOpenAiUsage()) || 0),
    0
  ).toFixed(6));
  const stage4TriggeredRuns = runs.filter((run) => Boolean(run.stage4?.triggered)).length;
  const stage4Extracted = hasExtractedLoungeSofaTraits(voted.stage3?.image_traits || {});
  const stage4Applicability = getLoungeSofaTraitApplicability(routingTypeKey, enumFields);
  const stage4Measurements = aggregateLoungeSofaMeasurements(
    stage4Applicability,
    runs.map((run) => run.stage4?.raw_measurements || {})
  );
  const stage4Status = deriveLoungeSofaTraitStageStatus(
    stage4Applicability,
    voted.stage3?.image_traits || {},
    stage4TriggeredRuns > 0
  );

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
    seating_type: String(routingTypeKey || ""),
    pixelseek_type: String(pixelSeekType || ""),
    type_routing_source: "mapping_v1",
    enum_fields: enumFields,
    field_confidence: fieldConfidence,
    free_text: freeText,
    reasoning: String(voted.stage3?.reasoning || "").trim(),
    plan_shape_reasoning: String(voted.stage3?.reasoning || "").trim(),
    tiebreaker_triggered: tiebreakerTriggered,
    confidence_tier: confidenceTier,
    tokens: {
      stage_0: stage0Usage,
      stage_4: stage4UsageTotal,
      runs: runs.map((run) => ({
        run: run.run_label,
        stage23_usage: run.usage?.stage23 || normalizeOpenAiUsage(),
        stage4_usage: run.usage?.stage4 || normalizeOpenAiUsage(),
        usage: run.usage?.total || normalizeOpenAiUsage()
      })),
      total: usageTotal
    },
    cost: {
      stage_0_usd: stage0Cost,
      stage_4_usd: stage4CostUsd,
      runs: runs.map((run) => ({
        run: run.run_label,
        stage23_estimated_cost_usd: Number(estimateUsageCostUsd(run.usage?.stage23 || normalizeOpenAiUsage()) || 0),
        stage4_estimated_cost_usd: Number(estimateUsageCostUsd(run.usage?.stage4 || normalizeOpenAiUsage()) || 0),
        estimated_cost_usd: Number(run.usage?.estimated_cost_usd || 0)
      })),
      total_usd: totalCostUsd
    },
    post_stage23_lounge_sofa_traits: {
      eligible: stage4Applicability.eligible,
      extracted: stage4Extracted,
      triggered_runs: stage4TriggeredRuns,
      applicable_trait_count: countApplicableLoungeSofaTraits(stage4Applicability),
      status: stage4Status,
      measurements: stage4Measurements
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

export async function generateProductExtractionRecordsWithCap(productImages = [], options = {}) {
  if (!Array.isArray(productImages) || !productImages.length) {
    return {
      records: [],
      failed_images: [],
      progress: {
        seating_type: "",
        stage0_passing_count: 0,
        selected_product_image_count: 0,
        successful_extraction_count: 0,
        failed_image_count: 0,
        failed_stage0_count: 0,
        failed_stage23_count: 0,
        effective_cap_applied: 0,
        images_skipped_by_cap: 0,
        hard_upper_cap_binding: false
      }
    };
  }

  const productType = getPixelSeekType(productImages[0]) || "";
  const visualType = resolveCatalogVisualTypeKey(productType) || "";
  if (productType === "SKIP") {
    return {
      records: [buildSyntheticUnmappedProductSkipRecord(productImages[0])],
      failed_images: [],
      progress: {
        seating_type: "",
        stage0_passing_count: 0,
        selected_product_image_count: 0,
        successful_extraction_count: 0,
        failed_image_count: 0,
        failed_stage0_count: 0,
        failed_stage23_count: 0,
        effective_cap_applied: 0,
        images_skipped_by_cap: 0,
        hard_upper_cap_binding: false
      }
    };
  }

  const classificationEntries = [];
  const failedImages = [];
  for (const image of productImages) {
    try {
      const stage0Result = await retryImageOperation(
        () => classifyImageStage0(image, options),
        { retryLimit: IMAGE_EXTRACTION_TRANSIENT_RETRY_LIMIT }
      );
      classificationEntries.push({
        image,
        stage0Payload: stage0Result.value
      });
    } catch (error) {
      failedImages.push({
        image_id: String(image.image_id || "").trim(),
        image_url: String(image.image_url || "").trim(),
        product_id: String(image.product_id || "").trim(),
        product_name: String(image.name || image.product_name || "").trim(),
        stage: "stage0",
        selected_for_extraction: false,
        attempts: Number(error?.__image_attempts || 1) || 1,
        retried: Number(error?.__image_attempts || 1) > 1,
        error: error?.message || "Stage 0 image classification failed."
      });
    }
  }

  const stage0PassingEntries = classificationEntries.filter((entry) => String(entry.stage0Payload?.stage0?.result || "").trim().toLowerCase() === "product");
  const effectiveCap = getEffectiveExtractionImageCap(visualType || productType);
  const softCap = visualType || productType;
  const selectedImageIds = new Set(
    stage0PassingEntries
      .slice(0, effectiveCap)
      .map((entry) => String(entry.image.image_id || entry.image.image_url || ""))
  );

  const records = [];
  let successfulExtractionCount = 0;
  for (const entry of classificationEntries) {
    const key = String(entry.image.image_id || entry.image.image_url || "");
    const stage0Result = String(entry.stage0Payload?.stage0?.result || "").trim().toLowerCase();
    if (stage0Result !== "product" || selectedImageIds.has(key)) {
      try {
        const extractionResult = await retryImageOperation(
          () => generateImageExtractionRecordFromStage0(entry.image, entry.stage0Payload, options),
          { retryLimit: stage0Result === "product" ? IMAGE_EXTRACTION_TRANSIENT_RETRY_LIMIT : 0 }
        );
        const record = extractionResult.value;
        records.push(record);
        if (stage0Result === "product" && getEffectiveClassification(record) === "product") {
          successfulExtractionCount += 1;
        }
      } catch (error) {
        failedImages.push({
          image_id: String(entry.image.image_id || "").trim(),
          image_url: String(entry.image.image_url || "").trim(),
          product_id: String(entry.image.product_id || "").trim(),
          product_name: String(entry.image.name || entry.image.product_name || "").trim(),
          stage: stage0Result === "product" ? "stage23" : "stage0_finalize",
          selected_for_extraction: selectedImageIds.has(key),
          attempts: Number(error?.__image_attempts || 1) || 1,
          retried: Number(error?.__image_attempts || 1) > 1,
          error: error?.message || "Image extraction failed."
        });
      }
    }
  }

  return {
    records,
    failed_images: failedImages,
    progress: {
      seating_type: visualType,
      stage0_passing_count: stage0PassingEntries.length,
      selected_product_image_count: selectedImageIds.size,
      successful_extraction_count: successfulExtractionCount,
      failed_image_count: failedImages.length,
      failed_stage0_count: failedImages.filter((entry) => entry.stage === "stage0").length,
      failed_stage23_count: failedImages.filter((entry) => entry.stage === "stage23").length,
      effective_cap_applied: effectiveCap,
      images_skipped_by_cap: Math.max(0, stage0PassingEntries.length - effectiveCap),
      hard_upper_cap_binding: getEffectiveExtractionImageCap(softCap) === EXTRACTION_IMAGE_HARD_CAP &&
        stage0PassingEntries.length > EXTRACTION_IMAGE_HARD_CAP
    }
  };
}

export async function generateImageExtractionRecord(imageRecord = {}, options = {}) {
  const stage0Payload = await classifyImageStage0(imageRecord, options);
  return generateImageExtractionRecordFromStage0(imageRecord, stage0Payload, options);
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
  const routingTypeKey = resolveCatalogVisualTypeKey(pixelSeekType);
  if (pixelSeekType === "SKIP" || pixelSeekType === "INTENTIONALLY_EXCLUDED" || !routingTypeKey) {
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
      excluded_reason: pixelSeekType === "INTENTIONALLY_EXCLUDED"
        ? "intentionally_excluded"
        : "unmapped_category_grouping",
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
  const enumFields = applyGuestChairBaseFinishRecordFallback(routingTypeKey, {
    design_register: String(voted.stage2?.design_register || "unknown"),
    ...(voted.stage3?.image_traits || {})
  }, imageRecord, productName);
  const fieldConfidence = flattenFieldConfidence(voted);
  const confidenceTier = deriveOverallConfidence(fieldConfidence);
  const usageTotal = sumUsage(preservedStage0Usage, ...runs.map((run) => run.usage?.total));
  const stage4UsageTotal = sumUsage(...runs.map((run) => run.usage?.stage4));
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
  const stage4CostUsd = Number(runs.reduce(
    (sum, run) => sum + Number(estimateUsageCostUsd(run.usage?.stage4 || normalizeOpenAiUsage()) || 0),
    0
  ).toFixed(6));
  const stage4TriggeredRuns = runs.filter((run) => Boolean(run.stage4?.triggered)).length;
  const stage4Extracted = hasExtractedLoungeSofaTraits(voted.stage3?.image_traits || {});
  const stage4Applicability = getLoungeSofaTraitApplicability(routingTypeKey, enumFields);
  const stage4Measurements = aggregateLoungeSofaMeasurements(
    stage4Applicability,
    runs.map((run) => run.stage4?.raw_measurements || {})
  );
  const stage4Status = deriveLoungeSofaTraitStageStatus(
    stage4Applicability,
    voted.stage3?.image_traits || {},
    stage4TriggeredRuns > 0
  );

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
    seating_type: String(routingTypeKey || ""),
    pixelseek_type: String(pixelSeekType || ""),
    type_routing_source: "mapping_v1",
    enum_fields: enumFields,
    field_confidence: fieldConfidence,
    free_text: freeText,
    reasoning: String(voted.stage3?.reasoning || "").trim(),
    plan_shape_reasoning: String(voted.stage3?.reasoning || "").trim(),
    tiebreaker_triggered: tiebreakerTriggered,
    confidence_tier: confidenceTier,
    tokens: {
      stage_0: preservedStage0Usage,
      stage_4: stage4UsageTotal,
      runs: runs.map((run) => ({
        run: run.run_label,
        stage23_usage: run.usage?.stage23 || normalizeOpenAiUsage(),
        stage4_usage: run.usage?.stage4 || normalizeOpenAiUsage(),
        usage: run.usage?.total || normalizeOpenAiUsage()
      })),
      total: usageTotal
    },
    cost: {
      stage_0_usd: preservedStage0Cost,
      stage_4_usd: stage4CostUsd,
      runs: runs.map((run) => ({
        run: run.run_label,
        stage23_estimated_cost_usd: Number(estimateUsageCostUsd(run.usage?.stage23 || normalizeOpenAiUsage()) || 0),
        stage4_estimated_cost_usd: Number(estimateUsageCostUsd(run.usage?.stage4 || normalizeOpenAiUsage()) || 0),
        estimated_cost_usd: Number(run.usage?.estimated_cost_usd || 0)
      })),
      total_usd: totalCostUsd
    },
    post_stage23_lounge_sofa_traits: {
      eligible: stage4Applicability.eligible,
      extracted: stage4Extracted,
      triggered_runs: stage4TriggeredRuns,
      applicable_trait_count: countApplicableLoungeSofaTraits(stage4Applicability),
      status: stage4Status,
      measurements: stage4Measurements
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
  const currentPass = Number(String(runLabel).match(/run_(\d+)/)?.[1] || 0);
  const expectedPasses = currentPass >= 3 ? 3 : 2;
  if (!options.suppressPerRunProgress && typeof options.progressCallback === "function") {
    options.progressCallback({
      type: `${runLabel}_started`,
      run_label: runLabel,
      current_pass: currentPass,
      expected_passes: expectedPasses,
      image_url: imageInput.image_url,
      product_id: imageRecord?.product_id || "",
      product_name: imageRecord?.name || ""
    });
  }
  const { data: stage1, usage: stage1Usage } = await classifySeatingTypeOpenAiWithMeta(imageInput, options);
  if (isStage1OverrideResult(stage1)) {
    const usageTotal = sumUsage(stage1Usage, normalizeOpenAiUsage(), normalizeOpenAiUsage());
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
        stage4: normalizeOpenAiUsage(),
        total: usageTotal,
        estimated_cost_usd: estimateUsageCostUsd(usageTotal)
      }
    };
  }
  const seatingType = resolveStage1VisualType(stage1);
  const { stage2, stage3, usage: stage23Usage } = await extractStage23CombinedOpenAi(imageInput, seatingType, stage1, options);

  const fieldMap = getFieldMap(seatingType);
  const imageTraits = {};
  for (const [fieldName, value] of Object.entries(stage3.image_traits || {})) {
    const field = fieldMap.get(fieldName);
    if (!field) continue;
    imageTraits[fieldName] = normalizeEnum(value, field.allowed_values);
  }

  const stage4 = await extractLoungeSofaTraitsOpenAi(imageInput, seatingType, imageTraits, options);
  const mergedImageTraits = applyLoungeSofaTraitApplicability(seatingType, {
    ...imageTraits,
    ...(stage4.image_traits || {})
  });
  const usageTotal = sumUsage(stage1Usage, stage23Usage, stage4.usage);
  if (!options.suppressPerRunProgress && typeof options.progressCallback === "function") {
    options.progressCallback({
      type: `${runLabel}_done`,
      run_label: runLabel,
      current_pass: currentPass,
      expected_passes: expectedPasses,
      image_url: imageInput.image_url,
      product_id: imageRecord?.product_id || "",
      product_name: imageRecord?.name || ""
    });
  }
  return {
    run_label: runLabel,
    stage1,
    stage2,
    stage3: {
      ...stage3,
      image_traits: mergedImageTraits
    },
    usage: {
      stage1: stage1Usage,
      stage23: stage23Usage,
      stage4: stage4.usage,
      total: usageTotal,
      estimated_cost_usd: estimateUsageCostUsd(usageTotal)
    },
    stage4: {
      triggered: stage4.triggered,
      applicability: stage4.applicability || getLoungeSofaTraitApplicability(seatingType, imageTraits),
      image_traits: stage4.image_traits || {},
      raw_measurements: stage4.raw_measurements || {}
    }
  };
}

function buildCatalogRoutingStage1Stub(typeKey = "") {
  return buildResolvedRoutingStage1Stub(typeKey, "mapping_v1");
}

export function resolveCatalogVisualTypeKey(pixelSeekType = "") {
  const direct = normalizeVisualTypeKey(pixelSeekType);
  if (direct) {
    return direct;
  }
  const resolved = PIXELSEEK_TYPE_TO_VISUAL_TYPE[String(pixelSeekType || "").trim()];
  return resolved || "";
}

async function runStage23ExtractionWithType(imageInput, typeKey, options = {}, imageRecord = {}, runLabel = "run_1") {
  const currentPass = Number(String(runLabel).match(/run_(\d+)/)?.[1] || 0);
  const expectedPasses = currentPass >= 3 ? 3 : 2;
  if (!options.suppressPerRunProgress && typeof options.progressCallback === "function") {
    options.progressCallback({
      type: `${runLabel}_started`,
      run_label: runLabel,
      current_pass: currentPass,
      expected_passes: expectedPasses,
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

  const stage4 = await extractLoungeSofaTraitsOpenAi(imageInput, typeKey, imageTraits, options);
  const mergedImageTraits = applyLoungeSofaTraitApplicability(typeKey, {
    ...imageTraits,
    ...(stage4.image_traits || {})
  });
  const usageTotal = sumUsage(stage23Usage, stage4.usage);

  if (!options.suppressPerRunProgress && typeof options.progressCallback === "function") {
    options.progressCallback({
      type: `${runLabel}_done`,
      run_label: runLabel,
      current_pass: currentPass,
      expected_passes: expectedPasses,
      image_url: imageInput.image_url,
      product_id: imageRecord?.product_id || "",
      product_name: imageRecord?.name || ""
    });
  }

  return {
    run_label: runLabel,
    stage1,
    stage2,
    stage3: {
      ...stage3,
      image_traits: mergedImageTraits
    },
    usage: {
      stage1: normalizeOpenAiUsage(),
      stage23: stage23Usage,
      stage4: stage4.usage,
      total: usageTotal,
      estimated_cost_usd: estimateUsageCostUsd(usageTotal)
    },
    stage4: {
      triggered: stage4.triggered,
      applicability: stage4.applicability || getLoungeSofaTraitApplicability(typeKey, imageTraits),
      image_traits: stage4.image_traits || {},
      raw_measurements: stage4.raw_measurements || {}
    }
  };
}

function allFieldsAgree(runA, runB) {
  return valueVoteKey(buildEnumComparisonSnapshot(runA)) === valueVoteKey(buildEnumComparisonSnapshot(runB));
}

function allStage1VotesAgree(runA, runB) {
  return valueVoteKey({
    result: normalizeStage1Result(runA?.stage1?.result),
    seating_type: String(runA?.stage1?.seating_type || "").trim()
  }) === valueVoteKey({
    result: normalizeStage1Result(runB?.stage1?.result),
    seating_type: String(runB?.stage1?.seating_type || "").trim()
  });
}

async function voteStage1Classifications(imageInput, options = {}) {
  const [run1, run2] = await Promise.all([
    classifySeatingTypeOpenAiWithMeta(imageInput, options),
    classifySeatingTypeOpenAiWithMeta(imageInput, options)
  ]);
  const runs = [
    { run_label: "run_1", stage1: run1.data, usage: run1.usage },
    { run_label: "run_2", stage1: run2.data, usage: run2.usage }
  ];

  if (!allStage1VotesAgree(runs[0], runs[1])) {
    if (typeof options.progressCallback === "function") {
      options.progressCallback({
        type: "stage1_tiebreaker_started",
        current_pass: 3,
        expected_passes: 3
      });
    }
    const run3 = await classifySeatingTypeOpenAiWithMeta(imageInput, options);
    runs.push({ run_label: "run_3", stage1: run3.data, usage: run3.usage });
    if (typeof options.progressCallback === "function") {
      options.progressCallback({
        type: "stage1_tiebreaker_done",
        current_pass: 3,
        expected_passes: 3
      });
    }
  }

  const stage1ResultVote = voteFieldValues(runs.map((run) => normalizeStage1Result(run.stage1?.result)));
  if (stage1ResultVote.value === "product_detail" || stage1ResultVote.value === "scene") {
    const winningRun = runs.find((run) => normalizeStage1Result(run.stage1?.result) === stage1ResultVote.value) || {};
    return {
      stage1: buildStage1OverrideVoteResult(
        stage1ResultVote.value,
        winningRun.stage1?.override_reason || null,
        stage1ResultVote.confidence
      ).stage1,
      field_confidence: {
        stage1: {
          result: stage1ResultVote.confidence,
          seating_type: "low"
        }
      },
      runs,
      extraction_runs: runs.length,
      api_call_count: runs.length
    };
  }

  const seatingTypeVote = voteFieldValues(
    runs.map((run) => {
      const value = String(run.stage1?.seating_type || "").trim();
      return seatingTypes[value] ? value : "";
    })
  );
  const resolvedSeatingType = seatingTypes[String(seatingTypeVote.value || "").trim()]
    ? seatingTypeVote.value
    : "";
  return {
    stage1: {
      result: "product",
      seating_type: resolvedSeatingType,
      override_reason: null
    },
    field_confidence: {
      stage1: {
        result: stage1ResultVote.confidence,
        seating_type: seatingTypeVote.confidence
      }
    },
    runs,
    extraction_runs: runs.length,
    api_call_count: runs.length
  };
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
  const seatingTypeVote = voteFieldValues(runs.map((run) => run.stage1?.seating_type || ""));
  const designRegisterVote = voteFieldValues(runs.map((run) => run.stage2?.design_register || "unknown"));
  const imageTraitKeys = [...new Set(runs.flatMap((run) => Object.keys(run.stage3?.image_traits || {})))].sort((a, b) => a.localeCompare(b));
  const imageTraitVote = voteNamedFields(imageTraitKeys, runs, (run, key) => (
    Object.prototype.hasOwnProperty.call(run.stage3?.image_traits || {}, key)
      ? run.stage3.image_traits[key]
      : null
  ));

  return {
    stage1: {
      result: "product",
      seating_type: seatingTypeVote.value || "",
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
    seating_type: seatingTypeVote.value || "",
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

  if (options.stage1Only) {
    if (typeof runOptions.progressCallback === "function") {
      runOptions.progressCallback({
        type: "stage1_started"
      });
    }
    const stage1Vote = await voteStage1Classifications(imageInput, {
      ...runOptions,
      visionModel: runOptions.visionModel || "gpt-4.1"
    });
    if (typeof runOptions.progressCallback === "function") {
      runOptions.progressCallback({
        type: "stage1_done"
      });
    }
    return {
      seating_type: String(stage1Vote.stage1?.seating_type || "").trim(),
      stage1: cloneKnownValue(stage1Vote.stage1),
      field_confidence: cloneKnownValue(stage1Vote.field_confidence),
      extraction_runs: stage1Vote.extraction_runs,
      analysis_api_call_count: stage1Vote.api_call_count,
      api_call_count: stage1Vote.api_call_count,
      stage1_runs: stage1Vote.runs.map((run) => ({
        run: run.run_label,
        stage1: cloneKnownValue(run.stage1)
      }))
    };
  }

  const forcedSeatingType = resolveSupportedQueryImageVisualType(
    String(options.seatingTypeOverride || options.visualTypeOverride || "").trim()
  );
  if (forcedSeatingType) {
    if (typeof runOptions.progressCallback === "function") {
      runOptions.progressCallback({
        type: "stage23_started",
        expected_passes: 2
      });
    }
    const [run1, run2] = await Promise.all([
      runStage23ExtractionWithType(imageInput, forcedSeatingType, {
        ...runOptions,
        suppressPerRunProgress: true,
        visionModel: runOptions.visionModel || "gpt-4.1"
      }, { name: "Inspiration image" }, "run_1"),
      runStage23ExtractionWithType(imageInput, forcedSeatingType, {
        ...runOptions,
        suppressPerRunProgress: true,
        visionModel: runOptions.visionModel || "gpt-4.1"
      }, { name: "Inspiration image" }, "run_2")
    ]);
    if (typeof runOptions.progressCallback === "function") {
      runOptions.progressCallback({
        type: "stage23_done",
        current_pass: 2,
        expected_passes: 2
      });
    }
    const runs = [run1, run2];
    if (!allFieldsAgree(run1, run2)) {
      if (typeof runOptions.progressCallback === "function") {
        runOptions.progressCallback({
          type: "stage23_started",
          current_pass: 3,
          expected_passes: 3
        });
      }
      runs.push(await runStage23ExtractionWithType(imageInput, forcedSeatingType, {
        ...runOptions,
        suppressPerRunProgress: true,
        visionModel: runOptions.visionModel || "gpt-4.1"
      }, { name: "Inspiration image" }, "run_3"));
      if (typeof runOptions.progressCallback === "function") {
        runOptions.progressCallback({
          type: "stage23_done",
          current_pass: 3,
          expected_passes: 3
        });
      }
    }

    const voted = voteStage123Runs(runs);
    const visualSummary = normalizeWhitespace(voted.stage2.visual_summary || "");
    const imageTraits = applyLoungeSofaTraitApplicability(
      forcedSeatingType,
      normalizeImageTraits(forcedSeatingType, voted.stage3.image_traits || {})
    );
    const fieldConfidence = buildSinglePassFieldConfidence(forcedSeatingType, imageTraits);
    const stage4TriggeredRuns = runs.filter((run) => Boolean(run.stage4?.triggered)).length;
    const stage4Applicability = getLoungeSofaTraitApplicability(forcedSeatingType, imageTraits);
    const stage4Measurements = aggregateLoungeSofaMeasurements(
      stage4Applicability,
      runs.map((run) => run.stage4?.raw_measurements || {})
    );
    const stage4Status = deriveLoungeSofaTraitStageStatus(stage4Applicability, imageTraits, stage4TriggeredRuns > 0);
    const searchText = buildSearchableText({
      productName: "",
      brand: "",
      seatingType: forcedSeatingType,
      enumFields: imageTraits,
      freeText: {
        visual_summary: visualSummary,
        structured_caption: voted.stage3.structured_caption || "",
        silhouette: voted.stage2.silhouette || "",
        proportions: voted.stage2.proportions || "",
        structure_type: voted.stage2.structure_type || "",
        back_geometry: voted.stage2.back_geometry || "",
        seat_geometry: voted.stage2.seat_geometry || "",
        arm_geometry: voted.stage2.arm_geometry || "",
        surface_language: voted.stage2.surface_language || "",
        distinctive_elements: Array.isArray(voted.stage2.distinctive_elements) ? voted.stage2.distinctive_elements : []
      }
    });
    if (typeof runOptions.progressCallback === "function") {
      runOptions.progressCallback({
        type: "embedding_started"
      });
    }
    const queryEmbedding = await embedSearchText(searchText, runOptions);
    if (typeof runOptions.progressCallback === "function") {
      runOptions.progressCallback({
        type: "embedding_done"
      });
    }

    return {
      seating_type: forcedSeatingType,
      stage1: { seating_type: forcedSeatingType },
      stage2: {
        visual_summary: visualSummary,
        design_register: String(imageTraits.design_register || "").trim()
      },
      stage3: {
        reasoning: voted.stage3.reasoning || "",
        image_traits: imageTraits
      },
      enum_fields: imageTraits,
      field_confidence: fieldConfidence,
      image_traits: imageTraits,
      reasoning: voted.stage3.reasoning || "",
      plan_shape_reasoning: voted.stage3.reasoning || "",
      visual_form: visualSummary,
      search_text: searchText,
      search_bullets: buildSearchTimeBullets(imageTraits, forcedSeatingType),
      query_embedding: queryEmbedding,
      visual_summary_embedding: queryEmbedding,
      raw_visual_highlights: Array.isArray(voted.stage3.raw_visual_highlights) ? voted.stage3.raw_visual_highlights : [],
      structured_caption: voted.stage3.structured_caption || "",
      extraction_runs: runs.length,
      analysis_api_call_count: runs.length + stage4TriggeredRuns,
      api_call_count: runs.length + stage4TriggeredRuns,
      post_stage23_lounge_sofa_traits: {
        eligible: stage4Applicability.eligible,
        extracted: hasExtractedLoungeSofaTraits(imageTraits),
        triggered_runs: stage4TriggeredRuns,
        applicable_trait_count: countApplicableLoungeSofaTraits(stage4Applicability),
        status: stage4Status,
        measurements: stage4Measurements
      }
    };
  }

  let stage1Vote;
  try {
    if (typeof runOptions.progressCallback === "function") {
      runOptions.progressCallback({
        type: "stage1_started"
      });
    }
    stage1Vote = await voteStage1Classifications(imageInput, {
      ...runOptions,
      visionModel: runOptions.visionModel || "gpt-4.1"
    });
    if (typeof runOptions.progressCallback === "function") {
      runOptions.progressCallback({
        type: "stage1_done"
      });
    }
  } catch (error) {
    throw new QueryImageAnalysisStageError("stage1", "Stage 1 query-time image analysis failed.", { cause: error });
  }

  const stage1 = stage1Vote?.stage1 || null;
  if (!stage1 || isStage1OverrideResult(stage1)) {
    throw new QueryImageAnalysisStageError(
      "stage1",
      "Stage 1 query-time image analysis failed to produce a valid seating type."
    );
  }

  const seatingType = resolveStage1VisualType(stage1);
  if (!seatingTypes[seatingType]) {
    throw new QueryImageAnalysisStageError(
      "stage1",
      `Stage 1 returned unsupported seating type "${stage1.seating_type}".`
    );
  }

  let runs;
  try {
    if (typeof runOptions.progressCallback === "function") {
      runOptions.progressCallback({
        type: "stage23_started",
        expected_passes: 2
      });
    }
    runs = await Promise.all([
      runStage23ExtractionWithType(imageInput, seatingType, {
        ...runOptions,
        suppressPerRunProgress: true,
        visionModel: runOptions.visionModel || "gpt-4.1"
      }, { name: "Inspiration image" }, "run_1"),
      runStage23ExtractionWithType(imageInput, seatingType, {
        ...runOptions,
        suppressPerRunProgress: true,
        visionModel: runOptions.visionModel || "gpt-4.1"
      }, { name: "Inspiration image" }, "run_2")
    ]);
    if (typeof runOptions.progressCallback === "function") {
      runOptions.progressCallback({
        type: "stage23_done",
        current_pass: 2,
        expected_passes: 2
      });
    }
  } catch (error) {
    throw new QueryImageAnalysisStageError("stage23", "Stage 2+3 query-time image analysis failed.", { cause: error });
  }

  if (!allFieldsAgree(runs[0], runs[1])) {
    try {
      if (typeof runOptions.progressCallback === "function") {
        runOptions.progressCallback({
          type: "stage23_started",
          current_pass: 3,
          expected_passes: 3
        });
      }
      runs.push(await runStage23ExtractionWithType(imageInput, seatingType, {
        ...runOptions,
        suppressPerRunProgress: true,
        visionModel: runOptions.visionModel || "gpt-4.1"
      }, { name: "Inspiration image" }, "run_3"));
      if (typeof runOptions.progressCallback === "function") {
        runOptions.progressCallback({
          type: "stage23_done",
          current_pass: 3,
          expected_passes: 3
        });
      }
    } catch (error) {
      throw new QueryImageAnalysisStageError("stage23", "Stage 2+3 query-time image analysis failed.", { cause: error });
    }
  }

  const voted = voteStage123Runs(runs);
  if (!voted?.stage2 || !voted?.stage3) {
    throw new QueryImageAnalysisStageError(
      "stage23",
      "Stage 2+3 query-time image analysis returned incomplete output."
    );
  }

  const visualSummary = normalizeWhitespace(voted.stage2.visual_summary || "");
  const imageTraits = applyLoungeSofaTraitApplicability(
    seatingType,
    normalizeImageTraits(seatingType, voted.stage3.image_traits || {})
  );
  const fieldConfidence = buildSinglePassFieldConfidence(seatingType, imageTraits);
  const stage4TriggeredRuns = runs.filter((run) => Boolean(run.stage4?.triggered)).length;
  const stage4Applicability = getLoungeSofaTraitApplicability(seatingType, imageTraits);
  const stage4Measurements = aggregateLoungeSofaMeasurements(
    stage4Applicability,
    runs.map((run) => run.stage4?.raw_measurements || {})
  );
  const stage4Status = deriveLoungeSofaTraitStageStatus(stage4Applicability, imageTraits, stage4TriggeredRuns > 0);
  const searchText = buildSearchableText({
    productName: "",
    brand: "",
    seatingType,
    enumFields: imageTraits,
    freeText: {
      visual_summary: visualSummary,
      structured_caption: voted.stage3.structured_caption || "",
      silhouette: voted.stage2.silhouette || "",
      proportions: voted.stage2.proportions || "",
      structure_type: voted.stage2.structure_type || "",
      back_geometry: voted.stage2.back_geometry || "",
      seat_geometry: voted.stage2.seat_geometry || "",
      arm_geometry: voted.stage2.arm_geometry || "",
      surface_language: voted.stage2.surface_language || "",
      distinctive_elements: Array.isArray(voted.stage2.distinctive_elements) ? voted.stage2.distinctive_elements : []
    }
  });
  if (typeof runOptions.progressCallback === "function") {
    runOptions.progressCallback({
      type: "embedding_started"
    });
  }
  const queryEmbedding = await embedSearchText(searchText, runOptions);
  if (typeof runOptions.progressCallback === "function") {
    runOptions.progressCallback({
      type: "embedding_done"
    });
  }

  return {
    seating_type: seatingType,
    stage1: { seating_type: seatingType },
    stage2: {
      visual_summary: visualSummary,
      design_register: String(imageTraits.design_register || "").trim()
    },
    stage3: {
      reasoning: voted.stage3.reasoning || "",
      image_traits: imageTraits
    },
    enum_fields: imageTraits,
    field_confidence: fieldConfidence,
    image_traits: imageTraits,
    reasoning: voted.stage3.reasoning || "",
    plan_shape_reasoning: voted.stage3.reasoning || "",
    visual_form: visualSummary,
    search_text: searchText,
    search_bullets: buildSearchTimeBullets(imageTraits, seatingType),
    query_embedding: queryEmbedding,
    visual_summary_embedding: queryEmbedding,
    raw_visual_highlights: Array.isArray(voted.stage3.raw_visual_highlights) ? voted.stage3.raw_visual_highlights : [],
    structured_caption: voted.stage3.structured_caption || "",
    extraction_runs: runs.length,
    analysis_api_call_count: Number(stage1Vote?.api_call_count || 0) + runs.length + stage4TriggeredRuns,
    api_call_count: Number(stage1Vote?.api_call_count || 0) + runs.length + stage4TriggeredRuns + 1,
    post_stage23_lounge_sofa_traits: {
      eligible: stage4Applicability.eligible,
      extracted: hasExtractedLoungeSofaTraits(imageTraits),
      triggered_runs: stage4TriggeredRuns,
      applicable_trait_count: countApplicableLoungeSofaTraits(stage4Applicability),
      status: stage4Status,
      measurements: stage4Measurements
    }
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
