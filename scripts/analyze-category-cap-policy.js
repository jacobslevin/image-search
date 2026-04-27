#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");

const DEFAULT_INPUT = path.join(rootDir, "tmp", "image-marginal-value-analysis-test.json");
const DEFAULT_POSITIONS = [3, 5, 7, 8, 10, 12];
const DEFAULT_PERCENTILES = [50, 75, 90, 95];
const DEFAULT_THRESHOLD = 0.9;
const DEFAULT_MIN_SUPPORT = 20;

function parseArgs(argv = []) {
  const args = {
    input: DEFAULT_INPUT,
    positions: [...DEFAULT_POSITIONS],
    coverageThreshold: DEFAULT_THRESHOLD,
    percentiles: [...DEFAULT_PERCENTILES],
    minSupport: DEFAULT_MIN_SUPPORT,
    perImageCost: null,
    jsonOut: "",
    csvOutDir: ""
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "").trim();
    const next = argv[i + 1];
    if (token === "--input" && next) {
      args.input = path.resolve(next);
      i += 1;
    } else if (token === "--positions" && next) {
      args.positions = next.split(",").map((value) => Number(value.trim())).filter((value) => Number.isFinite(value) && value > 0);
      i += 1;
    } else if (token === "--coverage-threshold" && next) {
      args.coverageThreshold = Number(next);
      i += 1;
    } else if (token === "--percentiles" && next) {
      args.percentiles = next.split(",").map((value) => Number(value.trim())).filter((value) => Number.isFinite(value) && value > 0);
      i += 1;
    } else if (token === "--min-support" && next) {
      args.minSupport = Math.max(1, Number(next));
      i += 1;
    } else if (token === "--per-image-cost" && next) {
      args.perImageCost = Number(next);
      i += 1;
    } else if (token === "--json-out" && next) {
      args.jsonOut = path.resolve(next);
      i += 1;
    } else if (token === "--csv-out-dir" && next) {
      args.csvOutDir = path.resolve(next);
      i += 1;
    }
  }

  return args;
}

function roundNumber(value, digits = 4) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return null;
  }
  return Number(Number(value).toFixed(digits));
}

