# Tables Taxonomy Verification Memo

## 1. Overview

Step 10 validated that the family-aware tables foundation from step 9 works against real catalog data, not just registry/spec design. The goal was to pressure-test the four production-targeted tables sub-categories against live Designer Pages catalog products, verify that extraction scope behaves deterministically, and confirm that tables can flow through the production index and search stack as real v2 records.

High-level outcome: the foundation works, tables are viable as a real v2 family, and the main remaining work is no longer taxonomy definition but query-side/search-side integration and a handful of quality follow-ups. The verification also surfaced several concrete improvements, including the shared finish-palette refinement, minimal production routing for clean table categories, and a small frontend routing fix required for phrase-detected table searches.

Date range of step 10 work: May 4, 2026.

## 2. What Was Verified

- `40` tables products were extracted across `4` verified sub-categories:
  - `conference`
  - `occasional`
  - `cafe_dining`
  - `training`
- Sampling was split into two batches:
  - `10b`: `20` products (`5` per sub-category)
  - `10d`: `20` additional products (`5` per sub-category, no overlap with `10b`)
- All `40` products completed successfully through both:
  - the research/verification path (`/tmp/tables-taxonomy-verification.json`, `/tmp/tables-taxonomy-verification-10d.json`)
  - the production path (`/api/refresh-products`, writing production records into the live index)
- Conditional trait scope correctness was `100%` across all `40` sampled products:
  - `conference`: `power_data_integration` only, no `height_register`
  - `occasional`: `height_register` only, no `power_data_integration`
  - `cafe_dining`: `height_register` only, no `power_data_integration`
  - `training`: both fields present
- Real production search now returns correctly filtered tables results when the request carries `visual_type=conference|occasional|cafe_dining|training`.

## 3. Per-Sub-Category Findings

### Conference

`10` products were sampled. Extraction was coherent and visually diverse. The bucket supported a wider range of `base_type` and `top_shape` values than the other three sub-categories, including `Pedestal`, `T-leg`, `Panel-slab`, `Trestle`, and `4-leg`, with `Rectangle`, `Oval`, `Round`, and `Soft-organic` top variants appearing across the two batches. This is the broadest visually within-bucket category in the verified set, but the category still extracted cleanly and consistently.

### Occasional

`10` products were sampled. This bucket was heavily `Pedestal` + `Round` dominant, which is a real catalog pattern rather than a taxonomy problem. `height_register` correctly split products between `Coffee` and `End/Side`. The category is visually coherent, but it overlaps structurally with `cafe_dining` in silhouette more than with `conference` or `training`.

### Cafe/Dining

`10` products were sampled. This bucket was also strongly `Pedestal` + `Round` dominant, with one `4-leg` variant and a smaller amount of rectangular variation. `height_register` correctly separated `Sitting` vs `Standing`, which proved to be one of the main discriminators in practice. The extracted results were usable and stable, but visual overlap with `occasional` remains a real structural ambiguity in the source catalog.

### Training

`10` products were sampled. This was the cleanest and tightest taxonomy bucket in the entire verification pass. The dominant signature was `T-leg` + `Rectangle` + `Casters`, with `Sitting` height and mostly `Not visible` / occasionally `Present` power-data outcomes. This category had the strongest visual identity and the lowest ambiguity in both the research path and production extraction.

### Huddle/Collaborative

`huddle_collaborative` was intentionally deferred from step 10. Step `10a`’s catalog distribution showed insufficient clean representation in the ingested DP categories to make a meaningful verification sample worth the extraction cost.

## 4. Cross-Cutting Observations

- `occasional` vs `cafe_dining` ambiguity is structural, not a bug. Their silhouettes overlap substantially in real contract-furniture catalogs. In practice, `height_register` and DP category provenance were the primary discriminators.
- `training` has the tightest visual signature of the four buckets.
- `conference` has the broadest visual range and the most internal variation while still remaining extraction-coherent.
- Across the `40` sampled products, the sub-categories exercised the major base archetypes expected for these categories:
  - `Pedestal`
  - `T-leg`
  - `Panel-slab`
  - `4-leg`
  - plus smaller appearances of `Trestle` and `Tripod`
- The `X-base` bucket did not appear in any sampled product. It remains in the schema, but step 10 produced no live evidence for it.

## 5. Palette Refinement

Step `10b` surfaced two concrete issues in the shared finish palette:

- smooth painted neutrals like gray had no good home
- `colored` implicitly read as “non-neutral” instead of “painted finish of any color”

Step `10c` refined the shared palette to align with seating’s conventions and close those gaps:

- all values were renamed to human-readable Title Case
- `colored` was renamed to `Painted color`
- `Gray` was added
- `Unknown` was added as an explicit abstain option

The canonical post-`10c` finish palette became:

- `Polished chrome / nickel`
- `Brushed nickel / stainless`
- `Matte black`
- `Warm gold / brass`
- `Bronze / dark`
- `White`
- `Gray`
- `Painted color`
- `Unknown`

Re-extraction on the `7` affected `10b` products validated the refinement:

- the canonical win was `Aware Training Table`, which moved from `White` to `Gray`
- some previous `colored` guesses became `Unknown`, which was healthier than forcing an overconfident painted-color guess

The `10d` batch validated the refined palette at a larger sample size:

- `Gray`: `1`
- `Painted color`: `3`
- `Unknown`: `2`

## 6. Tiebreaker Analysis

On the production extraction of the verified tables sample, tables did **not** look cheaper/easier than seating.

Observed rates from the live-index snapshot:

- tables tiebreaker rate: about `41.9%`
- seating reference rate: about `31.9%`

By table sub-category, the provisional rates clustered as:

- `training`: about `31%`
- `conference`: about `44%`
- `occasional`: about `41%`
- `cafe_dining`: about `46%`

So `training` was the cleanest bucket, while the other three needed the third pass more often.

The production records do not persist per-pass trait payloads, so step 10 could not compute pass-1 vs pass-2 disagreement by field directly. The closest available proxy was low-confidence final outputs on triggered records. The fields that showed up most often in those ambiguity surfaces were:

- `base_visual_weight`
- `base_finish`
- `edge_profile`
- `base_type`
- `top_thickness`

Note: this is “fields that ended up low-confidence after consensus voted” — not “fields that drove the tiebreaker.” Whether a trait is volatile across passes (the actual tiebreaker driver) cannot be determined from the data we have.

This suggests that tables do not currently support a “just use two passes” simplification without further evidence.

## 7. What Was Integrated Into The Live Index

Step 10 concluded with the `40` verification products re-extracted through the real production pipeline and written into the live image index as production records with:

- proper production schema
- embeddings
- real image dimensions
- standard search/index fields

Results of the production integration:

- total batch products: `40`
- failures: `0`
- processed images: `519`
- Live index delta: `8561 → 9080` image records (delta: `519`). Of those, `257` are typed tables records visible in production search. The remaining `262` are non-product or excluded image records (scene/detail variants) processed during the same product refresh.

These records now flow through production search correctly when the request resolves to:

- `conference`
- `occasional`
- `cafe_dining`
- `training`

Canonical live index path:

`/Users/jacobslevin/Documents/Documents - Jacob’s Mac Studio/Jake 2.0/Codex/PixelSeek/image-index.json`

Backup created before integration:

`image-index.backup-pre-tables-integration-2026-05-04T12-53-00.json`

## 8. Known Issues / Follow-Up Work

### 8a. Query-Side Scoring Is Not Yet Family-Aware (Step 12)

Search now filters correctly by `visual_type`, but query-side matching still behaves as if tables are not first-class structured categories. As a result, tables search currently scopes results to the right category but does not rank them by query relevance the way seating search does — meaning a query like `conference tables with wood legs` returns conference tables, but doesn't preferentially surface ones with wood-look bases.

Symptoms observed during step 10:

- refine-results panel missing for tables
- `trait_contributions` effectively zero for tables in score-debug views
- `text_query_traits` can still emit seating-shaped values for table queries

This became step `12`, to be completed before Phase 1 closes.

### 8b. Stage 0 Misclassification Of Scene/Lifestyle Photos

Some staged-environment or contextual photos still pass Stage 0 as `product` rather than `scene` or `product_detail`. That surfaced during conference/training searches as room-scene hero images for otherwise valid products. The current search-time penalty for these images is mild. This is a real quality issue, but it is more of a classification/tuning problem than a taxonomy failure.

Recommended later work:

- Stage 0 prompt tuning
- stronger search-side penalty for contextual product images

### 8c. Per-Pass Trait Payload Persistence

