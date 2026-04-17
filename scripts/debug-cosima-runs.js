#!/usr/bin/env node
import { debugInspirationImageRuns } from "../src/captioning.js";

const imageUrl = "https://assets.ofs.com/s3fs-public/styles/max_1300x1300/public/2019-06/OFS_Cosima_v13_Chair_wr.jpg?itok=-9faKHX1";

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required.");
}

const result = await debugInspirationImageRuns(imageUrl, {
  provider: "openai",
  apiKey: process.env.OPENAI_API_KEY,
  visionModel: "gpt-4.1"
});

console.log(JSON.stringify(result, null, 2));
