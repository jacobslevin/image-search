import test from "node:test";
import assert from "node:assert/strict";

import {
  buildStage0CompletenessPrompt,
  buildStage0FurnitureCountPrompt,
  resolveCatalogVisualTypeKey,
  resolveStage0RoutingContext
} from "../src/captioning.js";
import { getPixelSeekType } from "../src/utils.js";

test("Stage 0 resolves seating routing context from explicit visual_type and legacy fallback", () => {
  assert.deepEqual(
    resolveStage0RoutingContext({ visual_type: "lounge_chair" }),
    {
      source_field: "visual_type",
      visual_type: "lounge_chair",
      family: "seating",
      label: "Lounge Chair",
      family_label: "Seating"
    }
  );

  assert.deepEqual(
    resolveStage0RoutingContext({ seating_type: "bench" }),
    {
      source_field: "seating_type",
      visual_type: "bench",
      family: "seating",
      label: "Bench",
      family_label: "Seating"
    }
  );
});

test("Stage 0 resolves tables routing context from explicit visual_type", () => {
  assert.deepEqual(
    resolveStage0RoutingContext({ visual_type: "conference" }),
    {
      source_field: "visual_type",
      visual_type: "conference",
      family: "tables",
      label: "Conference Tables",
      family_label: "Tables"
    }
  );
});

test("clean conference-table catalog records round-trip through grouping routing into Stage 0 tables context", () => {
  const catalogRecord = {
    b_level: ["Workplace"],
    c_level: ["Conference Tables"]
  };

  assert.equal(getPixelSeekType(catalogRecord, {}), "conference");
  assert.equal(resolveCatalogVisualTypeKey(getPixelSeekType(catalogRecord, {})), "conference");
  assert.deepEqual(
    resolveStage0RoutingContext(catalogRecord),
    {
      source_field: "visual_type",
      visual_type: "conference",
      family: "tables",
      label: "Conference Tables",
      family_label: "Tables"
    }
  );
});

test("clean faucet catalog records round-trip through grouping routing into Stage 0 faucets context", () => {
  const kitchenRecord = {
    b_level: ["Faucets"],
    c_level: ["Kitchen Faucets"]
  };
  const bathroomRecord = {
    b_level: ["Bathroom Faucets"],
    c_level: ["Faucets"]
  };

  assert.equal(getPixelSeekType(kitchenRecord, {}), "kitchen_faucet");
  assert.equal(resolveCatalogVisualTypeKey(getPixelSeekType(kitchenRecord, {})), "kitchen_faucet");
  assert.deepEqual(
    resolveStage0RoutingContext(kitchenRecord),
    {
      source_field: "visual_type",
      visual_type: "kitchen_faucet",
      family: "faucets",
      label: "Kitchen Faucet",
      family_label: "Faucets"
    }
  );

  assert.equal(getPixelSeekType(bathroomRecord, {}), "bathroom_lavatory_faucet");
  assert.equal(resolveCatalogVisualTypeKey(getPixelSeekType(bathroomRecord, {})), "bathroom_lavatory_faucet");
  assert.deepEqual(
    resolveStage0RoutingContext(bathroomRecord),
    {
      source_field: "visual_type",
      visual_type: "bathroom_lavatory_faucet",
      family: "faucets",
      label: "Bathroom Lavatory Faucet",
      family_label: "Faucets"
    }
  );
});

test("Stage 0 furniture-count prompt stays conservative for seating and faucets", () => {
  const seatingPrompt = buildStage0FurnitureCountPrompt(resolveStage0RoutingContext({ visual_type: "lounge_chair" }));
  assert.match(seatingPrompt, /A seating product with an integrated or attached table/i);
  assert.match(seatingPrompt, /Count it as a separate furniture item only when the table or worksurface stands on its own independent support structure/i);

  const faucetPrompt = buildStage0FurnitureCountPrompt({
    source_field: "visual_type",
    visual_type: "kitchen_faucet",
    family: "faucets",
    label: "Kitchen Faucet",
    family_label: "Faucets"
  });
  assert.match(faucetPrompt, /The intended product family for this image is faucets/i);
  assert.match(faucetPrompt, /A clean studio, cutout, or plain-background presentation of one faucet counts as 1/i);
  assert.match(faucetPrompt, /Environmental scene indicators for faucets include visible sink bowls, vanities, countertops, backsplashes/i);
});

test("Stage 0 furniture-count prompt becomes table-aware for tables family", () => {
  const tablesPrompt = buildStage0FurnitureCountPrompt(resolveStage0RoutingContext({ visual_type: "conference" }));
  assert.match(tablesPrompt, /The intended product family for this image is tables/i);
  assert.match(tablesPrompt, /If the image reads as a real environment or lifestyle scene, do NOT collapse it to 1 just because one table is dominant/i);
  assert.match(tablesPrompt, /Environmental scene indicators include architectural context such as walls, windows, ceilings, floors, outdoor views/i);
  assert.match(tablesPrompt, /In a conference room, cafe, restaurant, lounge, or other fully realized environment, count surrounding independent chairs as additional furniture pieces/i);
});

test("Stage 0 completeness prompt distinguishes environmental tables scenes while leaving seating unchanged", () => {
  const tablesPrompt = buildStage0CompletenessPrompt(resolveStage0RoutingContext({ visual_type: "conference" }));
  assert.match(tablesPrompt, /Assess the primary table product in this photo/i);
  assert.match(tablesPrompt, /\"environmental\" if the full table may be visible but the image reads as a fully realized room/i);
  assert.match(tablesPrompt, /Return only "full", "partial", or "environmental"/i);

  const seatingPrompt = buildStage0CompletenessPrompt(resolveStage0RoutingContext({ visual_type: "lounge_chair" }));
  assert.match(seatingPrompt, /Can you see the full silhouette of the furniture piece in this photo/i);
  assert.match(seatingPrompt, /Return "full" or "partial"/i);
  assert.doesNotMatch(seatingPrompt, /environmental/i);
});
