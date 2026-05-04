import { normalizeVisualTypeKey } from "./category-scope.js";

const LEGACY_VISUAL_TYPE_DISPLAY_NAMES = {
  task_collab_chair: "Work Chairs",
  guest_chair: "Multi-Use / Guest Chairs",
  lounge_chair: "Lounge Seating",
  bench: "Benches",
  stool: "Stools"
};

const TABLE_VISUAL_TYPES_FALLBACK = {
  conference: {
    label: "Conference",
    fields: [
      { field: "design_register", type: "enum", allowed_values: ["Minimal", "Organic", "Industrial", "Traditional", "Sculptural", "Utilitarian", "unknown"], priority: "high", detectability: "medium_high" },
      { field: "base_type", type: "enum", allowed_values: ["Pedestal", "4-leg", "Trestle", "T-leg", "X-base", "Tripod", "Panel-slab", "unknown"], priority: "high", detectability: "high" },
      { field: "top_shape", type: "enum", allowed_values: ["Round", "Square", "Rectangle", "Oval", "Soft-organic", "unknown"], priority: "high", detectability: "high" },
      { field: "top_material", type: "enum", allowed_values: ["Wood-look", "Stone-look", "Solid-color", "Glass", "Metal", "unknown"], priority: "high", detectability: "medium" },
      { field: "base_visual_weight", type: "enum", allowed_values: ["Heavy/grounded", "Light/airy", "unknown"], priority: "medium", detectability: "high" },
      { field: "base_finish", type: "enum", allowed_values: ["polished_chrome_nickel", "brushed_nickel_stainless", "matte_black", "warm_gold_brass", "bronze_dark", "white", "colored"], priority: "medium", detectability: "medium" },
      { field: "mobility", type: "enum", allowed_values: ["Casters", "Non-mobile", "unknown"], priority: "low", detectability: "high_when_visible" },
      { field: "top_thickness", type: "enum", allowed_values: ["Thin", "Standard", "Thick-slab", "unknown"], priority: "low", detectability: "medium" },
      { field: "edge_profile", type: "enum", allowed_values: ["Square", "Eased", "Beveled", "unknown"], priority: "low", detectability: "low_medium" },
      { field: "power_data_integration", type: "enum", allowed_values: ["Present", "Not visible", "unknown"], priority: "medium", detectability: "high_when_present" }
    ]
  },
  occasional: {
    label: "Occasional",
    fields: [
      { field: "design_register", type: "enum", allowed_values: ["Minimal", "Organic", "Industrial", "Traditional", "Sculptural", "Utilitarian", "unknown"], priority: "high", detectability: "medium_high" },
      { field: "base_type", type: "enum", allowed_values: ["Pedestal", "4-leg", "Trestle", "T-leg", "X-base", "Tripod", "Panel-slab", "unknown"], priority: "high", detectability: "high" },
      { field: "top_shape", type: "enum", allowed_values: ["Round", "Square", "Rectangle", "Oval", "Soft-organic", "unknown"], priority: "high", detectability: "high" },
      { field: "top_material", type: "enum", allowed_values: ["Wood-look", "Stone-look", "Solid-color", "Glass", "Metal", "unknown"], priority: "high", detectability: "medium" },
      { field: "base_visual_weight", type: "enum", allowed_values: ["Heavy/grounded", "Light/airy", "unknown"], priority: "medium", detectability: "high" },
      { field: "base_finish", type: "enum", allowed_values: ["polished_chrome_nickel", "brushed_nickel_stainless", "matte_black", "warm_gold_brass", "bronze_dark", "white", "colored"], priority: "medium", detectability: "medium" },
      { field: "mobility", type: "enum", allowed_values: ["Casters", "Non-mobile", "unknown"], priority: "low", detectability: "high_when_visible" },
      { field: "top_thickness", type: "enum", allowed_values: ["Thin", "Standard", "Thick-slab", "unknown"], priority: "low", detectability: "medium" },
      { field: "edge_profile", type: "enum", allowed_values: ["Square", "Eased", "Beveled", "unknown"], priority: "low", detectability: "low_medium" },
      { field: "height_register", type: "enum", allowed_values: ["Coffee", "End/Side", "unknown"], priority: "medium", detectability: "high" }
    ]
  },
  cafe_dining: {
    label: "Cafe/Dining",
    fields: [
      { field: "design_register", type: "enum", allowed_values: ["Minimal", "Organic", "Industrial", "Traditional", "Sculptural", "Utilitarian", "unknown"], priority: "high", detectability: "medium_high" },
      { field: "base_type", type: "enum", allowed_values: ["Pedestal", "4-leg", "Trestle", "T-leg", "X-base", "Tripod", "Panel-slab", "unknown"], priority: "high", detectability: "high" },
      { field: "top_shape", type: "enum", allowed_values: ["Round", "Square", "Rectangle", "Oval", "Soft-organic", "unknown"], priority: "high", detectability: "high" },
      { field: "top_material", type: "enum", allowed_values: ["Wood-look", "Stone-look", "Solid-color", "Glass", "Metal", "unknown"], priority: "high", detectability: "medium" },
      { field: "base_visual_weight", type: "enum", allowed_values: ["Heavy/grounded", "Light/airy", "unknown"], priority: "medium", detectability: "high" },
      { field: "base_finish", type: "enum", allowed_values: ["polished_chrome_nickel", "brushed_nickel_stainless", "matte_black", "warm_gold_brass", "bronze_dark", "white", "colored"], priority: "medium", detectability: "medium" },
      { field: "mobility", type: "enum", allowed_values: ["Casters", "Non-mobile", "unknown"], priority: "low", detectability: "high_when_visible" },
      { field: "top_thickness", type: "enum", allowed_values: ["Thin", "Standard", "Thick-slab", "unknown"], priority: "low", detectability: "medium" },
      { field: "edge_profile", type: "enum", allowed_values: ["Square", "Eased", "Beveled", "unknown"], priority: "low", detectability: "low_medium" },
      { field: "height_register", type: "enum", allowed_values: ["Sitting", "Standing", "unknown"], priority: "medium", detectability: "high" }
    ]
  },
  training: {
    label: "Training",
    fields: [
      { field: "design_register", type: "enum", allowed_values: ["Minimal", "Organic", "Industrial", "Traditional", "Sculptural", "Utilitarian", "unknown"], priority: "high", detectability: "medium_high" },
      { field: "base_type", type: "enum", allowed_values: ["Pedestal", "4-leg", "Trestle", "T-leg", "X-base", "Tripod", "Panel-slab", "unknown"], priority: "high", detectability: "high" },
      { field: "top_shape", type: "enum", allowed_values: ["Round", "Square", "Rectangle", "Oval", "Soft-organic", "unknown"], priority: "high", detectability: "high" },
      { field: "top_material", type: "enum", allowed_values: ["Wood-look", "Stone-look", "Solid-color", "Glass", "Metal", "unknown"], priority: "high", detectability: "medium" },
      { field: "base_visual_weight", type: "enum", allowed_values: ["Heavy/grounded", "Light/airy", "unknown"], priority: "medium", detectability: "high" },
      { field: "base_finish", type: "enum", allowed_values: ["polished_chrome_nickel", "brushed_nickel_stainless", "matte_black", "warm_gold_brass", "bronze_dark", "white", "colored"], priority: "medium", detectability: "medium" },
      { field: "mobility", type: "enum", allowed_values: ["Casters", "Non-mobile", "unknown"], priority: "low", detectability: "high_when_visible" },
      { field: "top_thickness", type: "enum", allowed_values: ["Thin", "Standard", "Thick-slab", "unknown"], priority: "low", detectability: "medium" },
      { field: "edge_profile", type: "enum", allowed_values: ["Square", "Eased", "Beveled", "unknown"], priority: "low", detectability: "low_medium" },
      { field: "height_register", type: "enum", allowed_values: ["Sitting", "Standing", "unknown"], priority: "medium", detectability: "high" },
      { field: "power_data_integration", type: "enum", allowed_values: ["Present", "Not visible", "unknown"], priority: "medium", detectability: "high_when_present" }
    ]
  },
  huddle_collaborative: {
    label: "Huddle/Collaborative",
    fields: [
      { field: "design_register", type: "enum", allowed_values: ["Minimal", "Organic", "Industrial", "Traditional", "Sculptural", "Utilitarian", "unknown"], priority: "high", detectability: "medium_high" },
      { field: "base_type", type: "enum", allowed_values: ["Pedestal", "4-leg", "Trestle", "T-leg", "X-base", "Tripod", "Panel-slab", "unknown"], priority: "high", detectability: "high" },
      { field: "top_shape", type: "enum", allowed_values: ["Round", "Square", "Rectangle", "Oval", "Soft-organic", "unknown"], priority: "high", detectability: "high" },
      { field: "top_material", type: "enum", allowed_values: ["Wood-look", "Stone-look", "Solid-color", "Glass", "Metal", "unknown"], priority: "high", detectability: "medium" },
      { field: "base_visual_weight", type: "enum", allowed_values: ["Heavy/grounded", "Light/airy", "unknown"], priority: "medium", detectability: "high" },
      { field: "base_finish", type: "enum", allowed_values: ["polished_chrome_nickel", "brushed_nickel_stainless", "matte_black", "warm_gold_brass", "bronze_dark", "white", "colored"], priority: "medium", detectability: "medium" },
      { field: "mobility", type: "enum", allowed_values: ["Casters", "Non-mobile", "unknown"], priority: "low", detectability: "high_when_visible" },
      { field: "top_thickness", type: "enum", allowed_values: ["Thin", "Standard", "Thick-slab", "unknown"], priority: "low", detectability: "medium" },
      { field: "edge_profile", type: "enum", allowed_values: ["Square", "Eased", "Beveled", "unknown"], priority: "low", detectability: "low_medium" },
      { field: "height_register", type: "enum", allowed_values: ["Sitting", "Standing", "unknown"], priority: "medium", detectability: "high" },
      { field: "power_data_integration", type: "enum", allowed_values: ["Present", "Not visible", "unknown"], priority: "medium", detectability: "high_when_present" }
    ]
  }
};

