#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { analyzeInspirationImage } from "../src/captioning.js";

const execFileAsync = promisify(execFile);

const DEFAULT_PRODUCTS = {
  ofs_cosima_chair: {
    url: "https://assets.ofs.com/s3fs-public/styles/max_1300x1300/public/2019-06/OFS_Cosima_v13_Chair_wr.jpg?itok=-9faKHX1"
  },
  haworth_buzzispark: {
    url: "https://www.haworth.com/content/dam/haworth-com/global/products-na/seating/lounge-chairs/buzzispark-lounge-chair/hero-carousel/buzzispark_lounge_3_4.png"
  },
  a_bench: {
    url: "https://cdn.prod.website-files.com/60edd826130a2e787f6647ff/61e58bf7981d9935e68dac14_A-Bench_Photo%20Gallery_02-p-1080.jpeg"
  }
};

const STEP_DOWN = Number(process.env.RESOLUTION_STEP_DOWN || 0.9);
const MIN_SHORT_SIDE = Number(process.env.RESOLUTION_MIN_SHORT_SIDE || 600);
const RUNS_PER_STEP = Number(process.env.RESOLUTION_RUNS_PER_STEP || 3);
const AGREE_FLOOR = Number(process.env.RESOLUTION_AGREE_FLOOR || 0.8);
const MATCH_FIELDS = ["seat_upholstery", "shell_material", "base_type", "leg_angle"];

const SYNONYMS = {
  "leather-like": "leather",
  "matte-leather": "leather",
  "faux-leather": "leather",
  "fabric-upholstered": "fabric",
  "polished-aluminum": "polished-metal",
  "brushed-metal": "polished-metal",
  graphite: "painted-metal",
  "black-enamel": "painted-metal",
  "black-paint": "painted-metal",
  "natural-/-wood": "natural-wood",
  "natural-wood": "natural-wood",
  "fabric-(specify-category)": "fabric",
  "upholstered-foam": "upholstered"
};

function normalizeValue(value = "") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, "-");
  return SYNONYMS[normalized] || normalized || "none";
}

function normalizeSeatUpholstery(value = "") {
  const normalized = normalizeValue(value);
  if (normalized.includes("leather")) return "leather";
  if (normalized.includes("fabric") || normalized.includes("textile")) return "fabric";
  if (normalized.includes("velvet")) return "velvet";
  if (normalized.includes("wood")) return "wood";
  if (normalized.includes("metal")) return "metal";
  return "none";
}

function normalizeShellMaterial(value = "") {
  const normalized = normalizeValue(value);
  if (normalized.includes("upholster")) return "upholstered";
  if (normalized.includes("wood")) return "wood";
  if (normalized.includes("metal")) return "metal";
  if (normalized.includes("plastic") || normalized.includes("poly")) return "plastic";
  if (normalized.includes("wicker") || normalized.includes("woven") || normalized.includes("rattan")) return "wicker";
  return "none";
}

function normalizeShellBaseFinish(value = "") {
  const normalized = normalizeValue(value);
  if (normalized === "chrome") return "chrome";
  if (normalized.includes("polished")) return "polished-metal";
  if (normalized.includes("paint") || normalized.includes("enamel")) return "painted-metal";
  if (normalized.includes("stain")) return "wood-stain";
  if (normalized.includes("natural-wood") || normalized.includes("wood")) return "natural-wood";
  return "none";
}

function normalizeBackHeight(value = "") {
  const normalized = normalizeValue(value);
  if (["low", "mid", "high"].includes(normalized)) {
    return normalized;
  }
  return "none";
}

function inferBaseTypeFromText(text = "") {
  const normalized = String(text || "").toLowerCase();
  if (!normalized) return "none";
  if (/\bcantilever\b/.test(normalized)) return "cantilever";
  if (/\bsled\b/.test(normalized)) return "sled";
  if (/\bpedestal\b/.test(normalized)) return "pedestal";
  if (/\bpanel\b/.test(normalized)) return "panel";
  if (/\bbench\b/.test(normalized)) return "bench-leg";
  if (/\bfour\b.*\blegs?\b|\b4\b.*\blegs?\b|\bangled legs?\b|\bmetal legs?\b|\bslender legs?\b/.test(normalized)) {
    return "four-leg";
  }
  return "none";
}

