#!/usr/bin/env node
import { analyzeInspirationImage } from "../src/captioning.js";

function normalizeWhitespace(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function composeDeterministicQueryFromBullets(bullets = []) {
  const unique = [...new Set((bullets || []).map((item) => normalizeWhitespace(item).toLowerCase()).filter(Boolean))];
  if (!unique.length) return "";

  const type = unique.find((item) => /\b(chair|lounge chair|guest chair|task chair|stool|bench|sofa)\b/.test(item)) || "chair";
  const structural = unique.filter((item) => /\b(base|frame|back|arms?|seat|silhouette)\b/.test(item) && item !== type).slice(0, 3);
  const finish = unique.filter((item) => /\b(color|fabric|leather|mesh|wood|metal|upholstered)\b/.test(item)).slice(0, 2);

  const parts = [type];
  if (structural.length) parts.push(`with ${structural.join(", ")}`);
  if (finish.length) parts.push(`featuring ${finish.join(", ")}`);

  return parts.join(" ").replace(/\s+,/g, ",").replace(/\s+/g, " ").trim();
}

function canonicalSnapshot(analysis = {}) {
  return {
    seating_type: analysis.seating_type || "",
    image_traits: analysis.image_traits || {},
    spec_traits: analysis.spec_traits || {},
    merged_traits: analysis.merged_traits || {},
    trait_provenance: analysis.trait_provenance || {},
    visual_highlights: analysis.visual_highlights || []
  };
}

async function run() {
  const runs = [];
  const imageUrl = "https://content.designerpages.com/assets/81487729/thprdeamesloungechairandottomanloungeseatingfn.jpg";

  for (let i = 0; i < 5; i += 1) {
    const analysis = await analyzeInspirationImage(imageUrl, {
      provider: "demo",
      fileName: "stability-fixture.jpg",
      matchMode: "balanced"
    });

    const snapshot = canonicalSnapshot(analysis);
    const query = composeDeterministicQueryFromBullets(snapshot.visual_highlights);
    runs.push({ snapshot, query });
  }

  const baselineSnapshot = JSON.stringify(runs[0].snapshot);
  const baselineQuery = runs[0].query;

  const mismatchIndex = runs.findIndex((run) => JSON.stringify(run.snapshot) !== baselineSnapshot || run.query !== baselineQuery);
  if (mismatchIndex >= 0) {
    throw new Error(`Stability regression failed at run ${mismatchIndex + 1}.`);
  }

  console.log(JSON.stringify({
    runs: runs.length,
    stable: true,
    composed_query: baselineQuery,
    seating_type: runs[0].snapshot.seating_type
  }, null, 2));
}

run().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
