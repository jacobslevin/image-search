# Step A Audit: Adding Tables as a Second Visual Family

Date: 2026-04-28

Scope: research only. This document audits the current seating-only implementation and recommends how to prepare the codebase for a second visual family (`Tables`) before any refactor begins.

## 1. Canonical Routing Model And Naming Recommendation

### Recommendation

Use `visual_type` as the new canonical vision-routing field name.

Why `visual_type` is the best fit:

- `category` is already overloaded elsewhere in the codebase to mean catalog taxonomy from Designer Pages (`a_level`, `b_level`, `c_level`, `raw_category`, canonicalized category labels).
- The current `seating_type` field is not a catalog category. It is a vision-routing class that drives extraction schema, search-time filtering, prompt selection, and UI behavior.
- `visual_type` describes what the field is, not just what it does. That makes a future `lounge_chair` / `occasional_table` split legible to someone reading the code without needing the migration history.

### Migration Pattern

Recommended pattern: introduce `visual_type` as the new canonical field while preserving `seating_type` as a read/write compatibility alias during the migration.

Why this is safer than a hard rename:

- `seating_type` is persisted in indexed images, query-time analysis payloads, debug payloads, prompt-library payloads, diagnostics, progress objects, URL params, and scripts.
- A hard rename would force synchronized changes across `src/`, `public/`, `server.js`, scripts, fixtures, and generated JSON artifacts.
- A compatibility period allows Step B to convert family-aware infrastructure first, then retire `seating_type` after indexed data and client payloads are migrated.

Recommended shape:

- Canonical internal field: `visual_type`
- Compatibility alias during migration: `seating_type`
- Family derived from config, not stored separately at first
- Legacy URL/query param support for `seating_type` during transition, with a new canonical param introduced later if needed

### Family: Stored Or Derived

Recommendation: derive family from config; do not persist a second `family` field initially.

Why:

- The code already treats the specific routing key as the primary truth: `task_collab_chair`, `guest_chair`, `lounge_chair`, `stool`, and `bench` drive prompts, trait fields, filtering, image-cap policy, diagnostics, and UI ordering.
- No current code path needs an independently stored family once the routing config can answer “which family owns this type key?”
- Persisting both `family` and `visual_type` would increase migration surface without solving a current problem.

Suggested future config shape:

```json
{
  "families": {
    "seating": {
      "types": {
        "lounge_chair": { "...": "..." }
      }
    },
    "tables": {
      "types": {
        "occasional_table": { "...": "..." }
      }
    }
  }
}
```

With that structure, family is derived by looking up which family owns a given `visual_type`.

## 2. Catalog Taxonomy Vs. Vision-Routing Taxonomy

### Catalog Taxonomy: where it lives now

Catalog taxonomy currently means Designer Pages category structure and text-derived catalog labels.

Primary locations:

- `src/designerpages.js`
  - `buildCategoryLevels`
  - `parseDesignerPagesProductPayload`
- `src/utils.js`
  - `getCategoryLevels`
  - `getLeafCategories`
  - `getNavigationCategories`
  - `getAllCategoryTerms`
  - `getCategoryGroupingKey`
  - `getPixelSeekType`
- `src/category-rules.js`
  - `CATEGORY_RULES`
  - `canonicalizeCategory`
- `src/query-parser.js`
  - `detectCategory`
  - `parseSearchQueryWithAI`

Catalog taxonomy inputs and outputs include:

- `a_level`, `b_level`, `c_level`
- `raw_category`
- canonical catalog categories like `Lounge Seating`, `Bench Seating`, `Occasional Tables`
- grouped Designer Pages combinations used by `getPixelSeekType`

### Vision-routing taxonomy: where it lives now

Vision routing currently means “which structured trait schema and downstream logic applies to this image/query/result.”

Primary locations:

- `data/seating-types.json`
- `src/captioning.js`
- `src/search.js`
- `src/search-category-filter.js`
- `public/app.js`
- `public/category-scope.js`
- `src/pipeline-diagnostics.js`
- `server.js`

Current routing keys:

- `task_collab_chair`
- `guest_chair`
- `lounge_chair`
- `stool`
- `bench`

### Are they currently distinct?

Partially, but not cleanly.

The codebase has a real conceptual split between:

