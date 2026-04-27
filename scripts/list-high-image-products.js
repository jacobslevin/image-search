#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");

const DEFAULT_THRESHOLD = 8;
const DEFAULT_ARTIFACT_PATH = path.join(rootDir, "tmp", "image-marginal-value-analysis-test.json");
const DEFAULT_LIVE_INDEX_PATH = path.join(rootDir, "data", "image-index.json");
const DEFAULT_JSON_OUT = path.join(rootDir, "tmp", "high-image-products.json");
const DEFAULT_CSV_OUT = path.join(rootDir, "tmp", "high-image-products.csv");

function parseArgs(argv = []) {
  const args = {
    threshold: DEFAULT_THRESHOLD,
    artifactPath: DEFAULT_ARTIFACT_PATH,
    jsonOut: DEFAULT_JSON_OUT,
    csvOut: DEFAULT_CSV_OUT
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || "").trim();
    const next = argv[index + 1];
    if (token === "--threshold" && next) {
      args.threshold = Math.max(0, Number(next));
      index += 1;
    } else if (token === "--artifact" && next) {
      args.artifactPath = path.resolve(next);
      index += 1;
    } else if (token === "--json-out" && next) {
      args.jsonOut = path.resolve(next);
      index += 1;
    } else if (token === "--csv-out" && next) {
      args.csvOut = path.resolve(next);
      index += 1;
    }
  }

  return args;
}

function getRecordSeatingType(record = {}) {
  return String(record.stage1?.seating_type || record.seating_type || "").trim() || "unknown";
}

function getProductName(record = {}) {
  return String(record.product_name || record.name || "").trim();
}

function shouldCountRecord(record = {}) {
  return String(record.stage_0_result || "").trim().toLowerCase() === "product" && record.excluded !== true;
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

function toCsv(rows = []) {
  if (!rows.length) {
    return "";
  }
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const escape = (value) => {
    const stringValue = value === null || value === undefined ? "" : String(value);
    if (/[",\n]/.test(stringValue)) {
      return `"${stringValue.replace(/"/g, "\"\"")}"`;
    }
    return stringValue;
  };
  return `${headers.join(",")}\n${rows.map((row) => headers.map((header) => escape(row[header])).join(",")).join("\n")}\n`;
}

function formatCell(value, width) {
  return String(value).padEnd(width);
}

async function resolveSourcePaths(artifactPath, liveIndexPath) {
  let artifact = null;
  try {
    artifact = JSON.parse(await fs.readFile(artifactPath, "utf8"));
  } catch {
    artifact = null;
  }

  const snapshotPath = artifact?.snapshot?.snapshot_path;
  if (snapshotPath) {
    try {
      await fs.access(snapshotPath);
      return {
        sourceLabel: "upstream snapshot",
        sourcePath: snapshotPath,
        artifactPath
      };
    } catch {
      // fall through
    }
  }

  return {
    sourceLabel: "live index fallback",
    sourcePath: liveIndexPath,
    artifactPath
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = await resolveSourcePaths(args.artifactPath, DEFAULT_LIVE_INDEX_PATH);
  const index = JSON.parse(await fs.readFile(source.sourcePath, "utf8"));

  const byProduct = new Map();
  (index.images || []).forEach((record, ingestionIndex) => {
    if (!shouldCountRecord(record)) {
      return;
    }
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

  const highProducts = [...byProduct.entries()]
    .map(([productId, records]) => ({
      product_id: productId,
      product_name: getProductName(records[0] || {}),
      seating_type: dominantSeatingType(records),
      image_count: records.length,
      excess_above_threshold: Math.max(0, records.length - args.threshold)
    }))
    .filter((entry) => entry.image_count > args.threshold)
    .sort((left, right) =>
      right.image_count - left.image_count ||
      left.seating_type.localeCompare(right.seating_type) ||
      left.product_name.localeCompare(right.product_name)
    );

  const types = ["task_collab_chair", "guest_chair", "lounge_chair", "stool", "bench"];
  const grouped = new Map();
  for (const type of types) {
    grouped.set(type, []);
  }
  for (const entry of highProducts) {
    if (!grouped.has(entry.seating_type)) {
      grouped.set(entry.seating_type, []);
    }
    grouped.get(entry.seating_type).push(entry);
  }

  const summaryRows = [];
  const allExcess = highProducts.reduce((total, entry) => total + entry.excess_above_threshold, 0);
  const overallMax = highProducts.length ? Math.max(...highProducts.map((entry) => entry.image_count)) : 0;
  summaryRows.push({
    seating_type: "overall",
    product_count: highProducts.length,
    total_excess_images_above_threshold: allExcess,
    max_images: overallMax
  });

  for (const type of types) {
    const entries = grouped.get(type) || [];
    summaryRows.push({
      seating_type: type,
      product_count: entries.length,
      total_excess_images_above_threshold: entries.reduce((total, entry) => total + entry.excess_above_threshold, 0),
      max_images: entries.length ? Math.max(...entries.map((entry) => entry.image_count)) : 0
    });
  }

  const output = {
    analysis_generated_at: new Date().toISOString(),
    threshold: args.threshold,
    source: {
      label: source.sourceLabel,
      path: source.sourcePath,
      artifact_path: source.artifactPath
    },
    summary: summaryRows,
    products: highProducts,
    products_at_or_above_20: highProducts.filter((entry) => entry.image_count >= 20),
    products_at_or_above_30: highProducts.filter((entry) => entry.image_count >= 30)
  };

  await fs.mkdir(path.dirname(args.jsonOut), { recursive: true });
  await fs.mkdir(path.dirname(args.csvOut), { recursive: true });
  await fs.writeFile(args.jsonOut, `${JSON.stringify(output, null, 2)}\n`);
  await fs.writeFile(args.csvOut, toCsv(highProducts));

  console.log(`Source: ${source.sourceLabel}`);
  console.log(`Source path: ${source.sourcePath}`);
  console.log("");
  console.log(`Products with >${args.threshold} stage-0-passing images:`);

  const widths = [18, 12, 32, 10];
  console.log([
    formatCell("", widths[0]),
    formatCell("n products", widths[1]),
    formatCell(`total excess images (above ${args.threshold})`, widths[2]),
    formatCell("max images", widths[3])
  ].join("  "));
  for (const row of summaryRows) {
    console.log([
      formatCell(row.seating_type, widths[0]),
      formatCell(row.product_count, widths[1]),
      formatCell(row.total_excess_images_above_threshold, widths[2]),
      formatCell(row.max_images, widths[3])
    ].join("  "));
  }

  console.log("");
  console.log("Top 10 products by image count:");
  for (const entry of highProducts.slice(0, 10)) {
    console.log(`  [${entry.seating_type}] ${entry.product_name} — ${entry.image_count} images`);
  }

  console.log("");
  console.log(`Products with >=20 images: ${output.products_at_or_above_20.length}`);
  for (const entry of output.products_at_or_above_20) {
    console.log(`  [${entry.seating_type}] ${entry.product_name} — ${entry.image_count} images`);
  }

  console.log("");
  console.log(`Products with >=30 images: ${output.products_at_or_above_30.length}`);
  for (const entry of output.products_at_or_above_30) {
    console.log(`  [${entry.seating_type}] ${entry.product_name} — ${entry.image_count} images`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
