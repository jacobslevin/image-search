export function resolveSearchVisualTypeRequest({
  requestedCategoryScopeMode = "all",
  explicitVisualType = "",
  inferredVisualTypeFromQuery = ""
} = {}) {
  const mode = String(requestedCategoryScopeMode || "all").trim().toLowerCase();
  const explicit = String(explicitVisualType || "").trim();
  const inferred = String(inferredVisualTypeFromQuery || "").trim();

  if (mode === "explicit") {
    return {
      effectiveCategoryScopeMode: "explicit",
      apiRequestedVisualType: explicit
    };
  }

  if (inferred) {
    return {
      effectiveCategoryScopeMode: "explicit",
      apiRequestedVisualType: inferred
    };
  }

  return {
    effectiveCategoryScopeMode: "all",
    apiRequestedVisualType: ""
  };
}