- catalog taxonomy
- PixelSeek display labels
- vision-routing keys

But the names and plumbing are mixed enough that the boundaries are easy to miss.

### Current conflation points that should be separated

1. `getPixelSeekType` in `src/utils.js`

- This function translates Designer Pages catalog groupings into PixelSeek seating labels.
- It mixes catalog taxonomy concerns with runtime routing concerns.
- It is also seating-only: both the grouping map and routing label map assume a single family.

2. `server.js` search-category validation

- `/api/search` validates filters against `ACTIVE_SEATING_TYPE_KEYS` and errors with “PixelSeek seating types.”
- This ties API semantics, user-facing validation copy, and seating-only routing keys together.

3. `public/category-scope.js`

- The URL/query model uses the param name `seating_type` for result scope.
- That is vision-routing state, not catalog category state.

4. `public/app.js` label formatting and clarification prompts

- The UI presents routing keys through `SEATING_CATEGORY_DISPLAY_NAMES` and clarification messages like “What kind of seating are you looking for?”
- That works today because the only family is seating, but it conflates family assumptions with a generic category-picker interaction.

5. `src/query-parser.js` + `src/category-rules.js`

- The parser can detect catalog categories including `Occasional Tables`, but the rest of the pipeline still routes only within seating.
- This is a real mismatch already present in the codebase.

## 3. `seating_type` Assumption Inventory

Notes on inventory scope:

- “Place” below means a logical block, function, endpoint, or grouped block with one refactor treatment.
- Generated data snapshots are not enumerated row-by-row; they are summarized in a separate appendix because they are outputs, not active logic.
- The duplicated `src/captioning-stage23-test.mjs` file mirrors many `src/captioning.js` assumptions and should be treated as a parallel maintenance target.

### Tag definitions

- `generic keyed lookup`: config-driven, easy to generalize once the config is family-aware
- `specific enum-list assumption`: explicit list of seating values; must be templated or family-aware
- `one-off branch on a named type`: custom logic for `lounge_chair`, `stool`, etc.; higher risk
- `UI copy / labels only`: cosmetic or labeling-only usage

### Core runtime inventory

