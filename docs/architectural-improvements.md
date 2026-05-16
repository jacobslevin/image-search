# Architectural Improvements

## DB-Direct Extraction Plan

See `docs/db-direct-extraction-design.md` for the implementation-level companion design covering module interfaces, transaction semantics, integration points, validation, rollback, and Phase 1 scope.

### Background

The current local extraction pipeline uses `data/image-index.json` as a middle step between AI extraction and the runtime database:

```text
extraction -> data/image-index.json -> migrate-image-index-to-postgres.js -> staging tables -> merge-canonical.js -> canonical tables
```

Runtime search, browse, and refinement already read from Postgres canonical tables. The JSON file remains the extraction result ledger and the source for the image-index migration script.

The main JSON writers are:

- `scripts/build-index.js`, which generates extraction records and writes the full index.
- `server.js` admin refresh endpoints, which regenerate product records and write them back through `replaceProductImages()`.
- One-off re-extraction and cleanup scripts that read and rewrite `data/image-index.json`.

The JSON index contains top-level metadata plus lightweight `products[]` summaries and detailed `images[]` extraction records. The image records include stage outputs, enum fields, free text, captions, summaries, embeddings, costs, dimensions, timestamps, and raw stage payloads.

### Problem

`migrate-image-index-to-postgres.js` upserts JSON contents into the staging `products` and `images` tables, but it does not delete staging rows that are missing from the current JSON file. That creates drift potential: stale staging rows can persist even when the current `data/image-index.json` no longer contains those products or images.

Concrete evidence from the 2026-05-16 catalog-only products investigation:

- Burin (`product_dp_1888882`)
- Anza - Meeting (`product_dp_13945962`)
- Two4Six Meeting (`product_dp_11588120`)
- Trace (`product_dp_13946162`)
- E-Table 2 (`product_dp_14051131`)

These 5 products existed in local canonical DB state but not in the current repo `data/image-index.json`. Root cause: an older external image-index snapshot with 9643 records was imported through `migrate-image-index-to-postgres.js`; the current repo JSON has 2304 records. Because the migration is upsert-only, stale image-index staging rows persisted. `merge-canonical.js` then rebuilt canonical tables from staging and carried those stale products forward.

This is not urgent for those specific products because their current classifications looked plausible, but it exposes an architectural mismatch: extraction treats JSON as source-of-truth while runtime treats Postgres as source-of-truth.

### Proposed Approach

Move local extraction to write directly to Postgres staging tables, and demote `data/image-index.json` to a derived debug/export artifact.

The DB-direct extraction path should write:

- `products` rows with `source_system = 'image_index'` for extracted product summaries and refresh diagnostics.
- `images` rows with `source_system = 'image_index'` for extracted image records, including the same fields currently mapped by `migrate-image-index-to-postgres.js`.
- `ingestion_runs` rows for build or refresh batches, with logical run metadata and counts.

`merge-canonical.js` should remain in place initially. It already merges the source-aware staging tables into canonical products/images and preserves provenance in link tables.

`migrate-image-index-to-postgres.js` can eventually become a legacy importer for old snapshots rather than part of the normal extraction path.

JSON still has value for debugging, backup, portability, and manual inspection. The preferred long-term shape is DB-first extraction plus an explicit export command, for example `scripts/export-image-index-from-postgres.js`, when a JSON snapshot is useful.

### Phased Plan

1. Extract shared DB writer logic from `migrate-image-index-to-postgres.js`.

   Create reusable helpers for image-index staging writes, including product upsert, image replacement/upsert, and ingestion-run recording.

2. Parallel-write.

   Keep existing JSON writes unchanged, but also write the same extraction records directly to staging tables in one transaction. Validate that JSON-to-staging parity holds after refresh/build runs.

3. Preserve product-level replace semantics.

   Today `replaceProductImages()` removes old image records for refreshed product IDs before appending refreshed images. DB-direct extraction must preserve this behavior. A simple upsert-only implementation would repeat the current drift bug by allowing stale image rows to survive.

4. Flip readers and tools gradually.

   Update spot-fix and re-extraction scripts so they can select records from staging/canonical DB tables instead of only from `data/image-index.json`.

5. Make JSON a derived artifact.

   Add a DB-to-JSON export script for debugging, backup, and sysadmin handoff. Once validated, stop treating `data/image-index.json` as the extraction source-of-truth.

6. Retire the normal JSON migration path.

   Keep `migrate-image-index-to-postgres.js` only as a legacy snapshot importer, or rename it to make that role explicit.

### Scope

Minimum viable parallel-write implementation: approximately 1-2 focused engineering days.

Expected files affected:

- `scripts/migrate-image-index-to-postgres.js`
- A new shared staging writer module
- `scripts/build-index.js`
- `server.js`
- `src/refresh-index.js` or a replacement DB-oriented refresh helper
- Tests or validation scripts for parity and product-level replacement

Full cutover: approximately 3-5 focused engineering days.

Additional work for full cutover:

- DB-backed versions of re-extraction target selection.
- JSON export from Postgres.
- Cleanup or repurposing of JSON-first scripts.
- Documentation updates for the new local extraction workflow.

### Key Constraint

Product-level replace semantics are mandatory.

DB-direct extraction should not merely upsert by image ID. On a product refresh, old `image_index` staging rows for that product must be deleted, superseded, or otherwise excluded before the new extracted rows become canonical candidates. Without this, DB-direct extraction would preserve the same stale-row failure mode that caused the catalog-only products drift.
