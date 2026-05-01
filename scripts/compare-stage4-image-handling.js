import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const imageIndexPath = path.join(__dirname, "..", "data", "image-index.json");
const sampleReportPath = path.join(__dirname, "..", "data", "stage4-sample-25-report.json");

const MODEL = process.env.STAGE4_COMPARE_MODEL || "gpt-4.1";
const API_KEY = process.env.OPENAI_API_KEY || process.env.API_KEY || process.env.OPENAI_VISION_API_KEY || "";

const ARMLESS_VALUES = new Set(["armless", "no arms"]);
const MONOLITHIC_BASE_VALUES = new Set(["integrated base", "molded one-piece"]);
const SOFA_HEIGHT_INCHES = 31;
const RATIO_A_THRESHOLD_PCT = 18;
const FLUSH_WITH_BACK_MAX_DROP_PCT = 5;

const TARGETS = [
  { product: "Arcular - Lounge Chairs", filename: "6655f27e87e8a14be5d9e71bArcularProduct11.jpg", expectations: { seat_construction: "Cushion Only", narrow_arms: "Narrower", arms_flush_with_back: "Flush with Back" } },
  { product: "A-Bench - Sofas", filename: "621ed29fa8676a1bb07648efABenchSofa.jpg", expectations: { seat_construction: "Cushion Only", narrow_arms: "Narrower", arms_flush_with_back: "Flush with Back" } },
  { product: "Becca - Lounge", filename: "BeccaImageGallery211.jpg", expectations: { seat_construction: null, narrow_arms: "Narrower", arms_flush_with_back: "Flush with Back", arm_traits_nullable: true } },
  { product: "Orla", filename: "orla04whitesweephaworth.jpg", expectations: { seat_construction: null, narrow_arms: "Narrower", arms_flush_with_back: "Flush with Back", arm_traits_nullable: true } },
  { product: "Finale - Sofa", filename: "FinaleImageGallery131.jpg", expectations: { seat_construction: "Cushion Only", narrow_arms: "Narrower", arms_flush_with_back: "Flush with Back" } },
  { product: "Rule of Three - Lounge", filename: "ROTlounge20silo6.jpg", expectations: { seat_construction: "Cushion Only", narrow_arms: "Narrower", arms_flush_with_back: "Below Back" } },
  { product: "Harmony Classic - Sofa", filename: "HarmonyClassicImageGallery081.jpg", expectations: { seat_construction: "Cushion on Platform", narrow_arms: "Narrower", arms_flush_with_back: "Below Back" } },
  { product: "Corral Lounge", filename: "DeckSofa.jpg", expectations: { seat_construction: "Cushion on Platform", narrow_arms: "Wider", arms_flush_with_back: "Below Back" } },
  { product: "HAVEN BENCH", filename: "haven1.jpg", expectations: { seat_construction: "Cushion on Platform", narrow_arms: "Wider", arms_flush_with_back: null } },
  { product: "Lyda", filename: "ws2LydaThreeSeater2ArmFrontFNL.jpg", expectations: { seat_construction: "Cushion on Platform", narrow_arms: "Narrower", arms_flush_with_back: "Below Back" } },
  { product: "Kithara", filename: "Loveseat.jpg", expectations: { seat_construction: "Cushion Only", narrow_arms: "Wider", arms_flush_with_back: "Below Back" } }
];