| Location | Current usage | Tag | Proposed treatment |
| --- | --- | --- | --- |
| `src/utils.js:140-182` `ROUTING_KEY_TO_PIXELSEEK_TYPE`, `ACTIVE_SEATING_TYPE_KEYS` | Seating-only map from routing keys to display labels; also exports active key list | `specific enum-list assumption` | Replace with family-aware routing registry that can answer `type -> display label`, `type -> family`, and `family -> active types` |
| `src/utils.js:221-299` extraction caps and `normalizeRoutingTypeKey` | Seating-only normalization aliases and per-type extraction caps | `specific enum-list assumption` | Move aliases and cap policy into family-aware config; tables likely need a separate cap policy |
| `src/search-category-filter.js:52-84` `collectActiveResultSeatingTypes`, `filterSearchResultsByCategory` | Result filtering reads `image.seating_type` and assumes category filters are seating routing keys | `generic keyed lookup` | Rename to generic active visual types; filter against family-aware valid routing keys |
| `src/search.js:48-79` seating config load and field lookup helpers | Loads `data/seating-types.json` and resolves fields keyed by seating type | `generic keyed lookup` | Swap to family-aware config loader and `getTypeFields(visualType)` |
| `src/search.js:91-98` `STRUCTURED_BULLET_FIELD_ALIASES` | Seating-oriented aliases, including `height` -> `height_category` | `specific enum-list assumption` | Make aliases family-scoped; table aliases should not inherit seating-only mappings |
| `src/search.js:134-171` `formatDetectedTraits` labels | Seating-heavy label map for trait chips | `generic keyed lookup` | Move field labels into per-family/per-type schema metadata |
| `src/search.js:182-200` `expandCompatibleSeatingTypes` | Special handling for `task_collab_chair` vs `task_chair`, `stool` vs `perch_stool` | `one-off branch on a named type` | Replace with compatibility-group metadata in config |
| `src/search.js:533-583` `computeTraitBoost` | Reads `record.stage1?.seating_type` and scores bullets by type-specific priority | `generic keyed lookup` | Generalize to `visual_type`; preserve family-specific field priorities via config |
| `src/search.js:710-726` `resolveImageSearchContext` | Resolves query/image-analysis type from `parsed.seating_type` or analysis payload | `generic keyed lookup` | Rename to `visual_type`; keep same logic under compatibility alias |
| `src/search.js:799-841` `searchIndex` stage1 type compatibility filter | Search filter assumes a single type dimension and seating compatibility rules | `specific enum-list assumption` | Replace with family-aware compatibility groups; tables likely need no cross-type compatibility aliases at first |
| `src/search.js:920-1014` product result assembly | Persists `seating_type` into hero/matching image payloads and debug payloads | `generic keyed lookup` | Emit `visual_type` canonically, keep alias during migration |
| `src/query-traits.js:159-203` table detectors vs. seating trait object | Query heuristics already detect `table` in `product_type`, but the returned trait object remains seating-shaped | `one-off branch on a named type` | Split text heuristics by family instead of mixing embryonic table detection into seating heuristics |
| `src/query-traits.js:222-260+` `extractQueryTraits` | Shared trait heuristics are seating-biased (`seating_category_visual`, `arm_type`, `seat_material`, etc.) | `one-off branch on a named type` | Family-specific text trait heuristics; tables should not share the seating trait object |
| `src/pipeline-diagnostics.js:16-30` diagnostics type ordering | Explicit diagnostics order for seating categories | `specific enum-list assumption` | Move ordering to family-aware diagnostics config; default UI should show one family at a time |
| `src/pipeline-diagnostics.js:141-203` logical inconsistency rules | Lounge/stool-specific integrity rules | `one-off branch on a named type` | Keep rules, but register them by `visual_type` or family/type pair |
| `src/pipeline-diagnostics.js:257-365` diagnostics aggregation | Counts and trait-health summaries keyed by `image.seating_type` and `diagnostics.seating_type` | `generic keyed lookup` | Rename field and make type lookup family-aware |
| `src/query-parser.js:40-55` `detectCategory` | Detects catalog category including `Occasional Tables` | `UI copy / labels only` for routing, but relevant separation point | Leave catalog taxonomy separate; do not reuse this as the routing classifier |
| `public/category-scope.js:1-59` seating-only category scope normalization | Normalizes aliases and phrase lists for seating-only composer/category scope | `specific enum-list assumption` | Replace with family-aware scope config and query phrase dictionaries |
| `public/category-scope.js:125-158` bullet stripping and URL param build | Treats `seating_type:` bullets specially and serializes `seating_type` URL param | `specific enum-list assumption` | Introduce generic scoped-type bullet handling and canonical URL state |
| `public/app.js:51-62` `state.currentSeatingType` and related state | Seating-only state names used across search/refine/image analysis | `generic keyed lookup` | Rename state to `currentVisualType`/`originalVisualType` with alias handling at API boundaries |
| `public/app.js:102-122` category display names, supported browse types | Explicit seating label map and supported-type set | `specific enum-list assumption` | Move labels and browse-support flags into family-aware config metadata |
| `public/app.js:181-205` matrix type order and priority field order | Explicit seating matrix order and seating-oriented field order | `specific enum-list assumption` | Inspector should become family-switcher with per-family type order and field priority order |
| `public/app.js:1004-1060` label formatting and category-scoped image filtering | Formats seating labels and filters images by `image.seating_type` | `generic keyed lookup` | Rename to generic visual-type label formatting and type-scoped filtering |
| `public/app.js:1643-1689` trait-field config bootstrap | Reads `bootstrap.seating_types` and resolves fields for the current type | `generic keyed lookup` | Generalize bootstrap payload to include family-aware visual schemas |
| `public/app.js:1691-1715` structured-bullet parsing | Defaults type context to `state.currentSeatingType` | `generic keyed lookup` | Rename to generic current visual type |
| `public/app.js:2070-2185` debug lightbox build/fetch | Reads `heroImage.seating_type`, prints `seating:` label, posts `seating_type` to search APIs | `generic keyed lookup` | Rename payload fields and labels to generic visual type; compatibility alias during migration |
| `public/app.js:3038-3055` extraction summary title | Heading says “By seating type” | `UI copy / labels only` | Rename to “By visual type” or family-aware section title |
| `public/app.js:3357-3358` unmapped mapping options | Unmapped DP combinations can only map to seating labels | `specific enum-list assumption` | Mapping UI must become family-aware and include table routing targets |
| `public/app.js:3850-3872` `refineSearchResults` | Posts `seating_type` to `/api/refine-search` | `generic keyed lookup` | Rename request field canonically; accept alias during migration |
| `public/app.js:3882-3927` `applyActiveSearchContext` | Stores `currentSeatingType`, reads `payload.seating_type`, `payload.seating_type_source` | `generic keyed lookup` | Rename client state and API payload fields; compatibility alias |
| `public/app.js:4161-4252` trait config and chip formatting | Reads `bootstrap.seating_types`; label map is seating-biased | `generic keyed lookup` | Family-aware config plus field label metadata |
| `public/app.js:4272-4318` stored-image search context | Builds image-analysis context with `seating_type` and `stage1.seating_type` | `generic keyed lookup` | Rename to `visual_type`; keep alias while stored payloads migrate |
| `public/app.js:4928-5052` clarification bar | Prompts user to choose among seating-only options and stores `seatingTypeOverride` | `specific enum-list assumption` | Make clarification family-aware; message and option source must come from backend family/type schema |
| `public/app.js:5166-5188` structured trait type entries | Structured trait matrix is built from `bootstrap.seating_types` in seating order | `specific enum-list assumption` | Convert inspector to family-switcher; build entries from selected family only |
| `public/app.js:6271-6275` refine bullet formatting | Special-cases label `seating type` | `UI copy / labels only` | Replace with `visual type` display formatter |
| `public/app.js:6651-6669` matching-image normalization | Browse/search image selection narrows to same `seating_type` as hero | `generic keyed lookup` | Rename to generic visual type; preserve same behavior |
| `public/app.js:6845-6856` active image context | Reads resolved `seating_type` from active image/hero/debug state | `generic keyed lookup` | Rename to `visualType` in UI state |
| `public/app.js:7561-7695` `runSearch` | Search request/response contract uses `seating_type`, `seating_type_source`, `seating_category_options`; category-required flow is seating-only | `specific enum-list assumption` | High-risk API/UI seam. Replace with family-aware routing payloads and neutral clarification contract |
| `public/app.js:7854-7866` `composeQueryForBullets` | `/api/compose-query` payload sends `seating_type`, default `"seating"` | `specific enum-list assumption` | Make compose-query family-aware; default family/type must not be hard-coded to seating |
| `public/app.js:7999-8156` image analysis flow | Stage1-only analysis, clarification prompt, `seating_type_override`, extracted-type status copy, and refine redirect are all seating-only | `specific enum-list assumption` | High-risk UI flow. Convert to neutral image-analysis routing contract with family/type-aware prompts |
| `public/app.js:8257-8355` bootstrap + URL hydration | Reads initial `seating_type` URL param, restores pending handoff with `seatingType` | `specific enum-list assumption` | Add canonical routing param support and backward-compatible alias parsing |
| `public/app.js:8423-8452` search form submit | Browse entry serializes `seating_type` into navigation state | `generic keyed lookup` | Rename to generic visual-type scope |
| `server.js:50-66` seating config and prompt-library type list | Server bootstrap and prompt library are explicitly seating-only | `specific enum-list assumption` | Introduce family-aware prompt-library registry |
| `server.js:1271-1319` structured-bullet field resolution | Server resolves bullet fields from `seatingTypes` | `generic keyed lookup` | Load family-aware config |
| `server.js:1392-1499` structured bullet normalization | Prioritizes bullets based on `seatingType` | `generic keyed lookup` | Rename to `visualType`; derive field priority from family/type config |
| `server.js:944-965` eval candidate profile | Emits `catalog.seating_type:*` tokens into eval profile | `UI copy / labels only` semantically, but persisted metric key | Rename metric namespace or preserve legacy alias for historical comparability |
| `server.js:2145-2167` representative product summary | Uses representative image `seating_type` as product-level summary field | `generic keyed lookup` | Rename stored field and compatibility alias |
| `server.js:2735` `/api/bootstrap` | Returns `seating_types` to the client | `specific enum-list assumption` | Return family-aware schema bundle; keep `seating_types` temporarily if client still expects it |
| `server.js:2816-2938` `/api/search` | Reads request `seating_type`, validates against `ACTIVE_SEATING_TYPE_KEYS`, infers seating category, emits `seating_type_source`, `seating_category_options` | `specific enum-list assumption` | Highest-risk server endpoint. Needs family-aware routing request/response contract and family-aware category inference |
| `server.js:2964-3013` `/api/refine-search` | Reads `body.seating_type`; injects `{ stage1: { seating_type } }` into parsed context | `generic keyed lookup` | Rename to generic visual type and keep alias during migration |
| `server.js:3229-3297` `/api/analyze-image` | Reads `seating_type_override`, checks stage1 seating confidence, emits `seating_category_options` | `specific enum-list assumption` | High-risk image-analysis endpoint; convert to neutral family/type routing |
| `server.js:3375` `/api/rewrite-query-traits` | Normalizes structured bullets with `body.seating_type` | `generic keyed lookup` | Rename payload field to `visual_type` |
| `server.js:3496-3509` `/api/compose-query` | Reads `body.seating_type` and defaults to `"seating"` | `specific enum-list assumption` | Make family/type explicit; no implicit seating fallback |
| `src/captioning.js:27-54` seating schema load, Stage 1 enum list, PixelSeek map | Core extraction module is wired directly to `data/seating-types.json` and an explicit seating value list | `specific enum-list assumption` | Highest-risk family fork. Replace with family-aware schema registry and family-specific Stage 1 classifier |
| `src/captioning.js:120-188` stage1 override/excluded payload shapes | Empty payloads and excluded records explicitly include blank `seating_type` | `generic keyed lookup` | Rename payload shape; keep alias during migration |
| `src/captioning.js:391-429` visual-summary instructions | Prompt copy says “this seating type” and assumes a seating product noun | `specific enum-list assumption` | Family-specific visual-summary prompt builders |
| `src/captioning.js:768-985` Stage 1 and consolidated schemas | JSON schemas explicitly enumerate seating values and require `seating_type` | `specific enum-list assumption` | Replace with family-aware classifier schemas; likely separate seating vs. tables Stage 1 prompts |
| `src/captioning.js:987-1020` per-type field guides | Builds guide from seating-only type set | `generic keyed lookup` | Family-aware type registry |
| `src/captioning.js:1022-1080` `consolidatedStage123Prompt` | Prompt says “primary seating product,” enumerates seating-only type list, and injects seating-only special rules | `specific enum-list assumption` | Highest-risk family-level prompt branch; tables need a separate family prompt builder |
| `src/captioning.js:1240-1300` query-composition prompt and Stage 1 classifier | Search-query writer says “Given a seating type”; Stage 1 classifier schema name is `seating_type_classifier` | `specific enum-list assumption` | Family-aware query composer and classifier naming |
| `src/captioning.js:1303-1325` `visualDescriptionPrompt` | Prompt says “primary seating item” and instructs model to ignore tables/background | `specific enum-list assumption` | Family-specific prompt copy; table family should not tell the model to ignore tables |
| `src/captioning.js:1740-1864` Stage 2/3 extraction calls and combined prompt | Runtime prompt text, schema names, and handoff notes all assume seating | `specific enum-list assumption` | High-risk family-level prompt branch. This is the main blocker to any table launch |
| `src/captioning.js:3001-3029` deterministic text-query enum fields | Explicit type branches for `lounge_chair`, `task_collab_chair`, `guest_chair` | `one-off branch on a named type` | Move deterministic mappings into family/type-specific handlers |
| `src/captioning.js:3031-3084` text-query trait prompt | Prompt text says “for seating”; fixed `seating_type` field is included in output | `specific enum-list assumption` | Family-specific text-query extraction prompts |
| `src/captioning.js:3086-3177` text-query category inference | Explicit seating category list and descriptions; returns `category_required` against seating-only options | `specific enum-list assumption` | Separate family inference from type inference; add table family/type options |
| `src/captioning.js:3179-3264` `extractTextQueryTraits` | Resolves `options.seatingType`, filters fields against seating schema | `generic keyed lookup` | Rename to `visualType`; field logic becomes family-aware |
| `src/captioning.js:3365-3813` indexed-image extraction record generation | Indexed records, progress payloads, and search text all persist `seating_type`; type resolution comes from seating-only PixelSeek maps | `specific enum-list assumption` | Family-aware indexing pipeline plus canonical `visual_type` field |
| `src/captioning.js:3831-4065` query-time Stage 1 voting | Query-time image analysis runs `classifySeatingType*`, validates against seating schema, and votes `seating_type` confidence | `specific enum-list assumption` | High-risk family-level classifier refactor |
| `src/captioning.js:4067-4257` Stage 1/2/3 vote aggregation | Consensus objects, confidence payloads, and aggregate outputs all persist `seating_type` | `generic keyed lookup` | Rename to `visual_type`; preserve compatibility alias |
| `src/captioning.js:4341-4565` `analyzeInspirationImage` | Stage1-only flow, forced type overrides, error messages, and outputs are seating-only | `specific enum-list assumption` | High-risk family-aware image-analysis API refactor |

