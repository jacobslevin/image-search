import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const imageIndexPath = path.join(repoRoot, "data", "image-index.json");
const backupPath = path.join(repoRoot, "data", "image-index.pre-bench-seat-finish-migration-backup.json");

const migrationMap = new Map([
  ["walnut", "Natural wood"],
  ["white oak", "Natural wood"],
  ["fabric (specify category)", "Fabric"],
  ["com", "Fabric"],
  ["col", "Leather"]
]);

function normalizeValue(value) {
  return String(value ?? "").trim().toLowerCase();
}

function resolveSeatingType(record = {}) {
  return String(record?.seating_type || record?.stage1?.seating_type || "").trim().toLowerCase();
}

function getRecordLabel(record = {}, fallback = "unknown-record") {
  return String(
    record.product_name ||
    record.id ||
    record.product_id ||
    record.image_url ||
    fallback
  ).trim();
}

function migrateSeatFinish(enumFields = {}) {
  if (!enumFields || typeof enumFields !== "object" || Array.isArray(enumFields)) {
    return null;
  }

  const currentValue = enumFields.seat_finish_fabric;
  const normalizedValue = normalizeValue(currentValue);
  const nextValue = migrationMap.get(normalizedValue);

  if (!nextValue || currentValue === nextValue) {
    return null;
  }

  enumFields.seat_finish_fabric = nextValue;
  return {
    from: String(currentValue ?? ""),
    to: nextValue,
    normalizedFrom: normalizedValue
  };
}

function maybeMigrateRecord(record = {}, logs = [], mappingCounts = new Map()) {
  if (resolveSeatingType(record) !== "bench") {
    return false;
  }

  let changed = false;
  const recordLabel = getRecordLabel(record);

  const topLevelChange = migrateSeatFinish(record.enum_fields);
  if (topLevelChange) {
    changed = true;
    logs.push(`bench | ${recordLabel} | seat_finish_fabric: "${topLevelChange.from}" -> "${topLevelChange.to}"`);
    mappingCounts.set(
      `${topLevelChange.normalizedFrom} -> ${topLevelChange.to}`,
      (mappingCounts.get(`${topLevelChange.normalizedFrom} -> ${topLevelChange.to}`) || 0) + 1
    );
  }

  if (Array.isArray(record.matching_images)) {
    record.matching_images.forEach((imageRecord, index) => {
      if (resolveSeatingType(imageRecord) !== "bench") {
        return;
      }
      const nestedChange = migrateSeatFinish(imageRecord.enum_fields);
      if (!nestedChange) {
        return;
      }
      changed = true;
      logs.push(`bench | ${recordLabel}#matching_images[${index}] | seat_finish_fabric: "${nestedChange.from}" -> "${nestedChange.to}"`);
      mappingCounts.set(
        `${nestedChange.normalizedFrom} -> ${nestedChange.to}`,
        (mappingCounts.get(`${nestedChange.normalizedFrom} -> ${nestedChange.to}`) || 0) + 1
      );
    });
  }

  return changed;
}

if (!fs.existsSync(imageIndexPath)) {
  throw new Error(`Missing image index: ${imageIndexPath}`);
}

const imageIndex = JSON.parse(fs.readFileSync(imageIndexPath, "utf8"));
const logs = [];
const mappingCounts = new Map();
let modifiedRecords = 0;

for (const record of imageIndex.images || []) {
  if (maybeMigrateRecord(record, logs, mappingCounts)) {
    modifiedRecords += 1;
  }
}

if (modifiedRecords === 0) {
  console.log("No migrations required.");
  process.exit(0);
}

if (fs.existsSync(backupPath)) {
  throw new Error(`Backup already exists and migrations are still pending, aborting without changes: ${backupPath}`);
}

fs.copyFileSync(imageIndexPath, backupPath);
fs.writeFileSync(imageIndexPath, `${JSON.stringify(imageIndex, null, 2)}\n`);

for (const line of logs) {
  console.log(line);
}

console.log("");
console.log("Summary");
console.log(`Records modified: ${modifiedRecords}`);
for (const [mapping, count] of [...mappingCounts.entries()].sort()) {
  console.log(`${mapping}: ${count}`);
}
