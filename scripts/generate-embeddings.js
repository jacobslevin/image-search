#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { embedTextWithOpenAi, readJson, writeJson } from "../src/utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const indexPath = path.join(process.cwd(), "data", "image-index.json");
const embeddingModel = "text-embedding-3-small";
const saveEvery = 10;

async function loadLocalEnv() {
  const envFiles = [
    path.join(rootDir, ".env.local"),
    path.join(rootDir, ".env")
  ];

  for (const envPath of envFiles) {
    let contents = "";
    try {
      contents = await fs.readFile(envPath, "utf8");
    } catch {
      continue;
    }

    for (const rawLine of contents.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }

      const separatorIndex = line.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) {
        continue;
      }

      let value = line.slice(separatorIndex + 1).trim();
      if (
        (value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      process.env[key] = value;
    }
  }
}

function getVisualSummary(record = {}) {
  return String(record.visual_summary || record.stage2?.visual_summary || "").trim();
}

await loadLocalEnv();

const index = await readJson(indexPath);
if (!index?.images?.length) {
  throw new Error(`No images found in ${indexPath}`);
}

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required.");
}

const pendingIndexes = index.images
  .map((record, recordIndex) => ({ record, recordIndex }))
  .filter(({ record }) => {
    const visualSummary = getVisualSummary(record);
    return visualSummary && (!Array.isArray(record.visual_summary_embedding) || !record.visual_summary_embedding.length);
  });

const total = pendingIndexes.length;
let completed = 0;

for (const { record, recordIndex } of pendingIndexes) {
  const visualSummary = getVisualSummary(record);
  const embedding = await embedTextWithOpenAi(visualSummary, {
    apiKey: process.env.OPENAI_API_KEY,
    model: embeddingModel
  });

  index.images[recordIndex] = {
    ...record,
    visual_summary_embedding: embedding,
    embedding_model_version: `openai:${embeddingModel}`
  };

  completed += 1;
  console.log(`Embedded ${completed} of ${total}: ${record.name || record.product_id || `record-${recordIndex + 1}`}`);

  if (completed % saveEvery === 0) {
    await writeJson(indexPath, index);
  }
}

await writeJson(indexPath, index);

const populated = index.images.filter((record) => Array.isArray(record.visual_summary_embedding) && record.visual_summary_embedding.length).length;
console.log(`Done. ${populated} records now have visual_summary_embedding.`);