### Supplementary scripts, tests, and maintenance tooling

| Location | Current usage | Tag | Proposed treatment |
| --- | --- | --- | --- |
| `src/captioning-stage23-test.mjs` mirrored prompt and voting logic | Test harness duplicates most seating-only assumptions from `src/captioning.js` | `specific enum-list assumption` | Keep in lockstep with the family-aware refactor or retire duplication |
| `scripts/recompute-cap-policy-savings.js:20-35`, `74-95`, `118-125`, `208-245`, `268-282` | Policy caps and savings analysis are hard-coded to seating types | `specific enum-list assumption` | Split seating cap analytics from future table cap analytics |
| `scripts/migrate-pipeline-compliance.js:123-131`, `137-157` | Migration reports preserve `seating_type`; logic branches specifically on `lounge_chair` | `one-off branch on a named type` | Keep as seating-specific migration script; no need to generalize unless reused |
| `scripts/strip-ghost-fields.js:21-31`, `42-83` | Uses resolved seating type to decide valid fields for cleanup | `generic keyed lookup` | Point at family-aware schema registry |
| `scripts/test-plan-view-shape.cjs:161` | Fixture selection filters `image.seating_type === "lounge_chair"` | `one-off branch on a named type` | Leave as seating-specific test or rename explicitly to seating plan-shape test |
| `scripts/run-visual-summary-stability.js:180`, `398`, `417`, `517` | Stability analysis groups results by seating type | `generic keyed lookup` | Family-aware grouping if reused across tables |
| `scripts/category-mismatch-scan.js:61`, `121` | Reports seating type alongside category mismatch | `generic keyed lookup` | Rename to visual type |
| `scripts/test-image-pipeline-stability.js:25`, `62` | Stores `analysis.seating_type` in snapshots | `generic keyed lookup` | Rename snapshot field when API changes |
| `scripts/test-consolidated-stage123.js:39` | Reads generated `stage1.seating_type` | `generic keyed lookup` | Rename test expectation once API changes |
| `docs/followups/search-mode-pixelseek-filter.md` | Docs describe category filters as PixelSeek seating types | `UI copy / labels only` | Update docs when API contract changes |

