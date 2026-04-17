import fs from "node:fs/promises";

import { regenerateImageExtractionRecordWithExistingStage0 } from "../src/captioning.js";

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required.");
  }

  const index = JSON.parse(await fs.readFile(new URL("../data/image-index.json", import.meta.url), "utf8"));
  const targets = new Set(["Arwyn", "Sachet Lounge"]);
  const rows = (index.images || []).filter((record) => targets.has(record.product_name) && record.stage_0_result === "product");
  const results = [];
  let totalCostUsd = 0;

  for (const existing of rows) {
    const imageRecord = {
      image_id: existing.image_id,
      image_url: existing.image_url,
      product_id: existing.product_id,
      product_name: existing.product_name || existing.name || "",
      name: existing.product_name || existing.name || "",
      brand: existing.brand || "",
      a_level: existing.a_level || [],
      b_level: existing.b_level || [],
      c_level: existing.c_level || [],
      stage_0_result: existing.stage_0_result
    };

    const next = await regenerateImageExtractionRecordWithExistingStage0(
      imageRecord,
      existing,
      {
        apiKey: process.env.OPENAI_API_KEY,
        provider: "openai",
        visionModel: "gpt-4.1"
      }
    );

    const runCostUsd = Number(
      ((next.cost?.runs || []).reduce((sum, run) => sum + Number(run?.estimated_cost_usd || 0), 0)).toFixed(6)
    );
    totalCostUsd += runCostUsd;

    results.push({
      product_name: next.product_name,
      image_url: next.image_url,
      seating_type: next.seating_type,
      enum_fields: next.enum_fields,
      field_confidence: next.field_confidence,
      run_cost_usd: runCostUsd
    });
  }

  console.log(JSON.stringify({
    total_images: results.length,
    total_cost_usd: Number(totalCostUsd.toFixed(6)),
    results
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
