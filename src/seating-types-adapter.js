import { createVisualTypesRegistry, getVisualTypesRegistryPath } from "./visual-types-registry.js";

const adapterCache = new Map();
const LEGACY_SEATING_TYPES_VERSION = "1.0";
const SEATING_FAMILY_KEY = "seating";

function cloneValue(value) {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function getLegacyDefaultType(registry = {}) {
  const candidate = String(registry?.defaults?.visual_type || "").trim();
  if (!candidate) {
    return "";
  }

  const category = registry?.families?.[SEATING_FAMILY_KEY]?.categories?.[candidate];
  return category ? candidate : "";
}

function toLegacyFieldShape(field = {}) {
  const legacy = {
    field: field.field,
    type: field.type,
    detectability: field.detectability,
    allowed_values: cloneValue(field.allowed_values || [])
  };

  if (field.priority !== undefined) {
    legacy.priority = field.priority;
  }

  if (Array.isArray(field.groups) && field.groups.length) {
    legacy.groups = cloneValue(field.groups);
  }

  if (field.value_definitions && typeof field.value_definitions === "object") {
    legacy.value_definitions = cloneValue(field.value_definitions);
  }

  return legacy;
}

export function createSeatingTypesAdapter(options = {}) {
  const registryPath = options.registryPath || getVisualTypesRegistryPath();
  const registryApi = createVisualTypesRegistry({ registryPath });
  const registry = registryApi.getRegistry();
  const seatingFamily = registry?.families?.[SEATING_FAMILY_KEY];

  if (!seatingFamily || typeof seatingFamily !== "object") {
    throw new Error(`Visual types registry does not define family "${SEATING_FAMILY_KEY}"`);
  }

  const categories = seatingFamily.categories || {};
  const types = {};

  for (const [typeKey, typeConfig] of Object.entries(categories)) {
    types[typeKey] = {
      label: typeConfig?.label || typeKey,
      visual_summary_categories: Array.isArray(typeConfig?.visual_summary_categories)
        ? cloneValue(typeConfig.visual_summary_categories)
        : [],
      fields: registryApi.getCategoryFields(SEATING_FAMILY_KEY, typeKey).map(toLegacyFieldShape)
    };
  }

  return {
    version: LEGACY_SEATING_TYPES_VERSION,
    default_type: getLegacyDefaultType(registry),
    types
  };
}

export function loadSeatingTypesAdapter(options = {}) {
  const registryPath = options.registryPath || getVisualTypesRegistryPath();
  if (!options.forceReload && adapterCache.has(registryPath)) {
    return cloneValue(adapterCache.get(registryPath));
  }
  const config = createSeatingTypesAdapter({ registryPath });
  adapterCache.set(registryPath, config);
  return cloneValue(config);
}

export function clearSeatingTypesAdapterCache() {
  adapterCache.clear();
}
