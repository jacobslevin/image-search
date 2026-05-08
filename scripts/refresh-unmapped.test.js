import test from "node:test";
import assert from "node:assert/strict";

import { generateProductExtractionRecordsWithCap } from "../src/captioning.js";
import { createEmptyIndex, replaceProductImages, summarizeRefreshOutcome } from "../src/refresh-index.js";

test("unmapped products skip before Stage 0 and persist a single synthetic excluded record", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error("fetch should not be called for unmapped preflight skips");
  };

  try {
    const productId = "product_dp_13886097";
    const matchingImages = [
      {
        image_id: `${productId}_img_001`,
        product_id: productId,
        product_name: "Everywhere Tables",
        name: "Everywhere Tables",
        brand: "Herman Miller",
        image_url: "https://example.com/everywhere.jpg",
        a_level: [],
        b_level: ["Workplace", "Occasional Tables"],
        c_level: ["Training Tables"]
      }
    ];

    const generated = await generateProductExtractionRecordsWithCap(matchingImages, {});
    assert.equal(generated.records.length, 1);
    assert.equal(generated.failed_images.length, 0);
    assert.equal(generated.progress.stage0_passing_count, 0);
    assert.equal(generated.progress.selected_product_image_count, 0);
    assert.equal(generated.progress.successful_extraction_count, 0);

    const [record] = generated.records;
    assert.equal(record.product_id, productId);
    assert.equal(record.excluded, true);
    assert.equal(record.excluded_reason, "unmapped_category_grouping");
    assert.equal(record.is_synthetic_skip, true);
    assert.equal(record.effective_classification, "");
    assert.equal(record.stage_0_result, "");
    assert.equal(record.search_text, "");
    assert.deepEqual(record.search_text_embedding, []);
    assert.equal(record.cost?.total_usd, 0);
    assert.equal(record.tokens?.total?.total_tokens, 0);

    const refreshOutcome = summarizeRefreshOutcome({
      productId,
      matchingImages,
      refreshedImages: generated.records,
      successfulExtractionCount: generated.progress.successful_extraction_count,
      lastError: null
    });

    assert.equal(refreshOutcome.skipped_unmapped, true);
    assert.equal(refreshOutcome.unmapped_grouping, "Occasional Tables | Training Tables | Workplace");

    const catalog = {
      brands: ["Herman Miller"],
      categories: ["Occasional Tables", "Workplace"],
      products: [
        {
          product_id: productId,
          source_product_id: "13886097",
          name: "Everywhere Tables",
          brand: "Herman Miller",
          image_urls: ["https://example.com/everywhere.jpg"],
          a_level: [],
          b_level: ["Workplace", "Occasional Tables"],
          c_level: ["Training Tables"]
        }
      ]
    };

    const index = createEmptyIndex(catalog);
    const output = replaceProductImages(index, catalog, [productId], generated.records, {
      refreshDiagnosticsByProductId: new Map([[
        productId,
        {
          last_attempted_at: "2026-05-09T00:00:00.000Z",
          ai_refreshed_at: "2026-05-09T00:00:00.000Z",
          seating_type: "",
          visual_type: "",
          stage0_passing_count: 0,
          selected_product_image_count: 0,
          successful_extraction_count: 0,
          failed_image_count: 0,
          failed_stage0_count: 0,
          failed_stage23_count: 0,
          images_skipped_by_cap: 0,
          hard_upper_cap_binding: false,
          partial_image_failure: false,
          skipped_unmapped: true,
          unmapped_grouping: refreshOutcome.unmapped_grouping,
          failed_images: []
        }
      ]])
    });

    assert.equal(output.images.length, 1);
    assert.equal(output.images[0].is_synthetic_skip, true);
    assert.equal(output.images[0].excluded_reason, "unmapped_category_grouping");
    assert.equal(output.totals.images, 0);
    assert.equal(output.products.length, 1);
    assert.equal(output.products[0].refresh_diagnostics.skipped_unmapped, true);
    assert.equal(output.products[0].refresh_diagnostics.unmapped_grouping, refreshOutcome.unmapped_grouping);
  } finally {
    global.fetch = originalFetch;
  }
});
