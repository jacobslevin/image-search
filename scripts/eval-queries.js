#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSearchQuery } from "../src/query-parser.js";
import { searchIndex } from "../src/search.js";

const scriptPath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(scriptPath), "..");
const evalPath = path.join(rootDir, "eval", "problem-queries.json");
const indexPath = path.join(rootDir, "data", "image-index.json");
const baseUrl = process.env.EVAL_BASE_URL || "http://127.0.0.1:3001";
const forceLocalMode = String(process.env.EVAL_LOCAL || "").toLowerCase() === "1";

function rankOf(results, name) {
  const index = results.findIndex((item) => item.name === name);
  return index >= 0 ? index + 1 : null;
}

function truncateScore(value) {
  return Number(Number(value || 0).toFixed(4));
}

async function run() {
  const raw = await fs.readFile(evalPath, "utf8");
  const data = JSON.parse(raw);
  const cases = Array.isArray(data.cases) ? data.cases : [];
  const index = await fs.readFile(indexPath, "utf8").then((content) => JSON.parse(content));
  const report = [];
  let passed = 0;
  let failed = 0;

  for (const testCase of cases) {
    const mode = testCase.mode || "balanced";
    const query = String(testCase.generated_query || "").trim();
    const sourceImageUrl = String(testCase.source_image_url || "").trim();
    const url =
      `${baseUrl}/api/search?q=${encodeURIComponent(query)}` +
      `&match_mode=${encodeURIComponent(mode)}` +
      `&source_image_url=${encodeURIComponent(sourceImageUrl)}`;

    let results = [];
    if (!forceLocalMode) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          const payload = await response.json();
          results = Array.isArray(payload.results) ? payload.results : [];
        } else {
          throw new Error(`Case ${testCase.id}: search request failed with ${response.status}`);
        }
      } catch {
        // Fall back to local pipeline when loopback HTTP is unavailable in sandboxed sessions.
        const parsed = await parseSearchQuery(query, index.brands || [], {
          apiKey: process.env.OPENAI_API_KEY,
          model: process.env.QUERY_MODEL
        });
        const searchResponse = await searchIndex({
          query,
          parsed,
          index,
          sourceImageUrl,
          apiKey: process.env.OPENAI_API_KEY
        });
        results = searchResponse.results;
      }
    } else {
      const parsed = await parseSearchQuery(query, index.brands || [], {
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.QUERY_MODEL
      });
      const searchResponse = await searchIndex({
        query,
        parsed,
        index,
        sourceImageUrl,
        apiKey: process.env.OPENAI_API_KEY
      });
      results = searchResponse.results;
    }

    const topOrderChecks = (testCase.expected_top_order || []).map((name, idx) => {
      const foundRank = rankOf(results, name);
      const pass = foundRank === idx + 1;
      return { name, expected_rank: idx + 1, actual_rank: foundRank, pass };
    });

    const abovePairChecks = (testCase.expected_above_pairs || []).map((pair) => {
      const higherRank = rankOf(results, pair.higher);
      const lowerRank = rankOf(results, pair.lower);
      const pass = higherRank !== null && (lowerRank === null || higherRank < lowerRank);
      return { ...pair, higher_rank: higherRank, lower_rank: lowerRank, pass };
    });

    const casePass = [...topOrderChecks, ...abovePairChecks].every((check) => check.pass);
    if (casePass) {
      passed += 1;
    } else {
      failed += 1;
    }

    report.push({
      id: testCase.id,
      mode,
      pass: casePass,
      top_order_checks: topOrderChecks,
      above_pair_checks: abovePairChecks,
      top_results: results.slice(0, 8).map((item) => ({
        name: item.name,
        score: truncateScore(item.score)
      }))
    });
  }

  console.log(JSON.stringify({ total: cases.length, passed, failed, report }, null, 2));
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
