import test from "node:test";
import assert from "node:assert/strict";

import { getPixelSeekType } from "../src/utils.js";

test("minimal exact table grouping mappings route to the expected canonical visual_type keys", () => {
  const expectations = [
    {
      record: { b_level: ["Occasional Tables"] },
      expected: "occasional"
    },
    {
      record: { b_level: ["Conference Tables"] },
      expected: "conference"
    },
    {
      record: { b_level: ["Conference Tables", "Workplace"] },
      expected: "conference"
    },
    {
      record: { b_level: ["Cafe Tables"] },
      expected: "cafe_dining"
    },
    {
      record: { b_level: ["Training Tables"] },
      expected: "training"
    },
    {
      record: { b_level: ["Training Tables", "Workplace"] },
      expected: "training"
    }
  ];

  for (const { record, expected } of expectations) {
    assert.equal(getPixelSeekType(record, {}), expected);
  }
});

test("representative seating grouping still routes the same way", () => {
  assert.equal(
    getPixelSeekType({ b_level: ["Multi-use Guest Chairs"] }, {}),
    "guest_chair"
  );
});

test("mixed-tag table grouping remains SKIP", () => {
  assert.equal(
    getPixelSeekType({ b_level: ["Conference Tables", "Training Tables", "Workplace"] }, {}),
    "SKIP"
  );
});