const LAST_RUN_RESULTS = new Map([
  ["Arcular - Lounge Chairs", { seat_construction: "Cushion Only", narrow_arms: "Narrower", arms_flush_with_back: "Flush with Back" }],
  ["A-Bench - Sofas", { seat_construction: "Cushion Only", narrow_arms: "Narrower", arms_flush_with_back: "Flush with Back" }],
  ["Becca - Lounge", { seat_construction: null, narrow_arms: "Narrower", arms_flush_with_back: "Flush with Back" }],
  ["Orla", { seat_construction: null, narrow_arms: "Narrower", arms_flush_with_back: "Flush with Back" }],
  ["Finale - Sofa", { seat_construction: "Cushion on Less Thin Platform", narrow_arms: "Narrower", arms_flush_with_back: "Flush with Back" }],
  ["Rule of Three - Lounge", { seat_construction: "Cushion Only", narrow_arms: "Narrower", arms_flush_with_back: "Below Back" }],
  ["Harmony Classic - Sofa", { seat_construction: "Cushion on Thin Platform", narrow_arms: "Narrower", arms_flush_with_back: "Below Back" }],
  ["Corral Lounge", { seat_construction: "Cushion on Thin Platform", narrow_arms: "Narrower", arms_flush_with_back: "Below Back" }],
  ["HAVEN BENCH", { seat_construction: "Cushion on Thin Platform", narrow_arms: "Narrower", arms_flush_with_back: "Flush with Back" }],
  ["Lyda", { seat_construction: "Cushion on Thin Platform", narrow_arms: "Wider", arms_flush_with_back: "Below Back" }],
  ["Kithara", { seat_construction: "Cushion Only", narrow_arms: "Narrower", arms_flush_with_back: "Below Back" }]
]);

const LAST_RUN_ARM_INCHES = new Map([
  ["Arcular - Lounge Chairs", 2],
  ["A-Bench - Sofas", 2],
  ["Becca - Lounge", 2],
  ["Orla", 2],
  ["Finale - Sofa", 3],
  ["Rule of Three - Lounge", 2],
  ["Harmony Classic - Sofa", 4],
  ["Corral Lounge", 4],
  ["HAVEN BENCH", 3],
  ["Lyda", 6],
  ["Kithara", 5]
]);

const PROMPT_HEADER = `Look at this sofa image and provide the following measurements
and classifications.

Note on pillows:
Ignore decorative or toss pillows. Toss pillows sit on top of
the seat cushion or in front of the back, are square or accent-
patterned, and are not structurally part of the sofa. Back
cushions sit flush against the back frame, match the primary
upholstery, and align with the seat segments.

Use these typical sofa proportions as anchors:
- 3-seat sofas are typically 80-90 inches wide and 30-32 inches
  tall
- Arm panel thickness typically falls between 1 and 9 inches
- Seat cushion thickness typically falls between 3 and 7 inches
- Upholstered platforms (when present) typically fall between
  2 and 8 inches`;

const SEAT_SECTION = `Trait 1: Seat Construction (raw observations)

Look at the area between the seat cushion and the floor. Answer
the following questions about what you see below the cushion.
Do not classify the result — just describe what is there.

1. Is there a horizontal element below the seat cushion that is
   wrapped in upholstery (fabric or leather)? Answer Yes or No.

   - Metal legs, metal frames, metal stretchers, metal crossbars,
     wire frames, wood legs, wood frames, wood rails, sled bases,
     and other structural elements are NOT upholstered, regardless
     of how substantial they look. Answer No if all you see is
     metal or wood structure.

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
   element exists.

Output JSON for this trait:

{
  "upholstered_base_present": "Yes" | "No",
  "upholstered_base_same_material": "Yes" | "No" | "N/A",
  "upholstered_base_seam_visible": "Yes" | "No" | "N/A",
  "upholstered_base_height_inches": <number 2-8 or null>
}`;

