#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");

const DEFAULT_ARTIFACT = path.join(rootDir, "tmp", "category-cap-policy-analysis.json");
const DEFAULT_OUTPUT = path.join(rootDir, "tmp", "cap-policy-savings-final.json");
const DEFAULT_COST = 0.009532;
const OUTLIER_IDS = new Set([
  "product_dp_13890803", // Pact Flex
  "product_dp_11831800", // Jax
  "product_dp_14107139", // Collette
  "product_dp_13884178"  // Nuez - Barstools
]);

const POLICY_CAPS = Object.freeze({
  "7/7/8": {
    task_collab_chair: 7,
    guest_chair: 7,
    lounge_chair: 8
  },
  "8/8/10": {
    task_collab_chair: 8,
    guest_chair: 8,
    lounge_chair: 10
  },
  "10/10/10": {
    task_collab_chair: 10,
    guest_chair: 10,
    lounge_chair: 10
  }
});

function roundNumber(value, digits = 4) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return null;
  }
  return Number(Number(value).toFixed(digits));
}

function quantile(values = [], percentile = 0.5) {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 1) {
    return sorted[0];
  }
  const position = (sorted.length - 1) * percentile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) {
    return sorted[lower];
  }
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function mean(values = []) {
  if (!values.length) {
    return null;
  }
  return values.reduce((total, value) => total + Number(value || 0), 0) / values.length;
}

function shouldCountRecord(record = {}) {
  return String(record.stage_0_result || "").trim().toLowerCase() === "product" && record.excluded !== true;
}

function getRecordSeatingType(record = {}) {
  return String(record.stage1?.seating_type || record.seating_type || "").trim() || "unknown";
}

function getProductName(record = {}) {
  return String(record.product_name || record.name || "").trim();
}

function dominantSeatingType(records = []) {
  const counts = new Map();
  for (const record of records) {
    const type = getRecordSeatingType(record);
    if (!counts.has(type)) {
      counts.set(type, { count: 0, firstIndex: Number(record.__ingestionIndex ?? Number.MAX_SAFE_INTEGER) });
    }
    const entry = counts.get(type);
    entry.count += 1;
    entry.firstIndex = Math.min(entry.firstIndex, Number(record.__ingestionIndex ?? Number.MAX_SAFE_INTEGER));
  }
  return [...counts.entries()]
    .sort((left, right) => right[1].count - left[1].count || left[1].firstIndex - right[1].firstIndex)[0]?.[0] || "unknown";
}

async function resolveSnapshotPath(artifactPath) {
  const artifact = JSON.parse(await fs.readFile(artifactPath, "utf8"));
  const snapshotPath = artifact?.upstream_snapshot?.snapshot_path || artifact?.upstream_snapshot?.source_path;
  return { artifact, snapshotPath };
}

function buildProductCounts(snapshot = {}) {
  const byProduct = new Map();

  (snapshot.images || []).forEach((record, ingestionIndex) => {
    const productId = String(record.product_id || "").trim();
    if (!productId) {
      return;
    }
    const enriched = { ...record, __ingestionIndex: ingestionIndex };
    if (!byProduct.has(productId)) {
      byProduct.set(productId, []);
    }
    byProduct.get(productId).push(enriched);
  });

  return [...byProduct.entries()].map(([productId, records]) => {
    const passingRecords = records.filter((record) => shouldCountRecord(record));
    return {
      product_id: productId,
      product_name: getProductName(records[0] || {}),
      seating_type: dominantSeatingType(passingRecords.length ? passingRecords : records),
      image_count: passingRecords.length
    };
  });
}

function buildDistributionStats(entries = []) {
  const values = entries.map((entry) => entry.image_count);
  return {
    n: entries.length,
    mean: roundNumber(mean(values), 1),
    median: roundNumber(quantile(values, 0.5), 1),
    p25: roundNumber(quantile(values, 0.25), 1),
    p75: roundNumber(quantile(values, 0.75), 1),
    p90: roundNumber(quantile(values, 0.9), 1)
  };
}

function getCoverageAtCap(segment = {}, cap) {
  const positions = segment?.positions || {};
  const exact = positions[String(cap)];
  if (exact) {
    return {
      mean: exact.mean_coverage,
      p10: exact.p10_coverage
    };
  }

  const available = Object.keys(positions).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!available.length) {
    return { mean: null, p10: null };
  }
  const last = available.filter((value) => value <= cap).pop() ?? available[available.length - 1];
  const point = positions[String(last)];
  return {
    mean: point?.mean_coverage ?? null,
    p10: point?.p10_coverage ?? null
  };
}