### Generated data and persisted artifacts

These are not active logic, but they are part of migration surface and should be expected to change once Step B lands.

Representative persisted artifacts:

- `data/primary-test-catalog.image-index.json`
- `data/designerpages-phase2-test-index.json`
- `data/reextract-stage123-progress.json`
- any backup snapshots under `data/` containing indexed image records

What changes later:

- top-level record field name
- `stage1.seating_type`
- `search_text` strings containing “seating type …”
- progress payloads containing `seating_type`
- diagnostics grouped by seating type

## 4. UI Fork Inventory

### Concentration of UI assumptions

Most UI forking risk is concentrated in `public/app.js`, with a smaller but important support layer in `public/category-scope.js`.

Primary seating-shaped UI forks:

- category labels and category pickers
- browse trait filter support
- structured trait matrix ordering
- category clarification prompts
- URL/query state
- search/refine/image-analysis API payloads
- prompt-library UI copy
- extraction-summary and diagnostics headings

### Fork inventory by concern

#### A. Category labels and category selectors

Primary locations:

- `public/app.js:102-122`
- `public/app.js:1004-1013`
- `public/app.js:3357-3358`
- `public/app.js:4928-5052`

Current behavior:

- All visible labels come from `SEATING_CATEGORY_DISPLAY_NAMES`
- clarification options are seating-only
- unmapped DP category combinations can only map into seating targets

