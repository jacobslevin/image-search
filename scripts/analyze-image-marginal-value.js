#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");

const DEFAULT_INPUT_PATH = path.join(rootDir, "data", "image-index.json");
const DEFAULT_MIN_IMAGES = 8;
const DEFAULT_MAX_POSITION = 12;
const DEFAULT_MIN_SUPPORT = 20;
const DEFAULT_LATE_VALUE_START = 8;
const DEFAULT_SATURATION_THRESHOLD = 0.5;

function parseArgs(argv = []) {
  const args = {
    input: DEFAULT_INPUT_PATH,
    jsonOut: "",
    snapshotOut: "",
    minImages: DEFAULT_MIN_IMAGES,
    maxPosition: DEFAULT_MAX_POSITION,
    minSupport: DEFAULT_MIN_SUPPORT,
    lateValueStart: DEFAULT_LATE_VALUE_START,
    saturationThreshold: DEFAULT_SATURATION_THRESHOLD,
    includeProductDetail: false,
    byType: true,
    perImageCost: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || "").trim();
    const next = argv[index + 1];

    if (token === "--input" && next) {
      args.input = path.resolve(next);
      index += 1;
    } else if (token === "--json-out" && next) {
      args.jsonOut = path.resolve(next);
      index += 1;
    } else if (token === "--snapshot-out" && next) {
      args.snapshotOut = path.resolve(next);
      index += 1;
    } else if (token === "--min-images" && next) {
      args.minImages = Math.max(1, Number(next));
      index += 1;
    } else if (token === "--max-position" && next) {
      args.maxPosition = Math.max(1, Number(next));
      index += 1;
    } else if (token === "--min-support" && next) {
      args.minSupport = Math.max(1, Number(next));
      index += 1;
    } else if (token === "--late-value-start" && next) {
      args.lateValueStart = Math.max(1, Number(next));
      index += 1;
    } else if (token === "--saturation-threshold" && next) {
      args.saturationThreshold = Math.max(0, Number(next));
      index += 1;
    } else if (token === "--per-image-cost" && next) {
      args.perImageCost = Number(next);
      index += 1;
    } else if (token === "--include-product-detail") {
      args.includeProductDetail = true;
    } else if (token === "--no-by-type") {
      args.byType = false;
    }
  }

  return args;
}

function formatTimestampForFilename(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function sum(values = []) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function mean(values = []) {
  if (!values.length) {
    return null;
  }
  return sum(values) / values.length;
}

function quantile(values = [], q = 0.5) {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 1) {
    return sorted[0];
  }
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) {
    return sorted[lower];
  }
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function roundNumber(value, digits = 4) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return null;
  }
  return Number(Number(value).toFixed(digits));
}

function normalizeFieldName(value = "") {
  return String(value || "").trim();
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
  const enumFields = record?.enum_fields || {};
  const pairs = new Set();
  const fields = new Set();

  for (const [rawField, rawValue] of Object.entries(enumFields)) {
    const field = normalizeFieldName(rawField);
    const value = normalizeFieldValue(rawValue);
    if (!field || !value) {
      continue;
    }
    fields.add(field);
    pairs.add(`${field}=${value}`);
  }

  return {
    pairs,
    fields
  };
}

function getProductName(record = {}) {
  return String(record.product_name || record.name || "").trim();
}

function getRecordSeatingType(record = {}) {
  return String(record.stage1?.seating_type || record.seating_type || "").trim();
}

function shouldIncludeRecord(record = {}, options = {}) {
  const stage0 = String(record.stage_0_result || "").trim().toLowerCase();
  if (record.excluded === true) {
    return false;
  }
  if (stage0 === "product") {
    return true;
  }
  if (options.includeProductDetail && stage0 === "product_detail") {
    return true;
  }
  return false;
}

function classifyExcludedRecord(record = {}) {
  const stage0 = String(record.stage_0_result || "").trim().toLowerCase();
  if (stage0 === "scene") {
    return "scene";
  }
  if (stage0 === "product_detail") {
    return "product_detail";
  }
  return record.excluded ? "excluded_other" : "not_included";
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
    .sort((left, right) => {
      if (right[1].count !== left[1].count) {
        return right[1].count - left[1].count;
      }
      return left[1].firstIndex - right[1].firstIndex;
    })[0]?.[0] || "";
}

