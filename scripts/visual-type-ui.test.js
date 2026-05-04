import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRoutingTypesConfig,
  formatVisualTypeLabel,
  getVisualTypeOptions,
  isSupportedBrowseVisualType,
  resolveStoredVisualType
} from "../public/visual-type-ui.js";

test("formatVisualTypeLabel preserves legacy seating labels and adds tables labels", () => {
  assert.equal(formatVisualTypeLabel("lounge_chair"), "Lounge Seating");
  assert.equal(formatVisualTypeLabel("conference"), "Conference");
  assert.equal(formatVisualTypeLabel("cafe_dining"), "Cafe/Dining");
});

test("buildRoutingTypesConfig merges tables fallback into seating-only bootstrap config", () => {
  const merged = buildRoutingTypesConfig({
    visual_types: {
      default_type: "lounge_chair",
      types: {
        lounge_chair: { label: "Lounge Chair", fields: [] }
      }
    }
  });

  assert.equal(merged.default_type, "lounge_chair");
  assert.ok(merged.types.lounge_chair);
  assert.ok(merged.types.conference);
  assert.ok(merged.types.training);
});

test("isSupportedBrowseVisualType recognizes tables visual types", () => {
  assert.equal(isSupportedBrowseVisualType("conference"), true);
  assert.equal(isSupportedBrowseVisualType("cafe_dining"), true);
  assert.equal(isSupportedBrowseVisualType("unknown_category"), false);
});

test("getVisualTypeOptions includes both seating and tables categories", () => {
  const options = getVisualTypeOptions({
    visual_types: {
      default_type: "lounge_chair",
      types: {
        lounge_chair: { label: "Lounge Chair", fields: [] },
        bench: { label: "Bench", fields: [] }
      }
    },
    visual_type_options: ["lounge_chair", "bench"]
  });

  assert.ok(options.includes("conference"));
  assert.ok(options.includes("training"));
  assert.ok(options.includes("lounge_chair"));
});

test("resolveStoredVisualType migrates legacy seating-named state and prefers canonical state", () => {
  assert.equal(resolveStoredVisualType({ currentSeatingType: "conference" }), "conference");
  assert.equal(
    resolveStoredVisualType({ currentVisualType: "training", currentSeatingType: "conference" }),
    "training"
  );
});