function buildCoverageSummaryForPolicy(artifact = {}, policyCaps = {}) {
  const byType = artifact.by_type || {};
  const weighted = [];

  for (const [type, segment] of Object.entries(byType)) {
    const cap = policyCaps[type];
    if (!cap) {
      continue;
    }
    const coverage = getCoverageAtCap(segment.coverage, cap);
    const weight = Number(segment.coverage?.n || 0);
    if (coverage.mean !== null) {
      weighted.push({
        type,
        weight,
        mean: coverage.mean,
        p10: coverage.p10
      });
    }
  }

  const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  const weightedMean = totalWeight
    ? weighted.reduce((sum, entry) => sum + entry.mean * entry.weight, 0) / totalWeight
    : null;
  const weightedP10 = totalWeight
    ? weighted.reduce((sum, entry) => sum + (entry.p10 ?? 0) * entry.weight, 0) / totalWeight
    : null;

  return {
    by_type: Object.fromEntries(weighted.map((entry) => [entry.type, {
      n: entry.weight,
      mean_coverage: roundNumber(entry.mean),
      worst_decile_coverage: roundNumber(entry.p10)
    }])),
    overall_weighted_mean_coverage: roundNumber(weightedMean),
    overall_weighted_worst_decile_coverage: roundNumber(weightedP10)
  };
}

function computePolicySavings(entries = [], policyName = "", policyCaps = {}, costPerImage = DEFAULT_COST, artifact = {}) {
  let skipped = 0;
  let processed = 0;
  const byType = {};

  for (const entry of entries) {
    const cap = policyCaps[entry.seating_type];
    const nextProcessed = cap ? Math.min(entry.image_count, cap) : entry.image_count;
    const nextSkipped = Math.max(0, entry.image_count - nextProcessed);

    processed += nextProcessed;
    skipped += nextSkipped;

    if (!byType[entry.seating_type]) {
      byType[entry.seating_type] = {
        image_total: 0,
        skipped_images: 0
      };
    }

    byType[entry.seating_type].image_total += entry.image_count;
    byType[entry.seating_type].skipped_images += nextSkipped;
  }

  const totalImages = processed + skipped;
  const coverage = buildCoverageSummaryForPolicy(artifact, policyCaps);

  return {
    policy: policyName,
    caps: policyCaps,
    skipped_images: skipped,
    processed_images: processed,
    total_images: totalImages,
    skip_rate: totalImages ? roundNumber(skipped / totalImages) : null,
    dollars_saved_per_run: roundNumber(skipped * costPerImage, 4),
    coverage_summary: coverage,
    by_type: Object.fromEntries(
      Object.entries(byType)
        .sort((left, right) => left[0].localeCompare(right[0]))
        .map(([type, stats]) => [type, {
          image_total: stats.image_total,
          skipped_images: stats.skipped_images,
          skip_rate_within_type: stats.image_total ? roundNumber(stats.skipped_images / stats.image_total) : null
        }])
    )
  };
}

function formatCell(value, width) {
  return String(value).padEnd(width);
}

