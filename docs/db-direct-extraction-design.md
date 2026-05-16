# DB-Direct Extraction Design

This document is the implementation-level companion to `docs/architectural-improvements.md`.

It details the first practical design for moving local extraction from a JSON-first pipeline to direct writes into Postgres image-index staging tables, while keeping JSON as the source of truth during validation.

## Module Interface

Recommended location: `src/image-index-staging-writer.js`.

This location is preferred over `scripts/` because the module will be called by both CLI scripts and `server.js` admin refresh flows.

The public API should be async and DB-client-first. Transaction ownership should stay explicit: most functions should expect a caller-provided `pg` client and should not open or commit transactions themselves. This lets callers batch multiple product updates safely.

### `upsertImageIndexProduct(client, { productSummary, fallbackImageRecord = null })`

Purpose: upsert one `source_system = 'image_index'` row into `products`.

Parameters:

- `client`: connected `pg` client.
- `productSummary`: object shaped like `image-index.products[]`.
- `fallbackImageRecord`: optional object shaped like `image-index.images[]`, used when no product summary exists.

Return value:

```js
{
  productDbId,
  sourceProductId,
  insertedOrUpdated: true
}
```

Transaction behavior: does not start, commit, or roll back a transaction. Expects caller-managed transaction when atomicity matters.

Error handling: throws on missing `product_id`, invalid DB client, or database errors.

This should replace the current split between `upsertProductSummary()` and `upsertProduct()` in `scripts/migrate-image-index-to-postgres.js`.

### `upsertImageIndexImage(client, { imageRecord, productDbId })`

Purpose: upsert one extracted image row into `images`.

Parameters:

- `client`: connected `pg` client.
- `imageRecord`: object shaped like `image-index.images[]`.
- `productDbId`: staging `products.id` foreign key.

Return value:

```js
{
  sourceImageId,
  sourceProductId,
  insertedOrUpdated: true
}
```

Transaction behavior: does not start, commit, or roll back a transaction.

Error handling: throws on missing `image_id`, missing `productDbId`, vector-cast errors, or database errors.

This function owns the field mapping currently embedded in `upsertImage()`.

### `replaceImageIndexProductImages(client, { productId, productSummary = null, imageRecords, refreshDiagnostics = null, sourcePath = "db-direct-extraction" })`

Purpose: product-level replacement primitive for refresh/build flows.

Parameters:

- `client`: connected `pg` client.
- `productId`: source product ID, for example `product_dp_13945962`.
- `productSummary`: optional object shaped like `image-index.products[]`.
- `imageRecords`: replacement extracted image records for that product only.
- `refreshDiagnostics`: optional refresh diagnostics payload to store on the product metadata.
- `sourcePath`: logical source label for diagnostics or ingestion metadata.

Return value:

```js
{
  productDbId,
  productId,
  deletedImages,
  insertedImages,
  imageIds
}
```

Transaction behavior: should not own the transaction by default. Caller should wrap this in a transaction. A separate convenience wrapper may be added later if useful.

Error handling: throws if `productId` is missing, if any image record belongs to a different product, or if any database operation fails.

### `recordImageIndexExtractionRun(client, { recordType, sourcePath, recordCount, notes = {} })`

Purpose: image-index-specific wrapper around ingestion-run recording.

Parameters:

- `client`: connected `pg` client.
- `recordType`: for example `image_index_snapshot`, `image_index_product_refresh`, or `image_index_batch_refresh`.
- `sourcePath`: file path or logical run label.
- `recordCount`: number of image records written.
- `notes`: JSON metadata.

Return value:

```js
{
  recorded: true
}
```

If `recordIngestionRun()` later returns inserted IDs, this can return `{ ingestionRunId }`.

### `migrateImageIndexSnapshot(client, { imageIndex, sourcePath })`

Purpose: compatibility helper for the current JSON importer.

Parameters:

- `client`: connected `pg` client.
- `imageIndex`: full parsed JSON object, or legacy array of image records.
- `sourcePath`: file path or logical source label.

Return value:

```js
{
  imageRecords,
  productsInIndex,
  hashedDuplicatesSkipped,
  productsUpserted,
  productsSeen,
  skippedDueToDpInProductsSection,
  skippedDueToDpInImagesSection,
  skippedDueToDpInLocalDb
}
```

Transaction behavior: can either expect caller-managed transaction or expose a documented `manageTransaction` option. For phase 1, prefer caller-managed transaction to keep behavior explicit.

