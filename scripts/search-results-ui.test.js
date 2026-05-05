import test from "node:test";
import assert from "node:assert/strict";

import { shouldShowClearResultsButton } from "../public/search-results-ui.js";

test("clear results button is hidden on landing state", () => {
  assert.equal(
    shouldShowClearResultsButton({
      landingOnlyMode: true,
      visibleResultCount: 12
    }),
    false
  );
});

test("clear results button is hidden when there are no visible results", () => {
  assert.equal(
    shouldShowClearResultsButton({
      landingOnlyMode: false,
      visibleResultCount: 0
    }),
    false
  );
});

test("clear results button is shown when results are visible off the homepage", () => {
  assert.equal(
    shouldShowClearResultsButton({
      landingOnlyMode: false,
      visibleResultCount: 31
    }),
    true
  );
});