function buildTrajectory(images = [], maxPosition = DEFAULT_MAX_POSITION) {
  const eventualPairs = new Set();
  const eventualFields = new Set();
  for (const image of images) {
    for (const pair of image.pairs || []) {
      eventualPairs.add(pair);
    }
    for (const field of image.fields || []) {
      eventualFields.add(field);
    }
  }

  const seenPairs = new Set();
  const seenFields = new Set();
  const positions = [];
  const positionCount = Math.min(images.length, maxPosition);

  for (let index = 0; index < positionCount; index += 1) {
    const image = images[index];
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
      position: index + 1,
      image_id: image.image_id,
      stage_0_result: String(image.stage_0_result || "").trim().toLowerCase(),
      new_pairs: newPairs,
      new_fields: newFields,
      new_values_existing_field: newValuesExistingField,
      cumulative_pairs: seenPairs.size,
      cumulative_fields: seenFields.size,
      pair_coverage: eventualPairs.size ? seenPairs.size / eventualPairs.size : null,
      field_coverage: eventualFields.size ? seenFields.size / eventualFields.size : null
    });
  }

  return {
    total_pairs: eventualPairs.size,
    total_fields: eventualFields.size,
    positions
  };
}

function buildOracleImageOrder(images = []) {
  const remaining = images.map((image, index) => ({ image, index }));
  const seenPairs = new Set();
  const ordered = [];

  while (remaining.length) {
    let bestIndex = 0;
    let bestNovelty = -1;

    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      let uncoveredPairs = 0;
      for (const pair of candidate.image.pairs || []) {
        if (!seenPairs.has(pair)) {
          uncoveredPairs += 1;
        }
      }

      if (uncoveredPairs > bestNovelty) {
        bestNovelty = uncoveredPairs;
        bestIndex = index;
      } else if (uncoveredPairs === bestNovelty) {
        const currentPosition = Number(candidate.image.__productOrder ?? Number.MAX_SAFE_INTEGER);
        const bestPosition = Number(remaining[bestIndex].image.__productOrder ?? Number.MAX_SAFE_INTEGER);
        if (currentPosition < bestPosition) {
          bestIndex = index;
        }
      }
    }

    const [picked] = remaining.splice(bestIndex, 1);
    ordered.push(picked.image);
    for (const pair of picked.image.pairs || []) {
      seenPairs.add(pair);
    }
  }

  return ordered;
}

function buildCurveSummary(valuesByPosition = new Map(), minSupport = DEFAULT_MIN_SUPPORT, perImageCost = null) {
  return [...valuesByPosition.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([position, metrics]) => {
      const newPairs = metrics.new_pairs;
      const newFields = metrics.new_fields;
      const newValuesExistingField = metrics.new_values_existing_field;
      const pairCoverage = metrics.pair_coverage;
      const fieldCoverage = metrics.field_coverage;

      const meanNewPairs = mean(newPairs);
      const meanNewFields = mean(newFields);

      return {
        position,
        support_n: newPairs.length,
        low_confidence: newPairs.length < minSupport,
        new_pairs: {
          mean: roundNumber(meanNewPairs),
          median: roundNumber(quantile(newPairs, 0.5)),
          p75: roundNumber(quantile(newPairs, 0.75)),
          p90: roundNumber(quantile(newPairs, 0.9))
        },
        new_fields: {
          mean: roundNumber(meanNewFields),
          median: roundNumber(quantile(newFields, 0.5)),
          p75: roundNumber(quantile(newFields, 0.75)),
          p90: roundNumber(quantile(newFields, 0.9))
        },
        new_values_existing_field: {
          mean: roundNumber(mean(newValuesExistingField)),
          median: roundNumber(quantile(newValuesExistingField, 0.5)),
          p75: roundNumber(quantile(newValuesExistingField, 0.75)),
          p90: roundNumber(quantile(newValuesExistingField, 0.9))
        },
        pair_coverage: {
          mean: roundNumber(mean(pairCoverage)),
          median: roundNumber(quantile(pairCoverage, 0.5)),
          p75: roundNumber(quantile(pairCoverage, 0.75)),
          p90: roundNumber(quantile(pairCoverage, 0.9))
        },
        field_coverage: {
          mean: roundNumber(mean(fieldCoverage)),
          median: roundNumber(quantile(fieldCoverage, 0.5)),
          p75: roundNumber(quantile(fieldCoverage, 0.75)),
          p90: roundNumber(quantile(fieldCoverage, 0.9))
        },
        composition: {
          new_fields_fraction_mean: meanNewPairs ? roundNumber(meanNewFields / meanNewPairs) : null,
          new_values_existing_field_fraction_mean: meanNewPairs
            ? roundNumber(mean(newValuesExistingField) / meanNewPairs)
            : null
        },
        cost_efficiency: perImageCost === null ? null : {
          per_image_cost: roundNumber(perImageCost, 6),
          cost_per_new_pair: meanNewPairs > 0 ? roundNumber(perImageCost / meanNewPairs, 6) : null,
          cost_per_new_field: meanNewFields > 0 ? roundNumber(perImageCost / meanNewFields, 6) : null
        }
      };
    });
}

