import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  buildStructuredInspirationBullets,
  resolveCurateVisualType
} from "../public/curate-bullets.js";
import { buildBootstrapSchemaPayload } from "../src/bootstrap-visual-types.js";

const bootstrapPayload = buildBootstrapSchemaPayload();

function legacySeatingBullets(analysis = {}) {
  const stage2 = analysis?.stage2 && typeof analysis.stage2 === "object" ? analysis.stage2 : {};
  const imageTraits = analysis?.image_traits && typeof analysis.image_traits === "object" ? analysis.image_traits : {};
  const bullets = [];

  const isPresentBulletValue = (value) => {
    if (value === null || value === undefined) {
      return false;
    }
    const normalized = String(value).trim();
    return normalized && normalized.toLowerCase() !== "unknown";
  };

  const isSingleSeatConfiguration = (value) => String(value || "").trim().toLowerCase() === "single seat";
  const isPlaceholderSeatFabric = (value) => new Set(["fabric (specify category)", "col", "com", "unknown"]).has(
    String(value || "").trim().toLowerCase()
  );

  if (isPresentBulletValue(stage2.design_register)) bullets.push(stage2.design_register);
  if (Array.isArray(stage2.distinctive_elements)) {
    stage2.distinctive_elements.forEach((value) => {
      if (isPresentBulletValue(value)) bullets.push(value);
    });
  }
  if (isPresentBulletValue(imageTraits.back_style)) bullets.push(imageTraits.back_style);
  if (isPresentBulletValue(imageTraits.body_construction)) bullets.push(imageTraits.body_construction);
  if (isPresentBulletValue(imageTraits.arm_option) && String(imageTraits.arm_option).trim().toLowerCase() !== "none") bullets.push(imageTraits.arm_option);
  if (isPresentBulletValue(imageTraits.arm_configuration)) bullets.push(imageTraits.arm_configuration);
  if (isPresentBulletValue(imageTraits.base_type)) bullets.push(imageTraits.base_type);
  if (isPresentBulletValue(imageTraits.configuration) && !isSingleSeatConfiguration(imageTraits.configuration)) bullets.push(imageTraits.configuration);
  if (isPresentBulletValue(imageTraits.seat_fabric) && !isPlaceholderSeatFabric(imageTraits.seat_fabric)) bullets.push(imageTraits.seat_fabric);
  if (isPresentBulletValue(imageTraits.base_finish)) bullets.push(imageTraits.base_finish);
  if (isPresentBulletValue(imageTraits.seat_upholstery) && !isPlaceholderSeatFabric(imageTraits.seat_upholstery)) bullets.push(imageTraits.seat_upholstery);
  if (isPresentBulletValue(imageTraits.back_upholstery)) bullets.push(imageTraits.back_upholstery);

  return bullets;
}

function normalizePriorityBulletList(values = []) {
  const seen = new Set();
  const normalized = [];

  for (const value of values) {
    const bullet = String(value || "").trim();
    const key = bullet.toLowerCase();
    if (!bullet || seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(bullet);
  }

  return normalized;
}

test("seating bullet harvesting remains byte-equivalent to the legacy seating logic", () => {
  const analysis = {
    visual_type: "lounge_chair",
    stage2: {
      design_register: "Minimal",
      distinctive_elements: ["Low, rounded shell"]
    },
    image_traits: {
      back_style: "Low back",
      body_construction: "Molded shell",
      arm_option: "Two arms",
      arm_configuration: "Integrated arms",
      base_type: "4-leg",
      configuration: "Single seat",
      seat_fabric: "COL",
      base_finish: "Matte black",
      seat_upholstery: "Boucle",
      back_upholstery: "Boucle",
      design_register: "Minimal"
    }
  };

  assert.deepEqual(
    buildStructuredInspirationBullets(analysis, { bootstrap: bootstrapPayload }),
    normalizePriorityBulletList(legacySeatingBullets(analysis))
  );
});

test("tables bullet harvesting produces tables fields for conference records", () => {
  const analysis = {
    visual_type: "conference",
    stage2: {
      design_register: "Minimal",
      distinctive_elements: ["Boat-shaped top"]
    },
    image_traits: {
      base_type: "Panel-slab",
      top_shape: "Rectangle",
      top_material: "Wood-look",
      base_visual_weight: "Heavy/grounded",
      base_finish: "colored",
      mobility: "Non-mobile",
      top_thickness: "Standard",
      edge_profile: "Square",
      power_data_integration: "Present"
    }
  };

  assert.deepEqual(
    buildStructuredInspirationBullets(analysis, { bootstrap: bootstrapPayload }),
    [
      "Minimal",
      "Boat-shaped top",
      "Panel-slab",
      "Rectangle",
      "Wood-look",
      "Heavy/grounded",
      "colored",
      "Present",
      "Non-mobile",
      "Standard",
      "Square"
    ]
  );
});

test("tables bullet harvesting respects conditional trait scope by sub-category", () => {
  const cafeDining = buildStructuredInspirationBullets({
    visual_type: "cafe_dining",
    stage2: { design_register: "Minimal" },
    image_traits: {
      base_type: "4-leg",
      top_shape: "Round",
      top_material: "Wood-look",
      base_visual_weight: "Light/airy",
      base_finish: "matte_black",
      mobility: "Non-mobile",
      top_thickness: "Thin",
      edge_profile: "Square",
      height_register: "Sitting",
      power_data_integration: "Present"
    }
  }, { bootstrap: bootstrapPayload });

  const training = buildStructuredInspirationBullets({
    visual_type: "training",
    stage2: { design_register: "Utilitarian" },
    image_traits: {
      base_type: "T-leg",
      top_shape: "Rectangle",
      top_material: "Wood-look",
      base_visual_weight: "Light/airy",
      base_finish: "brushed_nickel_stainless",
      mobility: "Casters",
      top_thickness: "Thin",
      edge_profile: "Square",
      height_register: "Sitting",
      power_data_integration: "Not visible"
    }
  }, { bootstrap: bootstrapPayload });

  assert.ok(cafeDining.includes("Sitting"));
  assert.ok(!cafeDining.includes("Present"));
  assert.ok(training.includes("Sitting"));
  assert.ok(training.includes("Not visible"));
});

test("resolveCurateVisualType prefers canonical visual_type and falls back to legacy seatingType override", () => {
  assert.equal(
    resolveCurateVisualType({ visual_type: "training" }, { seatingType: "conference" }),
    "training"
  );
  assert.equal(
    resolveCurateVisualType({}, { seatingType: "conference" }),
    "conference"
  );
});

test("composeQueryForBullets in curate.js resolves visual_type generically without hardcoded seating default", () => {
  const curateSource = fs.readFileSync(new URL("../public/curate.js", import.meta.url), "utf8");
  assert.match(curateSource, /const resolvedVisualType = resolveCurateVisualType\(state\.currentImageAnalysis, options\);/);
  assert.match(curateSource, /visual_type: resolvedVisualType/);
  assert.doesNotMatch(curateSource, /getPayloadVisualType\(state\.currentImageAnalysis\) \|\| "seating"/);
});
