import test from "node:test";
import assert from "node:assert/strict";

import { detectCategoryScopeFromQuery } from "../public/category-scope.js";
import { resolveSearchVisualTypeRequest } from "../public/search-request-routing.js";

test("query 'conference tables' with categoryScopeMode all sends conference", () => {
  assert.deepEqual(
    resolveSearchVisualTypeRequest({
      requestedCategoryScopeMode: "all",
      explicitVisualType: "",
      inferredVisualTypeFromQuery: detectCategoryScopeFromQuery("conference tables")
    }),
    {
      effectiveCategoryScopeMode: "explicit",
      apiRequestedVisualType: "conference"
    }
  );
});

test("query 'lounge chair' with categoryScopeMode all sends lounge_chair", () => {
  assert.deepEqual(
    resolveSearchVisualTypeRequest({
      requestedCategoryScopeMode: "all",
      explicitVisualType: "",
      inferredVisualTypeFromQuery: detectCategoryScopeFromQuery("lounge chair")
    }),
    {
      effectiveCategoryScopeMode: "explicit",
      apiRequestedVisualType: "lounge_chair"
    }
  );
});

test("query without detectable category and categoryScopeMode all sends empty apiRequestedVisualType", () => {
  assert.deepEqual(
    resolveSearchVisualTypeRequest({
      requestedCategoryScopeMode: "all",
      explicitVisualType: "",
      inferredVisualTypeFromQuery: detectCategoryScopeFromQuery("show me something")
    }),
    {
      effectiveCategoryScopeMode: "all",
      apiRequestedVisualType: ""
    }
  );
});

test("user-selected explicit category wins over phrase detection", () => {
  assert.deepEqual(
    resolveSearchVisualTypeRequest({
      requestedCategoryScopeMode: "explicit",
      explicitVisualType: "lounge_chair",
      inferredVisualTypeFromQuery: detectCategoryScopeFromQuery("conference tables")
    }),
    {
      effectiveCategoryScopeMode: "explicit",
      apiRequestedVisualType: "lounge_chair"
    }
  );
});

test("clarification gate can fire for unscoped ambiguous searches because apiRequestedVisualType stays empty", () => {
  const { effectiveCategoryScopeMode, apiRequestedVisualType } = resolveSearchVisualTypeRequest({
    requestedCategoryScopeMode: "all",
    explicitVisualType: "",
    inferredVisualTypeFromQuery: detectCategoryScopeFromQuery("conference room")
  });

  const payload = { category_required: true };
  const shouldClarify = Boolean(
    payload.category_required &&
    effectiveCategoryScopeMode === "all" &&
    !apiRequestedVisualType
  );

  assert.equal(shouldClarify, true);
});
