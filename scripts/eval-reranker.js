#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isRoomSceneVisualSummary, resolveQueryEmbedding, searchIndex } from "../src/search.js";
import { getImageIndexPath, writeJson } from "../src/utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const indexPath = getImageIndexPath();
const outputPath = path.join(rootDir, "scripts", "eval-results.json");
const envFiles = [
  path.join(rootDir, ".env.local"),
  path.join(rootDir, ".env")
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadLocalEnv() {
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

function rankOf(results, productId) {
  const index = results.findIndex((item) => item.product_id === productId);
  return index >= 0 ? index + 1 : results.length + 1;
}

function top10Summary(results) {
  return results.slice(0, 10).map((item) => ({
    product_id: item.product_id,
    product_name: item.name,
    brand: item.brand,
    score:
      typeof item.reranker_score === "number" ? item.reranker_score :
      typeof item.score === "number" ? item.score :
      typeof item.final_score === "number" ? item.final_score :
      typeof item.similarity === "number" ? item.similarity :
      null
  }));
}

function buildStats(results, field) {
  const ranks = results.map((result) => Number(result[field] || 0));
  const total = ranks.length || 1;
  const rank1 = ranks.filter((rank) => rank === 1).length;
  const rank1to3 = ranks.filter((rank) => rank >= 1 && rank <= 3).length;
  const avgRank = ranks.reduce((sum, rank) => sum + rank, 0) / total;

  return {
    rank_1: rank1,
    rank_1_to_3: rank1to3,
    avg_rank: Number(avgRank.toFixed(2))
  };
}

async function run() {
  await loadLocalEnv();

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required to run eval-reranker.");
  }

  const index = JSON.parse(await fs.readFile(indexPath, "utf8"));
  let skippedRoomScenes = 0;
  const products = (index.images || []).filter((record) =>
    Array.isArray(record.visual_summary_embedding) &&
    record.visual_summary_embedding.length &&
    String(record.visual_summary || "").trim()
  );
  const flaggedImages = (index.images || []).map((record) => ({
    ...record,
    is_room_scene: isRoomSceneVisualSummary(record.visual_summary || record.stage2?.visual_summary || "")
  }));
  index.images = flaggedImages;
  await writeJson(indexPath, index);
  const results = [];
  const total = products.length;
  let evaluatedCount = 0;

  for (const [productIndex, product] of products.entries()) {
    const query = String(product.visual_summary || "").trim();
    if (isRoomSceneVisualSummary(query)) {
      skippedRoomScenes += 1;
      console.log(`Skipping ${product.name} — room scene detected`);
      continue;
    }

    const queryEmbedding = await resolveQueryEmbedding({
      query,
      apiKey: process.env.OPENAI_API_KEY
    });

    const embeddingSearch = await searchIndex({
      query,
      parsed: {
        category: null,
        brand: null,
        visual_query: query,
        query_traits: null
      },
      index,
      queryEmbedding,
      apiKey: process.env.OPENAI_API_KEY,
      rerankerEnabled: false
    });

    const rerankerSearch = await searchIndex({
      query,
      parsed: {
        category: null,
        brand: null,
        visual_query: query,
        query_traits: null
      },
      index,
      queryEmbedding,
      apiKey: process.env.OPENAI_API_KEY,
      rerankerEnabled: true
    });

    const embeddingRank = rankOf(embeddingSearch.results, product.product_id);
    const rerankerRank = rankOf(rerankerSearch.results, product.product_id);
    const record = {
      product_id: product.product_id,
      product_name: product.name,
      brand: product.brand,
      visual_summary: query,
      embedding_rank: embeddingRank,
      reranker_rank: rerankerRank,
      embedding_top10: top10Summary(embeddingSearch.results),
      reranker_top10: top10Summary(rerankerSearch.results)
    };

    results.push(record);
    evaluatedCount += 1;

    console.log(
      `Evaluating ${productIndex + 1} of ${total}: ${product.name} — embedding rank: ${embeddingRank}, reranker rank: ${rerankerRank}`
    );

    if (productIndex < total - 1) {
      await sleep(500);
    }
  }

  const summary = {
    total,
    skipped_room_scenes: skippedRoomScenes,
    evaluated: evaluatedCount,
    embedding_only: buildStats(results, "embedding_rank"),
    with_reranker: buildStats(results, "reranker_rank")
  };

  await writeJson(outputPath, { summary, results });

  console.log("");
  console.log("Summary stats");
  console.log(JSON.stringify(summary, null, 2));
}

run().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