function mean(values = []) {
  if (!values.length) {
    return null;
  }
  return values.reduce((total, value) => total + Number(value || 0), 0) / values.length;
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

function normalizeFieldValue(value = "") {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  const lower = normalized.toLowerCase();
  if (lower === "unknown" || lower === "n/a" || lower === "na") {
    return "";
  }
  return normalized;
}

function buildImageTraitSets(record = {}) {
  const pairs = new Set();
  const fields = new Set();
  for (const [field, rawValue] of Object.entries(record.enum_fields || {})) {
    const normalizedField = String(field || "").trim();
    const normalizedValue = normalizeFieldValue(rawValue);
    if (!normalizedField || !normalizedValue) {
      continue;
    }
    fields.add(normalizedField);
    pairs.add(`${normalizedField}=${normalizedValue}`);
  }
  return { pairs, fields };
}

function shouldIncludeRecord(record = {}, includeProductDetail = false) {
  const stage0 = String(record.stage_0_result || "").trim().toLowerCase();
  if (record.excluded === true) {
    return false;
  }
  if (stage0 === "product") {
    return true;
  }
  return includeProductDetail && stage0 === "product_detail";
}

function getProductName(record = {}) {
  return String(record.product_name || record.name || "").trim();
}

function getRecordSeatingType(record = {}) {
  return String(record.stage1?.seating_type || record.seating_type || "").trim();
}

function dominantSeatingType(records = []) {
  const counts = new Map();
  for (const record of records) {
    const type = getRecordSeatingType(record);
    if (!type) {
      continue;
    }
    if (!counts.has(type)) {
      counts.set(type, { count: 0, firstIndex: Number(record.__ingestionIndex ?? Number.MAX_SAFE_INTEGER) });
    }
    const entry = counts.get(type);
    entry.count += 1;
    entry.firstIndex = Math.min(entry.firstIndex, Number(record.__ingestionIndex ?? Number.MAX_SAFE_INTEGER));
  }
  return [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[1].firstIndex - b[1].firstIndex)[0]?.[0] || "";
}

function buildTrajectory(images = [], maxPosition = 12) {
  const eventualPairs = new Set();
  const eventualFields = new Set();
  for (const image of images) {
    for (const pair of image.pairs || []) eventualPairs.add(pair);
    for (const field of image.fields || []) eventualFields.add(field);
  }

  const seenPairs = new Set();
  const seenFields = new Set();
  const positions = [];
  const count = Math.min(images.length, maxPosition);
  for (let i = 0; i < count; i += 1) {
    const image = images[i];
    let newPairs = 0;
    let newFields = 0;
    let newValuesExistingField = 0;

    for (const pair of image.pairs || []) {
      if (seenPairs.has(pair)) {
        continue;
      }
      const field = pair.split("=")[0];
      newPairs += 1;
      if (!seenFields.has(field)) {
        newFields += 1;
      } else {
        newValuesExistingField += 1;
      }
      seenPairs.add(pair);
      seenFields.add(field);
    }

    positions.push({
      position: i + 1,
      new_pairs: newPairs,
      new_fields: newFields,
      new_values_existing_field: newValuesExistingField,
      cumulative_pairs: seenPairs.size,
      pair_coverage: eventualPairs.size ? seenPairs.size / eventualPairs.size : null
    });
  }

  return {
    total_pairs: eventualPairs.size,
    total_fields: eventualFields.size,
    positions
  };
}

function buildProductTrajectories(snapshot = {}, minImages = 8, maxPosition = 12, includeProductDetail = false) {
  const byProduct = new Map();
  (snapshot.images || []).forEach((record, index) => {
    const productId = String(record.product_id || "").trim();
    if (!productId) return;
    const enriched = { ...record, __ingestionIndex: index };
    if (!byProduct.has(productId)) byProduct.set(productId, []);
    byProduct.get(productId).push(enriched);
  });

  const entries = [];
  for (const [productId, records] of byProduct.entries()) {
    const validImages = records
      .filter((record) => shouldIncludeRecord(record, includeProductDetail))
      .map((record, index) => ({
        ...record,
        __productOrder: index + 1,
        ...buildImageTraitSets(record)
      }));

    if (validImages.length < minImages) {
      continue;
    }

    entries.push({
      product_id: productId,
      product_name: getProductName(validImages[0] || records[0] || {}),
      seating_type: dominantSeatingType(validImages),
      valid_image_count: validImages.length,
      actual: buildTrajectory(validImages, maxPosition)
    });
  }

  return entries;
}

function getCoverageAtPosition(trajectory = {}, position) {
  if (!trajectory?.positions?.length) {
    return null;
  }
  const exact = trajectory.positions.find((entry) => entry.position === position);
  if (exact) {
    return exact.pair_coverage;
  }
  const last = trajectory.positions[trajectory.positions.length - 1];
  return last.position < position ? last.pair_coverage : null;
}

function findThresholdCrossingPosition(trajectory = {}, threshold = 0.9) {
  for (const position of trajectory.positions || []) {
    if ((position.pair_coverage ?? -1) >= threshold) {
      return position.position;
    }
  }
  return null;
}

function buildCoverageTable(entries = [], positions = [], minSupport = 20, upstreamSegment = null) {
  const row = {
    n: entries.length,
    low_confidence: entries.length < minSupport,
    saturation_point: upstreamSegment?.actual_order?.saturation_point ?? null,
    positions: {}
  };

  for (const position of positions) {
    const values = entries
      .map((entry) => getCoverageAtPosition(entry.actual, position))
      .filter((value) => value !== null);
    row.positions[position] = {
      support_n: values.length,
      low_confidence: values.length < minSupport,
      mean_coverage: roundNumber(mean(values)),
      p10_coverage: roundNumber(quantile(values, 0.1))
    };
  }

  return row;
}

function buildThresholdDistribution(entries = [], threshold = 0.9, percentiles = [], minSupport = 20) {
  const crossings = entries
    .map((entry) => findThresholdCrossingPosition(entry.actual, threshold))
    .filter((value) => value !== null);
  const neverReach = entries.length ? (entries.length - crossings.length) / entries.length : null;

  return {
    n: entries.length,
    low_confidence: entries.length < minSupport,
    threshold,
    crossing_support_n: crossings.length,
    never_reach_fraction: roundNumber(neverReach),
    percentiles: Object.fromEntries(
      percentiles.map((pct) => [`p${pct}`, roundNumber(quantile(crossings, pct / 100), 2)])
    )
  };
}

function determineCapCandidates(type = "", upstreamSegment = null) {
  const saturation = upstreamSegment?.actual_order?.saturation_point ?? null;
  if (type === "task_collab_chair") return [4, 5, 6];
  if (type === "guest_chair") return [6, 7, 8];
  if (type === "lounge_chair") return [7, 8, 10];
  if (saturation) return [...new Set([Math.max(1, saturation - 1), saturation, saturation + 1])].sort((a, b) => a - b);
  return [3, 5, 8];
}

function buildCapScorecard(entries = [], type = "", upstreamSegment = null, perImageCost = null, minSupport = 20) {
  const candidates = determineCapCandidates(type, upstreamSegment);
  const baselineCosts = entries.map((entry) => entry.valid_image_count);
  const baselineMeanImages = mean(baselineCosts);
  return candidates.map((cap) => {
    const cappedCoverage = entries.map((entry) => {
      const cappedPosition = Math.min(cap, entry.actual.positions.length);
      const coverage = getCoverageAtPosition(entry.actual, cappedPosition);
      return coverage ?? 0;
    });
    const at90 = cappedCoverage.filter((value) => value >= 0.9).length;
    const at95 = cappedCoverage.filter((value) => value >= 0.95).length;
    const meanImagesProcessed = mean(entries.map((entry) => Math.min(cap, entry.valid_image_count)));
    const baselineCost = perImageCost === null || baselineMeanImages === null ? null : baselineMeanImages * perImageCost;
    const capCost = perImageCost === null || meanImagesProcessed === null ? null : meanImagesProcessed * perImageCost;
    return {
      cap,
      support_n: entries.length,
      low_confidence: entries.length < minSupport,
      mean_coverage: roundNumber(mean(cappedCoverage)),
      fraction_at_90: entries.length ? roundNumber(at90 / entries.length) : null,
      fraction_at_95: entries.length ? roundNumber(at95 / entries.length) : null,
      estimated_per_product_cost: capCost === null ? null : roundNumber(capCost, 6),
      estimated_savings_vs_baseline: baselineCost === null || capCost === null ? null : roundNumber(baselineCost - capCost, 6)
    };
  });
}

function toCsv(rows = []) {
  if (!rows.length) return "";
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const escape = (value) => {
    const str = value === null || value === undefined ? "" : String(value);
    if (/[",\n]/.test(str)) return `"${str.replace(/"/g, "\"\"")}"`;
    return str;
  };
  return `${headers.join(",")}\n${rows.map((row) => headers.map((key) => escape(row[key])).join(",")).join("\n")}\n`;
}

async function writeCsvOutputs(dir, tables = {}) {
  if (!dir) return;
  await fs.mkdir(dir, { recursive: true });
  for (const [filename, rows] of Object.entries(tables)) {
    await fs.writeFile(path.join(dir, filename), toCsv(rows));
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const upstream = JSON.parse(await fs.readFile(args.input, "utf8"));
  const snapshotPath = upstream?.snapshot?.snapshot_path || upstream?.snapshot?.source_path;
  if (!snapshotPath) {
    throw new Error("Artifact does not contain snapshot metadata.");
  }
  const snapshot = JSON.parse(await fs.readFile(snapshotPath, "utf8"));

  const minImages = Number(upstream?.filters?.min_images_per_product || 8);
  const maxPosition = Math.max(...args.positions, Number(upstream?.filters?.max_position || 12));
  const includeProductDetail = Boolean(upstream?.filters?.include_product_detail);
  const perImageCost = args.perImageCost ?? upstream?.filters?.per_image_cost ?? null;
  const entries = buildProductTrajectories(snapshot, minImages, maxPosition, includeProductDetail);

  const byType = new Map();
  for (const entry of entries) {
    const type = entry.seating_type || "unknown";
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(entry);
  }

  const overallCoverage = buildCoverageTable(entries, args.positions, args.minSupport, upstream.overall);
  const overallThreshold = buildThresholdDistribution(entries, args.coverageThreshold, args.percentiles, args.minSupport);
  const overallScorecard = buildCapScorecard(entries, "overall", upstream.overall, perImageCost, args.minSupport);

  const coverageRows = [
    {
      seating_type: "overall",
      n: overallCoverage.n,
      low_confidence: overallCoverage.low_confidence,
      saturation_point: overallCoverage.saturation_point,
      ...Object.fromEntries(args.positions.flatMap((pos) => [
        [`mean_cov_${pos}`, overallCoverage.positions[pos]?.mean_coverage ?? null],
        [`p10_cov_${pos}`, overallCoverage.positions[pos]?.p10_coverage ?? null],
        [`support_${pos}`, overallCoverage.positions[pos]?.support_n ?? 0],
        [`low_conf_${pos}`, overallCoverage.positions[pos]?.low_confidence ?? false]
      ]))
    }
  ];

  const thresholdRows = [
    {
      seating_type: "overall",
      n: overallThreshold.n,
      low_confidence: overallThreshold.low_confidence,
      crossing_support_n: overallThreshold.crossing_support_n,
      never_reach_fraction: overallThreshold.never_reach_fraction,
      ...Object.fromEntries(args.percentiles.map((pct) => [`p${pct}`, overallThreshold.percentiles[`p${pct}`] ?? null]))
    }
  ];

  const scorecardRows = overallScorecard.map((row) => ({
    seating_type: "overall",
    ...row
  }));

  const byTypeSummary = {};
  for (const [type, typeEntries] of [...byType.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const upstreamSegment = upstream.by_type?.[type] || null;
    const coverage = buildCoverageTable(typeEntries, args.positions, args.minSupport, upstreamSegment);
    const threshold = buildThresholdDistribution(typeEntries, args.coverageThreshold, args.percentiles, args.minSupport);
    const scorecard = buildCapScorecard(typeEntries, type, upstreamSegment, perImageCost, args.minSupport);

    byTypeSummary[type] = {
      coverage,
      threshold_crossing: threshold,
      cap_scorecard: scorecard
    };

    coverageRows.push({
      seating_type: type,
      n: coverage.n,
      low_confidence: coverage.low_confidence,
      saturation_point: coverage.saturation_point,
      ...Object.fromEntries(args.positions.flatMap((pos) => [
        [`mean_cov_${pos}`, coverage.positions[pos]?.mean_coverage ?? null],
        [`p10_cov_${pos}`, coverage.positions[pos]?.p10_coverage ?? null],
        [`support_${pos}`, coverage.positions[pos]?.support_n ?? 0],
        [`low_conf_${pos}`, coverage.positions[pos]?.low_confidence ?? false]
      ]))
    });

    thresholdRows.push({
      seating_type: type,
      n: threshold.n,
      low_confidence: threshold.low_confidence,
      crossing_support_n: threshold.crossing_support_n,
      never_reach_fraction: threshold.never_reach_fraction,
      ...Object.fromEntries(args.percentiles.map((pct) => [`p${pct}`, threshold.percentiles[`p${pct}`] ?? null]))
    });

    for (const row of scorecard) {
      scorecardRows.push({
        seating_type: type,
        ...row
      });
    }
  }

  const output = {
    analysis_generated_at: new Date().toISOString(),
    input_artifact_path: args.input,
    upstream_snapshot: upstream.snapshot,
    upstream_notes: upstream.notes || [],
    notes: [
      "Per-product trajectories were recomputed from the snapshot referenced in the upstream artifact because the upstream artifact stores aggregated curves only.",
      "Threshold crossing is measured on actual-order cumulative pair coverage.",
      "Bench and stool remain included but should be interpreted cautiously when low_confidence=true."
    ],
    filters: {
      positions: args.positions,
      coverage_threshold: args.coverageThreshold,
      percentiles: args.percentiles,
      min_support: args.minSupport,
      per_image_cost: perImageCost,
      min_images_per_product_from_upstream: minImages,
      include_product_detail_from_upstream: includeProductDetail
    },
    overall: {
      coverage_table: overallCoverage,
      threshold_crossing: overallThreshold,
      cap_scorecard: overallScorecard
    },
    by_type: byTypeSummary
  };

  const jsonOut = args.jsonOut || path.join(rootDir, "tmp", "category-cap-policy-analysis.json");
  await fs.mkdir(path.dirname(jsonOut), { recursive: true });
  await fs.writeFile(jsonOut, `${JSON.stringify(output, null, 2)}\n`);

  if (args.csvOutDir) {
    await writeCsvOutputs(args.csvOutDir, {
      "coverage-table.csv": coverageRows,
      "threshold-crossing.csv": thresholdRows,
      "cap-scorecard.csv": scorecardRows
    });
  }

  console.log(JSON.stringify({
    output_path: jsonOut,
    overall_coverage_table: coverageRows[0],
    overall_threshold_crossing: thresholdRows[0],
    by_type_summary: Object.fromEntries(
      Object.entries(byTypeSummary).map(([type, summary]) => [
        type,
        {
          n: summary.coverage.n,
          low_confidence: summary.coverage.low_confidence,
          saturation_point: summary.coverage.saturation_point,
          threshold_crossing: summary.threshold_crossing,
          cap_scorecard: summary.cap_scorecard
        }
      ])
    )
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
