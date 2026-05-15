import test from "node:test";
import assert from "node:assert/strict";

import {
  computeTraitBoost,
  getFieldPriority,
  getTypeFields,
  searchIndex
} from "../src/search.js";

test("getTypeFields for conference includes power_data_integration and excludes height_register", () => {
  const fieldNames = getTypeFields("conference").map((field) => field.field);

  assert.ok(fieldNames.includes("design_register"));
  assert.ok(fieldNames.includes("base_type"));
  assert.ok(fieldNames.includes("power_data_integration"));
  assert.ok(!fieldNames.includes("height_register"));
});

test("getTypeFields for cafe_dining includes height_register and excludes power_data_integration", () => {
  const fieldNames = getTypeFields("cafe_dining").map((field) => field.field);

  assert.ok(fieldNames.includes("design_register"));
  assert.ok(fieldNames.includes("base_type"));
  assert.ok(fieldNames.includes("height_register"));
  assert.ok(!fieldNames.includes("power_data_integration"));
});

test("getFieldPriority returns registry-backed priorities for tables fields", () => {
  assert.equal(getFieldPriority("conference", "base_type"), "normal");
  assert.equal(getFieldPriority("conference", "base_visual_weight"), "high");
  assert.equal(getFieldPriority("conference", "top_shape"), "high");
  assert.equal(getFieldPriority("conference", "base_finish"), "low");
  assert.equal(getFieldPriority("conference", "mobility"), "low");
});

test("tables trait contributions use table fields rather than seating fields", async () => {
  const index = {
    products: [
      {
        product_id: "table_1",
        product_name: "Training Table",
        image_urls: ["https://example.com/table-training.jpg"]
      }
    ],
    images: [
      {
        image_id: "img_1",
        product_id: "table_1",
        image_url: "https://example.com/table-training.jpg",
        brand: "Test",
        stage_0_result: "product",
        effective_classification: "product",
        visual_type: "training",
        seating_type: "training",
        confidence_tier: "high",
        search_text_embedding: [1, 0],
        visual_summary_embedding: [1, 0],
        enum_fields: {
          design_register: "Utilitarian",
          base_type: "T-leg",
          top_shape: "Rectangle",
          top_material: "Wood-look",
          base_visual_weight: "Light/airy",
          base_finish: "Brushed nickel / stainless",
          mobility: "Casters",
          top_thickness: "Thin",
          edge_profile: "Square",
          height_register: "Sitting",
          power_data_integration: "Present"
        },
        image_traits: {
          design_register: "Utilitarian",
          base_type: "T-leg",
          top_shape: "Rectangle",
          top_material: "Wood-look",
          base_visual_weight: "Light/airy",
          base_finish: "Brushed nickel / stainless",
          mobility: "Casters",
          top_thickness: "Thin",
          edge_profile: "Square",
          height_register: "Sitting",
          power_data_integration: "Present"
        },
        field_confidence: {},
        free_text: {
          visual_summary: "Training table with a rectangular top and T-leg base on casters."
        },
        structured_caption: "Training table with a rectangular top and T-leg base on casters.",
        visual_summary: "Training table with a rectangular top and T-leg base on casters.",
        stage1: {
          result: "product",
          visual_type: "training",
          seating_type: "training"
        },
        stage2: {
          visual_summary: "Training table with a rectangular top and T-leg base on casters."
        }
      }
    ]
  };

  const results = await searchIndex({
    query: "mobile training table",
    parsed: { visual_type: "training" },
    index,
    limit: 5,
    selectedBullets: [
      "Base: T-leg",
      "Top Shape: Rectangle",
      "Power Data Integration: Present",
      "Mobility: Casters"
    ],
    queryEmbedding: [1, 0],
    rerankerEnabled: false
  });

  assert.equal(results.results.length, 1);
  const hero = results.results[0].hero_image;
  assert.ok(hero);
  assert.deepEqual(Object.keys(hero.trait_contributions).sort(), [
    "base_type",
    "mobility",
    "power_data_integration",
    "top_shape"
  ]);
  assert.equal(hero.trait_contributions.base_type.state, "hit");
  assert.equal(hero.trait_contributions.power_data_integration.state, "hit");
  assert.equal(hero.trait_contributions.arm_option, undefined);
});

test("computeTraitBoost supports tables records directly", () => {
  const boost = computeTraitBoost(
    [
      "Base: T-leg",
      "Top Shape: Rectangle",
      "Power Data Integration: Present"
    ],
    {
      visual_type: "training",
      enum_fields: {
        base_type: "T-leg",
        top_shape: "Rectangle",
        power_data_integration: "Present"
      }
    }
  );

  assert.ok(boost.value > 0);
  assert.ok(boost.contributions.base_type);
  assert.ok(boost.contributions.top_shape);
  assert.ok(boost.contributions.power_data_integration);
});

test("computeTraitBoost uses registry priority defaults for table traits", () => {
  const boost = computeTraitBoost(
    [
      "Base: T-leg",
      "Top Material: Wood-look",
      "Base Finish: Matte black"
    ],
    {
      visual_type: "conference",
      enum_fields: {
        base_type: "T-leg",
        top_material: "Wood-look",
        base_finish: "Matte black"
      }
    }
  );

  assert.equal(boost.contributions.base_type.state, "hit");
  assert.equal(boost.contributions.top_material.state, "hit");
  assert.equal(boost.contributions.base_finish.state, "hit");
  assert.equal(boost.contributions.base_type.contribution, 0.1);
  assert.equal(boost.contributions.top_material.contribution, 0.1);
  assert.equal(boost.contributions.base_finish.contribution, 0.05);
  assert.equal(boost.bonus, 0);
});

test("computeTraitBoost softens table top-shape penalties within configured groups", () => {
  const groupedMiss = computeTraitBoost(
    ["Top Shape: Square"],
    {
      visual_type: "occasional",
      enum_fields: {
        top_shape: "Rectangle"
      }
    }
  );

  const fullMiss = computeTraitBoost(
    ["Top Shape: Oval"],
    {
      visual_type: "occasional",
      enum_fields: {
        top_shape: "Rectangle"
      }
    }
  );

  assert.equal(groupedMiss.contributions.top_shape.state, "near-miss");
  assert.equal(fullMiss.contributions.top_shape.state, "miss");
  assert.ok(groupedMiss.contributions.top_shape.contribution > fullMiss.contributions.top_shape.contribution);
});
