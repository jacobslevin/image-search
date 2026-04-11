import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { embedTextWithOpenAi, normalizeWhitespace, sentenceCase, tokenize, uniqueStrings, readJson } from "./utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const seatingTypesPath = path.join(__dirname, "..", "data", "seating-types.json");
const pdfExtractPath = path.join(__dirname, "..", "data", "pdf-text-extract.json");

const seatingTypesConfig = JSON.parse(fs.readFileSync(seatingTypesPath, "utf8"));
const seatingTypes = seatingTypesConfig.types || {};
const defaultSeatingType = seatingTypesConfig.default_type || "other_seating";
const stage1SeatingTypeEnum = [
  "task_chair",
  "collaborative_chair",
  "lounge_chair",
  "stool",
  "guest_chair",
  "bench",
  "perch_stool",
  "ottoman",
  "other_seating"
];

const LEGACY_TRAIT_DEFAULTS = {
  product_type: "",
  seating_category_visual: "",
  application_type: "",
  subject_prominence: "",
  dominant_color: "",
  secondary_colors: [],
  base_type: "",
  base_material: "",
  base_finish: "",
  leg_material: "",
  leg_style: "",
  glide_type: "",
  caster_present: false,
  frame_material: "",
  frame_finish: "",
  shell_material: "",
  shell_finish: "",
  arms_present: false,
  arm_type: "",
  arm_material: "",
  arm_pad_present: false,
  arm_adjustability: "",
  back_construction: "",
  back_support_type: "",
  lumbar_support_type: "",
  seat_depth_adjustable: false,
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

function getTypeFields(typeKey) {
  return seatingTypes[typeKey]?.fields || seatingTypes[defaultSeatingType].fields || [];
}

function getFieldMap(typeKey) {
  return new Map(getTypeFields(typeKey).map((item) => [item.field, item]));
}

function normalizeEnum(value, allowedValues = []) {
  const allowed = new Set((allowedValues || []).map((entry) => String(entry || "").toLowerCase()));
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) {
    return allowed.has("unknown") ? "unknown" : "";
  }
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

function classifySeatingTypeHeuristic(context = "") {
  const value = String(context || "").toLowerCase();
  if (/perch|active stool|wobble|balance stool|saddle stool/.test(value)) return "perch_stool";
  if (/task|office|ergonomic|lumbar|headrest|executive chair/.test(value)) return "task_chair";
  if (/collaborative|conference chair|meeting chair|multipurpose|multi-use|stacking chair|nesting chair/.test(value)) return "collaborative_chair";
  if (/guest|side chair|multi-use|multipurpose/.test(value)) return "guest_chair";
  if (/lounge|club|accent/.test(value)) return "lounge_chair";
  if (/stool|counter stool|bar stool/.test(value)) return "stool";
  if (/bench/.test(value)) return "bench";
  return defaultSeatingType;
}

function classifySchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      seating_type: {
        type: "string",
        enum: stage1SeatingTypeEnum
      }
    },
    required: ["seating_type"]
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
    required: ["structured_caption", "raw_visual_highlights", "image_traits"]
  };
}

