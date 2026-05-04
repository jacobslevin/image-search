import test from "node:test";
import assert from "node:assert/strict";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  clearVisualTypesRegistryCache,
  createVisualTypesRegistry,
  getCategoryFields,
  getVisualTypesRegistryPath,
  listVisualTypes,
  loadVisualTypesRegistry,
  resolveRoutingKey,
  resolveSharedField
} from "../src/visual-types-registry.js";

test("visual types registry initializes successfully against the current registry", () => {
  clearVisualTypesRegistryCache();
  const registry = loadVisualTypesRegistry({ forceReload: true });
  assert.equal(registry.canonicalRoutingField, "visual_type");
  assert.equal(registry.registryPath, getVisualTypesRegistryPath());
});

test("resolveSharedField expands shared value_set definitions", () => {
  clearVisualTypesRegistryCache();
  const field = resolveSharedField("design_register", { forceReload: true });
  assert.equal(field.field, "design_register");
  assert.equal(field.type, "enum");
  assert.equal(field.value_set, "design_register_v1");
  assert.deepEqual(field.allowed_values, [
    "Minimal",
    "Organic",
    "Industrial",
    "Traditional",
    "Sculptural",
    "Utilitarian",
    "unknown"
  ]);
});

test("getCategoryFields resolves inherited seating and tables fields", () => {
  const loungeFields = getCategoryFields("seating", "lounge_chair", { forceReload: true });
  const loungeDesignRegister = loungeFields.find((field) => field.field === "design_register");
  assert.ok(loungeDesignRegister);
  assert.deepEqual(loungeDesignRegister.allowed_values, [
    "Minimal",
    "Organic",
    "Industrial",
    "Traditional",
    "Sculptural",
    "Utilitarian",
    "unknown"
  ]);
  assert.equal(loungeDesignRegister.detectability, "yes");

  const conferenceFields = getCategoryFields("tables", "conference");
  const tableBaseFinish = conferenceFields.find((field) => field.field === "base_finish");
  assert.ok(tableBaseFinish);
  assert.equal(tableBaseFinish.value_set, "finish_palette_v1");
  assert.deepEqual(tableBaseFinish.allowed_values, [
    "Polished chrome / nickel",
    "Brushed nickel / stainless",
    "Matte black",
    "Warm gold / brass",
    "Bronze / dark",
    "White",
    "Gray",
    "Painted color",
    "Unknown"
  ]);
});

test("shared finish palette uses Title case values and includes Gray, Painted color, and Unknown", () => {
  const finishField = resolveSharedField("finish", { forceReload: true });
  assert.deepEqual(finishField.allowed_values, [
    "Polished chrome / nickel",
    "Brushed nickel / stainless",
    "Matte black",
    "Warm gold / brass",
    "Bronze / dark",
    "White",
    "Gray",
    "Painted color",
    "Unknown"
  ]);
  assert.ok(finishField.allowed_values.every((value) => /[A-Z]/.test(value[0])));
});

test("tables and faucets docs reference the refined shared finish palette values", () => {
  const tablesDoc = fsSync.readFileSync(new URL("../docs/v2-categories/tables.md", import.meta.url), "utf8");
  const faucetsDoc = fsSync.readFileSync(new URL("../docs/v2-categories/faucets.md", import.meta.url), "utf8");

  assert.match(tablesDoc, /Painted color/);
  assert.match(tablesDoc, /Gray/);
  assert.match(tablesDoc, /Unknown/);
  assert.match(faucetsDoc, /Painted color/);
  assert.match(faucetsDoc, /Gray/);
  assert.match(faucetsDoc, /Unknown/);
});

test("getCategoryFields narrows allowed_subset for faucet design_register", () => {
  const fields = getCategoryFields("faucets", "kitchen_faucet", { forceReload: true });
  const designRegister = fields.find((field) => field.field === "design_register");
  assert.ok(designRegister);
  assert.equal(designRegister.inherits, "design_register");
  assert.deepEqual(designRegister.allowed_values, ["Minimal", "Traditional", "unknown"]);
});

test("getCategoryFields returns the expected flat field lists across families", () => {
  assert.equal(getCategoryFields("seating", "guest_chair").length, 9);
  assert.equal(getCategoryFields("tables", "training").length, 11);
  assert.equal(getCategoryFields("faucets", "bathroom_lavatory_faucet").length, 9);
});

test("listVisualTypes and resolveRoutingKey expose canonical routing with compatibility alias support", () => {
  const visualTypes = listVisualTypes({ forceReload: true });
  assert.ok(visualTypes.some((entry) => entry.family === "seating" && entry.visual_type === "bench"));
  assert.ok(visualTypes.some((entry) => entry.family === "tables" && entry.visual_type === "conference"));
  assert.ok(visualTypes.some((entry) => entry.family === "faucets" && entry.visual_type === "kitchen_faucet"));

  assert.deepEqual(resolveRoutingKey("lounge_chair"), {
    source_field: "visual_type",
    visual_type: "lounge_chair",
    family: "seating",
    label: "Lounge Chair",
    family_label: "Seating"
  });

  assert.deepEqual(resolveRoutingKey({ seating_type: "bench" }), {
    source_field: "seating_type",
    visual_type: "bench",
    family: "seating",
    label: "Bench",
    family_label: "Seating"
  });
});

test("registry validation throws on dangling value_set references", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "visual-types-registry-"));
  const invalidPath = path.join(tmpDir, "invalid-visual-types.json");
  await fs.writeFile(
    invalidPath,
    JSON.stringify(
      {
        version: "2.0",
        canonical_routing_field: "visual_type",
        legacy_aliases: {},
        shared_values: {},
        shared_fields: {
          design_register: {
            type: "enum",
            value_set: "missing_value_set"
          }
        },
        families: {},
        defaults: {}
      },
      null,
      2
    )
  );

  assert.throws(
    () => createVisualTypesRegistry({ registryPath: invalidPath }),
    /shared_fields\.design_register references unknown value_set "missing_value_set"/
  );
});
