import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const seatingTypesPath = path.join(__dirname, "..", "data", "seating-types.json");
const indexPath = path.join(__dirname, "..", "data", "image-index.json");
const backupPath = path.join(__dirname, "..", "data", "image-index.pre-ghost-field-cleanup-backup.json");
const SAMPLE_LIMIT = 20;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function getResolvedSeatingType(record = {}) {
  return String(record?.seating_type || record?.stage1?.seating_type || "").trim();
}

function getSchemaFieldSetMap(seatingTypesConfig = {}) {
  const types = seatingTypesConfig.types || {};
  return new Map(
    Object.entries(types).map(([typeKey, config]) => [
      typeKey,
      new Set((config?.fields || []).map((field) => field.field))
    ])
  );
}

function ensureBucket(map, key, fallbackFactory) {
  if (!map.has(key)) {
    map.set(key, fallbackFactory());
  }
  return map.get(key);
}

function stripGhostEnumFieldsFromRecord(record, schemaFieldsByType, summary, locationLabel) {
  const resolvedType = getResolvedSeatingType(record);
  if (!resolvedType) {
    summary.skippedMissingType += 1;
    return false;
  }

  const allowedFields = schemaFieldsByType.get(resolvedType);
  if (!allowedFields) {
    summary.skippedUnknownType += 1;
    return false;
  }

  const enumFields = record?.enum_fields;
  if (!enumFields || typeof enumFields !== "object" || Array.isArray(enumFields)) {
    return false;
  }

  const ghostKeys = Object.keys(enumFields).filter((field) => !allowedFields.has(field));
  if (!ghostKeys.length) {
    return false;
  }

  for (const field of ghostKeys) {
    delete enumFields[field];
    summary.totalGhostKeysRemoved += 1;
    ensureBucket(summary.perTypeRecordsModified, resolvedType, () => 0);
    ensureBucket(summary.perFieldRemovals, `${resolvedType}.${field}`, () => 0);
    summary.perFieldRemovals.set(`${resolvedType}.${field}`, summary.perFieldRemovals.get(`${resolvedType}.${field}`) + 1);
  }

  summary.perTypeRecordsModified.set(
    resolvedType,
    (summary.perTypeRecordsModified.get(resolvedType) || 0) + 1
  );

  if (summary.sampleTrail.length < SAMPLE_LIMIT) {
    const productLabel = String(record?.name || record?.product_name || record?.product_id || locationLabel || "unknown").trim();
    summary.sampleTrail.push(`${resolvedType} | ${productLabel} | removed: ${ghostKeys.join(", ")}`);
  }

  return true;
}

function main() {
  const seatingTypesConfig = readJson(seatingTypesPath);
  const schemaFieldsByType = getSchemaFieldSetMap(seatingTypesConfig);
  const index = readJson(indexPath);
  const images = Array.isArray(index?.images) ? index.images : [];

  const summary = {
    totalRecordsScanned: images.length,
    totalRecordsModified: 0,
    totalGhostKeysRemoved: 0,
    skippedMissingType: 0,
    skippedUnknownType: 0,
    perTypeRecordsModified: new Map(),
    perFieldRemovals: new Map(),
    sampleTrail: []
  };

  for (const image of images) {
    const topLevelChanged = stripGhostEnumFieldsFromRecord(
      image,
      schemaFieldsByType,
      summary,
      image?.image_url || image?.product_id || ""
    );

    if (topLevelChanged) {
      summary.totalRecordsModified += 1;
    }

    if (Array.isArray(image?.matching_images)) {
      for (const [index, matchingImage] of image.matching_images.entries()) {
        stripGhostEnumFieldsFromRecord(
          matchingImage,
          schemaFieldsByType,
          summary,
          `${image?.product_id || "record"} matching_images[${index}]`
        );
      }
    }
  }

  const changesDetected = summary.totalGhostKeysRemoved > 0;
  if (changesDetected) {
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(indexPath, backupPath);
      console.log(`Created backup: ${backupPath}`);
    } else {
      console.log(`Backup already exists, leaving in place: ${backupPath}`);
    }
    writeJson(indexPath, index);
    console.log(`Wrote cleaned index: ${indexPath}`);
  } else {
    console.log("No ghost enum_fields found. No files changed.");
  }

  const perTypeRecordsModified = Object.fromEntries(
    [...summary.perTypeRecordsModified.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  );
  const perFieldRemovals = Object.fromEntries(
    [...summary.perFieldRemovals.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  );

  console.log("Summary:");
  console.log(JSON.stringify({
    total_records_scanned: summary.totalRecordsScanned,
    total_records_modified: summary.totalRecordsModified,
    total_ghost_keys_removed: summary.totalGhostKeysRemoved,
    skipped_missing_type: summary.skippedMissingType,
    skipped_unknown_type: summary.skippedUnknownType,
    records_modified_per_type: perTypeRecordsModified,
    ghost_field_removals: perFieldRemovals
  }, null, 2));

  if (summary.sampleTrail.length) {
    console.log("Sample trail:");
    summary.sampleTrail.forEach((line) => console.log(`- ${line}`));
  }
}

main();
