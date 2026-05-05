# Tables Taxonomy Verification Memo

## 1. Overview

Step 10 began as a verification pass: validate that the family-aware tables foundation from step 9 works against real catalog data, not just registry/spec design. Over the course of the work, that expanded into step 11 implementation and closure work: query-side family-awareness, Stage 0 scene handling corrections, finish-palette expansion, routing hardening, and clarification UX cleanup.

The goal remained the same throughout: pressure-test the production-targeted tables sub-categories against live Designer Pages catalog products, verify deterministic extraction scope, confirm that tables can flow through the production index and search stack as real v2 records, and then close the integration gaps that surfaced once real users and real queries hit the system.

High-level outcome: the family-aware foundation works; tables now flow through extraction, indexing, search, and clarification as a real first-class v2 family; and Phase 1 is now closed. The remaining work is no longer “make tables work at all,” but narrower post-Phase-1 quality follow-up: hero quality, long-tail routing coverage, per-pass diagnostics, and future cross-family taxonomy cleanup.

Date range of step 10 plus step 11 closure work: May 4-5, 2026.

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
  - the initial production path (`/api/refresh-products`, writing production records into the live index)
- Conditional trait scope correctness was `100%` across all `40` sampled products:
  - `conference`: `power_data_integration` only, no `height_register`
  - `occasional`: `height_register` only, no `power_data_integration`
  - `cafe_dining`: `height_register` only, no `power_data_integration`
  - `training`: both fields present
- Real production search now returns correctly filtered tables results when the request resolves to:
  - `conference`
  - `occasional`
  - `cafe_dining`
  - `training`
- After the later routing and Stage 0 fixes, the full verification corpus was re-extracted through the corrected pipeline:
  - `39` products succeeded
  - `1` product failed (`Tributaire™ Conference Tables`) for data-quality reasons, not because of a pipeline bug

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

Step 10 initially concluded with the `40` verification products re-extracted through the real production pipeline and written into the live image index as production records with:

- proper production schema
- embeddings
- real image dimensions
- standard search/index fields

Initial production integration results:

- total batch products: `40`
- failures: `0`
- processed images: `519`
- Live index delta: `8561 → 9080` image records (delta: `519`). Of those, `257` are typed tables records visible in production search. The remaining `262` are non-product or excluded image records (scene/detail variants) processed during the same product refresh.

Later in the session, after the Stage 0 prompt correction, `Natural wood` palette addition, and routing label/key separation fix, the verification corpus was re-extracted again through the corrected pipeline:

- total verification products re-extracted through corrected pipeline: `40`
- successful re-extractions: `39`
- failed re-extractions: `1`

The one failure was:

- `Tributaire™ Conference Tables` (`product_dp_14116320`)

Failure mode:

- `All images failed extraction`

Diagnosis:

- all available catalog images for `Tributaire` were correctly classified by the corrected Stage 0 as `scene` or `product_detail`
- this left zero usable product shots for extraction
- this is data-driven, not a pipeline bug
- the corrected Stage 0 is doing exactly what it should
- No code or pipeline change can resolve Tributaire without different source imagery. Re-attempts of `/api/refresh-products` on this product will produce the same result.

`Tributaire` should be treated as an edge case for later re-extraction only if additional clean product imagery becomes available.

Canonical live index path:

`/Users/jacobslevin/Documents/Documents - Jacob’s Mac Studio/Jake 2.0/Codex/PixelSeek/image-index.json`

Important backups created during this work included:

- `image-index.backup-pre-tables-integration-2026-05-04T12-53-00.json`
- `image-index.backup-pre-stage0-and-wood-fix-2026-05-04T19-44-36.json`
- `image-index.backup-pre-stage0-fix-retry-2026-05-04T20-10-09.json`
- `image-index.backup-pre-full-re-extraction-2026-05-04T20-39-20.json`

## 8. Known Issues / Follow-Up Work

### 8a. Query-Side Family-Awareness Gap: Resolved In Step 11

This gap was originally discovered at the end of step 10 and carried forward as “step 12.” Step 11 closed it.

What changed:

- step 11 commit 1 (`de1065d`) made text-query trait extraction family-aware
- step 11 commit 2 (`ad4a371`) made server-side category inference family-aware

What step 11 accomplished:

- text-query extraction now preserves tables `visual_type`s instead of collapsing them to seating fallback types
- query trait prompts and allowed field sets are now family-aware
- tables queries now emit table-shaped `enum_fields` and usable `search_bullets`
- server-side category inference now considers tables categories and properly triggers clarification for ambiguous spatial queries

This closes the original “tables filter correctly but do not rank/query-match like first-class structured categories” gap that ended step 10.

### 8b. Stage 0 Environmental Scene Handling Improved, But Hero Quality Still Has Follow-Up Work

