import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  clearSeatingTypesAdapterCache,
  createSeatingTypesAdapter,
  loadSeatingTypesAdapter
} from "../src/seating-types-adapter.js";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

test("adapter output deep-matches the existing seating-types.json file", () => {
  clearSeatingTypesAdapterCache();
  const expected = readJson(path.join(process.cwd(), "data", "seating-types.json"));
  const actual = loadSeatingTypesAdapter({ forceReload: true });
  assert.deepStrictEqual(actual, expected);
});

test("adapter preserves seating category field counts and field ordering", () => {
  clearSeatingTypesAdapterCache();
  const expected = readJson(path.join(process.cwd(), "data", "seating-types.json"));
  const actual = loadSeatingTypesAdapter({ forceReload: true });

  for (const [typeKey, typeConfig] of Object.entries(expected.types || {})) {
    const expectedFields = (typeConfig.fields || []).map((field) => field.field);
    const actualFields = (actual.types?.[typeKey]?.fields || []).map((field) => field.field);
    assert.equal(actual.types?.[typeKey]?.fields?.length || 0, (typeConfig.fields || []).length, `${typeKey} field count`);
    assert.deepStrictEqual(actualFields, expectedFields, `${typeKey} field order`);
  }

  assert.equal(actual.default_type, expected.default_type);
});

test("adapter preserves per-field allowed_values, priority, and detectability", () => {
  clearSeatingTypesAdapterCache();
  const expected = readJson(path.join(process.cwd(), "data", "seating-types.json"));
  const actual = loadSeatingTypesAdapter({ forceReload: true });

  for (const [typeKey, typeConfig] of Object.entries(expected.types || {})) {
    const actualFields = new Map((actual.types?.[typeKey]?.fields || []).map((field) => [field.field, field]));
    for (const expectedField of typeConfig.fields || []) {
      const actualField = actualFields.get(expectedField.field);
      assert.ok(actualField, `${typeKey}.${expectedField.field} exists`);
      assert.deepStrictEqual(actualField.allowed_values, expectedField.allowed_values, `${typeKey}.${expectedField.field} allowed_values`);
      assert.equal(actualField.priority, expectedField.priority, `${typeKey}.${expectedField.field} priority`);
      assert.equal(actualField.detectability, expectedField.detectability, `${typeKey}.${expectedField.field} detectability`);
    }
  }
});

test("adapter works from a stub registry without reading seating-types.json directly", async () => {
  clearSeatingTypesAdapterCache();
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "seating-types-adapter-"));
  const registryPath = path.join(tmpDir, "visual-types.json");
  await fsp.writeFile(
    registryPath,
    JSON.stringify(
      {
        version: "2.0",
        canonical_routing_field: "visual_type",
        legacy_aliases: {
          seating_type: {
            maps_to: "visual_type",
            status: "compatibility_alias"
          }
        },
        shared_values: {
          design_register_v1: {
            kind: "enum",
            values: ["Minimal", "Traditional", "unknown"]
          }
        },
        shared_fields: {
          design_register: {
            type: "enum",
            value_set: "design_register_v1"
          }
        },
        families: {
          seating: {
            label: "Seating",
            categories: {
              lounge_chair: {
                label: "Lounge Chair",
                visual_summary_categories: ["lounge chair"],
                fields: [
                  {
                    field: "design_register",
                    inherits: "design_register",
                    detectability: "yes",
                    priority: "essential"
                  }
                ]
              }
            }
          }
        },
        defaults: {
          visual_type: ""
        }
      },
      null,
      2
    )
  );

  const actual = createSeatingTypesAdapter({ registryPath });
  assert.deepStrictEqual(actual, {
    version: "1.0",
    default_type: "",
    types: {
      lounge_chair: {
        label: "Lounge Chair",
        visual_summary_categories: ["lounge chair"],
        fields: [
          {
            field: "design_register",
            type: "enum",
            detectability: "yes",
            priority: "essential",
            allowed_values: ["Minimal", "Traditional", "unknown"]
          }
        ]
      }
    }
  });
});