const ARM_SECTION = `Trait 2: Numeric measurements (in inches)

By "arm panel thickness" we mean the side-to-side thickness of
the arm panel as visible from the front of the sofa. Not the
front-to-back depth of the arm.

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

By "seat cushion thickness" we mean the vertical dimension of
the seat cushion itself — top of cushion to bottom of cushion
where it meets the platform or frame. Do not include any
upholstered platform below the cushion.

By "platform thickness" we mean any upholstered base that sits
below the seat cushion and above the legs/floor, that meets
all three platform criteria above. If there is no platform,
return null.

Trait 3: Arm and back vertical positions (percentages of sofa
height)

At what vertical position does the highest visible structural
top of the arm sit? Use the actual top edge of the arm itself,
not the outer side panel silhouette and not a perspective
continuation.

Curved-shell sofas: When the arm and back are part of one
continuous curved shell, measure the arm top at the HIGHEST
POINT of the curve — typically where the side curve joins the
top of the back. Do not measure at the lower or intermediate
point of the curve where it dips down toward the seat. On a
continuous shell, the side termination meets the back at the
same height — both points are at the top of the shell.

At what vertical position does the top of the back cushion sit?
When back cushions project above the structural back, use the
visible cushion top.

Express both positions as a percentage of total sofa height
(where the floor is 0% and the highest point of the sofa is
100%).

Output JSON:

{
  "arm_panel_thickness_inches": <number 1-9 or null>,
  "seat_cushion_thickness_inches": <number 3-7 or null>,
  "platform_thickness_inches": <number 2-8 or null>,
  "arm_top_pct": <number 0-100 or null>,
  "back_top_pct": <number 0-100 or null>
}

Return null for any measurement that is not visible or not
applicable.`;

function normalizeUsage(usage = {}) {
  const promptTokens = Number(usage?.prompt_tokens ?? usage?.input_tokens ?? 0);
  const completionTokens = Number(usage?.completion_tokens ?? usage?.output_tokens ?? 0);
  const totalTokens = Number(usage?.total_tokens ?? (promptTokens + completionTokens) ?? 0);
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens
  };
}

