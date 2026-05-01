#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");

const indexPath = path.join(rootDir, "data", "image-index.json");
const backupPath = path.join(rootDir, "data", "image-index.pre-stage4-arm-trait-rename-backup.json");

const VALUE_RENAMES = Object.freeze({
  narrow_arms: Object.freeze({
    yes: "Narrower",
    no: "Wider"
  }),
  arms_flush_with_back: Object.freeze({
    yes: "Flush with Back",
    no: "Below Back"
  })
});

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

function renameTraitValue(container = null, field = "", summary = {}, variantSummary = {}) {
  if (!container || typeof container !== "object") {
    return false;
  }
  const value = container[field];
  const mapping = VALUE_RENAMES[field];
  if (value === null || value === undefined || !mapping) {
    return false;
  }
  const rawValue = String(value).trim();
  const normalizedValue = rawValue.toLowerCase();
  const renamed = mapping[normalizedValue];
  if (!renamed || container[field] === renamed) {
    return false;
  }
  container[field] = renamed;
  summary[field] = (summary[field] || 0) + 1;
  if (!variantSummary[field]) {
    variantSummary[field] = {};
  }
  variantSummary[field][rawValue] = (variantSummary[field][rawValue] || 0) + 1;
  return true;
}

async function main() {
  const originalIndex = JSON.parse(await fs.readFile(indexPath, "utf8"));
  const images = Array.isArray(originalIndex.images) ? originalIndex.images : [];

  const backupCreated = await ensureBackup(backupPath, originalIndex);

  const updatedCounts = {
    narrow_arms: 0,
    arms_flush_with_back: 0
  };
  const updatedVariants = {
    narrow_arms: {},
    arms_flush_with_back: {}
  };
  let recordsUpdated = 0;

  for (const image of images) {
    let recordChanged = false;
    for (const field of Object.keys(VALUE_RENAMES)) {
      const changedEnumField = renameTraitValue(image?.enum_fields, field, updatedCounts, updatedVariants);
      const changedImageTrait = renameTraitValue(image?.image_traits, field, updatedCounts, updatedVariants);
      recordChanged = recordChanged || changedEnumField || changedImageTrait;
    }
    if (recordChanged) {
      recordsUpdated += 1;
    }
  }

  const nextIndex = {
    ...originalIndex,
    generated_at: new Date().toISOString(),
    images
  };

  await fs.writeFile(indexPath, `${JSON.stringify(nextIndex, null, 2)}\n`);

  console.log(JSON.stringify({
    backup_created_at: backupPath,
    backup_created: backupCreated,
    records_scanned: images.length,
    records_updated: recordsUpdated,
    updates: updatedCounts,
    updated_input_variants: updatedVariants
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
