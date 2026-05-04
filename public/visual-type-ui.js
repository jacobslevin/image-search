import { normalizeVisualTypeKey } from "./category-scope.js";

const LEGACY_VISUAL_TYPE_DISPLAY_NAMES = {
  task_collab_chair: "Work Chairs",
  guest_chair: "Multi-Use / Guest Chairs",
  lounge_chair: "Lounge Seating",
  bench: "Benches",
  stool: "Stools",
  conference: "Conference",
  occasional: "Occasional",
  cafe_dining: "Cafe/Dining",
  training: "Training",
  huddle_collaborative: "Huddle/Collaborative"
};

export function buildRoutingTypesConfig(bootstrap = null) {
  const bootstrapConfig = bootstrap?.visual_types || bootstrap?.seating_types || null;
  return bootstrapConfig && typeof bootstrapConfig === "object"
    ? bootstrapConfig
    : { version: "", default_type: "", types: {} };
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
  const explicitOptions = Array.isArray(bootstrap?.visual_type_options) && bootstrap.visual_type_options.length
    ? bootstrap.visual_type_options
    : Array.isArray(bootstrap?.seating_category_options) && bootstrap.seating_category_options.length
      ? bootstrap.seating_category_options
      : Object.keys(config.types || {});
  const optionValues = new Set(explicitOptions);

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
