import test from "node:test";
import assert from "node:assert/strict";

import { getPixelSeekType } from "../src/utils.js";

test("minimal exact table grouping mappings route to the expected PixelSeek labels", () => {
  const expectations = [
    {
      record: { b_level: ["Occasional Tables"] },
      expected: "Occasional"
    },
    {
      record: { b_level: ["Conference Tables"] },
      expected: "Conference"
    },
    {
      record: { b_level: ["Conference Tables", "Workplace"] },
      expected: "Conference"
    },
    {
      record: { b_level: ["Cafe Tables"] },
      expected: "Cafe/Dining"
    },
    {
      record: { b_level: ["Training Tables"] },
      expected: "Training"
    },
    {
      record: { b_level: ["Training Tables", "Workplace"] },
      expected: "Training"
    }
  ];

  for (const { record, expected } of expectations) {
    assert.equal(getPixelSeekType(record, {}), expected);
  }
});

test("representative seating grouping still routes the same way", () => {
  assert.equal(
    getPixelSeekType({ b_level: ["Multi-use Guest Chairs"] }, {}),
    "Multi-Use / Guest Chairs"
  );
});

test("mixed-tag table grouping remains SKIP", () => {
  assert.equal(
    getPixelSeekType({ b_level: ["Conference Tables", "Training Tables", "Workplace"] }, {}),
    "SKIP"
  );
});