function buildCoverageCheckpoint(curve = [], positions = []) {
  const byPosition = new Map(curve.map((row) => [row.position, row]));
  return positions.map((position) => ({
    position,
    support_n: byPosition.get(position)?.support_n || 0,
    low_confidence: Boolean(byPosition.get(position)?.low_confidence),
    pair_coverage: byPosition.get(position)?.pair_coverage || null,
    field_coverage: byPosition.get(position)?.field_coverage || null
  }));
}

function percentProductsWithLateGain(trajectories = [], cutoff = DEFAULT_LATE_VALUE_START) {
  if (!trajectories.length) {
    return {
      support_n: 0,
      any_new_pairs_percent: null,
      any_new_fields_percent: null
    };
  }
  const pairHits = trajectories.filter((entry) => entry.positions.some((position) => position.position > cutoff && position.new_pairs > 0)).length;
  const fieldHits = trajectories.filter((entry) => entry.positions.some((position) => position.position > cutoff && position.new_fields > 0)).length;
  return {
    support_n: trajectories.length,
    any_new_pairs_percent: roundNumber(pairHits / trajectories.length, 4),
    any_new_fields_percent: roundNumber(fieldHits / trajectories.length, 4)
  };
}

function saturationPoint(curve = [], threshold = DEFAULT_SATURATION_THRESHOLD, minSupport = DEFAULT_MIN_SUPPORT) {
  for (const row of curve) {
    if (row.support_n < minSupport) {
      continue;
    }
    if ((row.new_pairs?.mean ?? Number.POSITIVE_INFINITY) < threshold) {
      return row.position;
    }
  }
  return null;
}

function initializeMetricBuckets() {
  return {
    new_pairs: [],
    new_fields: [],
    new_values_existing_field: [],
    pair_coverage: [],
    field_coverage: []
  };
}

function aggregateTrajectorySet(entries = [], options = {}) {
  const actualByPosition = new Map();
  const oracleByPosition = new Map();

  for (const entry of entries) {
    for (const position of entry.actual.positions) {
      if (!actualByPosition.has(position.position)) {
        actualByPosition.set(position.position, initializeMetricBuckets());
      }
      const bucket = actualByPosition.get(position.position);
      bucket.new_pairs.push(position.new_pairs);
      bucket.new_fields.push(position.new_fields);
      bucket.new_values_existing_field.push(position.new_values_existing_field);
      if (position.pair_coverage !== null) {
        bucket.pair_coverage.push(position.pair_coverage);
      }
      if (position.field_coverage !== null) {
        bucket.field_coverage.push(position.field_coverage);
      }
    }

    for (const position of entry.oracle.positions) {
      if (!oracleByPosition.has(position.position)) {
        oracleByPosition.set(position.position, initializeMetricBuckets());
      }
      const bucket = oracleByPosition.get(position.position);
      bucket.new_pairs.push(position.new_pairs);
      bucket.new_fields.push(position.new_fields);
      bucket.new_values_existing_field.push(position.new_values_existing_field);
      if (position.pair_coverage !== null) {
        bucket.pair_coverage.push(position.pair_coverage);
      }
      if (position.field_coverage !== null) {
        bucket.field_coverage.push(position.field_coverage);
      }
    }
  }

  const actualCurve = buildCurveSummary(actualByPosition, options.minSupport, options.perImageCost);
  const oracleCurve = buildCurveSummary(oracleByPosition, options.minSupport, options.perImageCost);
  const checkpoints = [1, 2, 3, 5, 8, 10, 12].filter((position) => position <= options.maxPosition);

  return {
    product_count: entries.length,
    products_with_zero_pairs: entries.filter((entry) => entry.actual.total_pairs === 0).length,
    actual_order: {
      curve: actualCurve,
      coverage_checkpoints: buildCoverageCheckpoint(actualCurve, checkpoints),
      late_gain_after_5: percentProductsWithLateGain(entries.map((entry) => entry.actual), 5),
      late_gain_after_8: percentProductsWithLateGain(entries.map((entry) => entry.actual), 8),
      late_gain_after_10: percentProductsWithLateGain(entries.map((entry) => entry.actual), 10),
      saturation_point: saturationPoint(actualCurve, options.saturationThreshold, options.minSupport)
    },
    oracle_order: {
      curve: oracleCurve,
      coverage_checkpoints: buildCoverageCheckpoint(oracleCurve, checkpoints),
      saturation_point: saturationPoint(oracleCurve, options.saturationThreshold, options.minSupport)
    }
  };
}