Error handling: throws on invalid input or DB failure.

### Internal Helpers

Expected internal-only helpers:

- `normalizeImageIndexProductPayload()`
- `normalizeImageIndexImagePayload()`
- `imageIndexProductParams()`
- `imageIndexImageParams()`
- `buildSkippedHashedSummaryMap()`
- `tailId()`
- `isDpProductId()`
- `isHashedProductId()`

Existing normalization helpers in `scripts/postgres-dev-common.js` can be reused at first. If script-to-`src` imports become awkward, move generic helpers into a shared `src/postgres-normalize.js` module later.

## Product-Level Replace Semantics

Product-level replacement is the key safety requirement. DB-direct extraction must not simply upsert image records, because upsert-only behavior is what allowed stale staging rows to survive.

Recommended SQL pattern: delete existing image-index staging rows for the product, then insert the new replacement records, all inside one caller-owned transaction.

Step-by-step:

1. Validate `productId`.
2. Validate every `imageRecord.product_id` equals `productId`.
3. Upsert the `products` row for `source_system = 'image_index'`.
4. Delete old staging images for the product:

```sql
DELETE FROM images
WHERE source_system = 'image_index'
  AND source_product_id = $1;
```

5. Insert/upsert the replacement image records with the current `product_db_id`.
6. Record or return ingestion-run metadata.
7. Commit only after all rows are written.

Conflict key for individual image rows remains the existing unique constraint:

```sql
UNIQUE (source_system, source_image_id)
```

Rows belonging to a product should be identified by:

```sql
source_system = 'image_index'
AND source_product_id = $productId
```

### Partial Failures

Replacement must run in a single transaction. If any insert fails after delete, the transaction should roll back and preserve previous staging rows.

### Cascade Concern

`canonical_images.image_index_image_id` references staging `images(id)` with `ON DELETE SET NULL`. Deleting staging image rows can orphan current canonical provenance until `merge-canonical.js` is rerun.

For phase 1, this is acceptable only if:

- DB-direct writes are treated as staging-only until canonical merge runs.
- Validation does not assume canonical tables are updated immediately.
- Any runtime verification that depends on canonical data runs after `merge-canonical.js`.

Do not add tombstones in phase 1. Tombstones would require schema changes and `merge-canonical.js` filtering changes. `DELETE + INSERT` is closer to the existing JSON `replaceProductImages()` behavior.

## Parallel-Write Integration

During validation, JSON remains canonical. Parallel-write should therefore write JSON first, then write DB staging.

### Recommended Order

1. Generate extraction records.
2. Write/update `data/image-index.json`.
3. If JSON succeeds, write the same records to Postgres staging.
4. Run parity validation.

This avoids the more dangerous case where DB staging advances but the JSON source of truth fails to update.

### Failure Policy

JSON succeeds, DB fails:

- Preserve current behavior.
- Log loudly.
- Return a warning field where practical.
- Mark reindex status with a parallel-write warning.
- Allow retry/reconciliation from JSON.

DB succeeds, JSON fails:

- Should not occur with JSON-first ordering.
- If later DB-first mode is introduced, this should block and require reconciliation.

Parity fails:

- During early parallel-write: warning plus report artifact.
- Before cutover: blocking failure.

### Integration Points

`scripts/build-index.js`:

- Current full JSON write happens after extraction.
- Hook DB write immediately after `writeJson(indexPath, output)`.
- For `--append`, import the same final merged output so staging mirrors JSON.

`server.js` single-product refresh:

- `refreshProductIndex()` writes JSON after `replaceProductImages()`.
- Hook `replaceImageIndexProductImages()` after the JSON write succeeds.

`server.js` multi-product refresh:

- `refreshProductsIndex()` writes JSON once after collecting refreshed records.
- Hook DB replacement for each refreshed product after that JSON write.

`server.js` bulk refresh:

- `runBulkRefresh()` writes JSON per completed batch.
- Hook DB replacement for the same batch after each batch JSON write.

`src/refresh-index.js`:

- Keep JSON helpers unchanged for phase 1.
- Do not hide DB writes inside `replaceProductImages()` yet; that function is pure and easy to test today.
- Add DB hooks at orchestration points instead.

## Parity Validation

Validation should live outside the writer module. Writers should write; validators should inspect.

Recommended location: `scripts/validate-image-index-staging-parity.js`.

