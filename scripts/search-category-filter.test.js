import test from "node:test";
import assert from "node:assert/strict";

import {
  filterSearchResultsByCategory,
  isIntentionallyExcludedProduct,
  isSearchRecordEligible,
  normalizeSearchCategoryFilters
} from "../src/search-category-filter.js";

test("normalizeSearchCategoryFilters accepts canonical keys and PixelSeek display labels only", () => {
  assert.deepEqual(
    normalizeSearchCategoryFilters(["stool", "Work Chairs", "bench", "stool"]),
    {
      normalized: ["stool", "task_collab_chair", "bench"],
      invalid: []
    }
  );

  assert.deepEqual(
    normalizeSearchCategoryFilters(["Fixed-height Stools"]),
    {
      normalized: [],
      invalid: ["Fixed-height Stools"]
    }
  );
});

test("filterSearchResultsByCategory uses union semantics across product images only", () => {
  const mixedTypeResult = {
    product_id: "fixture_mixed",
    matching_images: [
      { effective_classification: "product", seating_type: "stool" },
      { effective_classification: "product", seating_type: "bench" }
    ]
  };
  const sceneOnlyTypeResult = {
    product_id: "fixture_scene_only",
    matching_images: [
      { effective_classification: "scene", seating_type: "guest_chair" },
      { effective_classification: "product", seating_type: "" }
    ]
  };

  assert.deepEqual(
    filterSearchResultsByCategory([mixedTypeResult, sceneOnlyTypeResult], ["Stools"]).map((result) => result.product_id),
    ["fixture_mixed"]
  );
  assert.deepEqual(
    filterSearchResultsByCategory([mixedTypeResult, sceneOnlyTypeResult], ["Benches"]).map((result) => result.product_id),
    ["fixture_mixed"]
  );
  assert.deepEqual(
    filterSearchResultsByCategory([mixedTypeResult, sceneOnlyTypeResult], ["guest_chair"]).map((result) => result.product_id),
    []
  );
});

test("filterSearchResultsByCategory does not surface unspecified other_seating records", () => {
  const unspecifiedResult = {
    product_id: "fixture_unspecified",
    matching_images: [
      { effective_classification: "product", seating_type: "" },
      { effective_classification: "product", seating_type: "other_seating" }
    ]
  };

  assert.deepEqual(
    filterSearchResultsByCategory([unspecifiedResult], ["Lounge Seating"]),
    []
  );
});

test("excluded images do not contribute seating types to union matching", () => {
  const result = {
    product_id: "fixture_excluded_type_only",
    matching_images: [
      { effective_classification: "product", seating_type: "lounge_chair" },
      { effective_classification: "product", seating_type: "stool", excluded: true }
    ]
  };

  assert.deepEqual(
    filterSearchResultsByCategory([result], ["Stools"]),
    []
  );
});

test("intentionally excluded products are blocked in browse fixtures", () => {
  const product = {
    product_id: "fixture_excluded_product",
    b_level: ["Fixed-height Stools"]
  };
  const indexedImages = [
    {
      product_id: "fixture_excluded_product",
      b_level: ["Fixed-height Stools"],
      excluded: false,
      excluded_reason: "",
      effective_classification: "product",
      seating_type: "stool"
    }
  ];
  const decisions = {
    "Fixed-height Stools": {
      status: "intentionally_excluded"
    }
  };

  assert.equal(
    isIntentionallyExcludedProduct(product, indexedImages, { decisions }),
    true
  );
});

test("mixed products stay browse-visible when only one image is excluded", () => {
  const product = {
    product_id: "fixture_mixed_exclusion",
    b_level: ["Multi-use Guest Chairs"]
  };
  const indexedImages = [
    {
      product_id: "fixture_mixed_exclusion",
      b_level: ["Multi-use Guest Chairs"],
      excluded: false,
      excluded_reason: "",
      effective_classification: "product",
      seating_type: "guest_chair"
    },
    {
      product_id: "fixture_mixed_exclusion",
      b_level: ["Fixed-height Stools"],
      excluded: true,
      excluded_reason: "stage_0_v2_demotion",
      effective_classification: "scene",
      seating_type: "stool"
    }
  ];

  assert.equal(
    isIntentionallyExcludedProduct(product, indexedImages),
    false
  );
});

test("search fixtures reject stale non-excluded records for intentionally excluded groupings", () => {
  const record = {
    product_id: "fixture_excluded_record",
    b_level: ["Fixed-height Stools"],
    excluded: false,
    excluded_reason: "",
    effective_classification: "product",
    seating_type: "stool"
  };
  const decisions = {
    "Fixed-height Stools": {
      status: "intentionally_excluded"
    }
  };

  assert.equal(
    isSearchRecordEligible(record, { decisions }),
    false
  );
});