function buildLateValueProducts(entries = [], cutoff = DEFAULT_LATE_VALUE_START) {
  return entries
    .map((entry) => {
      const latePositions = entry.actual.positions.filter((position) => position.position > cutoff);
      return {
        product_id: entry.product_id,
        product_name: entry.product_name,
        seating_type: entry.seating_type,
        valid_image_count: entry.valid_image_count,
        total_pairs: entry.actual.total_pairs,
        total_fields: entry.actual.total_fields,
        late_new_pairs: sum(latePositions.map((position) => position.new_pairs)),
        late_new_fields: sum(latePositions.map((position) => position.new_fields))
      };
    })
    .filter((entry) => entry.late_new_pairs > 0 || entry.late_new_fields > 0)
    .sort((left, right) =>
      right.late_new_pairs - left.late_new_pairs ||
      right.late_new_fields - left.late_new_fields ||
      right.valid_image_count - left.valid_image_count ||
      left.product_name.localeCompare(right.product_name)
    );
}

async function createSnapshot(inputPath, requestedOutputPath = "") {
  const sourceBuffer = await fs.readFile(inputPath);
  const snapshotTimestamp = new Date();
  const snapshotPath = requestedOutputPath
    ? path.resolve(requestedOutputPath)
    : path.join(os.tmpdir(), `image-index-snapshot-${formatTimestampForFilename(snapshotTimestamp)}.json`);

  await fs.writeFile(snapshotPath, sourceBuffer);
  const sourceStats = await fs.stat(inputPath);

  return {
    snapshotPath,
    sourcePath: inputPath,
    sourceMtime: sourceStats.mtime.toISOString(),
    snapshotCapturedAt: snapshotTimestamp.toISOString()
  };
}

function buildEligibleProducts(index = {}, options = {}) {
  const byProduct = new Map();
  const excludedCounts = {
    scene: 0,
    product_detail: 0,
    excluded_other: 0,
    not_included: 0
  };

  (index.images || []).forEach((record, ingestionIndex) => {
    const productId = String(record.product_id || "").trim();
    if (!productId) {
      return;
    }

    const enriched = {
      ...record,
      __ingestionIndex: ingestionIndex
    };

    if (!byProduct.has(productId)) {
      byProduct.set(productId, []);
    }
    byProduct.get(productId).push(enriched);

    if (!shouldIncludeRecord(enriched, options)) {
      const bucket = classifyExcludedRecord(enriched);
      excludedCounts[bucket] = (excludedCounts[bucket] || 0) + 1;
    }
  });

  const eligibleProducts = [];
  let skippedForMinImages = 0;

  for (const [productId, records] of byProduct.entries()) {
    const validImages = records
      .filter((record) => shouldIncludeRecord(record, options))
      .map((record, index) => ({
        ...record,
        __productOrder: index + 1,
        ...buildImageTraitSets(record)
      }));

    if (validImages.length < options.minImages) {
      skippedForMinImages += 1;
      continue;
    }

    const productName = getProductName(validImages[0] || records[0] || {});
    const seatingType = dominantSeatingType(validImages);
    const actual = buildTrajectory(validImages, options.maxPosition);
    const oracle = buildTrajectory(buildOracleImageOrder(validImages), options.maxPosition);

    eligibleProducts.push({
      product_id: productId,
      product_name: productName,
      seating_type: seatingType,
      valid_image_count: validImages.length,
      actual,
      oracle
    });
  }

  return {
    eligibleProducts,
    excludedCounts,
    totals: {
      total_products_in_index: byProduct.size,
      eligible_products: eligibleProducts.length,
      skipped_for_min_images: skippedForMinImages
    }
  };
}

function buildByTypeSummaries(entries = [], options = {}) {
  const byType = new Map();
  for (const entry of entries) {
    const type = entry.seating_type || "unknown";
    if (!byType.has(type)) {
      byType.set(type, []);
    }
    byType.get(type).push(entry);
  }

  return Object.fromEntries(
    [...byType.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([type, typeEntries]) => [
        type,
        {
          product_count: typeEntries.length,
          low_confidence_segment: typeEntries.length < 30,
          ...aggregateTrajectorySet(typeEntries, options)
        }
      ])
  );
}