### Stage 1: Coarse Validation

- Compare refreshed product IDs.
- Compare image counts per product.
- Compare image ID sets per product.

This is the minimum validation for parallel-write.

### Stage 2: Sample Field Validation

For a small sample of images, compare:

- `visual_type`
- `effective_classification`
- `enum_fields`
- `visual_summary`
- `structured_caption`
- `search_text`
- embedding presence and dimensions
- `ai_refreshed_at`

This catches mapping mistakes without writing a full diff engine.

### Stage 3: Full Field Validation

Compare all mapped fields, excluding DB-generated IDs and timestamps.

This should be required before cutting over from JSON-first to DB-first.

### Failure Protocol

During parallel-write:

- Log warnings.
- Write a parity report artifact.
- Do not block existing JSON-backed behavior initially.

Before cutover:

- Fail the command on parity mismatch.
- Consider an extraction freeze flag if mismatches are detected.

## Testing Strategy

Minimum viable tests for phase 1:

- Payload-normalization tests using representative image-index records.
- SQL parameter-builder tests for product and image mappings.
- Integration test for `replaceImageIndexProductImages()` against a local test DB.
- Snapshot import smoke test through `migrateImageIndexSnapshot()`.

### Product Replacement Test

Test flow:

1. Insert a product with three old `image_index` images.
2. Replace it with two new image records.
3. Assert old images are gone.
4. Assert new images exist.
5. Assert product summary fields updated.
6. Force one insert failure and assert transaction rollback preserves old rows.

### Migration CLI Smoke Test

After refactoring `migrate-image-index-to-postgres.js` to call the shared module:

1. Run it against a tiny fixture JSON.
2. Compare resulting staging rows to expected fixture output.
3. Avoid using current live staging as baseline because it is mutable and noisy.

## Rollback Strategy

During parallel-write, JSON remains the rollback source.

If DB staging is corrupted:

1. Stop DB-direct extraction writes.
2. Restore image-index staging from current `data/image-index.json`.
3. Rerun `merge-canonical.js` if canonical tables were rebuilt from corrupted staging.

A new recovery script should be added before DB-direct cutover:

```text
scripts/rebuild-image-index-staging-from-json.js
```

Expected behavior:

1. Connect to local Postgres.
2. Delete all staging rows where `source_system = 'image_index'`.
3. Import current `data/image-index.json` through the shared writer module.
4. Record an ingestion run.
5. Print counts and warnings.

This is safer than the current importer because the current importer is upsert-only and cannot remove stale staging rows.

If canonical tables were corrupted:

1. Rebuild image-index staging from JSON.
2. Run `merge-canonical.js`.
3. Validate canonical counts and spot-check affected products.

## Phase 1 Implementation Scope

Move from `scripts/migrate-image-index-to-postgres.js`:

- `upsertProductSummary()` into `upsertImageIndexProduct()`.
- `upsertProduct()` into `upsertImageIndexProduct()` with fallback-image support.
- `upsertImage()` into `upsertImageIndexImage()`.
- `buildSkippedHashedSummaryMap()` into the shared module or importer helper.
- `tailId()`, `isDpProductId()`, and `isHashedProductId()` if needed by both writer and importer.

Keep in `scripts/migrate-image-index-to-postgres.js`:

- CLI `main()`.
- Reading `LIVE_IMAGE_INDEX_PATH`.
- Creating and closing DB client.
- Console logging.
- Process exit handling.
- CLI/report formatting.

Expected file impact:

- New `src/image-index-staging-writer.js`: roughly 300-450 lines.
- `scripts/migrate-image-index-to-postgres.js`: shrink from about 500 lines to roughly 80-140 lines.
- `scripts/postgres-dev-common.js`: probably unchanged initially.
- `server.js`: later parallel-write hooks, roughly 40-100 lines.
- `scripts/build-index.js`: later parallel-write hook, roughly 20-50 lines.
- Tests/fixtures: 1-3 new files.

## Recommendation For First Implementation Prompt

Do not start by parallel-writing everywhere.

First implementation should be:

```text
Extract the existing image-index migration mapping into src/image-index-staging-writer.js, refactor scripts/migrate-image-index-to-postgres.js to use it, and add tests for snapshot import plus product-level replacement semantics.
```

Once that lands, parallel-write hooks in `server.js` and `scripts/build-index.js` become much safer and smaller.

