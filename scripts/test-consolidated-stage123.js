#!/usr/bin/env node
import { generateCaption } from "../src/captioning.js";

const imageUrls = [
  "https://assets.ofs.com/s3fs-public/styles/max_1300x1300/public/2019-06/OFS_Cosima_v13_Chair_wr.jpg?itok=-9faKHX1",
  "https://www.haworth.com/content/dam/haworth-com/global/products-na/seating/lounge-chairs/buzzispark-lounge-chair/hero-carousel/buzzispark_lounge_3_4.png",
  "https://cdn.prod.website-files.com/60edd826130a2e787f6647ff/61e58bf7981d9935e68dac14_A-Bench_Photo%20Gallery_02-p-1080.jpeg"
];

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required.");
}

const results = [];

for (const imageUrl of imageUrls) {
  const generated = await generateCaption(
    {
      image_url: imageUrl,
      name: "Validation image",
      brand: "",
      category: ""
    },
    {
      provider: "openai",
      apiKey: process.env.OPENAI_API_KEY,
      visionModel: "gpt-4.1",
      extractionRuns: 3,
      precomputedImageDimensions: {
        width: 1300,
        height: 1300,
        shortSide: 1300
      }
    }
  );

  results.push({
    image_url: imageUrl,
    seating_type: generated.stage1?.seating_type || generated.seating_type,
    stage2: generated.stage2,
    stage3: {
      structured_caption: generated.structured_caption,
      raw_visual_highlights: generated.raw_visual_highlights,
      image_traits: generated.image_traits
    },
    field_confidence: generated.field_confidence,
    extraction_consensus: generated.extraction_consensus
  });
}

const average = results.reduce((acc, result) => {
  acc.prompt_tokens += Number(result.extraction_consensus?.total_usage?.prompt_tokens || 0);
  acc.completion_tokens += Number(result.extraction_consensus?.total_usage?.completion_tokens || 0);
  acc.total_tokens += Number(result.extraction_consensus?.total_usage?.total_tokens || 0);
  acc.estimated_cost_usd += Number(result.extraction_consensus?.total_usage?.estimated_cost_usd || 0);
  return acc;
}, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, estimated_cost_usd: 0 });

const divisor = results.length || 1;

console.log(JSON.stringify({
  images: results,
  average_tokens_per_image: {
    prompt_tokens: Number((average.prompt_tokens / divisor).toFixed(2)),
    completion_tokens: Number((average.completion_tokens / divisor).toFixed(2)),
    total_tokens: Number((average.total_tokens / divisor).toFixed(2)),
    estimated_cost_usd: Number((average.estimated_cost_usd / divisor).toFixed(6))
  }
}, null, 2));