function buildOrderSensitivity(overall = {}) {
  const actualByPosition = new Map((overall.actual_order?.curve || []).map((row) => [row.position, row]));
  const oracleByPosition = new Map((overall.oracle_order?.curve || []).map((row) => [row.position, row]));
  const positions = [...new Set([...actualByPosition.keys(), ...oracleByPosition.keys()])].sort((left, right) => left - right);

  return positions.map((position) => {
    const actual = actualByPosition.get(position);
    const oracle = oracleByPosition.get(position);
    return {
      position,
      support_n_actual: actual?.support_n || 0,
      support_n_oracle: oracle?.support_n || 0,
      actual_pair_coverage_mean: actual?.pair_coverage?.mean ?? null,
      oracle_pair_coverage_mean: oracle?.pair_coverage?.mean ?? null,
      pair_coverage_gap: (oracle?.pair_coverage?.mean !== null && actual?.pair_coverage?.mean !== null)
        ? roundNumber((oracle?.pair_coverage?.mean || 0) - (actual?.pair_coverage?.mean || 0))
        : null,
      actual_new_pairs_mean: actual?.new_pairs?.mean ?? null,
      oracle_new_pairs_mean: oracle?.new_pairs?.mean ?? null,
      new_pairs_gap: (oracle?.new_pairs?.mean !== null && actual?.new_pairs?.mean !== null)
        ? roundNumber((oracle?.new_pairs?.mean || 0) - (actual?.new_pairs?.mean || 0))
        : null
    };
  });
}

function buildConsoleSummary(analysis = {}) {
  const overall = analysis.overall || {};
  const actualCoverage = overall.actual_order?.coverage_checkpoints || [];
  const late5 = overall.actual_order?.late_gain_after_5 || {};
  const late8 = overall.actual_order?.late_gain_after_8 || {};
  const late10 = overall.actual_order?.late_gain_after_10 || {};

  return {
    snapshot: analysis.snapshot,
    filters: analysis.filters,
    totals: analysis.totals,
    excluded_counts: analysis.excluded_counts,
    actual_order_coverage_checkpoints: actualCoverage,
    late_gain_summary: {
      after_5: late5,
      after_8: late8,
      after_10: late10
    },
    saturation_points: {
      actual_order: overall.actual_order?.saturation_point ?? null,
      oracle_order: overall.oracle_order?.saturation_point ?? null
    },
    late_value_top10: (analysis.late_value_products || []).slice(0, 10)
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const snapshotMeta = await createSnapshot(options.input, options.snapshotOut);
  const snapshot = JSON.parse(await fs.readFile(snapshotMeta.snapshotPath, "utf8"));

  const { eligibleProducts, excludedCounts, totals } = buildEligibleProducts(snapshot, options);
  const overall = aggregateTrajectorySet(eligibleProducts, options);
  const byType = options.byType ? buildByTypeSummaries(eligibleProducts, options) : {};
  const lateValueProducts = buildLateValueProducts(eligibleProducts, options.lateValueStart);

  const analysis = {
    analysis_generated_at: new Date().toISOString(),
    snapshot: {
      source_path: snapshotMeta.sourcePath,
      source_mtime: snapshotMeta.sourceMtime,
      snapshot_path: snapshotMeta.snapshotPath,
      snapshot_captured_at: snapshotMeta.snapshotCapturedAt,
      index_generated_at: snapshot.generated_at || null
    },
    filters: {
      min_images_per_product: options.minImages,
      max_position: options.maxPosition,
      min_support_per_curve_point: options.minSupport,
      include_product_detail: options.includeProductDetail,
      late_value_start_position: options.lateValueStart,
      saturation_threshold_new_pairs_mean: options.saturationThreshold,
      per_image_cost: options.perImageCost
    },
    notes: [
      "Primary analysis includes only images with stage_0_result=product and excluded=false unless --include-product-detail is supplied.",
      "Actual-order uses current ingestion order within each product.",
      "Oracle-order uses deterministic greedy novelty ordering with earlier ingestion position winning ties.",
      "Products must meet the minimum valid-image threshold to enter the main analysis, which biases the sample toward higher-complexity products and may slightly overstate late-image value versus the full catalog.",
      "Curve points with support_n below the minimum support threshold are flagged low_confidence."
    ],
    totals,
    excluded_counts: excludedCounts,
    overall,
    order_sensitivity: buildOrderSensitivity(overall),
    by_type: byType,
    late_value_products: lateValueProducts
  };

  const outputPath = options.jsonOut || path.join(
    rootDir,
    "tmp",
    `image-marginal-value-analysis-${formatTimestampForFilename(new Date())}.json`
  );

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(analysis, null, 2)}\n`);

  console.log(JSON.stringify({
    output_path: outputPath,
    ...buildConsoleSummary(analysis)
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
