import { loadSeatingTypesAdapter } from "./seating-types-adapter.js";
import { loadVisualTypesRegistry } from "./visual-types-registry.js";

function cloneValue(value) {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function toLegacyFieldShape(field = {}) {
  const legacy = {
    field: field.field,
    type: field.type,
    allowed_values: cloneValue(field.allowed_values || [])
  };

  if (field.priority !== undefined) {
    legacy.priority = field.priority;
  }

  if (field.detectability !== undefined) {
    legacy.detectability = field.detectability;
  }

  if (Array.isArray(field.groups) && field.groups.length) {
    legacy.groups = cloneValue(field.groups);
  }

  if (field.value_definitions && typeof field.value_definitions === "object") {
    legacy.value_definitions = cloneValue(field.value_definitions);
  }

  return legacy;
}

export function createVisualTypesBootstrapConfig(options = {}) {
  const seatingTypesConfig = options.seatingTypesConfig || loadSeatingTypesAdapter(options);
  const registryApi = options.registryApi || loadVisualTypesRegistry(options);
  const registry = registryApi.getRegistry();
  const types = cloneValue(seatingTypesConfig?.types || {});

  for (const [familyName, family] of Object.entries(registry?.families || {})) {
    for (const [categoryName, category] of Object.entries(family?.categories || {})) {
      if (types[categoryName]) {
        continue;
      }
      const nextType = {
        label: category?.label || categoryName,
        fields: registryApi.getCategoryFields(familyName, categoryName).map(toLegacyFieldShape)
      };
      if (Array.isArray(category?.visual_summary_categories) && category.visual_summary_categories.length) {
        nextType.visual_summary_categories = cloneValue(category.visual_summary_categories);
      }
      types[categoryName] = nextType;
    }
  }

  return {
    version: String(registry?.version || seatingTypesConfig?.version || "").trim(),
    default_type: String(seatingTypesConfig?.default_type || "").trim(),
    types
  };
}

export function getAllVisualTypeOptions(options = {}) {
  const registryApi = options.registryApi || loadVisualTypesRegistry(options);
  return registryApi.listVisualTypes().map((entry) => entry.visual_type);
}

export function buildVisualTypeFamilyMap(options = {}) {
  const registryApi = options.registryApi || loadVisualTypesRegistry(options);
  return Object.fromEntries(
    registryApi.listVisualTypes().map((entry) => [entry.visual_type, entry.family])
  );
}

export function buildVisualTypeFamilyLabels(options = {}) {
  const registryApi = options.registryApi || loadVisualTypesRegistry(options);
  const families = registryApi.getRegistry()?.families || {};
  return Object.fromEntries(
    Object.entries(families).map(([familyKey, familyConfig]) => [familyKey, String(familyConfig?.label || familyKey).trim()])
  );
}

export function buildBootstrapSchemaPayload(options = {}) {
  const seatingTypesConfig = options.seatingTypesConfig || loadSeatingTypesAdapter(options);
  const registryApi = options.registryApi || loadVisualTypesRegistry(options);
  const visualTypesConfig = options.visualTypesConfig || createVisualTypesBootstrapConfig({
    ...options,
    seatingTypesConfig,
    registryApi
  });
  const visibleVisualTypeOptions = getAllVisualTypeOptions({
    ...options,
    registryApi
  }).filter((visualType) => {
    const entry = registryApi.resolveRoutingKey(visualType);
    return entry?.family === "seating" || entry?.family === "tables";
  });

  return {
    seating_types: cloneValue(seatingTypesConfig),
    visual_types: cloneValue(visualTypesConfig),
    seating_category_options: Object.keys(seatingTypesConfig?.types || {}),
    visual_type_options: visibleVisualTypeOptions,
    visual_type_family_map: buildVisualTypeFamilyMap({ ...options, registryApi }),
    visual_type_family_labels: buildVisualTypeFamilyLabels({ ...options, registryApi }),
    legacy_aliases: cloneValue(registryApi.legacyAliases || {})
  };
}