Refactor need:

- replace seating label map with family-aware label registry
- clarification UI should receive option payloads from the backend, not derive seating options locally
- unmapped mapping UI must support table targets as first-class choices

#### B. Browse trait filter support

Primary locations:

- `public/app.js:116-122`
- `public/app.js:1030-1050`
- `public/app.js:6651-6655`

Current behavior:

- browse trait filters are only enabled for known seating types
- field config comes from `bootstrap.seating_types`

Refactor need:

- family-aware trait filter support keyed by selected family and type
- field labels should come from schema metadata rather than seating hard-codes

#### C. Structured trait inspector / matrix

Primary locations:

- `public/app.js:181-205`
- `public/app.js:5166-5188`

Current behavior:

- single seating matrix across seating categories
- ordering and field emphasis are explicitly seating-shaped

### Inspector recommendation

Recommendation: use a family-switcher, not a unified cross-family matrix.

Why:

- The current matrix assumes categories are meaningfully comparable column-to-column.
- Under the agreed parallel-schemas framing, seating and tables do not share enough value semantics for one matrix to be useful.
- A unified 11-column seating+tables view would be dominated by empty or irrelevant cells (`arm_option` vs. `has_modesty_panel`, `top_shape` vs. `back_height`).

Recommended UI shape:

- top-level toggle: `Seating | Tables`
- each family renders its own matrix ordering and field priorities
- shared inspector shell remains reusable

