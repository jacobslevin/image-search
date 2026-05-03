import test from "node:test";
import assert from "node:assert/strict";

import { generateCaption } from "../src/captioning.js";

const DEMO_OPTIONS = Object.freeze({
  provider: "demo",
  extractionRuns: 2,
  precomputedImageDimensions: {
    width: 1200,
    height: 900,
    shortSide: 900
  }
});

test("generateCaption stubs Stage 1 from caller-provided tables visual_type without running seating classification", async () => {
  const events = [];
  const caption = await generateCaption(
    {
      image_url: "https://content.designerpages.com/assets/82063931/Thumbfaceoff8803.png",
      name: "Thumb Faceoff",
      brand: "",
      category: "Cafe / Dining Tables"
    },
    {
      ...DEMO_OPTIONS,
      visual_type: "conference",
      progressCallback: (event = {}) => events.push(event)
    }
  );

  assert.equal(caption.stage1.result, "product");
  assert.equal(caption.stage1.visual_type, "conference");
  assert.equal(caption.stage1.family, "tables");
  assert.equal(caption.stage1.type_routing_source, "caller_provided");
  assert.equal(caption.visual_type, "conference");
  assert.equal(caption.family, "tables");
  assert.equal(caption.extraction_runs, 0);
  assert.deepEqual(caption.extraction_consensus.runs, []);
  assert.ok(events.some((event) => event.type === "stage1_stubbed" && event.visual_type === "conference"));
  assert.ok(!events.some((event) => event.type === "stage1_started"));
});

test("generateCaption with caller-provided seating visual_type still uses the seating Stage 1 path", async () => {
  const caption = await generateCaption(
    {
      image_url: "https://content.designerpages.com/assets/82667595/newriomultipurposechairarcticshellmomentumsilicacumulusfront.jpg",
      name: "Validation image",
      brand: "",
      category: "Lounge Seating"
    },
    {
      ...DEMO_OPTIONS,
      visual_type: "lounge_chair"
    }
  );

  assert.equal(caption.stage1.seating_type, caption.seating_type);
  assert.ok(caption.extraction_runs >= 2);
  assert.notEqual(caption.type_routing_source, "caller_provided");
});

test("generateCaption without visual_type input still runs the seating Stage 1 path", async () => {
  const caption = await generateCaption(
    {
      image_url: "https://content.designerpages.com/assets/81784115/FOApplauseFlipNestDOWNweb0_large.jpg",
      name: "Validation image",
      brand: "",
      category: "Stools"
    },
    DEMO_OPTIONS
  );

  assert.equal(caption.seating_type, "stool");
  assert.equal(caption.stage1.seating_type, "stool");
  assert.ok(caption.extraction_runs >= 2);
});
