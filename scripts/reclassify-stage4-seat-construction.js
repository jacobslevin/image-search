#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");

const indexPath = path.join(rootDir, "data", "image-index.json");
const backupPath = path.join(rootDir, "data", "image-index.pre-stage4-seat-construction-reclassify-backup.json");

const VALUE_BUCKETS = Object.freeze({
  present: ["Yes", "No"],
  triState: ["Yes", "No", "N/A"]
});

function unwrapVoteValue(value) {
  if (value && typeof value === "object" && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, "value")) {
    return value.value;
  }
  return value;
}

function normalizeValue(value, allowedValues = []) {
  if (value === null || value === undefined) {
    return null;
  }
  const raw = String(value).trim();
  if (!raw) {
    return null;
  }
  const match = allowedValues.find((entry) => entry.toLowerCase() === raw.toLowerCase());
  return match || null;
}

function normalizeHeight(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return numeric;
}

function classifySeatConstruction(raw = {}) {
  return raw.upholstered_base_present === "Yes"
    && raw.upholstered_base_same_material === "Yes"
    && raw.upholstered_base_seam_visible === "Yes"
    && Number.isFinite(Number(raw.upholstered_base_height_inches))
    && Number(raw.upholstered_base_height_inches) >= 2.5
    ? "Cushion on Platform"
    : "Cushion Only";
}

function hasAnyRawSeatObservation(measurements = {}) {
  return [
    measurements?.upholstered_base_present,
    measurements?.upholstered_base_same_material,
    measurements?.upholstered_base_seam_visible,
    measurements?.upholstered_base_height_inches
  ].some((value) => value !== undefined && value !== null);
}

function analyzeRawSeatObservations(measurements = {}) {
  const rawPresent = unwrapVoteValue(measurements?.upholstered_base_present);
  const rawSameMaterial = unwrapVoteValue(measurements?.upholstered_base_same_material);
  const rawSeamVisible = unwrapVoteValue(measurements?.upholstered_base_seam_visible);
  const rawHeight = measurements?.upholstered_base_height_inches;

  const normalized = {
    upholstered_base_present: normalizeValue(rawPresent, VALUE_BUCKETS.present),
    upholstered_base_same_material: normalizeValue(rawSameMaterial, VALUE_BUCKETS.triState),
    upholstered_base_seam_visible: normalizeValue(rawSeamVisible, VALUE_BUCKETS.triState),
    upholstered_base_height_inches: normalizeHeight(rawHeight)
  };

  const issues = [];
  if (rawPresent !== undefined && rawPresent !== null && normalized.upholstered_base_present === null) {
    issues.push(`unparseable_present:${String(rawPresent)}`);
  }
  if (rawSameMaterial !== undefined && rawSameMaterial !== null && normalized.upholstered_base_same_material === null) {
    issues.push(`unparseable_same_material:${String(rawSameMaterial)}`);
  }
  if (rawSeamVisible !== undefined && rawSeamVisible !== null && normalized.upholstered_base_seam_visible === null) {
    issues.push(`unparseable_seam_visible:${String(rawSeamVisible)}`);
  }
  if (rawHeight !== undefined && rawHeight !== null && normalized.upholstered_base_height_inches === null) {
    issues.push(`unparseable_height:${String(rawHeight)}`);
  }

  const present = normalized.upholstered_base_present;
  const sameMaterial = normalized.upholstered_base_same_material;
  const seamVisible = normalized.upholstered_base_seam_visible;

  if (present === "No" && sameMaterial && sameMaterial !== "N/A") {
    issues.push(`inconsistent_same_material_with_present_no:${sameMaterial}`);
  }
  if (present === "No" && seamVisible && seamVisible !== "N/A") {
    issues.push(`inconsistent_seam_visible_with_present_no:${seamVisible}`);
  }
  if (present === "Yes" && sameMaterial === "N/A") {
    issues.push("inconsistent_same_material_na_with_present_yes");
  }
  if (present === "Yes" && seamVisible === "N/A") {
    issues.push("inconsistent_seam_visible_na_with_present_yes");
  }

  return {
    normalized,
    issues
  };
}

async function ensureBackup(filePath, contents) {
  try {
    await fs.access(filePath);
    return false;
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.writeFile(filePath, `${JSON.stringify(contents, null, 2)}\n`);
      return true;
    }
    throw error;
  }
}

function setSeatConstruction(container = null, nextValue = "") {
  if (!container || typeof container !== "object") {
    return false;
  }
  if (container.seat_construction === nextValue) {
    return false;
  }
  container.seat_construction = nextValue;
  return true;
}

async function main() {
  const originalIndex = JSON.parse(await fs.readFile(indexPath, "utf8"));
  const images = Array.isArray(originalIndex.images) ? originalIndex.images : [];
  const backupCreated = await ensureBackup(backupPath, originalIndex);

  const summary = {
    backup_created_at: backupPath,
    backup_created: backupCreated,
    records_scanned: images.length,
    records_with_raw_observations: 0,
    records_updated: 0,
    new_value_distribution: {
      "Cushion Only": 0,
      "Cushion on Platform": 0
    },
    stored_before_distribution: {},
    issue_record_count: 0,
    issue_counts: {},
    issue_examples: []
  };

  for (const image of images) {
    const measurements = image?.post_stage23_lounge_sofa_traits?.measurements || {};
    if (!hasAnyRawSeatObservation(measurements)) {
      continue;
    }

    summary.records_with_raw_observations += 1;

    const priorValue = image?.enum_fields?.seat_construction ?? image?.image_traits?.seat_construction ?? null;
    const priorKey = priorValue === null || priorValue === undefined ? "<<missing>>" : String(priorValue);
    summary.stored_before_distribution[priorKey] = (summary.stored_before_distribution[priorKey] || 0) + 1;

    const analyzed = analyzeRawSeatObservations(measurements);
    const nextValue = classifySeatConstruction(analyzed.normalized);
    summary.new_value_distribution[nextValue] = (summary.new_value_distribution[nextValue] || 0) + 1;

    if (analyzed.issues.length) {
      summary.issue_record_count += 1;
      for (const issue of analyzed.issues) {
        summary.issue_counts[issue] = (summary.issue_counts[issue] || 0) + 1;
      }
      if (summary.issue_examples.length < 20) {
        summary.issue_examples.push({
          product_id: image.product_id || null,
          product_name: image.product_name || null,
          image_url: image.image_url || null,
          issues: analyzed.issues,
          raw: {
            upholstered_base_present: unwrapVoteValue(measurements?.upholstered_base_present),
            upholstered_base_same_material: unwrapVoteValue(measurements?.upholstered_base_same_material),
            upholstered_base_seam_visible: unwrapVoteValue(measurements?.upholstered_base_seam_visible),
            upholstered_base_height_inches: measurements?.upholstered_base_height_inches ?? null
          },
          normalized: analyzed.normalized,
          prior_value: priorValue,
          next_value: nextValue
        });
      }
    }

    const changedEnumField = setSeatConstruction(image?.enum_fields, nextValue);
    const changedImageTrait = setSeatConstruction(image?.image_traits, nextValue);
    if (changedEnumField || changedImageTrait) {
      summary.records_updated += 1;
    }
  }

  const nextIndex = {
    ...originalIndex,
    generated_at: new Date().toISOString(),
    images
  };

  await fs.writeFile(indexPath, `${JSON.stringify(nextIndex, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