The original tables Stage 0 prompt was effectively a reciprocal of the seating prompt and explicitly told the model to ignore surrounding furniture context when a dominant table was present. In practice, that caused obvious scene/lifestyle shots to pass as `product`.

The corrected Stage 0 prompt and completeness logic fixed the main failure mode:

- environmental indicators such as architectural context, multiple zones, decor, and real-space lighting now count as scene evidence
- the completeness prompt now distinguishes clean product presentations from fully realized rooms
- obvious scene heroes such as `Dock Meeting img_001` and `Anthology img_006` were correctly demoted to `scene` on re-extraction

Acknowledged limitation:

- borderline cases such as a single table surrounded by many chairs on a clean background (`Briefing Conference Table`) can still classify as `product`

That is acceptable for the current internal validation pass. The more important remaining follow-up is hero quality refinement:

- once Stage 0 is stricter, some products with mostly scene/detail image pools can surface partial-view heroes
- `Dock Meeting img_002` is the clearest example: after scene demotion, the product no longer shows a room hero, but its remaining winning image is a base-heavy partial view

This is best treated as post-Phase-1 follow-up:

- stronger product-detail suppression
- better hero selection among remaining product-valid images

### 8c. Per-Pass Trait Payload Persistence

Step 10 could not compute per-field pass-1 vs pass-2 disagreement rates because production records do not store pass-level trait payloads, only final voted results plus usage metadata. If future analysis needs that visibility, production extraction needs either:

- a diagnostic mode that stores pass outputs
- or a separate analysis path that persists pass-level trait data outside the canonical production record

This is best treated as a deferred follow-up enhancement.

### 8d. Hero Image Selection During Ingestion

Products such as `Dock Training` showed early that “first qualifying image” can still be a detail-oriented or otherwise weak primary image. The corrected Stage 0 work sharpened this issue further: once room scenes are excluded more aggressively, the remaining hero can be technically valid but still poor for browsing or trait extraction.

Improving hero image selection would benefit all families, not just tables.

### 8e. Mixed-Tag DP Category Routing

More than `50` ingested tables products still have multi-tag DP categories that do not route through production extraction. Step `9e` intentionally added only the clean exact groupings needed to route the verification products.

The later routing bug fixed in commit `f59d1c4` was **not** a mixed-tag problem. It was a display-label vs canonical-key regression on already clean table categories. Long-tail mixed-tag routing still remains deferred until the remaining ingested tables are ready for extraction. The deeper investigation and proposed mappings were documented during `9e Part 1`.

### 8f. Huddle/Collaborative Sub-Category

`huddle_collaborative` remains lightly exercised relative to the other four table categories because the ingested DP corpus did not yet contain enough clean representatives for a full step 10 verification sample. Revisit this when more huddle products are ingested or when DP catalog patterns justify explicit routing expansion.

### 8g. `X-base` Base Type Bucket

No `X-base` examples appeared in any of the `40` sampled products. That does not prove the bucket is wrong, but it does mean step 10 produced no evidence for it. Watch the bucket as more tables are extracted; consider consolidation later if it never appears.

### 8h. `seating_type` Carries Table Values For Compatibility

Per the `9a-2` compatibility decision, top-level `seating_type` continues to exist in production records and now carries table values like `conference` and `training` for legacy consumers. Intentional per the `9a-2` design; flagged here as a cleanup target for later work.

### 8i. Seating Finish Palette Reconciliation

Seating uses an inline finish palette (`Black`, `Natural wood`, `Painted color`, `Polished chrome / aluminum`, `White`, `Unknown`) that predates the shared `finish_palette_v1` used by tables and faucets. The post-10c shared palette is more granular but initially did not include `Natural wood`.

Step 11 added `Natural wood` to the shared finish vocabulary and used per-category subsetting so tables could opt in while faucets stayed excluded. That fixed the immediate tables problem, but seating still uses a different finish vocabulary structure.

Eventually, all three categories should use a unified palette so that finish-based search behaves consistently across categories. This is meaningful later taxonomy work that affects all three families.

## 9. Phase 1 Status Snapshot

Phase 1 is now closed.

Major commits that closed the remaining Phase 1 gaps:

- `de1065d` — family-aware text-query trait extraction
- `06f5f00` — Stage 0 environmental scene fix for tables
- `8fdd3c0` — `Natural wood` added to shared finish palette with per-category subsetting
- `f59d1c4` — routing label/key separation and canonical-key round-trip fix
- `ad4a371` — server-side category inference family-awareness
- `206f9c5` — text-search clarification gate fix (`apiRequestedVisualType: "all" -> ""`)
- `8068e76` — filtered, hierarchical clarification UI
- `62a2a0d` — clarification UX refinement: no default family selection