async function main() {
  const artifactPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_ARTIFACT;
  const outputPath = process.argv[3] ? path.resolve(process.argv[3]) : DEFAULT_OUTPUT;
  const { artifact, snapshotPath } = await resolveSnapshotPath(artifactPath);

  if (!snapshotPath) {
    throw new Error("Could not resolve upstream snapshot path from artifact.");
  }

  const snapshot = JSON.parse(await fs.readFile(snapshotPath, "utf8"));
  const allEntries = buildProductCounts(snapshot);
  const filteredEntries = allEntries.filter((entry) => !OUTLIER_IDS.has(entry.product_id));

  const byType = new Map();
  for (const entry of filteredEntries) {
    if (!byType.has(entry.seating_type)) {
      byType.set(entry.seating_type, []);
    }
    byType.get(entry.seating_type).push(entry);
  }

  const distribution = {
    overall: buildDistributionStats(filteredEntries),
    by_type: Object.fromEntries(
      [...byType.entries()]
        .sort((left, right) => left[0].localeCompare(right[0]))
        .map(([type, entries]) => [type, buildDistributionStats(entries)])
    )
  };

  const totalImages = filteredEntries.reduce((sum, entry) => sum + entry.image_count, 0);
  const zeroPassProducts = filteredEntries.filter((entry) => entry.image_count === 0).length;
  const policies = Object.fromEntries(
    Object.entries(POLICY_CAPS).map(([name, caps]) => [
      name,
      computePolicySavings(filteredEntries, name, caps, DEFAULT_COST, artifact)
    ])
  );

  const output = {
    analysis_generated_at: new Date().toISOString(),
    source_snapshot: snapshotPath,
    outlier_exclusion_product_ids: [...OUTLIER_IDS],
    totals: {
      total_products: filteredEntries.length,
      total_stage0_passing_images: totalImages,
      zero_qualifying_products: zeroPassProducts
    },
    distribution,
    policies
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);

  console.log("After excluding 4 outlier products (>=30 images):");
  console.log(`  Total products: ${filteredEntries.length}`);
  console.log(`  Total stage-0-passing images: ${totalImages}`);
  console.log(`  Products with zero qualifying images: ${zeroPassProducts}`);
  console.log("");

  console.log("Updated distribution stats:");
  const distWidths = [18, 5, 6, 7, 5, 5, 5];
  console.log([
    formatCell("", distWidths[0]),
    formatCell("n", distWidths[1]),
    formatCell("mean", distWidths[2]),
    formatCell("median", distWidths[3]),
    formatCell("p25", distWidths[4]),
    formatCell("p75", distWidths[5]),
    formatCell("p90", distWidths[6])
  ].join("  "));
  const order = ["overall", "task_collab_chair", "guest_chair", "lounge_chair", "stool", "bench"];
  for (const type of order) {
    const stats = type === "overall" ? distribution.overall : distribution.by_type[type];
    if (!stats) continue;
    console.log([
      formatCell(type, distWidths[0]),
      formatCell(stats.n, distWidths[1]),
      formatCell(stats.mean, distWidths[2]),
      formatCell(stats.median, distWidths[3]),
      formatCell(stats.p25, distWidths[4]),
      formatCell(stats.p75, distWidths[5]),
      formatCell(stats.p90, distWidths[6])
    ].join("  "));
  }
  console.log("");

  console.log("Savings by policy:");
  const policyWidths = [12, 12, 12, 12];
  console.log([
    formatCell("", policyWidths[0]),
    formatCell("7/7/8", policyWidths[1]),
    formatCell("8/8/10", policyWidths[2]),
    formatCell("10/10/10", policyWidths[3])
  ].join("  "));
  const rows = [
    ["Skipped", "skipped_images", (value) => value],
    ["% of total", "skip_rate", (value) => value === null ? "" : `${roundNumber(value * 100, 1)}%`],
    ["$ saved/run", "dollars_saved_per_run", (value) => value === null ? "" : `$${roundNumber(value, 2)}`],
    ["Mean coverage", "overall_weighted_mean_coverage", (value, policy) => {
      const metric = policies[policy].coverage_summary.overall_weighted_mean_coverage;
      return metric === null ? "" : `${roundNumber(metric * 100, 1)}%`;
    }],
    ["Worst-decile", "overall_weighted_worst_decile_coverage", (value, policy) => {
      const metric = policies[policy].coverage_summary.overall_weighted_worst_decile_coverage;
      return metric === null ? "" : `${roundNumber(metric * 100, 1)}%`;
    }]
  ];
  for (const [label, key, formatter] of rows) {
    console.log([
      formatCell(label, policyWidths[0]),
      formatCell(formatter(policies["7/7/8"][key], "7/7/8"), policyWidths[1]),
      formatCell(formatter(policies["8/8/10"][key], "8/8/10"), policyWidths[2]),
      formatCell(formatter(policies["10/10/10"][key], "10/10/10"), policyWidths[3])
    ].join("  "));
  }
  console.log("");

  console.log("Per-category savings under 8/8/10:");
  for (const type of ["task_collab_chair", "guest_chair", "lounge_chair", "stool", "bench"]) {
    const stats = policies["8/8/10"].by_type[type] || { skipped_images: 0, skip_rate_within_type: 0 };
    console.log(`  ${type}: ${stats.skipped_images} images skipped (${roundNumber((stats.skip_rate_within_type || 0) * 100, 1)}% of category)`);
  }
  console.log("");
  console.log(`Wrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