function sumUsage(...entries) {
  return entries.reduce((acc, usage) => ({
    prompt_tokens: acc.prompt_tokens + Number(usage?.prompt_tokens || 0),
    completion_tokens: acc.completion_tokens + Number(usage?.completion_tokens || 0),
    total_tokens: acc.total_tokens + Number(usage?.total_tokens || 0)
  }), { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
}

function estimateUsageCostUsd(usage = {}) {
  return Number((((Number(usage?.prompt_tokens || 0) * (2 / 1_000_000)) + (Number(usage?.completion_tokens || 0) * (8 / 1_000_000)))).toFixed(6));
}

function normalizeLower(value = "") {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeNumber(value, min = null, max = null) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  let clamped = numeric;
  if (Number.isFinite(min)) clamped = Math.max(min, clamped);
  if (Number.isFinite(max)) clamped = Math.min(max, clamped);
  return Number(clamped.toFixed(2));
}

function classifyFlushWithBack(armTopPct = null, backTopPct = null) {
  const armTop = Number(armTopPct);
  const backTop = Number(backTopPct);
  if (!Number.isFinite(armTop) || !Number.isFinite(backTop)) return null;
  return (backTop - armTop) <= FLUSH_WITH_BACK_MAX_DROP_PCT ? "Flush with Back" : "Below Back";
}

function classifySeatConstruction(raw = {}) {
  return raw.upholstered_base_present === "Yes"
    && raw.upholstered_base_same_material === "Yes"
    && raw.upholstered_base_seam_visible === "Yes"
    && Number.isFinite(Number(raw.upholstered_base_height_inches))
    && Number(raw.upholstered_base_height_inches) >= 2.5
    ? "Cushion on Platform"
    : "Cushion Only";
}

function ratioAFromInches(armInches = null) {
  const arm = Number(armInches);
  if (!Number.isFinite(arm)) return null;
  return Number(((arm / SOFA_HEIGHT_INCHES) * 100).toFixed(2));
}

function ratioBFromInches(armInches = null, cushionInches = null) {
  const arm = Number(armInches);
  const cushion = Number(cushionInches);
  if (!Number.isFinite(arm) || !Number.isFinite(cushion) || cushion <= 0) return null;
  return Number((arm / cushion).toFixed(3));
}

function ratioCFromInches(armInches = null, cushionInches = null, platformInches = null) {
  const arm = Number(armInches);
  const cushion = Number(cushionInches);
  const platform = Number(platformInches);
  const denominator = cushion + (Number.isFinite(platform) ? platform : 0);
  if (!Number.isFinite(arm) || !Number.isFinite(cushion) || denominator <= 0) return null;
  return Number((arm / denominator).toFixed(3));
}

function classifyByThreshold(value = null, threshold = null) {
  const numeric = Number(value);
  const cut = Number(threshold);
  if (!Number.isFinite(numeric) || !Number.isFinite(cut)) return null;
  return numeric <= cut ? "Narrower" : "Wider";
}

function getApplicability(enumFields = {}) {
  return {
    seat_construction: !MONOLITHIC_BASE_VALUES.has(normalizeLower(enumFields?.base_type)),
    arm_measurements: !ARMLESS_VALUES.has(normalizeLower(enumFields?.arm_option))
  };
}

function buildPrompt(applicability = {}) {
  const sections = [PROMPT_HEADER];
  const requested = [];
  if (applicability.seat_construction) {
    sections.push(SEAT_SECTION);
    requested.push('  "upholstered_base_present": "Yes" | "No"');
    requested.push('  "upholstered_base_same_material": "Yes" | "No" | "N/A"');
    requested.push('  "upholstered_base_seam_visible": "Yes" | "No" | "N/A"');
    requested.push('  "upholstered_base_height_inches": <number 2-8 or null>');
  }
  if (applicability.arm_measurements) {
    sections.push(ARM_SECTION);
    requested.push('  "arm_panel_thickness_inches": <number 1-9 or null>');
    requested.push('  "seat_cushion_thickness_inches": <number 3-7 or null>');
    requested.push('  "platform_thickness_inches": <number 2-8 or null>');
    requested.push('  "arm_top_pct": <number 0-100 or null>');
    requested.push('  "back_top_pct": <number 0-100 or null>');
  }
  sections.push(`Output JSON:\n\n{\n${requested.join(",\n")}\n}\n\nReturn null for any measurement that is not visible or not\napplicable.`);
  return sections.join("\n\n");
}

function buildSchema(applicability = {}) {
  const properties = {};
  const required = [];
  if (applicability.seat_construction) {
    properties.upholstered_base_present = { type: "string", enum: ["Yes", "No"] };
    properties.upholstered_base_same_material = { type: "string", enum: ["Yes", "No", "N/A"] };
    properties.upholstered_base_seam_visible = { type: "string", enum: ["Yes", "No", "N/A"] };
    properties.upholstered_base_height_inches = { anyOf: [{ type: "number", minimum: 2, maximum: 8 }, { type: "null" }] };
    required.push("upholstered_base_present", "upholstered_base_same_material", "upholstered_base_seam_visible", "upholstered_base_height_inches");
  }
  if (applicability.arm_measurements) {
    properties.arm_panel_thickness_inches = { anyOf: [{ type: "number", minimum: 1, maximum: 9 }, { type: "null" }] };
    properties.seat_cushion_thickness_inches = { anyOf: [{ type: "number", minimum: 3, maximum: 7 }, { type: "null" }] };
    properties.platform_thickness_inches = { anyOf: [{ type: "number", minimum: 2, maximum: 8 }, { type: "null" }] };
    properties.arm_top_pct = { anyOf: [{ type: "number", minimum: 0, maximum: 100 }, { type: "null" }] };
    properties.back_top_pct = { anyOf: [{ type: "number", minimum: 0, maximum: 100 }, { type: "null" }] };
    required.push("arm_panel_thickness_inches", "seat_cushion_thickness_inches", "platform_thickness_inches", "arm_top_pct", "back_top_pct");
  }
  return { type: "object", additionalProperties: false, properties, required };
}

async function callOpenAiJson({ systemPrompt, imageUrl, schemaName, schema }) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      input: [
        { role: "system", content: [{ type: "input_text", text: systemPrompt }] },
        { role: "user", content: [{ type: "input_image", image_url: imageUrl, detail: "high" }] }
      ],
      text: { format: { type: "json_schema", name: schemaName, strict: true, schema } }
    })
  });
  if (!response.ok) throw new Error(`OpenAI request failed with ${response.status}: ${await response.text()}`);
  const payload = await response.json();
  const outputText = payload.output_text || payload.output?.[0]?.content?.[0]?.text;
  if (!outputText) throw new Error("OpenAI response did not include JSON output.");
  return { data: JSON.parse(outputText), usage: normalizeUsage(payload.usage) };
}

