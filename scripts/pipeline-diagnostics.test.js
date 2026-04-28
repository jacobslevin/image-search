import test from "node:test";
import assert from "node:assert/strict";

import { buildPipelineDiagnostics } from "../src/pipeline-diagnostics.js";

test("pipeline diagnostics surfaces stale n/a plan_shape values as compliance violations", () => {
  const diagnostics = buildPipelineDiagnostics({
    images: [
      {
        product_id: "fixture_lounge",
        product_name: "Fixture Lounge",
        image_url: "https://example.com/lounge.jpg",
        effective_classification: "product",
        seating_type: "lounge_chair",
        enum_fields: {
          plan_shape: "n/a",
          configuration: "Single seat",
          arm_option: "Armless",
          back_height: "High",
          base_type: "4-leg",
          base_finish: "Natural wood",
          seat_finish: "Fabric",
          back_finish: "Matches seat",
          body_construction: "Upholstered",
          design_register: "Minimal",
          shape_character: "Soft / tapered"
        }
      }
    ],
    products: []
  });

  assert.equal(diagnostics.schema_compliance_violations.length, 1);
  assert.deepEqual(diagnostics.schema_compliance_violations[0], {
    product_id: "fixture_lounge",
    product_name: "Fixture Lounge",
    image_url: "https://example.com/lounge.jpg",
    category_key: "lounge_chair",
    field: "plan_shape",
    value: "n/a"
  });
});

test("pipeline diagnostics reports per-category image extraction failures from refresh diagnostics", () => {
  const diagnostics = buildPipelineDiagnostics({
    images: [
      {
        product_id: "fixture_task",
        product_name: "Fixture Task",
        image_url: "https://example.com/task.jpg",
        effective_classification: "product",
        seating_type: "task_collab_chair",
        enum_fields: {
          back_finish: "Mesh / net",
          back_profile: "Rounded / curved",
          arm_option: "Adjustable arms",
          base_type: "5-star with casters",
          base_finish: "Black",
          seat_finish: "Fabric",
          design_register: "Utilitarian"
        }
      }
    ],
    products: [
      {
        product_id: "fixture_task",
        product_name: "Fixture Task",
        refresh_diagnostics: {
          seating_type: "task_collab_chair",
          stage0_passing_count: 4,
          successful_extraction_count: 3,
          failed_image_count: 1,
          failed_images: [
            {
              image_id: "fixture_task_img_002",
              image_url: "https://example.com/task-failed.jpg",
              stage: "stage23",
              error: "Transient upstream failure"
            }
          ]
        }
      }
    ]
  });

  assert.equal(diagnostics.image_extraction_failures.length, 1);
  assert.deepEqual(diagnostics.image_extraction_failures[0], {
    product_id: "fixture_task",
    product_name: "Fixture Task",
    category_key: "task_collab_chair",
    failed_image_count: 1,
    stage0_passing_count: 4,
    successful_extraction_count: 3,
    failed_images: [
      {
        image_id: "fixture_task_img_002",
        image_url: "https://example.com/task-failed.jpg",
        stage: "stage23",
        error: "Transient upstream failure"
      }
    ]
  });

  const taskCategory = diagnostics.categories.find((entry) => entry.category_key === "task_collab_chair");
  assert.ok(taskCategory);
  assert.deepEqual(taskCategory.image_failures, {
    product_count: 1,
    failed_image_count: 1
  });
});

test("trait coverage ignores scene and detail rows in the denominator", () => {
  const diagnostics = buildPipelineDiagnostics({
    images: [
      {
        product_id: "fixture_guest",
        product_name: "Fixture Guest",
        image_url: "https://example.com/guest-product.jpg",
        stage_0_result: "product",
        effective_classification: "product",
        seating_type: "guest_chair",
        enum_fields: {
          base_type: "4-leg",
          base_finish: "Black",
          arm_option: "Armless",
          back_profile: "Rounded / curved",
          frame_openness: "Open / see-through",
          mobility: "Non-mobile",
          seat_finish: "Fabric",
          back_finish: "Fabric",
          design_register: "Minimal"
        }
      },
      {
        product_id: "fixture_guest",
        product_name: "Fixture Guest",
        image_url: "https://example.com/guest-scene.jpg",
        stage_0_result: "scene",
        effective_classification: "scene",
        seating_type: "guest_chair",
        enum_fields: {}
      },
      {
        product_id: "fixture_guest",
        product_name: "Fixture Guest",
        image_url: "https://example.com/guest-detail.jpg",
        stage_0_result: "product_detail",
        effective_classification: "product_detail",
        seating_type: "guest_chair",
        enum_fields: {}
      }
    ],
    products: []
  });

  const guestCategory = diagnostics.categories.find((entry) => entry.category_key === "guest_chair");
  assert.ok(guestCategory);
  const baseTypeTrait = guestCategory.trait_health.traits.find((trait) => trait.field === "base_type");
  assert.ok(baseTypeTrait);
  assert.equal(baseTypeTrait.total_count, 1);
  assert.equal(baseTypeTrait.populated_count, 1);
  assert.equal(baseTypeTrait.coverage_percent, 100);
  assert.equal(guestCategory.total_images, 3);
});