async function callOpenAiJson({ apiKey, model, systemPrompt, userParts, schemaName, schema }) {
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
  const bulletsByPriority = Array.isArray(selectedBullets)
    ? { essential: [], normal: normalizePriorityList(selectedBullets) }
    : {
        essential: normalizePriorityList(selectedBullets?.essential || []),
        normal: normalizePriorityList(selectedBullets?.normal || [])
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
- Never use furniture category or type names in the query. Do not use words like: collaborative, task chair, lounge, guest chair, stool, bench, ottoman, perch, or any other seating category name. Describe only what is visually observable — form, geometry, materials, and structure.
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
    return { seating_type: heuristic };
  }

  const parsed = await callOpenAiJson({
    apiKey: options.apiKey,
    model: options.visionModel,
    systemPrompt: `Classify the primary furniture item in the image into a seating type.
Return JSON only. Choose exactly one seating_type from the enum.
Use the catalog context only as a disambiguation hint, not as override.

Type hints:
- task_chair: fully adjustable desk chair with 5-star base, ergonomic controls, designed for extended seated work
- collaborative_chair: meeting or classroom chair, simpler adjustments, often stackable or on sled base
- lounge_chair: low relaxed seating including sofas, modular pieces, and high-back privacy chairs
- stool: elevated seat with no back or low back, for counter, bar, or drafting height
- guest_chair: side chair or visitor chair, 4-leg or sled base, minimal adjustability
- bench: multi-person seat without individual back support, long seat surface
- perch_stool: active or perch seating with angled seat, wobble base, or saddle geometry
- ottoman: backless upholstered seat surface used as footrest or occasional seating, no arms
- other_seating: use only if the item genuinely does not fit any of the above types.` ,
    userParts: [
      ...(imageInput.catalogContext
        ? [{ type: "input_text", text: imageInput.catalogContext }]
        : []),
      { type: "input_image", image_url: imageInput.image_url, detail: "high" }
    ],
    schemaName: "seating_type_classifier",
    schema: classifySchema()
  });

  return { seating_type: ensureTypeKey(parsed.seating_type) };
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
- distinctive_elements: up to 5 short visual details that would distinguish this from similar items. Each item must be 8 words or fewer. Focus on what is visually unique — do not describe standard ergonomic features that appear on most task chairs.
- visual_summary: 2-3 sentence embedding-ready description combining the above. No brand names. Lead with form, not color.`;
}

function extractionPrompt(typeKey) {
  const type = seatingTypes[typeKey] || seatingTypes[defaultSeatingType];
  const fields = getTypeFields(typeKey).filter((entry) => entry.detectability !== "no");
  const fieldLines = fields
    .map((entry) => `- ${entry.field} (photo-detectable: ${String(entry.detectability || "").toUpperCase()}) => [${entry.allowed_values.join(", ")}]`)
    .join("\n");
  const stoolBackRule = typeKey === "stool"
    ? `- For stool type only: the back field refers to whether a physical backrest is present on the stool, not the material of the seat or legs. A stool with no backrest must return "None - backless" regardless of what materials are visible.\n`
    : "";
  const taskChairArmRule = typeKey === "task_chair"
    ? `- For task_chair type: when evaluating arm_option, look for visible adjustment mechanisms on the arm supports - sliding columns, pivot joints, or height adjustment hardware. If any adjustment mechanism is visible, return "Adjustable arms" or "4D adjustable arms". Only return "Fixed arms" if the arms are rigid with no visible adjustment hardware. Arms with padded caps that also have visible adjustment hardware should be classified as "Adjustable arms" not "Arms with arm pads".\n`
    : "";
  const taskChairBaseAndFrameRule = typeKey === "task_chair"
    ? `- For task_chair type: base_finish refers to the color and surface treatment of the five-star base only - black, polished aluminum, graphite, or white. Never return "Plastic" for base_finish - plastic describes material not finish. For the frame field, only return "Plastic" if the structural frame is visibly and predominantly plastic with no visible metal components. If the base is a five-star metal base with casters, frame should be "Metal" or "Aluminum" not "Plastic".\n`
    : "";

  return `Analyze one furniture image and answer only schema-routed questions. Type route: ${type.label} (${typeKey}). Return strict JSON only.

Rules:
- Fill image_traits fields only for the listed fields.
- Only attempt fields marked (photo-detectable: YES). Set (photo-detectable: MAYBE) fields only if clearly visible. Omit (photo-detectable: NO) fields entirely — these must come from spec data.
- If a trait is not visible or not applicable, use "unknown". Never guess. Never infer material from color alone.
- If a feature is structurally absent (e.g. no back, no arms), use "none" not "unknown".
- Never invent values outside allowed enum values.
- Ignore non-primary products and scene decor.
${stoolBackRule}${taskChairArmRule}${taskChairBaseAndFrameRule}- structured_caption: write a 1-2 sentence product caption. No brand or model names. Lead with form and distinctive geometry. This replaces the previous visual_description field.
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

function heuristicImageTraits(typeKey, context = "") {
  const source = String(context || "").toLowerCase();
  const output = {};
  const fields = getTypeFields(typeKey).filter((entry) => entry.detectability !== "no");

  const inferred = {
    product_type: /sofa|loveseat|sectional/.test(source)
      ? "sofa"
      : /stool/.test(source)
        ? "stool"
        : /bench/.test(source)
          ? "bench"
          : /task|office/.test(source)
            ? "task chair"
            : /guest|side chair/.test(source)
              ? "guest chair"
              : /lounge/.test(source)
                ? "lounge chair"
                : "chair",
    arms_present: /armless|no arms/.test(source) ? "no" : /arm/.test(source) ? "yes" : "unknown",
    base_type: /caster|wheel/.test(source)
      ? "five-star caster"
      : /sled/.test(source)
        ? "sled"
        : /cantilever/.test(source)
          ? "cantilever"
          : /pedestal/.test(source)
            ? "pedestal"
            : /plinth/.test(source)
              ? "plinth"
              : /four[- ]leg|four leg|legs/.test(source)
                ? "four-leg"
                : "unknown",
    frame_material: /wood|oak|walnut|ash|maple/.test(source)
      ? "wood"
      : /metal|steel|aluminum|aluminium|chrome/.test(source)
        ? "metal"
        : /poly|plastic/.test(source)
          ? "plastic"
          : "unknown",
    seat_material: /leather/.test(source)
      ? "leather"
      : /mesh/.test(source)
        ? "mesh"
        : /fabric|upholster|textile/.test(source)
          ? "fabric"
          : /wood/.test(source)
            ? "wood"
            : /poly|plastic/.test(source)
              ? "polymer"
              : "unknown",
    back_construction: /mesh/.test(source)
      ? "mesh"
      : /upholster|fabric|leather/.test(source)
        ? "upholstered"
        : /wood/.test(source)
          ? "wood shell"
          : /poly|plastic/.test(source)
            ? "polymer shell"
            : "unknown",
    dominant_color: /black|charcoal/.test(source)
      ? "black"
      : /white/.test(source)
        ? "white"
        : /gray|grey/.test(source)
          ? "gray"
          : /blue|navy|teal/.test(source)
            ? "blue"
            : /green|olive/.test(source)
              ? "green"
              : /red|burgundy/.test(source)
                ? "red"
                : /brown|tan|beige|camel|cognac/.test(source)
                  ? "brown"
                  : "unknown",
    silhouette: /curved|rounded/.test(source)
      ? "curved"
      : /angular/.test(source)
        ? "angular"
        : /compact/.test(source)
          ? "compact"
          : /rectilinear|boxy|straight/.test(source)
            ? "rectilinear"
            : "unknown",
    upholstery_coverage: /fully upholstered/.test(source)
      ? "fully upholstered"
      : /seat and back/.test(source)
        ? "seat and back"
        : /seat only/.test(source)
          ? "seat only"
          : "unknown",
    swivel_present: /swivel/.test(source) ? "yes" : "unknown",
    tilt_present: /tilt|recline/.test(source) ? "yes" : "unknown"
  };

  for (const field of fields) {
    output[field.field] = normalizeEnum(inferred[field.field], field.allowed_values);
  }

  return output;
}

async function extractImageTraitsOpenAi(imageInput, typeKey, stage1, stage2, options = {}) {
  if (!options.apiKey) {
    const heuristicTraits = heuristicImageTraits(typeKey, `${imageInput.catalogContext || ""} ${imageInput.image_url || ""}`);
    return {
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
        text: `Seating type: ${stage1.seating_type}. Visual context: ${stage2.visual_summary}. Extract structured traits and write the structured_caption from the image.`
      },
      { type: "input_image", image_url: imageInput.image_url, detail: "high" }
    ],
    schemaName: `seating_traits_${typeKey}`,
    schema: extractionSchemaForType(typeKey)
  });
  console.log("HANDOFF 1 - raw parsed image_traits:", JSON.stringify(parsed.image_traits, null, 2));
  const guardedParsed = applyStage3EnumGuardrails(typeKey, parsed);
  console.log("HANDOFF 2 - post-guardrail image_traits:", JSON.stringify(guardedParsed.image_traits, null, 2));
  const finalTraits = normalizeImageTraits(typeKey, guardedParsed.image_traits || {});
  console.log("HANDOFF 3 - post-normalization image_traits:", JSON.stringify(finalTraits, null, 2));

  return {
    structured_caption: sentenceCase(guardedParsed.structured_caption || "Structured seating result.").replace(/\.*$/, "."),
    raw_visual_highlights: uniqueStrings(Array.isArray(guardedParsed.raw_visual_highlights) ? guardedParsed.raw_visual_highlights : []).slice(0, 8),
    image_traits: finalTraits
  };
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

  return {
    silhouette: normalizeWhitespace(parsed.silhouette || ""),
    proportions: normalizeWhitespace(parsed.proportions || ""),
    structure_type: normalizeWhitespace(parsed.structure_type || ""),
    back_geometry: normalizeWhitespace(parsed.back_geometry || ""),
    seat_geometry: normalizeWhitespace(parsed.seat_geometry || ""),
    arm_geometry: normalizeWhitespace(parsed.arm_geometry || ""),
    surface_language: normalizeWhitespace(parsed.surface_language || ""),
    design_register: normalizeEnum(parsed.design_register, ["minimal", "organic", "industrial", "traditional", "sculptural", "utilitarian"]) || "utilitarian",
    distinctive_elements: uniqueStrings(Array.isArray(parsed.distinctive_elements) ? parsed.distinctive_elements : []).slice(0, 5),
    visual_summary: normalizeWhitespace(parsed.visual_summary || "")
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

  if (fieldName === "lumbar_support") {
    if (/adjustable lumbar/.test(source)) return "adjustable";
    if (/lumbar/.test(source)) return "fixed";
    if (/no lumbar/.test(source)) return "none";
  }

  if (fieldName === "seat_depth_adjustable") {
    if (/seat depth|flexfront|adjustable seat depth/.test(source)) return "yes";
    if (/non-adjustable seat depth|no seat depth adjustment/.test(source)) return "no";
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
  const frameMaterial = mergedTraits.frame_material === "unknown" ? "" : mergedTraits.frame_material;
  const seatMaterial = mergedTraits.seat_material === "unknown" ? "" : mergedTraits.seat_material;
  const backConstruction = mergedTraits.back_construction === "unknown" ? "" : mergedTraits.back_construction;
  const armsPresent = mergedTraits.arms_present === "yes";

  const mapped = {
    ...LEGACY_TRAIT_DEFAULTS,
    product_type: productType,
    seating_category_visual:
      typeKey === "task_chair"
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
      typeKey === "task_chair"
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
    arms_present: armsPresent,
    arm_type: mergedTraits.arms_present === "no" ? "no arms" : armsPresent ? "fixed arms" : "",
    arm_adjustability: mergedTraits.arm_adjustability && mergedTraits.arm_adjustability !== "unknown" ? mergedTraits.arm_adjustability : "",
    lumbar_support_type: mergedTraits.lumbar_support && mergedTraits.lumbar_support !== "unknown" ? mergedTraits.lumbar_support : "",
    seat_depth_adjustable: mergedTraits.seat_depth_adjustable === "yes",
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
    ["arms_present", (value) => (value === "yes" ? "with arms" : value === "no" ? "armless" : "")]
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
    visualTraits.lumbar_support_type,
    visualTraits.arm_adjustability,
    visualTraits.arm_material ? `${visualTraits.arm_material} arms` : visualTraits.arms_present ? "arms" : "",
    visualTraits.seat_material,
    visualTraits.back_material,
    ...(visualTraits.dominant_materials || []),
    ...(visualTraits.secondary_materials || []),
    ...(visualTraits.material_details || []),
    ...(visualTraits.notable_features || [])
  ]).map((phrase) => normalizeWhitespace(phrase));
}