function pickBestThreshold(rows = [], ratioKey) {
  const candidates = rows.map((row) => row[ratioKey]).filter((value) => Number.isFinite(Number(value))).map(Number).sort((a, b) => a - b);
  if (!candidates.length) return null;
  const thresholds = new Set([candidates[0], candidates[candidates.length - 1]]);
  for (let i = 0; i < candidates.length - 1; i += 1) thresholds.add(Number((((candidates[i] + candidates[i + 1]) / 2)).toFixed(3)));
  let best = null;
  for (const threshold of thresholds) {
    let correct = 0;
    let total = 0;
    for (const row of rows) {
      if (!row.groundTruthNarrow || row.groundTruthNarrow === "null") continue;
      const predicted = classifyByThreshold(row[ratioKey], threshold);
      if (!predicted) continue;
      total += 1;
      if (predicted === row.groundTruthNarrow) correct += 1;
    }
    const score = total ? correct / total : 0;
    if (!best || score > best.score || (score === best.score && threshold < best.threshold)) best = { threshold, score, correct, total };
  }
  return best;
}

function formatNullable(value) {
  return value === null || value === undefined ? "null" : String(value);
}

function formatTriple(seat, narrow, flush) {
  return `SC=${formatNullable(seat)} / NA=${formatNullable(narrow)} / FB=${formatNullable(flush)}`;
}

function matchesExpected(row) {
  const seatOk = row.seatConstruction === row.expectations.seat_construction;
  const narrowOk = row.expectations.arm_traits_nullable ? (row.narrowArmsA === row.expectations.narrow_arms || row.narrowArmsA === null) : row.narrowArmsA === row.expectations.narrow_arms;
  const flushOk = row.expectations.arm_traits_nullable ? (row.flush === row.expectations.arms_flush_with_back || row.flush === null) : row.flush === row.expectations.arms_flush_with_back;
  return seatOk && narrowOk && flushOk;
}

function markdownTable1(rows = []) {
  return [
    "| Product | Last Run Result | This Run Result | Expected | Match? |",
    "|---|---|---|---|---|",
    ...rows.map((row) => `| ${row.product} | ${row.lastRun} | ${row.thisRun} | ${row.expected} | ${row.match} |`)
  ].join("\n");
}

function markdownTable2(rows = []) {
  return [
    "| Product | Last Run | This Run | Arm Top % | Back Top % | Expected | Match? |",
    "|---|---|---|---:|---:|---|---|",
    ...rows.map((row) => `| ${row.product} | ${row.lastRun} | ${row.thisRun} | ${row.armTop} | ${row.backTop} | ${row.expected} | ${row.match} |`)
  ].join("\n");
}

function markdownTable3(rows = []) {
  return [
    "| Product | Expected | arm_in (last run -> this run) | cushion_in | platform_in | Ratio A | Ratio B | Ratio C |",
    "|---|---|---:|---:|---:|---:|---:|---:|",
    ...rows.map((row) => `| ${row.product} | ${row.expected} | ${row.armInches} | ${row.cushionInches} | ${row.platformInches} | ${row.ratioA} | ${row.ratioB} | ${row.ratioC} |`)
  ].join("\n");
}

function loadContext() {
  const imageIndex = JSON.parse(fs.readFileSync(imageIndexPath, "utf8"));
  const sampleReport = JSON.parse(fs.readFileSync(sampleReportPath, "utf8"));
  const imageRows = sampleReport.image_rows || [];
  const images = imageIndex.images || [];
  const products = imageIndex.products || [];
  const imageByFilename = new Map(images.map((image) => [path.basename(new URL(image.image_url).pathname), image]));
  const reportRowByProductAndImage = new Map(imageRows.map((row) => [`${row.product}::${row.image}`, row]));
  const productByName = new Map(products.map((product) => [product.product_name, product]));
  return { imageByFilename, reportRowByProductAndImage, productByName };
}

