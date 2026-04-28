import { buildPipelineDiagnostics, readPipelineDiagnosticsBaseline, writePipelineDiagnosticsBaseline } from "../src/pipeline-diagnostics.js";
import { getImageIndexPath, readJson } from "../src/utils.js";

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function formatSupplementalTraitText(trait = {}) {
  const supplemental = Array.isArray(trait?.supplemental_metrics) ? trait.supplemental_metrics : [];

  if (trait?.field === "back_finish") {
    const benchWithBacksMetric = supplemental.find((metric) => metric?.key === "bench_with_backs");
    if (benchWithBacksMetric && Number(benchWithBacksMetric.total_count || 0) > 0) {
      return `${benchWithBacksMetric.coverage_percent}% on benches with backs (${trait.coverage_percent}% across all benches)`;
    }
    const loungeWithBacksMetric = supplemental.find((metric) => metric?.key === "lounge_with_backs");
    if (loungeWithBacksMetric && Number(loungeWithBacksMetric.total_count || 0) > 0) {
      return `${loungeWithBacksMetric.coverage_percent}% on lounge pieces with backs (${trait.coverage_percent}% across all lounge seating)`;
    }
  }

  if (trait?.field === "back_height") {
    const loungeWithBacksMetric = supplemental.find((metric) => metric?.key === "lounge_with_backs");
    if (loungeWithBacksMetric && Number(loungeWithBacksMetric.total_count || 0) > 0) {
      return `${loungeWithBacksMetric.coverage_percent}% on lounge pieces with backs (${trait.coverage_percent}% across all lounge seating)`;
    }
  }

  if (trait?.field === "base_finish") {
    const loungeWithDiscreteBasesMetric = supplemental.find((metric) => metric?.key === "lounge_with_discrete_bases");
    if (loungeWithDiscreteBasesMetric && Number(loungeWithDiscreteBasesMetric.total_count || 0) > 0) {
      return `${loungeWithDiscreteBasesMetric.coverage_percent}% on lounge pieces with discrete bases (${trait.coverage_percent}% across all lounge seating)`;
    }
  }

  const supplementalMetrics = supplemental
      .filter((metric) => Number(metric?.total_count || 0) > 0)
      .map((metric) => `${metric.label} ${metric.coverage_percent}%`)
  ;

  return supplementalMetrics.length
    ? `${trait.coverage_percent}% | ${supplementalMetrics.join(" | ")}`
    : `${trait.coverage_percent}%`;
}

function printCategory(category = {}) {
  const issueCount = Number(category?.trait_health?.issue_count) || 0;
  const status = category?.has_trait_health
    ? (issueCount ? `${issueCount} issues` : "healthy")
    : "—";
  const imageFailureCount = Number(category?.image_failures?.failed_image_count || 0);
  const imageFailureText = imageFailureCount
    ? ` | ${imageFailureCount.toLocaleString()} image failures`
    : "";
  console.log(`${category.category_key}: ${Number(category.total_images || 0).toLocaleString()} images | ${Number(category.tiebreakers_triggered || 0).toLocaleString()} tiebreakers | ${status}${imageFailureText}`);

  if (!category?.has_trait_health) {
    return;
  }

  const issueTraits = (Array.isArray(category?.trait_health?.traits) ? category.trait_health.traits : [])
    .filter((trait) => trait.issue);
  issueTraits.forEach((trait) => {
    const delta = trait.dropped_vs_previous && trait.delta_percent !== null && trait.delta_percent !== undefined
      ? ` (${trait.delta_percent > 0 ? "+" : ""}${trait.delta_percent}% vs last run)`
      : "";
    console.log(`  - ${trait.field}: ${formatSupplementalTraitText(trait)}${delta}`);
  });
}

async function main() {
  const index = await readJson(getImageIndexPath(), { images: [] });
  const baseline = await readPipelineDiagnosticsBaseline();
  const diagnostics = buildPipelineDiagnostics(index, { baseline });

  if (hasFlag("--json")) {
    console.log(JSON.stringify(diagnostics, null, 2));
  } else {
    console.log(`Generated: ${diagnostics.generated_at}`);
    console.log(`Images: ${Number(diagnostics.total_images || 0).toLocaleString()}`);
    console.log(`Tiebreakers: ${Number(diagnostics.tiebreakers_triggered || 0).toLocaleString()}`);
    console.log(`Trait health: ${diagnostics.trait_health.all_healthy ? "All healthy" : `${diagnostics.trait_health.issue_count} issues across ${diagnostics.trait_health.checked_trait_count} combinations`}`);
    console.log(`Schema compliance violations: ${diagnostics.schema_compliance_violations.length}`);
    console.log(`Logical inconsistencies: ${diagnostics.logical_inconsistencies.length}`);
    console.log(`Image extraction failures: ${Array.isArray(diagnostics.image_extraction_failures) ? diagnostics.image_extraction_failures.length : 0} products`);
    console.log("");
    diagnostics.categories.forEach((category) => printCategory(category));
  }

  if (hasFlag("--write-baseline")) {
    await writePipelineDiagnosticsBaseline(diagnostics);
    console.log(`\nSaved baseline to current configured pipeline diagnostics baseline path.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
