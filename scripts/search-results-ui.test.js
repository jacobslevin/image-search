import test from "node:test";
import assert from "node:assert/strict";

import { shouldShowResetSearchButton } from "../public/search-results-ui.js";

test("reset search button is hidden on landing state", () => {
  assert.equal(
    shouldShowResetSearchButton({
      landingOnlyMode: true,
      isBrowseMode: false,
      visibleResultCount: 12
    }),
    false
  );
});

test("reset search button is hidden in browse mode", () => {
  assert.equal(
    shouldShowResetSearchButton({
      landingOnlyMode: false,
      isBrowseMode: true,
      visibleResultCount: 31
    }),
    false
  );
});

test("reset search button is hidden when there are no visible results", () => {
  assert.equal(
    shouldShowResetSearchButton({
      landingOnlyMode: false,
      isBrowseMode: false,
      visibleResultCount: 0
    }),
    false
  );
});

test("reset search button is shown when results are visible off the homepage", () => {
  assert.equal(
    shouldShowResetSearchButton({
      landingOnlyMode: false,
      isBrowseMode: false,
      visibleResultCount: 31
    }),
    true
  );
});
