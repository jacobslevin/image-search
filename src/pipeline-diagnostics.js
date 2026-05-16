import {
  getEffectiveClassification,
  getPipelineDiagnosticsBaselinePath,
  normalizeRoutingTypeKey,
  readJson,
  writeJson
} from "./utils.js";
import { getLoungeSofaTraitApplicability } from "./lounge-sofa-traits.js";
import { loadVisualTypesRegistry } from "./visual-types-registry.js";

const visualTypesRegistry = loadVisualTypesRegistry();

export const DIAGNOSTICS_UNSPECIFIED = "unspecified";
export const TRAIT_HEALTH_COVERAGE_THRESHOLD = 0.8;
export const TRAIT_HEALTH_DROP_THRESHOLD = 0.1;
export const DIAGNOSTICS_CATEGORY_ORDER = Object.freeze([
  "task_collab_chair",
  "guest_chair",
  "lounge_chair",
  "bench",
  "stool",
  "conference",
  "huddle_collaborative",
  "cafe_dining",
  "occasional",
  "training",
  DIAGNOSTICS_UNSPECIFIED
]);

const LEGACY_BACKLESS_VALUES = new Set(["backless", "no back", "none"]);
const MISSING_VALUE_SET = new Set(["", "unknown", "na", "null", "undefined"]);

function normalizeValue(value = "") {
  return String(value ?? "").trim().toLowerCase();
}

function isMissingValue(value = "") {
  return MISSING_VALUE_SET.has(normalizeValue(value));
}

