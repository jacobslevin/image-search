import test from "node:test";
import assert from "node:assert/strict";

import { isInlineRefinementDetectabilityEligible } from "../public/inline-refinement-ui.js";

test("inline refinement accepts richer detectability vocabulary", () => {
  [
    "yes",
    "high",
    "medium",
    "low",
    "high_when_visible",
    "high_when_present",
    "medium_high",
    "low_medium"
  ].forEach((value) => {
    assert.equal(
      isInlineRefinementDetectabilityEligible(value),
      true,
      `${value} should be eligible`
    );
  });
});

test("inline refinement rejects explicitly ineligible detectability values", () => {
  ["no", "never", "", "   ", null, undefined].forEach((value) => {
    assert.equal(
      isInlineRefinementDetectabilityEligible(value),
      false,
      `${String(value)} should be ineligible`
    );
  });
});
