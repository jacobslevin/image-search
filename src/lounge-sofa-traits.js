const LOUNGE_SOFA_CONFIGURATION_VALUES = new Set([
  "double seat",
  "triple seat (or larger)"
]);

const LOUNGE_SOFA_ARMLESS_VALUES = new Set(["armless", "no arms"]);
const LOUNGE_SOFA_MONOLITHIC_BASE_VALUES = new Set(["integrated base", "molded one-piece"]);

function normalizeLoungeSofaTraitValue(value = "") {
  return String(value ?? "").trim().toLowerCase();
}

export function isLoungeSofaTraitEligible(typeKey = "", imageTraits = {}) {
  if (normalizeLoungeSofaTraitValue(typeKey) !== "lounge_chair") {
    return false;
  }
  return LOUNGE_SOFA_CONFIGURATION_VALUES.has(normalizeLoungeSofaTraitValue(imageTraits?.configuration));
}

export function isArmlessLoungeSofa(imageTraits = {}) {
  return LOUNGE_SOFA_ARMLESS_VALUES.has(normalizeLoungeSofaTraitValue(imageTraits?.arm_option));
}

export function hasIntegratedBase(imageTraits = {}) {
  return LOUNGE_SOFA_MONOLITHIC_BASE_VALUES.has(normalizeLoungeSofaTraitValue(imageTraits?.base_type));
}

export function getLoungeSofaTraitApplicability(typeKey = "", imageTraits = {}) {
  const eligible = isLoungeSofaTraitEligible(typeKey, imageTraits);
  const seatConstruction = eligible && !hasIntegratedBase(imageTraits);
  const armTraits = eligible && !isArmlessLoungeSofa(imageTraits);

  return {
    eligible,
    seat_construction: seatConstruction,
    narrow_arms: armTraits,
    arms_flush_with_back: armTraits
  };
}

export function hasAnyApplicableLoungeSofaTraits(applicability = {}) {
  return Boolean(applicability?.seat_construction || applicability?.narrow_arms || applicability?.arms_flush_with_back);
}
