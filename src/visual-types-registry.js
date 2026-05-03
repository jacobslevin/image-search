import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");

const registryCache = new Map();

function cloneValue(value) {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function resolveOverridePath(envName, defaultPath) {
  const rawValue = String(process.env[envName] || "").trim();
  if (!rawValue) {
    return defaultPath;
  }
  return path.isAbsolute(rawValue) ? rawValue : path.resolve(ROOT_DIR, rawValue);
}

export function getVisualTypesRegistryPath() {
  return resolveOverridePath("VISUAL_TYPES_REGISTRY_PATH", path.join(DATA_DIR, "visual-types.json"));
}

function readRegistryJson(registryPath) {
  try {
    return JSON.parse(fsSync.readFileSync(registryPath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      error.message = `Invalid JSON in visual types registry at ${registryPath}: ${error.message}`;
    }
    throw error;
  }
}

function buildCategoryLookup(families = {}) {
  const lookup = new Map();
  for (const [familyName, family] of Object.entries(families || {})) {
    for (const [categoryName, category] of Object.entries(family?.categories || {})) {
      if (lookup.has(categoryName)) {
        throw new Error(
          `Duplicate visual_type category key "${categoryName}" found in multiple families`
        );
      }
      lookup.set(categoryName, {
        family: familyName,
        category: categoryName,
        family_label: family?.label || familyName,
        label: category?.label || categoryName
      });
    }
  }
  return lookup;
}

function ensureEnumValues(fieldDefinition, fieldLabel) {
  if (fieldDefinition.type !== "enum") {
    return;
  }
  if (!Array.isArray(fieldDefinition.allowed_values)) {
    throw new Error(`${fieldLabel} must resolve to an enum allowed_values array`);
  }
}

function validateSharedFields(sharedValues = {}, sharedFields = {}) {
  for (const [fieldName, fieldDefinition] of Object.entries(sharedFields || {})) {
    if (!fieldDefinition || typeof fieldDefinition !== "object") {
      throw new Error(`shared_fields.${fieldName} must be an object`);
    }
    const valueSetName = fieldDefinition.value_set;
    if (valueSetName) {
      if (!sharedValues[valueSetName]) {
        throw new Error(
          `shared_fields.${fieldName} references unknown value_set "${valueSetName}"`
        );
      }
      if (!Array.isArray(sharedValues[valueSetName].values)) {
        throw new Error(`shared_values.${valueSetName}.values must be an array`);
      }
    }
  }
}

function resolveSharedFieldDefinition(fieldName, sharedFieldDefinition, sharedValues) {
  const resolved = cloneValue(sharedFieldDefinition);
  resolved.field = fieldName;
  if (resolved.value_set) {
    const valueSet = sharedValues[resolved.value_set];
    resolved.allowed_values = cloneValue(valueSet.values);
    if (valueSet.labels) {
      resolved.value_labels = cloneValue(valueSet.labels);
    }
  }
  return resolved;
}

function resolveCategoryFieldDefinition(fieldDefinition, sharedFields, sharedValues, contextLabel) {
  let resolved = {};
  if (fieldDefinition.inherits) {
    const sharedFieldDefinition = sharedFields[fieldDefinition.inherits];
    if (!sharedFieldDefinition) {
      throw new Error(`${contextLabel} inherits unknown shared_field "${fieldDefinition.inherits}"`);
    }
    resolved = resolveSharedFieldDefinition(fieldDefinition.inherits, sharedFieldDefinition, sharedValues);
  }

  resolved = {
    ...resolved,
    ...cloneValue(fieldDefinition)
  };

  if (resolved.allowed_subset) {
    ensureEnumValues(resolved, contextLabel);
    const parentValues = new Set(resolved.allowed_values);
    for (const value of resolved.allowed_subset) {
      if (!parentValues.has(value)) {
        throw new Error(`${contextLabel} allowed_subset includes "${value}" outside parent enum`);
      }
    }
    resolved.allowed_values = cloneValue(resolved.allowed_subset);
  }

  if (resolved.value_set && !resolved.allowed_values) {
    const valueSet = sharedValues[resolved.value_set];
    if (!valueSet) {
      throw new Error(`${contextLabel} references unknown value_set "${resolved.value_set}"`);
    }
    resolved.allowed_values = cloneValue(valueSet.values);
    if (valueSet.labels) {
      resolved.value_labels = cloneValue(valueSet.labels);
    }
  }

  ensureEnumValues(resolved, contextLabel);
  return resolved;
}

export function validateVisualTypesRegistryData(registry) {
  if (!registry || typeof registry !== "object") {
    throw new Error("visual types registry must be a JSON object");
  }

  validateSharedFields(registry.shared_values, registry.shared_fields);

  for (const [familyName, family] of Object.entries(registry.families || {})) {
    for (const [categoryName, category] of Object.entries(family?.categories || {})) {
      const fields = Array.isArray(category?.fields) ? category.fields : [];
      for (const fieldDefinition of fields) {
        const fieldName = fieldDefinition?.field || "(unknown)";
        resolveCategoryFieldDefinition(
          fieldDefinition,
          registry.shared_fields || {},
          registry.shared_values || {},
          `families.${familyName}.categories.${categoryName}.fields.${fieldName}`
        );
      }
    }
  }

  buildCategoryLookup(registry.families || {});
  return true;
}

function createRegistryApi(registryPath, registry) {
  const sharedValues = registry.shared_values || {};
  const sharedFields = registry.shared_fields || {};
  const categoryLookup = buildCategoryLookup(registry.families || {});
  const canonicalRoutingField = registry.canonical_routing_field || "visual_type";
  const legacyAliases = registry.legacy_aliases || {};

  function getRegistry() {
    return cloneValue(registry);
  }

  function resolveSharedField(fieldName) {
    const sharedFieldDefinition = sharedFields[fieldName];
    if (!sharedFieldDefinition) {
      throw new Error(`Unknown shared_field "${fieldName}"`);
    }
    return resolveSharedFieldDefinition(fieldName, sharedFieldDefinition, sharedValues);
  }

  function getCategoryDefinition(familyName, categoryName) {
    const family = registry.families?.[familyName];
    if (!family) {
      throw new Error(`Unknown family "${familyName}"`);
    }
    const category = family.categories?.[categoryName];
    if (!category) {
      throw new Error(`Unknown category "${categoryName}" in family "${familyName}"`);
    }
    return category;
  }

  function getCategoryFields(familyName, categoryName) {
    const category = getCategoryDefinition(familyName, categoryName);
    return (category.fields || []).map((fieldDefinition) =>
      resolveCategoryFieldDefinition(
        fieldDefinition,
        sharedFields,
        sharedValues,
        `families.${familyName}.categories.${categoryName}.fields.${fieldDefinition.field || "(unknown)"}`
      )
    );
  }

  function listVisualTypes() {
    const entries = [];
    for (const [familyName, family] of Object.entries(registry.families || {})) {
      for (const [categoryName, category] of Object.entries(family?.categories || {})) {
        entries.push({
          family: familyName,
          family_label: family?.label || familyName,
          visual_type: categoryName,
          label: category?.label || categoryName
        });
      }
    }
    return entries;
  }

  function resolveRoutingKey(input) {
    let sourceField = canonicalRoutingField;
    let rawValue = "";

    if (typeof input === "string") {
      rawValue = input;
    } else if (input && typeof input === "object") {
      if (input[canonicalRoutingField]) {
        rawValue = input[canonicalRoutingField];
        sourceField = canonicalRoutingField;
      } else {
        for (const [aliasName, aliasDefinition] of Object.entries(legacyAliases)) {
          if (input[aliasName]) {
            rawValue = input[aliasName];
            sourceField = aliasName;
            if (aliasDefinition?.maps_to && aliasDefinition.maps_to !== canonicalRoutingField) {
              throw new Error(
                `Unsupported alias mapping from "${aliasName}" to "${aliasDefinition.maps_to}"`
              );
            }
            break;
          }
        }
      }
    }

    const visualType = String(rawValue || "").trim();
    if (!visualType) {
      return null;
    }

    const categoryInfo = categoryLookup.get(visualType);
    if (!categoryInfo) {
      throw new Error(`Unknown visual_type "${visualType}"`);
    }

    return {
      source_field: sourceField,
      visual_type: categoryInfo.category,
      family: categoryInfo.family,
      label: categoryInfo.label,
      family_label: categoryInfo.family_label
    };
  }

  return {
    registryPath,
    canonicalRoutingField,
    legacyAliases: cloneValue(legacyAliases),
    getRegistry,
    resolveSharedField,
    getCategoryFields,
    listVisualTypes,
    resolveRoutingKey
  };
}

export function createVisualTypesRegistry(options = {}) {
  const registryPath = options.registryPath || getVisualTypesRegistryPath();
  const registry = readRegistryJson(registryPath);
  validateVisualTypesRegistryData(registry);
  return createRegistryApi(registryPath, registry);
}

export function loadVisualTypesRegistry(options = {}) {
  const registryPath = options.registryPath || getVisualTypesRegistryPath();
  if (!options.forceReload && registryCache.has(registryPath)) {
    return registryCache.get(registryPath);
  }
  const api = createVisualTypesRegistry({ registryPath });
  registryCache.set(registryPath, api);
  return api;
}

export function clearVisualTypesRegistryCache() {
  registryCache.clear();
}

export function resolveSharedField(fieldName, options = {}) {
  return loadVisualTypesRegistry(options).resolveSharedField(fieldName);
}

export function getCategoryFields(familyName, categoryName, options = {}) {
  return loadVisualTypesRegistry(options).getCategoryFields(familyName, categoryName);
}

export function listVisualTypes(options = {}) {
  return loadVisualTypesRegistry(options).listVisualTypes();
}

export function resolveRoutingKey(input, options = {}) {
  return loadVisualTypesRegistry(options).resolveRoutingKey(input);
}
