import test from "node:test";
import assert from "node:assert/strict";

import {
  buildStage0FurnitureCountPrompt,
  resolveStage0RoutingContext
} from "../src/captioning.js";

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
  assert.match(faucetPrompt, /A seating product with an integrated or attached table/i);
});

test("Stage 0 furniture-count prompt becomes table-aware for tables family", () => {
  const tablesPrompt = buildStage0FurnitureCountPrompt(resolveStage0RoutingContext({ visual_type: "conference" }));
  assert.match(tablesPrompt, /The intended product family for this image is tables/i);
  assert.match(tablesPrompt, /Do not count accompanying chairs, stools, or other seating that merely support or surround the primary table/i);
  assert.match(tablesPrompt, /Count it as an additional furniture item only when a non-table furniture product is also substantially visible/i);
});