#### D. Category requirement prompts

Primary locations:

- `public/app.js:4928-5052`
- `public/app.js:7625-7639`
- `public/app.js:8035-8046`

Current behavior:

- prompts are seating-only in wording and option source
- state stores `seatingTypeOverride`

Refactor need:

- neutral prompt shell
- backend should own option payloads and copy such as “What kind of table are you looking for?” or “Which family does this image belong to?”

#### E. URL state and handoff state

Primary locations:

- `public/category-scope.js:145-158`
- `public/app.js:8257-8355`
- `public/app.js:8423-8452`

Current behavior:

- `seating_type` query param is the routing scope
- landing-page handoff and restore state also carry seating-only names

Refactor need:

- introduce canonical routing param/state naming
- preserve backward compatibility with `seating_type` temporarily

#### F. Result filtering and hero-image selection

Primary locations:

- `public/app.js:1053-1060`
- `public/app.js:6651-6669`
- `public/app.js:6845-6856`

Current behavior:

- matching images are scoped by same `seating_type` as the current browse scope or hero image

Refactor need:

- mostly rename-only once payloads and config are family-aware

## 5. Rollout Recommendation: All Five Table Categories Vs. Staged

### Recommendation

Launch tables with all five categories together after the family-aware refactor.

Do not stage tables by launching only `Occasional Tables` first.

### Why this is the right call

The audit found many seating-only assumptions, but they are overwhelmingly family-level, not “per extra category” level.

High-cost changes are required even for a one-category table launch:

- `src/captioning.js` Stage 1 classifier and Stage 2/3 prompts
- `server.js` `/api/search`, `/api/analyze-image`, `/api/compose-query`, `/api/bootstrap`
- `public/app.js` category clarification, image-analysis flow, matrix/inspector, URL/API payload contracts
- `public/category-scope.js` query/category phrase handling
- `src/search.js`, `src/search-category-filter.js`, and `src/pipeline-diagnostics.js` family-aware routing config and labels

Those costs do not meaningfully shrink if only `Occasional Tables` ships first.

### Why a single-category table launch is a weak test

`Occasional Tables` uses only the shared table core:

- `top_shape`
- `base_type`
- `top_material_family`
- `base_finish_family`

It does not exercise the category-specific extensions that make the family real:

- `Conference`: `top_construction`
- `Training`: `has_casters`, `has_modesty_panel`
- `Huddle/Collaborative`: `has_integrated_media`

So a one-category launch would validate only the easiest case while leaving the highest-value table-specific behavior untested.

### Cost reasoning from the audit

#### What is still hard today

These are the explicit code paths that still require code changes before any table category can launch:

- `src/captioning.js`
  - Stage 1 type enum and classifier schema
  - consolidated Stage 1/2/3 prompt
  - combined Stage 2/3 prompt
  - query-composition prompt
  - text-query category inference prompt
  - image-analysis orchestration and confidence handling