export function getFallbackTablesRoutingTypes() {
  return {
    default_type: "",
    types: structuredClone(TABLE_VISUAL_TYPES_FALLBACK)
  };
}

export function buildRoutingTypesConfig(bootstrap = null) {
  const bootstrapConfig = bootstrap?.visual_types || bootstrap?.seating_types || null;
  const bootstrapTypes = bootstrapConfig?.types && typeof bootstrapConfig.types === "object"
    ? bootstrapConfig.types
    : {};
  const mergedTypes = {
    ...structuredClone(TABLE_VISUAL_TYPES_FALLBACK),
    ...bootstrapTypes
  };

  return {
    ...(bootstrapConfig && typeof bootstrapConfig === "object" ? bootstrapConfig : {}),
    types: mergedTypes,
    default_type: String(bootstrapConfig?.default_type || "").trim()
  };
}

export function getVisualTypeDisplayNameMap(bootstrap = null) {
  const types = buildRoutingTypesConfig(bootstrap).types || {};
  const displayNames = { ...LEGACY_VISUAL_TYPE_DISPLAY_NAMES };

  Object.entries(types).forEach(([typeKey, typeConfig]) => {
    const normalizedKey = normalizeVisualTypeKey(typeKey);
    const label = String(typeConfig?.label || "").trim();
    if (normalizedKey && label && !displayNames[normalizedKey]) {
      displayNames[normalizedKey] = label;
    }
  });

  return displayNames;
}