function inferLegAngleFromText(text = "") {
  const normalized = String(text || "").toLowerCase();
  if (!normalized) return "none";
  if (/\bsplayed\b/.test(normalized)) return "splayed";
  if (/\bangled outward\b|\boutward\b/.test(normalized)) return "angled-out";
  if (/\bangled inward\b|\binward\b/.test(normalized)) return "angled-in";
  if (/\bangled\b/.test(normalized)) return "angled-out";
  if (/\bstraight\b/.test(normalized)) return "straight";
  return "none";
}

function criticalFieldsFromAnalysis(analysis = {}) {
  const imageTraits = analysis.image_traits || {};
  const stage2 = analysis.stage2 || {};
  const textPool = [
    stage2.structure_type,
    stage2.visual_summary,
    ...(stage2.distinctive_elements || []),
    ...(analysis.raw_visual_highlights || [])
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" | ");

  return {
    seat_upholstery: normalizeSeatUpholstery(imageTraits.seat_upholstery),
    shell_material: normalizeShellMaterial(imageTraits.shell_material),
    shell_base_finish: normalizeShellBaseFinish(imageTraits.shell_base_finish),
    base_type: inferBaseTypeFromText(textPool),
    leg_angle: inferLegAngleFromText(textPool),
    back_height: normalizeBackHeight(imageTraits.back_height)
  };
}

function loadEnvLine(line = "") {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return;
  }
  const separatorIndex = trimmed.indexOf("=");
  if (separatorIndex === -1) {
    return;
  }
  const key = trimmed.slice(0, separatorIndex).trim();
  let value = trimmed.slice(separatorIndex + 1).trim();
  if (!key || process.env[key]) {
    return;
  }
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  process.env[key] = value;
}

async function loadLocalEnv() {
  for (const fileName of [".env.local", ".env"]) {
    try {
      const envPath = path.resolve(process.cwd(), fileName);
      const content = await fs.readFile(envPath, "utf8");
      content.split(/\r?\n/).forEach(loadEnvLine);
    } catch {
      continue;
    }
  }
}

