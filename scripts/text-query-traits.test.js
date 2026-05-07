import test from "node:test";
import assert from "node:assert/strict";

import { extractTextQueryTraits, inferTextQueryCategory, validateTextQueryDisplayString } from "../src/captioning.js";

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
  assert.equal(traits.display_string, "");
});

test("validateTextQueryDisplayString accepts concise category-tagged strings", () => {
  assert.equal(
    validateTextQueryDisplayString("[CATEGORY], specifically sofas with concealed bases"),
    "[CATEGORY], specifically sofas with concealed bases"
  );
  assert.equal(
    validateTextQueryDisplayString(" [CATEGORY]   barstools "),
    "[CATEGORY] barstools"
  );
});

test("validateTextQueryDisplayString rejects malformed or JSON-looking output", () => {
  assert.equal(validateTextQueryDisplayString(""), "");
  assert.equal(validateTextQueryDisplayString("[CATEGORY]"), "");
  assert.equal(validateTextQueryDisplayString("lounge seating with wood arms"), "");
  assert.equal(validateTextQueryDisplayString("{\"display_string\":\"[CATEGORY] with wood arms\"}"), "");
  assert.equal(validateTextQueryDisplayString("```json {\"display_string\":\"[CATEGORY] with wood arms\"}```"), "");
  assert.equal(validateTextQueryDisplayString("[CATEGORY] [CATEGORY] with wood arms"), "");
});

test("inferTextQueryCategory resolves direct seating and tables phrases", async () => {
  const lounge = await inferTextQueryCategory("lounge chair");
  const conference = await inferTextQueryCategory("conference table");

  assert.equal(lounge.status, "resolved");
  assert.equal(lounge.category_key, "lounge_chair");
  assert.equal(conference.status, "resolved");
  assert.equal(conference.category_key, "conference");
});

test("inferTextQueryCategory returns clarification for ambiguous spatial queries", async () => {
  const conferenceRoom = await inferTextQueryCategory("conference room");
  const office = await inferTextQueryCategory("office");

  assert.equal(conferenceRoom.status, "category_required");
  assert.equal(office.status, "category_required");
  assert.ok(conferenceRoom.options.includes("conference"));
  assert.ok(conferenceRoom.options.includes("task_collab_chair"));
  assert.ok(conferenceRoom.options.includes("guest_chair"));
  assert.equal(conferenceRoom.options.includes("kitchen_faucet"), false);
  assert.equal(office.options.includes("bathroom_lavatory_faucet"), false);
});

test("inferTextQueryCategory filters clarification options to plausible families", async () => {
  const chair = await inferTextQueryCategory("chair");
  const table = await inferTextQueryCategory("table");
  const faucet = await inferTextQueryCategory("faucet");
  const kitchen = await inferTextQueryCategory("kitchen");

  assert.equal(chair.status, "category_required");
  assert.ok(chair.options.includes("lounge_chair"));
  assert.ok(chair.options.includes("guest_chair"));
  assert.equal(chair.options.includes("conference"), false);
  assert.equal(chair.options.includes("kitchen_faucet"), false);

  assert.equal(table.status, "category_required");
  assert.ok(table.options.includes("conference"));
  assert.ok(table.options.includes("training"));
  assert.equal(table.options.includes("lounge_chair"), false);
  assert.equal(table.options.includes("kitchen_faucet"), false);

  assert.equal(faucet.status, "category_required");
  assert.deepEqual(faucet.options, ["kitchen_faucet", "bathroom_lavatory_faucet"]);

  assert.equal(kitchen.status, "category_required");
  assert.ok(kitchen.options.includes("kitchen_faucet"));
  assert.ok(kitchen.options.includes("cafe_dining"));
  assert.ok(kitchen.options.includes("stool"));
});