async function createTypedCaption(imageInput, options = {}, imageRecord = {}) {
  const stage1 = await classifySeatingTypeOpenAi(imageInput, options);
  const seatingType = ensureTypeKey(stage1.seating_type);
  const stage2 = await describeVisualFormOpenAi(imageInput, options);
  const stage3 = await extractImageTraitsOpenAi(imageInput, seatingType, stage1, stage2, options);

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

  return {
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
    visual_traits: visualTraits
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
    caption_model_version: usedOpenAi ? `openai:${options.visionModel || "gpt-4.1-mini"}` : "demo:typed-v1",
    embedding_model_version: usedOpenAi
      ? `openai:${options.embeddingModel || process.env.EMBEDDING_MODEL || "text-embedding-3-small"}`
      : "missing"
  };
}

export async function analyzeInspirationImage(imageUrl, options = {}) {
  const provider = options.provider || "openai";
  const focusArea = options.focusArea && typeof options.focusArea === "object" ? options.focusArea : null;
  const focusAreaInstruction = focusArea
    ? `User-selected focus area (normalized): left=${Number(focusArea.x || 0).toFixed(3)}, top=${Number(focusArea.y || 0).toFixed(3)}, width=${Number(focusArea.width || 1).toFixed(3)}, height=${Number(focusArea.height || 1).toFixed(3)}.`
    : "";

  return createTypedCaption(
    {
      image_url: imageUrl,
      catalogContext: `Inspiration image analysis for visual search. ${focusAreaInstruction}`
    },
    {
      ...options,
      apiKey: provider === "openai" ? options.apiKey : null
    },
    {
      name: options.fileName || "Inspiration image"
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
