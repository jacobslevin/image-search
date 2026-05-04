import test from "node:test";
import assert from "node:assert/strict";

import { loadSeatingTypesAdapter } from "../src/seating-types-adapter.js";
import { loadVisualTypesRegistry } from "../src/visual-types-registry.js";
import { buildBootstrapSchemaPayload } from "../src/bootstrap-visual-types.js";

test("/api/bootstrap schema payload includes tables visual_types alongside unchanged seating_types", () => {
  const seatingTypes = loadSeatingTypesAdapter();
  const registryApi = loadVisualTypesRegistry();
  const payload = buildBootstrapSchemaPayload({
    seatingTypesConfig: seatingTypes,
    registryApi
  });

  assert.deepEqual(payload.seating_types, seatingTypes);
  assert.ok(payload.visual_types.types.conference);
  assert.ok(payload.visual_types.types.occasional);
  assert.ok(payload.visual_types.types.cafe_dining);
  assert.ok(payload.visual_types.types.training);
  assert.ok(payload.visual_types.types.huddle_collaborative);
  assert.deepEqual(payload.legacy_aliases, registryApi.legacyAliases);
});

test("tables visual_types in bootstrap carry the full registry field lists", () => {
  const payload = buildBootstrapSchemaPayload();

  assert.deepEqual(
    payload.visual_types.types.conference.fields.map((field) => field.field),
    [
      "design_register",
      "base_type",
      "top_shape",
      "top_material",
      "base_visual_weight",
      "base_finish",
      "mobility",
      "top_thickness",
      "edge_profile",
      "power_data_integration"
    ]
  );

  assert.deepEqual(
    payload.visual_types.types.cafe_dining.fields.map((field) => field.field),
    [
      "design_register",
      "base_type",
      "top_shape",
      "top_material",
      "base_visual_weight",
      "base_finish",
      "mobility",
      "top_thickness",
      "edge_profile",
      "height_register"
    ]
  );
});

test("seating_category_options stay seating-only while visual_type_options include tables", () => {
  const payload = buildBootstrapSchemaPayload();

  assert.deepEqual(payload.seating_category_options, [
    "task_collab_chair",
    "lounge_chair",
    "stool",
    "guest_chair",
    "bench"
  ]);

  assert.ok(payload.visual_type_options.includes("conference"));
  assert.ok(payload.visual_type_options.includes("training"));
});
