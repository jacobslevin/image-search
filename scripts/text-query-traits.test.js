import test from "node:test";
import assert from "node:assert/strict";

import { extractTextQueryTraits } from "../src/captioning.js";

test("conference tables query produces table-shaped enum fields", async () => {
  const traits = await extractTextQueryTraits("conference tables with wood legs", {
    seatingType: "conference"
  });

  assert.equal(traits.visual_type, "conference");
  assert.equal(traits.family, "tables");
  assert.equal(traits.seating_type, "conference");
  assert.equal(traits.enum_fields.top_material, "Wood-look");
  assert.equal(traits.enum_fields.arm_option, undefined);
  assert.equal(traits.enum_fields.back_finish, undefined);
  assert.ok(
    [...traits.search_bullets.essential, ...traits.search_bullets.normal, ...traits.search_bullets.low]
      .includes("top material: Wood-look")
  );
});

test("small round cafe table query produces cafe_dining bullets", async () => {
  const traits = await extractTextQueryTraits("small round cafe table", {
    seatingType: "cafe_dining"
  });

  assert.equal(traits.visual_type, "cafe_dining");
  assert.equal(traits.family, "tables");
  assert.equal(traits.enum_fields.top_shape, "Round");
  assert.equal(traits.enum_fields.arm_option, undefined);
  assert.ok(
    [...traits.search_bullets.essential, ...traits.search_bullets.normal, ...traits.search_bullets.low]
      .includes("top shape: Round")
  );
});

test("training table with casters query produces mobility bullets", async () => {
  const traits = await extractTextQueryTraits("training table with casters", {
    seatingType: "training"
  });

  assert.equal(traits.visual_type, "training");
  assert.equal(traits.family, "tables");
  assert.equal(traits.enum_fields.mobility, "Casters");
  assert.equal(traits.enum_fields.back_finish, undefined);
  assert.ok(
    [...traits.search_bullets.essential, ...traits.search_bullets.normal, ...traits.search_bullets.low]
      .includes("mobility: Casters")
  );
});

test("seating query regression remains functionally equivalent", async () => {
  const traits = await extractTextQueryTraits("armless lounge chair", {
    seatingType: "lounge_chair"
  });

  assert.equal(traits.visual_type, "lounge_chair");
  assert.equal(traits.family, "seating");
  assert.equal(traits.seating_type, "lounge_chair");
  assert.equal(traits.enum_fields.arm_option, "Armless");
  assert.equal(traits.enum_fields.top_shape, undefined);
  assert.ok(
    [...traits.search_bullets.essential, ...traits.search_bullets.normal, ...traits.search_bullets.low]
      .includes("arm option: Armless")
  );
});
