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

test("buildRoutingTypesConfig returns bootstrap visual_types when provided", () => {
  const merged = buildRoutingTypesConfig({
    visual_types: {
      default_type: "lounge_chair",
      types: {
        lounge_chair: { label: "Lounge Chair", fields: [] },
        conference: { label: "Conference", fields: [] },
        training: { label: "Training", fields: [] }
      }
    }
  });

  assert.equal(merged.default_type, "lounge_chair");
  assert.ok(merged.types.lounge_chair);
  assert.ok(merged.types.conference);
  assert.ok(merged.types.training);
});

test("isSupportedBrowseVisualType recognizes tables visual types", () => {
  const bootstrap = {
    visual_types: {
      default_type: "lounge_chair",
      types: {
        lounge_chair: { label: "Lounge Chair", fields: [] },
        conference: { label: "Conference", fields: [] },
        cafe_dining: { label: "Cafe/Dining", fields: [] }
      }
    }
  };
  assert.equal(isSupportedBrowseVisualType("conference", bootstrap), true);
  assert.equal(isSupportedBrowseVisualType("cafe_dining", bootstrap), true);
  assert.equal(isSupportedBrowseVisualType("unknown_category", bootstrap), false);
});

test("getVisualTypeOptions includes both seating and tables categories", () => {
  const options = getVisualTypeOptions({
    visual_types: {
      default_type: "lounge_chair",
      types: {
        lounge_chair: { label: "Lounge Chair", fields: [] },
        bench: { label: "Bench", fields: [] },
        conference: { label: "Conference", fields: [] },
        training: { label: "Training", fields: [] }
      }
    },
    visual_type_options: ["lounge_chair", "bench", "conference", "training"]
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
