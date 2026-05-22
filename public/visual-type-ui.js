import { normalizeVisualTypeKey } from "./category-scope.js";

const LEGACY_VISUAL_TYPE_DISPLAY_NAMES = {
  task_collab_chair: "Work Chairs",
  guest_chair: "Multi-Use / Guest Chairs",
  lounge_chair: "Lounge Seating",
  bench: "Benches",
  stool: "Stools",
  conference: "Conference Tables",
  occasional: "Occasional Tables",
  cafe_dining: "Cafe/Dining Tables",
  training: "Training Tables",
  huddle_collaborative: "Huddle/Collaborative Tables"
};

const DEFAULT_FAMILY_LABELS = {
  seating: "Seating",
  tables: "Tables",
  faucets: "Faucets"
};

export const PUBLIC_HIDDEN_VISUAL_TYPES = new Set([
  "huddle_collaborative"
]);

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

export function filterPublicVisualTypeOptions(optionValues = []) {
  return (Array.isArray(optionValues) ? optionValues : [])
    .map((value) => normalizeVisualTypeKey(value))
    .filter((value) => value && !PUBLIC_HIDDEN_VISUAL_TYPES.has(value));
}

export function groupPublicVisualTypeOptionsByFamily(optionValues = [], bootstrap = null) {
  return groupVisualTypeOptionsByFamily(
    filterPublicVisualTypeOptions(optionValues),
    bootstrap
  );
}

export function getVisualTypeFamilyMap(bootstrap = null) {
  const rawMap = bootstrap?.visual_type_family_map;
  if (!rawMap || typeof rawMap !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(rawMap)
      .map(([typeKey, familyKey]) => [normalizeVisualTypeKey(typeKey), String(familyKey || "").trim().toLowerCase()])
      .filter(([typeKey, familyKey]) => typeKey && familyKey)
  );
}

export function getVisualTypeFamilyLabelMap(bootstrap = null) {
  const rawMap = bootstrap?.visual_type_family_labels;
  return {
    ...DEFAULT_FAMILY_LABELS,
    ...Object.fromEntries(
      Object.entries(rawMap && typeof rawMap === "object" ? rawMap : {})
        .map(([familyKey, label]) => [String(familyKey || "").trim().toLowerCase(), String(label || "").trim()])
        .filter(([familyKey, label]) => familyKey && label)
    )
  };
}

export function groupVisualTypeOptionsByFamily(optionValues = [], bootstrap = null) {
  const familyMap = getVisualTypeFamilyMap(bootstrap);
  const familyLabelMap = getVisualTypeFamilyLabelMap(bootstrap);
  const grouped = new Map();

  optionValues
    .map((option) => normalizeVisualTypeKey(option))
    .filter((option) => option && option !== "all")
    .forEach((option) => {
      const family = familyMap[option] || "other";
      if (!grouped.has(family)) {
        grouped.set(family, []);
      }
      grouped.get(family).push(option);
    });

  return [...grouped.entries()]
    .map(([family, values]) => ({
      family,
      label: familyLabelMap[family] || family,
      options: values
        .sort((left, right) => formatVisualTypeLabel(left, bootstrap).localeCompare(formatVisualTypeLabel(right, bootstrap)))
        .map((value) => ({ value, label: formatVisualTypeLabel(value, bootstrap) }))
    }));
}

export function resolveClarificationFamilySelection(groupedOptions = [], activeFamily = "") {
  const groups = Array.isArray(groupedOptions) ? groupedOptions : [];
  const singleFamilyMode = groups.length <= 1;
  if (singleFamilyMode) {
    return {
      singleFamilyMode: true,
      activeFamily: groups[0]?.family || "",
      visibleOptions: groups[0]?.options || []
    };
  }

  const normalizedActiveFamily = String(activeFamily || "").trim().toLowerCase();
  const selectedGroup = groups.find((group) => group.family === normalizedActiveFamily) || null;
  return {
    singleFamilyMode: false,
    activeFamily: selectedGroup?.family || "",
    visibleOptions: selectedGroup?.options || []
  };
}

export function isSupportedBrowseVisualType(categoryKey = "", bootstrap = null) {
  const normalized = normalizeVisualTypeKey(categoryKey);
  return Boolean(normalized && buildRoutingTypesConfig(bootstrap).types?.[normalized]);
}

export function resolveStoredVisualType(source = {}) {
  const value = source?.currentVisualType ?? source?.currentSeatingType ?? source?.visualType ?? source?.seatingType ?? "";
  return normalizeVisualTypeKey(value);
}
