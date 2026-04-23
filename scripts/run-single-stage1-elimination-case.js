#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

import { regenerateImageExtractionRecordWithExistingStage0 } from "../src/captioning.js";
import { DATA_DIR } from "../src/utils.js";

const envPath = path.resolve(".env.local");
const indexPath = path.join(DATA_DIR, "image-index.json");
const imageId = String(process.argv[2] || "").trim();

function parseEnv(content = "") {
  const env = {};
  for (const rawLine of String(content || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

async function loadLocalEnv(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    const parsed = parseEnv(content);
    for (const [key, value] of Object.entries(parsed)) {
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

if (!imageId) {
  throw new Error("Image id is required.");
}

await loadLocalEnv(envPath);
if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required.");
}

const index = JSON.parse(await fs.readFile(indexPath, "utf8"));
const record = (index.images || []).find((image) => image.image_id === imageId);
if (!record) {
  throw new Error(`Could not find image ${imageId}.`);
}

const startedAt = Date.now();
const regenerated = await regenerateImageExtractionRecordWithExistingStage0(record, record, {
  apiKey: process.env.OPENAI_API_KEY,
  visionModel: process.env.VISION_MODEL || "gpt-4.1",
  embeddingModel: process.env.EMBEDDING_MODEL || "text-embedding-3-small"
});

process.stdout.write(JSON.stringify({
  image_id: imageId,
  runtime_ms: Date.now() - startedAt,
  regenerated
}));
process.exit(0);
