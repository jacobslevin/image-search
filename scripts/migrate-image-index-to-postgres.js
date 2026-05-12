import {
  APP_DATABASE_NAME,
  IMAGE_INDEX_SOURCE_SYSTEM,
  LIVE_IMAGE_INDEX_PATH,
  createDevClient,
  normalizeArray,
  normalizeBoolean,
  normalizeJson,
  normalizeText,
  normalizeTimestamp,
  readJsonFile,
  recordIngestionRun,
  vectorLiteral
} from "./postgres-dev-common.js";

function tailId(sourceProductId = "") {
  const match = normalizeText(sourceProductId).match(/(\d+)$/);
  return match ? match[1] : "";
}

function isDpProductId(sourceProductId = "") {
  return /^product_dp_\d+$/i.test(normalizeText(sourceProductId));
}

function isHashedProductId(sourceProductId = "") {
  return /^product_[0-9a-f]+_\d+$/i.test(normalizeText(sourceProductId));
}

function buildSkippedHashedSummaryMap(productSummaries = []) {
  const byTail = new Map();

  for (const summary of productSummaries) {
    const sourceProductId = normalizeText(summary?.product_id).trim();
    const tail = tailId(sourceProductId);
    if (!tail) {
      continue;
    }
    if (!byTail.has(tail)) {
      byTail.set(tail, []);
    }
    byTail.get(tail).push(summary);
  }

  const skippedHashedSummaryIds = new Set();
  const collisionLogs = [];

  for (const summaries of byTail.values()) {
    const dpSummaries = summaries.filter((summary) => isDpProductId(summary?.product_id));
    const hashedSummaries = summaries.filter((summary) => isHashedProductId(summary?.product_id));

    if (dpSummaries.length !== 1 || hashedSummaries.length === 0) {
      continue;
    }

    const winnerId = normalizeText(dpSummaries[0].product_id).trim();
    for (const hashedSummary of hashedSummaries) {
      const hashedId = normalizeText(hashedSummary?.product_id).trim();
      skippedHashedSummaryIds.add(hashedId);
      collisionLogs.push({
        hashedId,
        winnerId,
        productName: normalizeText(hashedSummary?.product_name || hashedSummary?.name || dpSummaries[0]?.product_name || dpSummaries[0]?.name).trim()
      });
    }
  }

  return {
    skippedHashedSummaryIds,
    collisionLogs
  };
}

async function upsertProduct(client, imageRecord, productSummary = null) {
  const summary = normalizeJson(productSummary);
  const result = await client.query(
    `INSERT INTO products (
      source_system,
      source_product_id,
      product_name,
      brand,
      description,
      raw_category,
      a_level,
      b_level,
      c_level,
      image_urls,
      product_metadata,
      raw_payload,
      updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7::text[], $8::text[], $9::text[], $10::text[], $11::jsonb, $12::jsonb, NOW()
    )
    ON CONFLICT (source_system, source_product_id) DO UPDATE SET
      product_name = EXCLUDED.product_name,
      brand = EXCLUDED.brand,
      description = EXCLUDED.description,
      raw_category = EXCLUDED.raw_category,
      a_level = EXCLUDED.a_level,
      b_level = EXCLUDED.b_level,
      c_level = EXCLUDED.c_level,
      image_urls = EXCLUDED.image_urls,
      product_metadata = EXCLUDED.product_metadata,
      raw_payload = EXCLUDED.raw_payload,
      updated_at = NOW()
    RETURNING id`,
    [
      IMAGE_INDEX_SOURCE_SYSTEM,
      normalizeText(imageRecord.product_id),
      normalizeText(summary.product_name || imageRecord.product_name || imageRecord.name),
      normalizeText(summary.brand || imageRecord.brand),
      "",
      "",
      normalizeArray(summary.a_level || imageRecord.a_level),
      normalizeArray(summary.b_level || imageRecord.b_level),
      normalizeArray(summary.c_level || imageRecord.c_level),
      normalizeArray(summary.image_urls || [normalizeText(imageRecord.image_url)].filter(Boolean)),
      JSON.stringify({
        visual_type: normalizeText(imageRecord.stage1?.seating_type || imageRecord.seating_type || imageRecord.pixelseek_type),
        family: normalizeText(imageRecord.family || ""),
        source: "image-index.json",
        passing_image_count: summary.passing_image_count ?? null,
        refresh_diagnostics: normalizeJson(summary.refresh_diagnostics)
      }),
      JSON.stringify(Object.keys(summary).length ? summary : {
        product_id: normalizeText(imageRecord.product_id),
        product_name: normalizeText(imageRecord.product_name || imageRecord.name),
        brand: normalizeText(imageRecord.brand),
        a_level: normalizeArray(imageRecord.a_level),
        b_level: normalizeArray(imageRecord.b_level),
        c_level: normalizeArray(imageRecord.c_level)
      })
    ]
  );
  return result.rows[0].id;
}

