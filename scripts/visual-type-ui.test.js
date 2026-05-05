import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRoutingTypesConfig,
  formatVisualTypeLabel,
  groupVisualTypeOptionsByFamily,
  getVisualTypeOptions,
  isSupportedBrowseVisualType,
  resolveStoredVisualType
} from "../public/visual-type-ui.js";

test("formatVisualTypeLabel preserves legacy seating labels and adds tables labels", () => {
  assert.equal(formatVisualTypeLabel("lounge_chair"), "Lounge Seating");
  assert.equal(formatVisualTypeLabel("conference"), "Conference Tables");
  assert.equal(formatVisualTypeLabel("cafe_dining"), "Cafe/Dining Tables");
});

test("buildRoutingTypesConfig returns bootstrap visual_types when provided", () => {
  const merged = buildRoutingTypesConfig({
    visual_types: {
      default_type: "lounge_chair",
      types: {
        lounge_chair: { label: "Lounge Chair", fields: [] },
        conference: { label: "Conference Tables", fields: [] },
        training: { label: "Training Tables", fields: [] }
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
        conference: { label: "Conference Tables", fields: [] },
        cafe_dining: { label: "Cafe/Dining Tables", fields: [] }
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
        conference: { label: "Conference Tables", fields: [] },
        training: { label: "Training Tables", fields: [] }
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

test("groupVisualTypeOptionsByFamily groups filtered clarification options hierarchically", () => {
  const bootstrap = {
    visual_types: {
      default_type: "lounge_chair",
      types: {
        lounge_chair: { label: "Lounge Seating", fields: [] },
        guest_chair: { label: "Multi-Use / Guest Chairs", fields: [] },
        conference: { label: "Conference Tables", fields: [] },
        kitchen_faucet: { label: "Kitchen Faucets", fields: [] }
      }
    },
    visual_type_family_map: {
      lounge_chair: "seating",
      guest_chair: "seating",
      conference: "tables",
      kitchen_faucet: "faucets"
    },
    visual_type_family_labels: {
      seating: "Seating",
      tables: "Tables",
      faucets: "Faucets"
    }
  };

  const groups = groupVisualTypeOptionsByFamily(["conference", "guest_chair", "lounge_chair"], bootstrap);

  assert.deepEqual(groups, [
    {
      family: "tables",
      label: "Tables",
      options: [
        { value: "conference", label: "Conference Tables" }
      ]
    },
    {
      family: "seating",
      label: "Seating",
      options: [
        { value: "lounge_chair", label: "Lounge Seating" },
        { value: "guest_chair", label: "Multi-Use / Guest Chairs" }
      ]
    }
  ]);
});