async function fetchImage(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image (${response.status}) for ${url}`);
  }
  const mimeType = String(response.headers.get("content-type") || "image/jpeg").split(";")[0] || "image/jpeg";
  const bytes = Buffer.from(await response.arrayBuffer());
  return { bytes, mimeType };
}

async function imageSize(filePath) {
  const { stdout } = await execFileAsync("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", filePath]);
  const width = Number((stdout.match(/pixelWidth:\s*(\d+)/) || [])[1] || 0);
  const height = Number((stdout.match(/pixelHeight:\s*(\d+)/) || [])[1] || 0);
  return { width, height };
}

async function resizeImage(sourcePath, outputPath, longestSide) {
  await fs.copyFile(sourcePath, outputPath);
  await execFileAsync("/usr/bin/sips", ["-Z", String(longestSide), outputPath]);
  return imageSize(outputPath);
}

function toDataUrl(bytes, mimeType = "image/jpeg") {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}

async function extractCriticalFields(imageBytes, mimeType, fileName) {
  const analysis = await analyzeInspirationImage(toDataUrl(imageBytes, mimeType), {
    provider: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    visionModel: process.env.VISION_MODEL,
    fileName
  });
  return criticalFieldsFromAnalysis(analysis);
}

async function runStep(imageBytes, mimeType, fileName) {
  const results = [];
  for (let index = 0; index < RUNS_PER_STEP; index += 1) {
    results.push(await extractCriticalFields(imageBytes, mimeType, fileName));
  }
  return results;
}

function majorityVote(runs = []) {
  if (!runs.length) {
    return {};
  }
  const keys = MATCH_FIELDS;
  return Object.fromEntries(
    keys.map((key) => {
      const values = runs.map((run) => run[key] || "none");
      const winner = [...new Set(values)].sort((a, b) => values.filter((value) => value === b).length - values.filter((value) => value === a).length)[0];
      return [key, winner];
    })
  );
}

function agreementRate(runs = []) {
  if (runs.length < 2) {
    return 1;
  }
  const keys = MATCH_FIELDS;
  const scores = [];
  for (let i = 0; i < runs.length; i += 1) {
    for (let j = i + 1; j < runs.length; j += 1) {
      const matches = keys.filter((key) => (runs[i][key] || "none") === (runs[j][key] || "none")).length;
      scores.push(matches / Math.max(keys.length, 1));
    }
  }
  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
}

function semanticDiffs(baseline = {}, candidate = {}) {
  const flips = [];
  for (const key of MATCH_FIELDS) {
    const before = baseline[key] || "none";
    const after = candidate[key] || "none";
    if (before === after) {
      continue;
    }
    flips.push(`${key}: "${before}" -> "${after}"`);
  }
  return flips;
}

function isUnstable(runs, baseline, agreement) {
  const consensus = majorityVote(runs);
  const flips = semanticDiffs(baseline, consensus);
  const unstable = flips.length > 0 || agreement < AGREE_FLOOR;
  return { unstable, flips, consensus };
}

function classifyRecovery(steps = []) {
  return steps.map((step, index) => {
    if (!step.unstable) {
      return { ...step, recovery_class: "stable" };
    }

    const nextOne = steps[index + 1];
    const nextTwo = steps[index + 2];
    const recoversSoon = [nextOne, nextTwo].some((candidate) => candidate && !candidate.unstable);
    return {
      ...step,
      recovery_class: recoversSoon ? "transient" : "persistent"
    };
  });
}

function usage() {
  console.log(`Usage:
  node scripts/test-resolution-cutoff.js [product_id ...]

Available product ids:
${Object.keys(DEFAULT_PRODUCTS).map((id) => `  - ${id}`).join("\n")}

Environment overrides:
  RESOLUTION_STEP_DOWN=0.9
  RESOLUTION_MIN_SHORT_SIDE=80
  RESOLUTION_RUNS_PER_STEP=3
  RESOLUTION_AGREE_FLOOR=0.8
`);
}

async function evaluateProduct(productId, config) {
  console.log(`\n${"=".repeat(60)}\n  ${productId}\n${"=".repeat(60)}`);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "resolution-cutoff-"));
  const sourcePath = path.join(tmpDir, `${productId}-source.jpg`);
  const { bytes, mimeType } = await fetchImage(config.url);
  await fs.writeFile(sourcePath, bytes);
  const sourceSize = await imageSize(sourcePath);

  console.log(`  Source: ${sourceSize.width}x${sourceSize.height}px\n`);

  const baselineRuns = await runStep(bytes, mimeType, `${productId}-baseline.jpg`);
  const baseline = majorityVote(baselineRuns);
  const baselineAgreement = agreementRate(baselineRuns);
  console.log(`  Baseline (agree=${baselineAgreement.toFixed(2)}):`);
  for (const key of [...MATCH_FIELDS, "shell_base_finish", "back_height"]) {
    const value = key in baseline ? baseline[key] : criticalFieldsFromAnalysis({ image_traits: {} })[key];
    if (key in baseline) {
      console.log(`    ${key.padEnd(22)} ${value}`);
    }
  }
  console.log(`  Baseline stability (${MATCH_FIELDS.join(", ")}): ${baselineAgreement.toFixed(2)}`);

  console.log(`\n  ${"Size".padStart(12)}  ${"Agree".padStart(6)}  ${"Flips".padStart(5)}  Status`);
  console.log(`  ${"-".repeat(72)}`);

  let scale = STEP_DOWN;
  let lastStable = sourceSize;
  const steps = [];

  while (true) {
    const resizedBytes = await (async () => {
      const outputPath = path.join(tmpDir, `${productId}-${Math.round(sourceSize.width * scale)}.jpg`);
      const size = await resizeImage(sourcePath, outputPath, Math.max(1, Math.round(Math.max(sourceSize.width, sourceSize.height) * scale)));
      return {
        bytes: await fs.readFile(outputPath),
        size
      };
    })();

    if (!resizedBytes) {
      break;
    }

    const { bytes: currentBytes, size } = resizedBytes;
    const runs = await runStep(currentBytes, "image/jpeg", `${productId}-${size.width}x${size.height}.jpg`);
    const agreement = agreementRate(runs);
    const { unstable, flips, consensus } = isUnstable(runs, baseline, agreement);
    steps.push({ size, agreement, unstable, flips, consensus });
    if (!unstable) {
      lastStable = size;
    }

    scale *= STEP_DOWN;
    if (Math.min(size.width, size.height) < MIN_SHORT_SIDE) {
      break;
    }
  }

  const classifiedSteps = classifyRecovery(steps);
  for (const step of classifiedSteps) {
    const status = !step.unstable
      ? "ok"
      : step.recovery_class === "transient"
        ? "transient drift"
        : "persistent drift";
    console.log(
      `  ${`${step.size.width}x${step.size.height}`.padStart(12)}  ${step.agreement.toFixed(2).padStart(6)}  ${String(step.flips.length || "—").padStart(5)}  ${status}`
    );
    if (step.flips.length) {
      for (const entry of step.flips) {
        console.log(`    flip: ${entry}`);
      }
      const nextStep = classifiedSteps.find((candidate) => candidate.size.width < step.size.width);
      if (nextStep) {
        console.log(`    next: ${nextStep.size.width}x${nextStep.size.height} -> ${nextStep.unstable ? "still drifting" : "recovered"}`);
      }
    }
  }

  const persistentDrift = classifiedSteps.find((step) => step.recovery_class === "persistent");
  const transientDrifts = classifiedSteps.filter((step) => step.recovery_class === "transient");
  const firstDrift = classifiedSteps.find((step) => step.unstable) || null;
  if (persistentDrift) {
    const priorStable = [...classifiedSteps]
      .filter((step) => !step.unstable && step.size.width > persistentDrift.size.width)
      .at(-1);
    if (priorStable) {
      lastStable = priorStable.size;
    }
  }

  const cutoff = Math.min(lastStable.width, lastStable.height);
  console.log(`\n  -> Matching-safe last stable : ${lastStable.width}x${lastStable.height} (short side ${cutoff}px)`);
  console.log(`  -> First drift observed      : ${firstDrift ? `${firstDrift.size.width}x${firstDrift.size.height}` : "none"}`);
  console.log(`  -> First persistent drift    : ${persistentDrift ? `${persistentDrift.size.width}x${persistentDrift.size.height}` : "none"}`);
  console.log(`  -> Transient drifts          : ${transientDrifts.length ? transientDrifts.map((step) => `${step.size.width}x${step.size.height}`).join(", ") : "none"}`);
  console.log(`  -> Recommended matching-safe cutoff: ${cutoff}px short side`);

  return {
    product: productId,
    source: sourceSize,
    baseline_agreement: baselineAgreement,
    cutoff_px: cutoff,
    last_stable: lastStable,
    first_drift: firstDrift?.size || null,
    first_persistent_drift: persistentDrift?.size || null,
    transient_drifts: transientDrifts.map((step) => step.size),
    baseline,
    steps: classifiedSteps
  };
}

async function main() {
  await loadLocalEnv();
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required. Set it in env or .env.local.");
  }

  const requested = process.argv.slice(2);
  if (requested.includes("--help") || requested.includes("-h")) {
    usage();
    return;
  }

  const targets = requested.length
    ? requested.map((id) => {
        const config = DEFAULT_PRODUCTS[id];
        if (!config) {
          throw new Error(`Unknown product id: ${id}`);
        }
        return [id, config];
      })
    : Object.entries(DEFAULT_PRODUCTS);

  const results = [];
  for (const [productId, config] of targets) {
    results.push(await evaluateProduct(productId, config));
  }

  console.log(`\n\n${"=".repeat(60)}\n  SUMMARY\n${"=".repeat(60)}`);
  const cutoffs = [];
  for (const result of results) {
    const firstDrift = result.first_drift ? `${result.first_drift.width}x${result.first_drift.height}` : "none";
    console.log(`  ${result.product.padEnd(30)}  baseline=${result.baseline_agreement.toFixed(2)}  cutoff=${String(result.cutoff_px).padEnd(4)}px  first_drift=${firstDrift}`);
    cutoffs.push(result.cutoff_px);
  }

  if (cutoffs.length) {
    console.log(`\n  Pipeline-wide recommended minimum: ${Math.max(...cutoffs)}px short side`);
  }
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