export function formatVisualTypeLabel(value = "", bootstrap = null) {
  const normalized = normalizeVisualTypeKey(value);
  if (normalized === "all") {
    return "All categories";
  }
  if (normalized === "unspecified") {
    return "Unspecified";
  }

  const displayNames = getVisualTypeDisplayNameMap(bootstrap);
  return displayNames[normalized] || normalized;
}

export function getVisualTypeOptions(bootstrap = null) {
  const config = buildRoutingTypesConfig(bootstrap);
  const optionValues = new Set([
    ...Object.keys(config.types || {}),
    ...(Array.isArray(bootstrap?.visual_type_options) ? bootstrap.visual_type_options : []),
    ...(Array.isArray(bootstrap?.seating_category_options) ? bootstrap.seating_category_options : [])
  ]);

  return [...optionValues]
    .map((value) => normalizeVisualTypeKey(value))
    .filter(Boolean)
    .sort((left, right) => formatVisualTypeLabel(left, bootstrap).localeCompare(formatVisualTypeLabel(right, bootstrap)));
}

export function isSupportedBrowseVisualType(categoryKey = "", bootstrap = null) {
  const normalized = normalizeVisualTypeKey(categoryKey);
  return Boolean(normalized && buildRoutingTypesConfig(bootstrap).types?.[normalized]);
}

export function resolveStoredVisualType(source = {}) {
  const value = source?.currentVisualType ?? source?.currentSeatingType ?? source?.visualType ?? source?.seatingType ?? "";
  return normalizeVisualTypeKey(value);
}