async function upsertProductSummary(client, productSummary) {
  const summary = normalizeJson(productSummary);
  const result = await client.query(
    `INSERT INTO products (
      source_system,
      source_product_id,
      product_name,
      brand,
      description,
      raw_category,
      a_level,
      b_level,
      c_level,
      image_urls,
      product_metadata,
      raw_payload,
      updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7::text[], $8::text[], $9::text[], $10::text[], $11::jsonb, $12::jsonb, NOW()
    )
    ON CONFLICT (source_system, source_product_id) DO UPDATE SET
      product_name = EXCLUDED.product_name,
      brand = EXCLUDED.brand,
      description = EXCLUDED.description,
      raw_category = EXCLUDED.raw_category,
      a_level = EXCLUDED.a_level,
      b_level = EXCLUDED.b_level,
      c_level = EXCLUDED.c_level,
      image_urls = EXCLUDED.image_urls,
      product_metadata = EXCLUDED.product_metadata,
      raw_payload = EXCLUDED.raw_payload,
      updated_at = NOW()
    RETURNING id`,
    [
      IMAGE_INDEX_SOURCE_SYSTEM,
      normalizeText(summary.product_id),
      normalizeText(summary.product_name || summary.name),
      normalizeText(summary.brand),
      "",
      "",
      normalizeArray(summary.a_level),
      normalizeArray(summary.b_level),
      normalizeArray(summary.c_level),
      normalizeArray(summary.image_urls),
      JSON.stringify({
        source: "image-index.json",
        passing_image_count: summary.passing_image_count ?? null,
        refresh_diagnostics: normalizeJson(summary.refresh_diagnostics)
      }),
      JSON.stringify(summary)
    ]
  );
  return result.rows[0].id;
}

