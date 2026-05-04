import { buildRoutingTypesConfig } from "./visual-type-ui.js";

const PRIORITY_ORDER = {
  essential: 0,
  high: 0,
  normal: 1,
  medium: 1,
  low: 2
};

const LEGACY_SEATING_COMPATIBILITY_FIELDS = [
  "back_style",
  "body_construction",
  "arm_option",
  "arm_configuration",
  "base_type",
  "configuration",
  "seat_fabric",
  "base_finish",
  "seat_upholstery",
  "back_upholstery"
];

function getPayloadVisualType(payload = {}) {
  return String(
    payload?.visual_type ||
    payload?.seating_type ||
    payload?.stage1?.visual_type ||
    payload?.stage1?.seating_type ||
    ""
  ).trim();
}

function isPresentBulletValue(value) {
  if (value === null || value === undefined) {
    return false;
  }

  const normalized = String(value).trim();
  return normalized && normalized.toLowerCase() !== "unknown";
}

function isSingleSeatConfiguration(value) {
  return String(value || "").trim().toLowerCase() === "single seat";
}

function isPlaceholderSeatFabric(value) {
  return new Set(["fabric (specify category)", "col", "com", "unknown"]).has(
    String(value || "").trim().toLowerCase()
  );
}

function shouldIncludeBulletFieldValue(fieldName = "", value = "") {
  if (!isPresentBulletValue(value)) {
    return false;
  }

  if (fieldName === "arm_option" && String(value).trim().toLowerCase() === "none") {
    return false;
  }

  if (fieldName === "configuration" && isSingleSeatConfiguration(value)) {
    return false;
  }

  if (fieldName === "seat_fabric" && isPlaceholderSeatFabric(value)) {
    return false;
  }

  if (fieldName === "seat_upholstery" && isPlaceholderSeatFabric(value)) {
    return false;
  }

  return true;
}

function getRoutingTypeConfig(bootstrap = null, visualType = "") {
  const normalizedVisualType = String(visualType || "").trim();
  if (!normalizedVisualType) {
    return null;
  }
  const routingTypes = buildRoutingTypesConfig(bootstrap);
  return routingTypes?.types?.[normalizedVisualType] || null;
}

function getOrderedSchemaFields(bootstrap = null, visualType = "") {
  const typeConfig = getRoutingTypeConfig(bootstrap, visualType);
  const fields = Array.isArray(typeConfig?.fields) ? typeConfig.fields : [];

  return fields
    .map((field, index) => ({ field, index }))
    .sort((left, right) => {
      const leftPriority = PRIORITY_ORDER[String(left.field?.priority || "").trim().toLowerCase()] ?? 1;
      const rightPriority = PRIORITY_ORDER[String(right.field?.priority || "").trim().toLowerCase()] ?? 1;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }
      return left.index - right.index;
    })
    .map(({ field }) => field);
}

export function resolveCurateVisualType(analysis = {}, options = {}) {
  return String(
    options.visualType ||
    getPayloadVisualType(analysis) ||
    getPayloadVisualType(analysis?.stage1) ||
    options.seatingType ||
    ""
  ).trim();
}

export function buildStructuredInspirationBullets(analysis = {}, options = {}) {
  const bootstrap = options.bootstrap || null;
  const visualType = resolveCurateVisualType(analysis, options);
  const stage2 = analysis?.stage2 && typeof analysis.stage2 === "object" ? analysis.stage2 : {};
  const imageTraits = analysis?.image_traits && typeof analysis.image_traits === "object" ? analysis.image_traits : {};
  const bullets = [];
  const seen = new Set();

  const pushBullet = (value) => {
    const bullet = String(value || "").trim();
    const key = bullet.toLowerCase();
    if (!bullet || seen.has(key)) {
      return;
    }
    seen.add(key);
    bullets.push(bullet);
  };

  if (isPresentBulletValue(stage2.design_register)) {
    pushBullet(stage2.design_register);
  } else if (shouldIncludeBulletFieldValue("design_register", imageTraits.design_register)) {
    pushBullet(imageTraits.design_register);
  }

  if (Array.isArray(stage2.distinctive_elements)) {
    stage2.distinctive_elements.forEach((value) => {
      if (isPresentBulletValue(value)) {
        pushBullet(value);
      }
    });
  }

  if (visualType && getRoutingTypeConfig(bootstrap, visualType)) {
    if (
      visualType === "task_collab_chair" ||
      visualType === "guest_chair" ||
      visualType === "lounge_chair" ||
      visualType === "stool" ||
      visualType === "bench"
    ) {
      LEGACY_SEATING_COMPATIBILITY_FIELDS.forEach((fieldName) => {
        const value = imageTraits[fieldName];
        if (shouldIncludeBulletFieldValue(fieldName, value)) {
          pushBullet(value);
        }
      });
    }

    getOrderedSchemaFields(bootstrap, visualType).forEach((fieldConfig) => {
      const fieldName = String(fieldConfig?.field || "").trim();
      if (!fieldName || fieldName === "design_register") {
        return;
      }
      const value = imageTraits[fieldName];
      if (shouldIncludeBulletFieldValue(fieldName, value)) {
        pushBullet(value);
      }
    });
  }

  return bullets;
}