function formatTraitFieldLabel(field = "") {
  return String(field || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeCategoryKey(value = "") {
  return normalizeRoutingTypeKey(value) || DIAGNOSTICS_UNSPECIFIED;
}

function getTraitFieldConfigs(typeKey = "") {
  if (!typeKey || typeKey === DIAGNOSTICS_UNSPECIFIED) {
    return [];
  }
  try {
    const resolved = visualTypesRegistry.resolveRoutingKey(typeKey);
    if (!resolved) {
      return [];
    }
    return visualTypesRegistry.getCategoryFields(resolved.family, resolved.visual_type).filter((field) => (
      field?.type === "enum" && field?.detectability !== "no"
    ));
  } catch {
    return [];
  }
}

function buildAllowedValueLookup(typeKey = "") {
  const lookup = new Map();
  getTraitFieldConfigs(typeKey).forEach((field) => {
    lookup.set(
      field.field,
      new Map((field.allowed_values || []).map((value) => [normalizeValue(value), String(value)]))
    );
  });
  return lookup;
}

function normalizeTraitValueAgainstSchema(value = "", allowedValues = new Map()) {
  const normalized = normalizeValue(value);
  if (!normalized) {
    return "";
  }
  return allowedValues.get(normalized) || "";
}

function hasExtractedLoungeSofaTraits(enumFields = {}) {
  return ["seat_construction", "narrow_arms", "arms_flush_with_back"].some((field) => !isMissingValue(enumFields?.[field]));
}

function buildCategorySkeleton(typeKey = "") {
  const fieldConfigs = getTraitFieldConfigs(typeKey);
  const traitMap = Object.fromEntries(fieldConfigs.map((field) => [field.field, {
    field: field.field,
    label: formatTraitFieldLabel(field.field),
    populated_count: 0,
    total_count: 0,
    below_threshold: false,
    dropped_vs_previous: false,
    delta_rate: null,
    delta_percent: null,
    coverage_rate: 0,
    coverage_percent: 0,
    supplemental_metrics: []
  }]));

  return {
    category_key: typeKey,
    total_images: 0,
    tiebreakers_triggered: 0,
    has_trait_health: typeKey !== DIAGNOSTICS_UNSPECIFIED,
    image_failures: {
      product_count: 0,
      failed_image_count: 0
    },
    trait_health: {
      traits: traitMap,
      checked_trait_count: fieldConfigs.length,
      issue_count: 0,
      healthy: true
    }
  };
}

function ensureSupplementalMetric(traitSummary, key, label) {
  const metrics = Array.isArray(traitSummary?.supplemental_metrics)
    ? traitSummary.supplemental_metrics
    : [];
  const existing = metrics.find((metric) => metric?.key === key);
  if (existing) {
    return existing;
  }

  const created = {
    key,
    label,
    populated_count: 0,
    total_count: 0,
    coverage_rate: 0,
    coverage_percent: 0
  };
  metrics.push(created);
  traitSummary.supplemental_metrics = metrics;
  return created;
}

function getBaselineCoverage(baseline = null, typeKey = "", fieldName = "") {
  const value = baseline?.categories?.[typeKey]?.traits?.[fieldName]?.coverage_rate;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

const LOGICAL_INCONSISTENCY_RULES = Object.freeze([
  {
    id: "lounge_ottoman_arm_option",
    appliesTo: "lounge_chair",
    evaluate(image = {}, normalizedTraits = {}) {
      if (normalizeValue(normalizedTraits.configuration) !== "ottoman") {
        return null;
      }
      const armOption = normalizeValue(normalizedTraits.arm_option);
      if (!armOption || armOption === "armless") {
        return null;
      }
      return `Ottoman has arm_option="${normalizedTraits.arm_option}".`;
    }
  },
  {
    id: "lounge_ottoman_back_height",
    appliesTo: "lounge_chair",
    evaluate(image = {}, normalizedTraits = {}) {
      if (normalizeValue(normalizedTraits.configuration) !== "ottoman") {
        return null;
      }
      const backHeight = normalizeValue(normalizedTraits.back_height);
      if (!backHeight || backHeight === "low") {
        return null;
      }
      return `Ottoman has back_height="${normalizedTraits.back_height}".`;
    }
  },
  {
    id: "stool_backless_legacy_back_fields",
    appliesTo: "stool",
    evaluate(image = {}, normalizedTraits = {}) {
      const backValue = normalizeValue(normalizedTraits.back || image?.enum_fields?.back);
      if (backValue && backValue !== "backless" && !LEGACY_BACKLESS_VALUES.has(backValue)) {
        return null;
      }
      const legacyBackKeys = ["back_height", "back_option", "back_finish", "back_profile"];
      const populated = legacyBackKeys
        .map((field) => [field, String(image?.enum_fields?.[field] || "").trim()])
        .filter(([, value]) => !isMissingValue(value));
      if (!populated.length) {
        return null;
      }
      const details = populated.map(([field, value]) => `${field}="${value}"`).join(", ");
      return `Backless stool has back-related fields populated (${details}).`;
    }
  }
]);

function collectLogicalInconsistencies(typeKey = "", image = {}, normalizedTraits = {}) {
  return LOGICAL_INCONSISTENCY_RULES
    .filter((rule) => rule.appliesTo === typeKey)
    .map((rule) => rule.evaluate(image, normalizedTraits))
    .filter(Boolean)
    .map((message) => ({
      product_id: String(image.product_id || "").trim(),
      product_name: String(image.product_name || image.name || "").trim(),
      image_url: String(image.image_url || "").trim(),
      category_key: typeKey,
      issue: message
    }));
}

export function createPipelineDiagnosticsBaseline(diagnostics = {}) {
  const categories = Object.fromEntries(
    (Array.isArray(diagnostics.categories) ? diagnostics.categories : [])
      .filter((category) => category?.has_trait_health)
      .map((category) => [
        category.category_key,
        {
          traits: Object.fromEntries(
            (Array.isArray(category?.trait_health?.traits) ? category.trait_health.traits : []).map((trait) => [
              trait.field,
              { coverage_rate: Number(trait.coverage_rate || 0) }
            ])
          )
        }
      ])
  );

  return {
    generated_at: new Date().toISOString(),
    categories
  };
}

export async function readPipelineDiagnosticsBaseline() {
  return readJson(getPipelineDiagnosticsBaselinePath(), null);
}

export async function writePipelineDiagnosticsBaseline(diagnostics = {}) {
  const baseline = createPipelineDiagnosticsBaseline(diagnostics);
  await writeJson(getPipelineDiagnosticsBaselinePath(), baseline);
  return baseline;
}

export function buildPipelineDiagnostics(index = { images: [] }, options = {}) {
  const images = Array.isArray(index?.images) ? index.images : [];
  const products = Array.isArray(index?.products) ? index.products : [];
  const baseline = options.baseline || null;
  const categories = new Map();
  const complianceViolations = [];
  const logicalInconsistencies = [];
  const imageExtractionFailures = [];
  const loungeSofaTraitStage = {
    eligible_image_count: 0,
    extracted_image_count: 0,
    not_applicable_image_count: 0,
    failed_image_count: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    estimated_total_cost_usd: 0
  };

  const ensureCategory = (typeKey) => {
    const normalizedKey = normalizeCategoryKey(typeKey);
    if (!categories.has(normalizedKey)) {
      categories.set(normalizedKey, buildCategorySkeleton(normalizedKey));
    }
    return categories.get(normalizedKey);
  };

  let tiebreakers = 0;

  for (const image of images) {
    const categoryKey = normalizeCategoryKey(image?.seating_type || "");
    const category = ensureCategory(categoryKey);
    const effectiveClassification = getEffectiveClassification(image);

    if (Boolean(image?.tiebreaker_triggered)) {
      tiebreakers += 1;
    }

    if (effectiveClassification !== "product") {
      continue;
    }

    category.total_images += 1;
    if (Boolean(image?.tiebreaker_triggered)) {
      category.tiebreakers_triggered += 1;
    }

    if (categoryKey === DIAGNOSTICS_UNSPECIFIED) {
      continue;
    }

    const enumFields = image?.enum_fields && typeof image.enum_fields === "object" ? image.enum_fields : {};
    const loungeSofaApplicability = getLoungeSofaTraitApplicability(categoryKey, enumFields);
    if (loungeSofaApplicability.eligible) {
      loungeSofaTraitStage.eligible_image_count += 1;
      const stageStatus = String(image?.post_stage23_lounge_sofa_traits?.status || "").trim().toLowerCase();
      if (stageStatus === "not_applicable") {
        loungeSofaTraitStage.not_applicable_image_count += 1;
      } else if (stageStatus === "failed") {
        loungeSofaTraitStage.failed_image_count += 1;
      } else if (stageStatus === "extracted" || hasExtractedLoungeSofaTraits(enumFields)) {
        loungeSofaTraitStage.extracted_image_count += 1;
      } else {
        const inferredNotApplicable = !loungeSofaApplicability.seat_construction
          && !loungeSofaApplicability.narrow_arms
          && !loungeSofaApplicability.arms_flush_with_back
          && isMissingValue(enumFields?.seat_construction);
        if (inferredNotApplicable) {
          loungeSofaTraitStage.not_applicable_image_count += 1;
        } else {
          loungeSofaTraitStage.failed_image_count += 1;
        }
      }
      const stage4Tokens = image?.tokens?.stage_4 && typeof image.tokens.stage_4 === "object"
        ? image.tokens.stage_4
        : {};
      loungeSofaTraitStage.prompt_tokens += Math.max(0, Number(stage4Tokens.prompt_tokens) || 0);
      loungeSofaTraitStage.completion_tokens += Math.max(0, Number(stage4Tokens.completion_tokens) || 0);
      loungeSofaTraitStage.total_tokens += Math.max(0, Number(stage4Tokens.total_tokens) || 0);
      loungeSofaTraitStage.estimated_total_cost_usd = Number((
        loungeSofaTraitStage.estimated_total_cost_usd + Math.max(0, Number(image?.cost?.stage_4_usd) || 0)
      ).toFixed(6));
    }
    const fieldConfigs = getTraitFieldConfigs(categoryKey);
    const allowedValueLookup = buildAllowedValueLookup(categoryKey);
    const normalizedTraits = {};

    fieldConfigs.forEach((field) => {
      const rawValue = enumFields[field.field];
      const rawText = String(rawValue ?? "").trim();
      const traitSummary = category.trait_health.traits[field.field];
      const supplementalMetrics = [];
      let traitApplicable = true;
      const isBenchBackFinishWithBack = (
        categoryKey === "bench" &&
        field.field === "back_finish" &&
        normalizeValue(enumFields.back_height) !== "backless"
      );

      if (isBenchBackFinishWithBack) {
        supplementalMetrics.push(ensureSupplementalMetric(traitSummary, "bench_with_backs", "with backs"));
      }

      const isLoungeBaseFinishWithDiscreteBase = (
        categoryKey === "lounge_chair" &&
        field.field === "base_finish" &&
        normalizeValue(enumFields.base_type) !== "integrated base"
      );

      if (isLoungeBaseFinishWithDiscreteBase) {
        supplementalMetrics.push(ensureSupplementalMetric(
          traitSummary,
          "lounge_with_discrete_bases",
          "with discrete bases"
        ));
      }

      const isLoungeBackTraitWithBack = (
        categoryKey === "lounge_chair" &&
        (field.field === "back_finish" || field.field === "back_height") &&
        normalizeValue(enumFields.configuration) !== "ottoman"
      );

      if (isLoungeBackTraitWithBack) {
        supplementalMetrics.push(ensureSupplementalMetric(traitSummary, "lounge_with_backs", "with backs"));
      }

      const isLoungeSeatConstructionTrait = (
        categoryKey === "lounge_chair" &&
        field.field === "seat_construction"
      );
      if (isLoungeSeatConstructionTrait) {
        traitApplicable = loungeSofaApplicability.seat_construction;
        const metric = ensureSupplementalMetric(
          traitSummary,
          "lounge_multi_seat_sofas",
          "applicable lounge sofas"
        );
        if (loungeSofaApplicability.seat_construction) {
          supplementalMetrics.push(metric);
        }
      }

      const isLoungeArmFormTrait = (
        categoryKey === "lounge_chair" &&
        (field.field === "narrow_arms" || field.field === "arms_flush_with_back")
      );
      if (isLoungeArmFormTrait) {
        traitApplicable = field.field === "narrow_arms"
          ? loungeSofaApplicability.narrow_arms
          : loungeSofaApplicability.arms_flush_with_back;
        const metric = ensureSupplementalMetric(
          traitSummary,
          "lounge_multi_seat_sofas_with_arms",
          "applicable lounge sofas with arms"
        );
        if (field.field === "narrow_arms" && loungeSofaApplicability.narrow_arms) {
          supplementalMetrics.push(metric);
        }
        if (field.field === "arms_flush_with_back" && loungeSofaApplicability.arms_flush_with_back) {
          supplementalMetrics.push(metric);
        }
      }

      if (traitApplicable) {
        traitSummary.total_count += 1;
      }
      supplementalMetrics.forEach((metric) => {
        metric.total_count += 1;
      });

      if (!traitApplicable) {
        normalizedTraits[field.field] = "";
        return;
      }

      if (isMissingValue(rawText)) {
        normalizedTraits[field.field] = "";
        return;
      }

      const normalizedValue = normalizeTraitValueAgainstSchema(rawText, allowedValueLookup.get(field.field));
      if (!normalizedValue) {
        complianceViolations.push({
          product_id: String(image.product_id || "").trim(),
          product_name: String(image.product_name || image.name || "").trim(),
          image_url: String(image.image_url || "").trim(),
          category_key: categoryKey,
          field: field.field,
          value: rawText
        });
        normalizedTraits[field.field] = rawText;
        return;
      }

      normalizedTraits[field.field] = normalizedValue;
      if (normalizeValue(normalizedValue) !== "unknown") {
        traitSummary.populated_count += 1;
        supplementalMetrics.forEach((metric) => {
          metric.populated_count += 1;
        });
      }
    });

    logicalInconsistencies.push(...collectLogicalInconsistencies(categoryKey, image, normalizedTraits));
  }

  for (const product of products) {
    const diagnostics = product?.refresh_diagnostics && typeof product.refresh_diagnostics === "object"
      ? product.refresh_diagnostics
      : null;
    const failedImageCount = Math.max(0, Number(diagnostics?.failed_image_count) || 0);
    if (!diagnostics || failedImageCount <= 0) {
      continue;
    }

    const categoryKey = normalizeCategoryKey(diagnostics?.seating_type || "");
    const category = ensureCategory(categoryKey);
    category.image_failures.product_count += 1;
    category.image_failures.failed_image_count += failedImageCount;

    imageExtractionFailures.push({
      product_id: String(product.product_id || "").trim(),
      product_name: String(product.product_name || product.name || "").trim(),
      category_key: categoryKey,
      failed_image_count: failedImageCount,
      stage0_passing_count: Math.max(0, Number(diagnostics?.stage0_passing_count) || 0),
      successful_extraction_count: Math.max(0, Number(diagnostics?.successful_extraction_count) || 0),
      failed_images: Array.isArray(diagnostics?.failed_images) ? diagnostics.failed_images : []
    });
  }

  const normalizedCategories = [...categories.values()]
    .map((category) => {
      if (!category.has_trait_health) {
        return {
          ...category,
          trait_health: {
            traits: [],
            checked_trait_count: 0,
            issue_count: 0,
            healthy: true
          }
        };
      }

      const traits = Object.values(category.trait_health.traits)
        .map((trait) => {
          const coverageRate = trait.total_count > 0 ? trait.populated_count / trait.total_count : 0;
          const baselineCoverage = getBaselineCoverage(baseline, category.category_key, trait.field);
          const deltaRate = baselineCoverage === null ? null : coverageRate - baselineCoverage;
          const supplementalMetrics = (Array.isArray(trait.supplemental_metrics) ? trait.supplemental_metrics : [])
            .map((metric) => ({
              ...metric,
              coverage_rate: metric.total_count > 0
                ? metric.populated_count / metric.total_count
                : 0,
              coverage_percent: metric.total_count > 0
                ? Math.round((metric.populated_count / metric.total_count) * 100)
                : 0
            }));
          const hasApplicabilityMetrics = supplementalMetrics.length > 0;
          const primaryIssueMetric = supplementalMetrics.find((metric) => Number(metric.total_count || 0) > 0) || null;
          const issueCoverageRate = hasApplicabilityMetrics
            ? (primaryIssueMetric ? primaryIssueMetric.coverage_rate : 1)
            : coverageRate;
          const belowThreshold = issueCoverageRate < TRAIT_HEALTH_COVERAGE_THRESHOLD;
          const droppedVsPrevious = deltaRate !== null && deltaRate <= (-1 * TRAIT_HEALTH_DROP_THRESHOLD);
          return {
            ...trait,
            coverage_rate: coverageRate,
            coverage_percent: Math.round(coverageRate * 100),
            below_threshold: belowThreshold,
            dropped_vs_previous: droppedVsPrevious,
            delta_rate: deltaRate,
            delta_percent: deltaRate === null ? null : Math.round(deltaRate * 100),
            issue_coverage_rate: issueCoverageRate,
            issue_coverage_percent: Math.round(issueCoverageRate * 100),
            issue_basis: primaryIssueMetric
              ? primaryIssueMetric.key
              : (hasApplicabilityMetrics ? "not_applicable" : "all_images"),
            supplemental_metrics: supplementalMetrics,
            issue: belowThreshold || droppedVsPrevious
          };
        })
        .sort((left, right) => {
          if (Number(right.issue) !== Number(left.issue)) {
            return Number(right.issue) - Number(left.issue);
          }
          if (left.coverage_rate !== right.coverage_rate) {
            return left.coverage_rate - right.coverage_rate;
          }
          return left.field.localeCompare(right.field);
        });

      const issueCount = traits.filter((trait) => trait.issue).length;
      return {
        ...category,
        trait_health: {
          traits,
          checked_trait_count: traits.length,
          issue_count: issueCount,
          healthy: issueCount === 0
        }
      };
    })
    .sort((left, right) => {
      const leftRank = DIAGNOSTICS_CATEGORY_ORDER.indexOf(left.category_key);
      const rightRank = DIAGNOSTICS_CATEGORY_ORDER.indexOf(right.category_key);
      const normalizedLeftRank = leftRank >= 0 ? leftRank : Number.MAX_SAFE_INTEGER;
      const normalizedRightRank = rightRank >= 0 ? rightRank : Number.MAX_SAFE_INTEGER;
      if (normalizedLeftRank !== normalizedRightRank) {
        return normalizedLeftRank - normalizedRightRank;
      }
      return left.category_key.localeCompare(right.category_key);
    });

  const checkedTraitCount = normalizedCategories
    .reduce((sum, category) => sum + Number(category?.trait_health?.checked_trait_count || 0), 0);
  const issueCount = normalizedCategories
    .reduce((sum, category) => sum + Number(category?.trait_health?.issue_count || 0), 0);

  return {
    generated_at: new Date().toISOString(),
    total_images: images.length,
    tiebreakers_triggered: tiebreakers,
    categories: normalizedCategories,
    trait_health: {
      issue_count: issueCount,
      checked_trait_count: checkedTraitCount,
      all_healthy: issueCount === 0,
      coverage_threshold: TRAIT_HEALTH_COVERAGE_THRESHOLD,
      drop_threshold: TRAIT_HEALTH_DROP_THRESHOLD,
      baseline_available: Boolean(baseline)
    },
    schema_compliance_violations: complianceViolations.sort((left, right) => (
      String(left.product_name || left.product_id).localeCompare(String(right.product_name || right.product_id)) ||
      String(left.field).localeCompare(String(right.field))
    )),
    logical_inconsistencies: logicalInconsistencies.sort((left, right) => (
      String(left.product_name || left.product_id).localeCompare(String(right.product_name || right.product_id)) ||
      String(left.issue).localeCompare(String(right.issue))
    )),
    image_extraction_failures: imageExtractionFailures.sort((left, right) => (
      Number(right.failed_image_count || 0) - Number(left.failed_image_count || 0) ||
      String(left.product_name || left.product_id).localeCompare(String(right.product_name || right.product_id))
    )),
    lounge_sofa_trait_stage: {
      ...loungeSofaTraitStage,
      average_cost_usd_per_eligible_image: loungeSofaTraitStage.eligible_image_count
        ? Number((loungeSofaTraitStage.estimated_total_cost_usd / loungeSofaTraitStage.eligible_image_count).toFixed(6))
        : 0,
      average_total_tokens_per_eligible_image: loungeSofaTraitStage.eligible_image_count
        ? Number((loungeSofaTraitStage.total_tokens / loungeSofaTraitStage.eligible_image_count).toFixed(1))
        : 0
    },
    supported_categories: visualTypesRegistry.listVisualTypes().map((entry) => entry.visual_type)
  };
}