test("bench back_finish exposes a companion metric that excludes backless benches", () => {
  const diagnostics = buildPipelineDiagnostics({
    images: [
      {
        product_id: "fixture_bench_backless",
        product_name: "Fixture Backless Bench",
        image_url: "https://example.com/bench-backless.jpg",
        stage_0_result: "product",
        effective_classification: "product",
        seating_type: "bench",
        enum_fields: {
          configuration: "Custom width",
          frame_material: "Steel tube",
          base_finish: "Black",
          seat_finish: "unknown",
          back_height: "Backless",
          back_finish: "unknown",
          design_register: "Minimal"
        }
      },
      {
        product_id: "fixture_bench_backed",
        product_name: "Fixture Backed Bench",
        image_url: "https://example.com/bench-backed.jpg",
        stage_0_result: "product",
        effective_classification: "product",
        seating_type: "bench",
        enum_fields: {
          configuration: "Double seat",
          frame_material: "Steel tube",
          base_finish: "Black",
          seat_finish: "Fabric",
          back_height: "Full back",
          back_finish: "Upholstered",
          design_register: "Minimal"
        }
      }
    ],
    products: []
  });

  const benchCategory = diagnostics.categories.find((entry) => entry.category_key === "bench");
  assert.ok(benchCategory);
  const backFinishTrait = benchCategory.trait_health.traits.find((trait) => trait.field === "back_finish");
  assert.ok(backFinishTrait);
  assert.equal(backFinishTrait.total_count, 2);
  assert.equal(backFinishTrait.populated_count, 1);
  assert.equal(backFinishTrait.coverage_percent, 50);
  assert.deepEqual(backFinishTrait.supplemental_metrics, [
    {
      key: "bench_with_backs",
      label: "with backs",
      populated_count: 1,
      total_count: 1,
      coverage_rate: 1,
      coverage_percent: 100
    }
  ]);
  assert.equal(backFinishTrait.issue, false);
});

test("lounge companion metrics exclude integrated bases and ottomans where traits are structurally inapplicable", () => {
  const diagnostics = buildPipelineDiagnostics({
    images: [
      {
        product_id: "fixture_lounge_ottoman",
        product_name: "Fixture Ottoman",
        image_url: "https://example.com/lounge-ottoman.jpg",
        stage_0_result: "product",
        effective_classification: "product",
        seating_type: "lounge_chair",
        enum_fields: {
          arm_option: "Armless",
          back_finish: "unknown",
          back_height: "unknown",
          base_finish: "unknown",
          base_type: "Integrated base",
          body_construction: "Upholstered",
          configuration: "Ottoman",
          design_register: "Minimal",
          plan_shape: "Round / semicircular",
          seat_finish: "Fabric",
          shape_character: "Soft / tapered"
        }
      },
      {
        product_id: "fixture_lounge_chair",
        product_name: "Fixture Lounge Chair",
        image_url: "https://example.com/lounge-chair.jpg",
        stage_0_result: "product",
        effective_classification: "product",
        seating_type: "lounge_chair",
        enum_fields: {
          arm_option: "Integrated / sculpted",
          back_finish: "Matches seat",
          back_height: "High",
          base_finish: "Black",
          base_type: "4-leg",
          body_construction: "Upholstered",
          configuration: "Single seat",
          design_register: "Minimal",
          plan_shape: "Round / semicircular",
          seat_finish: "Fabric",
          shape_character: "Soft / tapered"
        }
      }
    ],
    products: []
  });

  const loungeCategory = diagnostics.categories.find((entry) => entry.category_key === "lounge_chair");
  assert.ok(loungeCategory);

  const baseFinishTrait = loungeCategory.trait_health.traits.find((trait) => trait.field === "base_finish");
  assert.ok(baseFinishTrait);
  assert.equal(baseFinishTrait.total_count, 2);
  assert.equal(baseFinishTrait.populated_count, 1);
  assert.equal(baseFinishTrait.coverage_percent, 50);
  assert.deepEqual(baseFinishTrait.supplemental_metrics, [
    {
      key: "lounge_with_discrete_bases",
      label: "with discrete bases",
      populated_count: 1,
      total_count: 1,
      coverage_rate: 1,
      coverage_percent: 100
    }
  ]);

  const backFinishTrait = loungeCategory.trait_health.traits.find((trait) => trait.field === "back_finish");
  assert.ok(backFinishTrait);
  assert.equal(backFinishTrait.total_count, 2);
  assert.equal(backFinishTrait.populated_count, 1);
  assert.equal(backFinishTrait.coverage_percent, 50);
  assert.deepEqual(backFinishTrait.supplemental_metrics, [
    {
      key: "lounge_with_backs",
      label: "with backs",
      populated_count: 1,
      total_count: 1,
      coverage_rate: 1,
      coverage_percent: 100
    }
  ]);

  const backHeightTrait = loungeCategory.trait_health.traits.find((trait) => trait.field === "back_height");
  assert.ok(backHeightTrait);
  assert.equal(backHeightTrait.total_count, 2);
  assert.equal(backHeightTrait.populated_count, 1);
  assert.equal(backHeightTrait.coverage_percent, 50);
  assert.deepEqual(backHeightTrait.supplemental_metrics, [
    {
      key: "lounge_with_backs",
      label: "with backs",
      populated_count: 1,
      total_count: 1,
      coverage_rate: 1,
      coverage_percent: 100
    }
  ]);
  assert.equal(baseFinishTrait.issue, false);
  assert.equal(backFinishTrait.issue, false);
  assert.equal(backHeightTrait.issue, false);
  assert.equal(loungeCategory.trait_health.healthy, true);
});