Step 10 could not compute per-field pass-1 vs pass-2 disagreement rates because production records do not store pass-level trait payloads, only final voted results plus usage metadata. If future analysis needs that visibility, production extraction needs either:

- a diagnostic mode that stores pass outputs
- or a separate analysis path that persists pass-level trait data outside the canonical production record

This is best treated as a Phase 2 enhancement.

### 8d. Hero Image Selection During Ingestion

Products such as `Dock Training` showed that “first qualifying image” can still be a detail-oriented or otherwise weak primary image. That degrades extraction quality even when the taxonomy is right. Ingestion currently chooses the first image that passes the short-side gate, not the best hero image.

Improving hero image selection would benefit all families, not just tables.

### 8e. Mixed-Tag DP Category Routing

More than `50` ingested tables products still have multi-tag DP categories that do not route through production extraction. Step `9e` intentionally added only the six clean exact groupings needed to route the `40` verification products:

- `Occasional Tables`
- `Conference Tables`
- `Conference Tables | Workplace`
- `Cafe Tables`
- `Training Tables`
- `Training Tables | Workplace`

Long-tail mixed-tag routing remains deferred until the remaining ingested tables are ready for extraction. The deeper investigation and proposed mappings were documented during `9e Part 1`.

### 8f. Huddle/Collaborative Sub-Category

`huddle_collaborative` remains unverified because the ingested DP corpus did not yet contain enough clean representatives. Revisit this when more huddle products are ingested or when DP catalog patterns justify explicit routing.

### 8g. `X-base` Base Type Bucket

No `X-base` examples appeared in any of the `40` sampled products. That does not prove the bucket is wrong, but it does mean step 10 produced no evidence for it. Watch the bucket as more tables are extracted; consider consolidation later if it never appears.

### 8h. `seating_type` Carries Table Values For Compatibility

Per the `9a-2` compatibility decision, top-level `seating_type` continues to exist in production records and now carries table values like `conference` and `training` for legacy consumers. This is intentional and not a bug, but it remains an architectural cleanup target for later work.

### 8i. Seating Finish Palette Reconciliation

Seating uses an inline finish palette (`Black`, `Natural wood`, `Painted color`, `Polished chrome / aluminum`, `White`, `Unknown`) that predates the shared `finish_palette_v1` used by tables and faucets. The post-`10c` shared palette is more granular but doesn't include `Natural wood`. Eventually, all three categories should use a unified palette so that finish-based search behaves consistently across categories. This is meaningful Phase 2 taxonomy work that affects all three families.

## 9. Phase 1 Status Snapshot

At the end of step 10:

- planned steps `1-9` were complete
- step `10` was complete
- step `11` (adapter retirement) remained optional and was deferred to Phase 2
- step `12` was added based on step 10 findings and must land before Phase 1 closes

Practical status: tables now ship in v2 as a real category foundation, and step `12` is the main remaining blocker before calling the Phase 1 tables work closed.

## 10. Operational Notes Captured During Step 10

- The canonical live image index path is the local PixelSeek folder:
  - `/Users/jacobslevin/Documents/Documents - Jacob’s Mac Studio/Jake 2.0/Codex/PixelSeek/image-index.json`
- `src/utils.js` now carries that canonical path as the default index path, while `IMAGE_INDEX_PATH` still overrides it when explicitly set.
- The `"all"` sentinel in frontend routing caused one late step 10 search bug:
  - phrase-detected category searches like `conference tables` were being treated as unscoped because `"all"` was handled as if it were a real explicit visual type
  - that bug was fixed late in step 10
- Early diagnostics were briefly confused by stale browser/server state:
  - a stale in-memory server index
  - an older browser tab still running earlier frontend code
  - both were resolved during step 10 troubleshooting

## Appendix: Durable Artifacts From Step 10

- research batch `10b` raw output:
  - `/tmp/tables-taxonomy-verification.json`
- research batch `10d` raw output:
  - `/tmp/tables-taxonomy-verification-10d.json`
- translated `10b` post-`10c` output:
  - `/tmp/tables-taxonomy-verification-10b-translated.json`
- backfilled `10d` output:
  - `/tmp/tables-taxonomy-verification-10d-backfilled.json`
- merged `40`-record research dataset:
  - `/tmp/tables-extractions-40.json`

These `/tmp` artifacts were intermediate verification outputs. The canonical production state is the live index and the code/docs commits that landed during step 10.
