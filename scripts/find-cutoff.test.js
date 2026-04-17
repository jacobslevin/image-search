import test from "node:test";
import assert from "node:assert/strict";

import { findCutoff } from "../public/result-cutoff.js";

test("findCutoff returns gap cutoff for tight top cluster then drop", () => {
  const scores = [5.06, 4.95, 3.84, 3.83, 3.81, 3.71, 2.81, 2.72, 2.71];
  assert.deepEqual(findCutoff(scores), { cutoff: 6, reason: "gap" });
});

test("findCutoff returns gap cutoff for wider strong cluster", () => {
  const scores = [5.09, 5.08, 4.95, 4.83, 4.83, 3.82, 3.82, 3.69, 2.74];
  assert.deepEqual(findCutoff(scores), { cutoff: 5, reason: "gap" });
});

test("findCutoff shows all results when there are too few", () => {
  assert.deepEqual(findCutoff([4.2, 3.9]), { cutoff: 2, reason: "too_few" });
});

test("findCutoff shows all results when scores are uniformly strong", () => {
  const scores = [5.0, 4.8, 4.4, 4.2];
  assert.deepEqual(findCutoff(scores), { cutoff: 4, reason: "uniform" });
});

test("findCutoff falls back to relative threshold on monotonic decline", () => {
  const scores = [10, 9, 8, 7, 6];
  assert.deepEqual(findCutoff(scores), { cutoff: 4, reason: "relative" });
});

test("findCutoff prefers the earlier index when qualifying gaps tie", () => {
  const scores = [10, 9.8, 9.6, 8.6, 7.6, 7.4];
  assert.deepEqual(findCutoff(scores), { cutoff: 3, reason: "gap" });
});

test("findCutoff handles an empty array", () => {
  assert.deepEqual(findCutoff([]), { cutoff: 0, reason: "too_few" });
});