- `server.js`
  - `/api/bootstrap` schema payload
  - `/api/search` inferred-type flow and category-required contract
  - `/api/analyze-image` type override and ambiguity flow
  - `/api/compose-query`
  - prompt-library payload generation
- `public/app.js`
  - clarification bar
  - image-analysis search flow
  - search payload/hydration logic
  - structured trait inspector
  - unmapped category mapping UI
  - label maps and browse-support gating
- `public/category-scope.js`
  - seating-only phrase dictionary and URL serialization
- `src/utils.js`
  - PixelSeek grouping maps
  - active routing key list
  - extraction cap policy
- `src/search.js`
  - compatibility aliases
  - field labels
  - seating-config loader
- `src/pipeline-diagnostics.js`
  - explicit category order and seating-specific rules

#### What should become config-only after Step B

If Step B is done well, these should become family/type data rather than bespoke logic:

- type lists
- field definitions
- field labels
- supported browse/filter fields
- type ordering within a family
- per-type prompt rule text
- compatibility aliases

At that point, adding the five table categories together is preferable because:

- the family-level work is already paid
- the first launch actually exercises category-specific extensions
- data backfill cost is product/image-driven, not category-driven

### Bottom line

Current code is not ready for even one table category without real code changes.

But the audit does not support a staged table launch as a cheaper or safer product step. The hard work is family-level. Once that work is done, shipping all five table categories together is the better validation of the new abstraction.

## 6. Existing Schema Doc Conflict

`docs/trait-schema-v1.md` conflicts with the agreed parallel-schemas direction in two important ways.

### Conflict 1: shared core across categories

The doc explicitly promotes a cross-category shared core and later extension to tables:

- “shared core used across categories”
- “extend to tables, storage, lighting, and outdoor after seating stabilizes”

That conflicts with the current architectural decision for this audit:

- seating and tables are parallel schemas
- there is no cross-family trait dictionary
- shared infrastructure does not imply shared trait semantics

### Conflict 2: apparent table/seating field overlap

The doc assumes field names like `base_type` and `base_finish` can be normalized globally.

For tables, that is not a good assumption:

- table `base_type` values are intentionally different from seating `base_type` values
- the overlap is lexical, not semantic enough to justify one shared schema

### Recommendation

Do not extend `docs/trait-schema-v1.md` directly as if it were a canonical multi-family schema.

Recommended doc strategy:

1. Keep `docs/trait-schema-v1.md` as the historical seating-oriented schema doc.
2. Add a new `docs/trait-schema-tables.md` for the table family.
3. Update `docs/trait-schema-v1.md` with a short note that the original shared-core vision was superseded by parallel family schemas sharing infrastructure only.

That is cleaner than trying to retrofit the current document into a framework it no longer accurately describes.

## 7. Step B Implications

This audit suggests Step B should be split conceptually into two layers:

1. Family-aware infrastructure refactor
2. Table family implementation on top of that infrastructure

The highest-risk areas are not search scoring itself. They are:

- prompt-generation and classifier contracts
- API request/response shape
- client-side clarification and image-analysis flows
- config/bootstrap shape

That means Step B should start by making “family-aware but still seating-backed” infrastructure compile and run before adding the table family.

## Appendix A: Risk Summary

### Highest-risk `specific enum-list assumption` zones

- `src/captioning.js` Stage 1 classifier and Stage 2/3 prompts
- `src/captioning.js` text-query category inference
- `server.js` `/api/search` and `/api/analyze-image`
- `public/app.js` clarification, image-analysis, and structured-trait inspector flows
- `public/category-scope.js` seating-only query phrase model

### Highest-risk `one-off branch on a named type` zones

- `src/search.js` compatibility aliases for `task_collab_chair` and `stool`
- `src/captioning.js` type-specific prompt rule injections
- `src/captioning.js` deterministic text-query trait mappings
- `src/pipeline-diagnostics.js` lounge/stool-specific logical consistency rules
- seating-specific maintenance scripts like `scripts/migrate-pipeline-compliance.js`

### Low-risk rename / compatibility-alias zones

- payload assembly code that merely stores or forwards `seating_type`
- matching-image selection logic
- result debug payloads
- snapshot/test structures that mirror runtime output

