export function isInlineRefinementDetectabilityEligible(detectability) {
  const normalized = String(detectability || "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return normalized !== "no" && normalized !== "never";
}