async function main() {
  if (!API_KEY) throw new Error("Missing OPENAI_API_KEY/API_KEY/OPENAI_VISION_API_KEY.");

  const { imageByFilename, reportRowByProductAndImage, productByName } = loadContext();
  const results = [];
  let usageTotal = normalizeUsage();

  for (const target of TARGETS) {
    const image = imageByFilename.get(target.filename);
    if (!image) throw new Error(`Could not find image record for ${target.filename}`);

    const productRecord = productByName.get(target.product);
    const reportRow = reportRowByProductAndImage.get(`${target.product}::${target.filename}`) || null;
    const baseType = normalizeLower(image.enum_fields?.base_type || productRecord?.enum_fields?.base_type || "");
    const armOption = normalizeLower(image.enum_fields?.arm_option || productRecord?.enum_fields?.arm_option || "");
    const applicability = getApplicability(image.enum_fields || productRecord?.enum_fields || {});

    const { data, usage } = await callOpenAiJson({
      systemPrompt: buildPrompt(applicability),
      imageUrl: image.image_url,
      schemaName: "stage4_binary_seat_test",
      schema: buildSchema(applicability)
    });

    usageTotal = sumUsage(usageTotal, usage);

    const rawSeat = {
      upholstered_base_present: applicability.seat_construction ? (data.upholstered_base_present ?? null) : null,
      upholstered_base_same_material: applicability.seat_construction ? (data.upholstered_base_same_material ?? null) : null,
      upholstered_base_seam_visible: applicability.seat_construction ? (data.upholstered_base_seam_visible ?? null) : null,
      upholstered_base_height_inches: applicability.seat_construction ? normalizeNumber(data.upholstered_base_height_inches, 2, 8) : null
    };

    const armInches = applicability.arm_measurements ? normalizeNumber(data.arm_panel_thickness_inches, 1, 9) : null;
    const cushionInches = applicability.arm_measurements ? normalizeNumber(data.seat_cushion_thickness_inches, 3, 7) : null;
    const platformInches = applicability.arm_measurements ? normalizeNumber(data.platform_thickness_inches, 2, 8) : null;
    const armTopPct = applicability.arm_measurements ? normalizeNumber(data.arm_top_pct, 0, 100) : null;
    const backTopPct = applicability.arm_measurements ? normalizeNumber(data.back_top_pct, 0, 100) : null;

    const ratioA = ratioAFromInches(armInches);
    const ratioB = ratioBFromInches(armInches, cushionInches);
    const ratioC = ratioCFromInches(armInches, cushionInches, platformInches);

    results.push({
      product: target.product,
      image: target.filename,
      imageUrl: image.image_url,
      baseType: baseType || "unknown",
      armOption: armOption || "unknown",
      currentStoredSeat: reportRow?.seat_construction ?? null,
      currentStoredNarrow: reportRow?.narrow_arms ?? null,
      currentStoredFlush: reportRow?.arms_flush_with_back ?? null,
      rawSeat,
      seatConstruction: applicability.seat_construction ? classifySeatConstruction(rawSeat) : null,
      armInches,
      cushionInches,
      platformInches,
      armTopPct,
      backTopPct,
      ratioA,
      ratioB,
      ratioC,
      narrowArmsA: classifyByThreshold(ratioA, RATIO_A_THRESHOLD_PCT),
      flush: applicability.arm_measurements ? classifyFlushWithBack(armTopPct, backTopPct) : null,
      expectations: target.expectations
    });
  }

  const narrowThresholdRows = results.filter((row) => row.expectations.narrow_arms && !row.expectations.arm_traits_nullable);
  const ratioBThreshold = pickBestThreshold(narrowThresholdRows.map((row) => ({ ratioB: row.ratioB, groundTruthNarrow: row.expectations.narrow_arms })), "ratioB");
  const ratioCThreshold = pickBestThreshold(narrowThresholdRows.map((row) => ({ ratioC: row.ratioC, groundTruthNarrow: row.expectations.narrow_arms })), "ratioC");

  const finalRows = results.map((row) => ({
    ...row,
    narrowArmsB: classifyByThreshold(row.ratioB, ratioBThreshold?.threshold ?? null),
    narrowArmsC: classifyByThreshold(row.ratioC, ratioCThreshold?.threshold ?? null)
  }));

  const implausibleCases = finalRows.flatMap((row) => {
    const notes = [];
    if (row.armInches != null && row.cushionInches != null && row.expectations.narrow_arms === "Narrower" && row.armInches > row.cushionInches) {
      notes.push(`${row.product}: arm_inches (${row.armInches}) > cushion_inches (${row.cushionInches}) for expected narrow-arm case`);
    }
    if (row.seatConstruction === "Cushion Only" && row.platformInches != null) {
      notes.push(`${row.product}: platform_inches reported (${row.platformInches}) despite Cushion Only`);
    }
    if (row.armTopPct != null && row.backTopPct != null && row.armTopPct > row.backTopPct) {
      notes.push(`${row.product}: arm_top_pct (${row.armTopPct}) > back_top_pct (${row.backTopPct})`);
    }
    return notes;
  });

  const table1Rows = finalRows.map((row) => ({
    product: row.product,
    lastRun: formatNullable(LAST_RUN_RESULTS.get(row.product)?.seat_construction ?? null),
    thisRun: formatNullable(row.seatConstruction),
    expected: formatNullable(row.expectations.seat_construction),
    match: row.seatConstruction === row.expectations.seat_construction ? "Yes" : "No"
  }));

  const curvedShellProducts = new Set(["Arcular - Lounge Chairs", "A-Bench - Sofas", "Becca - Lounge", "Orla"]);
  const table2Rows = finalRows
    .filter((row) => curvedShellProducts.has(row.product))
    .map((row) => ({
      product: row.product,
      lastRun: `${formatNullable(LAST_RUN_RESULTS.get(row.product)?.narrow_arms)} / ${formatNullable(LAST_RUN_RESULTS.get(row.product)?.arms_flush_with_back)}`,
      thisRun: `${formatNullable(row.narrowArmsA)} / ${formatNullable(row.flush)}`,
      armTop: formatNullable(row.armTopPct),
      backTop: formatNullable(row.backTopPct),
      expected: `${formatNullable(row.expectations.narrow_arms)} / ${formatNullable(row.expectations.arms_flush_with_back)}`,
      match: (row.expectations.arm_traits_nullable
        ? ((row.narrowArmsA === row.expectations.narrow_arms || row.narrowArmsA === null) && (row.flush === row.expectations.arms_flush_with_back || row.flush === null))
        : (row.narrowArmsA === row.expectations.narrow_arms && row.flush === row.expectations.arms_flush_with_back)) ? "Yes" : "No"
    }));

  const table3Rows = finalRows.map((row) => ({
    product: row.product,
    expected: formatNullable(row.expectations.narrow_arms),
    armInches: `${formatNullable(LAST_RUN_ARM_INCHES.get(row.product) ?? null)} -> ${formatNullable(row.armInches)}`,
    cushionInches: formatNullable(row.cushionInches),
    platformInches: formatNullable(row.platformInches),
    ratioA: formatNullable(row.ratioA),
    ratioB: formatNullable(row.ratioB),
    ratioC: formatNullable(row.ratioC)
  }));

  const report = {
    model: MODEL,
    total_usage: usageTotal,
    total_estimated_cost_usd: estimateUsageCostUsd(usageTotal),
    ratio_b_threshold: ratioBThreshold,
    ratio_c_threshold: ratioCThreshold,
    results: finalRows,
    implausible_cases: implausibleCases
  };

  console.log(markdownTable1(table1Rows));
  console.log("");
  console.log(markdownTable2(table2Rows));
  console.log("");
  console.log(markdownTable3(table3Rows));
  console.log("");
  console.log(`Total tokens: ${usageTotal.total_tokens} (est. $${estimateUsageCostUsd(usageTotal).toFixed(6)})`);
  console.log("");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