Important practical outcome:

- tables now ship in v2 as a real category family
- query-side extraction, search routing, clarification, and production re-extraction all work through the corrected pipeline
- the remaining work is no longer Phase 1 enablement work
- All planned and added Phase 1 closure work landed.

## 10. Operational Notes Captured During Step 10 / Step 11 Closure

- The canonical live image index path is the local PixelSeek folder:
  - `/Users/jacobslevin/Documents/Documents - Jacob’s Mac Studio/Jake 2.0/Codex/PixelSeek/image-index.json`
- `src/utils.js` carries that canonical path as the default index path, while `IMAGE_INDEX_PATH` still overrides it when explicitly set.
- A late frontend routing bug came from treating `"all"` as if it were a real API `visual_type` value:
  - fixed in `206f9c5` by separating the UI sentinel from the API request field
- A later routing regression came from conflating display labels with routing identity:
  - the “append Tables to display labels” UX change exposed that the same strings were being used for both UI labels and canonical routing
  - fixed in `f59d1c4` by separating display labels from canonical `visual_type` keys
- Clarification UX evolved in three stages:
  - server-side family-aware ambiguity detection (`ad4a371`)
  - frontend clarification gate fix (`206f9c5`)
  - filtered/hierarchical clarification presentation (`8068e76`, `62a2a0d`)
- Final verified clarification behavior:
  - `chair` → seating sub-categories directly
  - `table` → tables sub-categories directly
  - `conference room` → `Tables` + `Seating` family buttons; click reveals sub-categories
  - `kitchen` → `Faucets` + `Tables` + `Seating`; click reveals sub-categories
  - direct product queries such as `lounge chair` and `conference tables` still go straight to results

## 11. Step 11 Addendum: What Closed After Step 10

### 11a. Family-Aware Text Query Extraction

Step 11 commit 1 (`de1065d`) fixed the core query-side gap discovered at the end of step 10:

- `extractTextQueryTraits()` and its helpers are now family-aware
- tables queries preserve their real `visual_type`
- prompts, allowed fields, and deterministic query heuristics now reflect the target family
- table queries produce usable structured bullets for scoring instead of seating-shaped fallbacks

### 11b. Stage 0 Environmental Scene Fix

Step 11 also corrected the tables Stage 0 prompt (`06f5f00`):

- the prior prompt told the model not to count surrounding chairs as additional furniture when a dominant table was present
- that let obvious room/lifestyle shots pass as `product`
- the corrected prompt recognizes environmental indicators and uses a completeness response of `environmental` for fully realized rooms

This was validated both on targeted scene examples and in re-extraction behavior.

### 11c. Shared Finish Palette: `Natural wood`

During step 11 testing, `conference tables with wood legs` surfaced a real taxonomy gap:

- query extraction could recognize wood language
- but tables `base_finish` had no shared finish value for wood

Root cause:

- shared `finish_palette_v1` had no wood value for tables `base_finish`
- seating’s historical inline palette already had `Natural wood`

Fix (`8fdd3c0`):

- `Natural wood` was added to the master shared palette
- tables `base_finish` opted in via `allowed_subset`
- faucets did **not** opt in

This is a strong example of the architectural value of shared palette plus per-category subsetting.

### 11d. Routing Label/Key Separation

The earlier “append Tables to display labels” commit revealed an architectural fragility: display labels and routing keys were using the same string vocabulary, so changing one for UX reasons broke routing.

The first five-product re-extraction attempt exposed this immediately:

- legitimate surviving `product` rows were written back as `excluded_reason: "unmapped_category_grouping"`

Fix (`f59d1c4`):

- routing now uses canonical `visual_type` keys (`conference`, `occasional`, etc.)
- display labels are reserved strictly for UI presentation
- regression tests were added to prevent recurrence

### 11e. Clarification UX Closure

During step 11 verification, a spatial-query bug surfaced:

- `conference room` returned `category_required: true` from the server
- but the frontend silently rendered `682` broad results instead of showing clarification

Three-stage fix:

1. server-side category inference became family-aware (`ad4a371`)
2. frontend clarification gate was fixed by changing `apiRequestedVisualType` from `"all"` to `""` for unscoped searches (`206f9c5`)
3. clarification options were filtered to plausible categories and rendered hierarchically by family (`8068e76`), then refined so no family is pre-selected by default (`62a2a0d`)

The final behavior is materially better than the earlier flat “show every category in one list” fallback and scales cleanly as more families exist.

The keyword-based filtering for plausible categories is a reasonable starting point. Future work may include more sophisticated semantic matching as the catalog grows or as queries become more nuanced.

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

These `/tmp` artifacts were intermediate verification outputs. The canonical production state is the live index and the code/docs commits that landed during step 10 and step 11 closure.