async function upsertImage(client, imageRecord, productDbId) {
  await client.query(
    `INSERT INTO images (
      source_system,
      source_image_id,
      product_db_id,
      source_product_id,
      image_url,
      product_name,
      brand,
      a_level,
      b_level,
      c_level,
      visual_type,
      family,
      seating_type,
      pixelseek_type,
      type_routing_source,
      stage_0_result,
      stage_1_override,
      stage_1_override_result,
      stage_1_override_reason,
      effective_classification,
      enum_fields,
      field_confidence,
      free_text,
      reasoning,
      plan_shape_reasoning,
      tiebreaker_triggered,
      confidence_tier,
      tokens,
      cost,
      extraction_timestamp,
      excluded,
      excluded_reason,
      image_traits,
      visual_summary,
      structured_caption,
      stage1,
      stage2,
      stage3,
      search_text,
      visual_summary_embedding,
      search_text_embedding,
      image_width,
      image_height,
      image_short_side,
      ai_refreshed_at,
      image_metadata,
      raw_payload,
      updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8::text[], $9::text[], $10::text[], $11, $12, $13, $14, $15,
      $16, $17::jsonb, $18, $19, $20, $21::jsonb, $22::jsonb, $23::jsonb, $24, $25, $26, $27, $28::jsonb,
      $29::jsonb, $30, $31, $32, $33::jsonb, $34, $35, $36::jsonb, $37::jsonb, $38::jsonb, $39,
      $40::vector, $41::vector, $42, $43, $44, $45, $46::jsonb, $47::jsonb, NOW()
    )
    ON CONFLICT (source_system, source_image_id) DO UPDATE SET
      product_db_id = EXCLUDED.product_db_id,
      source_product_id = EXCLUDED.source_product_id,
      image_url = EXCLUDED.image_url,
      product_name = EXCLUDED.product_name,
      brand = EXCLUDED.brand,
      a_level = EXCLUDED.a_level,
      b_level = EXCLUDED.b_level,
      c_level = EXCLUDED.c_level,
      visual_type = EXCLUDED.visual_type,
      family = EXCLUDED.family,
      seating_type = EXCLUDED.seating_type,
      pixelseek_type = EXCLUDED.pixelseek_type,
      type_routing_source = EXCLUDED.type_routing_source,
      stage_0_result = EXCLUDED.stage_0_result,
      stage_1_override = EXCLUDED.stage_1_override,
      stage_1_override_result = EXCLUDED.stage_1_override_result,
      stage_1_override_reason = EXCLUDED.stage_1_override_reason,
      effective_classification = EXCLUDED.effective_classification,
      enum_fields = EXCLUDED.enum_fields,
      field_confidence = EXCLUDED.field_confidence,
      free_text = EXCLUDED.free_text,
      reasoning = EXCLUDED.reasoning,
      plan_shape_reasoning = EXCLUDED.plan_shape_reasoning,
      tiebreaker_triggered = EXCLUDED.tiebreaker_triggered,
      confidence_tier = EXCLUDED.confidence_tier,
      tokens = EXCLUDED.tokens,
      cost = EXCLUDED.cost,
      extraction_timestamp = EXCLUDED.extraction_timestamp,
      excluded = EXCLUDED.excluded,
      excluded_reason = EXCLUDED.excluded_reason,
      image_traits = EXCLUDED.image_traits,
      visual_summary = EXCLUDED.visual_summary,
      structured_caption = EXCLUDED.structured_caption,
      stage1 = EXCLUDED.stage1,
      stage2 = EXCLUDED.stage2,
      stage3 = EXCLUDED.stage3,
      search_text = EXCLUDED.search_text,
      visual_summary_embedding = EXCLUDED.visual_summary_embedding,
      search_text_embedding = EXCLUDED.search_text_embedding,
      image_width = EXCLUDED.image_width,
      image_height = EXCLUDED.image_height,
      image_short_side = EXCLUDED.image_short_side,
      ai_refreshed_at = EXCLUDED.ai_refreshed_at,
      image_metadata = EXCLUDED.image_metadata,
      raw_payload = EXCLUDED.raw_payload,
      updated_at = NOW()`,
    [
      IMAGE_INDEX_SOURCE_SYSTEM,
      normalizeText(imageRecord.image_id),
      productDbId,
      normalizeText(imageRecord.product_id),
      normalizeText(imageRecord.image_url),
      normalizeText(imageRecord.product_name || imageRecord.name),
      normalizeText(imageRecord.brand),
      normalizeArray(imageRecord.a_level),
      normalizeArray(imageRecord.b_level),
      normalizeArray(imageRecord.c_level),
      normalizeText(imageRecord.visual_type || imageRecord.stage1?.seating_type || imageRecord.seating_type),
      normalizeText(imageRecord.family),
      normalizeText(imageRecord.seating_type),
      normalizeText(imageRecord.pixelseek_type),
      normalizeText(imageRecord.type_routing_source),
      normalizeText(imageRecord.stage_0_result),
      JSON.stringify(normalizeJson(imageRecord.stage_1_override)),
      normalizeText(imageRecord.stage_1_override_result),
      normalizeText(imageRecord.stage_1_override_reason),
      normalizeText(imageRecord.effective_classification),
      JSON.stringify(normalizeJson(imageRecord.enum_fields)),
      JSON.stringify(normalizeJson(imageRecord.field_confidence)),
      JSON.stringify(normalizeJson(imageRecord.free_text)),
      normalizeText(imageRecord.reasoning),
      normalizeText(imageRecord.plan_shape_reasoning),
      typeof imageRecord.tiebreaker_triggered === "boolean" ? imageRecord.tiebreaker_triggered : null,
      normalizeText(imageRecord.confidence_tier),
      JSON.stringify(normalizeJson(imageRecord.tokens)),
      JSON.stringify(normalizeJson(imageRecord.cost)),
      normalizeTimestamp(imageRecord.extraction_timestamp),
      normalizeBoolean(imageRecord.excluded, false),
      normalizeText(imageRecord.excluded_reason),
      JSON.stringify(normalizeJson(imageRecord.image_traits)),
      normalizeText(imageRecord.visual_summary),
      normalizeText(imageRecord.structured_caption),
      JSON.stringify(normalizeJson(imageRecord.stage1)),
      JSON.stringify(normalizeJson(imageRecord.stage2)),
      JSON.stringify(normalizeJson(imageRecord.stage3)),
      normalizeText(imageRecord.search_text),
      vectorLiteral(imageRecord.visual_summary_embedding),
      vectorLiteral(imageRecord.search_text_embedding),
      Number.isFinite(imageRecord.image_width) ? imageRecord.image_width : null,
      Number.isFinite(imageRecord.image_height) ? imageRecord.image_height : null,
      Number.isFinite(imageRecord.image_short_side) ? imageRecord.image_short_side : null,
      normalizeTimestamp(imageRecord.ai_refreshed_at),
      JSON.stringify({
        name: normalizeText(imageRecord.name),
        image_url: normalizeText(imageRecord.image_url)
      }),
      JSON.stringify(imageRecord)
    ]
  );
}

