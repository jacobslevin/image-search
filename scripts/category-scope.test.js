import test from "node:test";
import assert from "node:assert/strict";

import {
  buildResultsPageSearch,
  detectCategoryScopeFromQuery,
  getPrimaryCategoryScopeSelection,
  normalizeCategoryScopeSelection,
  stripCategoryScopeFromQuery,
  stripCategoryScopeFromSelectedBullets
} from "../public/category-scope.js";

test("normalizeCategoryScopeSelection keeps a single normalized category", () => {
  assert.deepEqual(
    normalizeCategoryScopeSelection(["Task_Chair", "stool"], { maxSelections: 1 }),
    ["task_collab_chair"]
  );
});

test("normalizeCategoryScopeSelection preserves the all sentinel", () => {
  assert.deepEqual(normalizeCategoryScopeSelection("all", { maxSelections: 1 }), ["all"]);
  assert.equal(getPrimaryCategoryScopeSelection(["all"]), "all");
});

test("stripCategoryScopeFromSelectedBullets removes legacy seating type bullets", () => {
  assert.deepEqual(
    stripCategoryScopeFromSelectedBullets({
      essential: ["Seating Type: stool", "Base Material: wood"],
      normal: ["Frame: metal"],
      low: ["seating_type: lounge_chair"]
    }),
    {
      essential: ["Base Material: wood"],
      normal: ["Frame: metal"],
      low: []
    }
  );
});

test("stripCategoryScopeFromSelectedBullets removes canonical visual_type bullets too", () => {
  assert.deepEqual(
    stripCategoryScopeFromSelectedBullets({
      essential: ["Visual Type: stool", "Base Material: wood"],
      normal: ["Frame: metal"],
      low: ["visual_type: lounge_chair"]
    }),
    {
      essential: ["Base Material: wood"],
      normal: ["Frame: metal"],
      low: []
    }
  );
});

test("buildResultsPageSearch serializes category scope and filters", () => {
  assert.equal(
    buildResultsPageSearch({
      query: "chrome sled base",
      categoryFilter: ["Lounge Seating", "Bench Seating"],
      categoryScope: ["all"],
      refreshAgeFilter: "1d"
    }),
    "q=chrome+sled+base&category=Lounge+Seating&category=Bench+Seating&refresh_age=1d"
  );
});

test("buildResultsPageSearch prefers visual_type for canonical URL state", () => {
  assert.equal(
    buildResultsPageSearch({
      query: "chrome sled base",
      categoryScope: ["lounge_chair"]
    }),
    "q=chrome+sled+base&visual_type=lounge_chair"
  );
});

test("stripCategoryScopeFromQuery removes inferred lounge category phrases", () => {
  assert.equal(
    stripCategoryScopeFromQuery("lounge seating with chrome bases", "lounge_chair"),
    "chrome bases"
  );
  assert.equal(
    stripCategoryScopeFromQuery("lounge chairs with concealed bases", "lounge_chair"),
    "concealed bases"
  );
});

test("detectCategoryScopeFromQuery recognizes table phrases across all five sub-categories", () => {
  assert.equal(detectCategoryScopeFromQuery("show me conference tables"), "conference");
  assert.equal(detectCategoryScopeFromQuery("I need a coffee table"), "occasional");
  assert.equal(detectCategoryScopeFromQuery("find a cafe table for a patio"), "cafe_dining");
  assert.equal(detectCategoryScopeFromQuery("looking for a flip-top training table"), "training");
  assert.equal(detectCategoryScopeFromQuery("need a team table for a project room"), "huddle_collaborative");
});