async function main() {
  const imageIndex = await readJsonFile(LIVE_IMAGE_INDEX_PATH);
  const rows = Array.isArray(imageIndex)
    ? imageIndex
    : Array.isArray(imageIndex?.images)
      ? imageIndex.images
      : [];
  const productSummaries = Array.isArray(imageIndex?.products) ? imageIndex.products : [];
  const {
    skippedHashedSummaryIds,
    collisionLogs
  } = buildSkippedHashedSummaryMap(productSummaries);
  const filteredProductSummaries = productSummaries.filter(
    (summary) => !skippedHashedSummaryIds.has(normalizeText(summary?.product_id).trim())
  );
  const productSummaryById = new Map(
    filteredProductSummaries.map((product) => [normalizeText(product.product_id), product])
  );
  const client = await createDevClient();
  const productIdCache = new Map();

  try {
    await client.query("BEGIN");
    for (const { hashedId, winnerId, productName } of collisionLogs) {
      console.log(
        `[importer] Skipping hashed duplicate: ${hashedId}` +
          `${productName ? ` (${productName})` : ""} — keeping ${winnerId}`
      );
    }
    for (const summary of filteredProductSummaries) {
      const sourceProductId = normalizeText(summary.product_id);
      if (!sourceProductId) {
        continue;
      }
      const productDbId = await upsertProductSummary(client, summary);
      productIdCache.set(sourceProductId, productDbId);
    }
    for (const row of rows) {
      const sourceProductId = normalizeText(row.product_id);
      let productDbId = productIdCache.get(sourceProductId);
      if (!productDbId) {
        productDbId = await upsertProduct(client, row, productSummaryById.get(sourceProductId));
        productIdCache.set(sourceProductId, productDbId);
      }
      await upsertImage(client, row, productDbId);
    }
    await recordIngestionRun(client, {
      sourceSystem: IMAGE_INDEX_SOURCE_SYSTEM,
      recordType: "image_index_snapshot",
      sourcePath: LIVE_IMAGE_INDEX_PATH,
      recordCount: rows.length,
      notes: {
        database: APP_DATABASE_NAME
      }
    });
    await client.query("COMMIT");
    console.log(
      JSON.stringify(
        {
          database: APP_DATABASE_NAME,
          source: LIVE_IMAGE_INDEX_PATH,
          image_records: rows.length,
          products_in_index: productSummaries.length,
          hashed_duplicates_skipped: skippedHashedSummaryIds.size,
          products_upserted: filteredProductSummaries.length,
          products_seen: productIdCache.size
        },
        null,
        2
      )
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
