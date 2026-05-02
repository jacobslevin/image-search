# V2 Structural Audit: Tables As A New Top-Level Family

Date: 2026-05-02

Scope: v2 planning only. This document is a partial refresh of [docs/step-a-visual-type-audit.md](/Users/jacobslevin/Code/image-search/docs/step-a-visual-type-audit.md), preserving the conclusions that still hold on `v2` and refreshing the current-code inventories that are now stale enough to matter for implementation planning.

Branch context: `v2`

HEAD at audit time: `ed27817cedf8f74feae542d81f4f2d942808a29a`

## 1. Canonical Routing Model And Naming

### Recommendation

Use `visual_type` as the new canonical vision-routing field name.

Why `visual_type` is the best fit:

- `category` is already overloaded elsewhere in the codebase to mean catalog taxonomy from Designer Pages (`a_level`, `b_level`, `c_level`, `raw_category`, canonicalized category labels).
- The current `seating_type` field is not a catalog category. It is a vision-routing class that drives extraction schema, search-time filtering, prompt selection, and UI behavior.
- `visual_type` describes what the field is, not just what it does. That makes a future `lounge_chair` / `occasional_table` split legible to someone reading the code without needing the migration history.

Confirmed current as of `ed27817cedf8f74feae542d81f4f2d942808a29a` per gap analysis on `2026-05-02`.

## 2. Migration Pattern And Family Derivation

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

Confirmed current as of `ed27817cedf8f74feae542d81f4f2d942808a29a` per gap analysis on `2026-05-02`.

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

Confirmed current as of `ed27817cedf8f74feae542d81f4f2d942808a29a` per gap analysis on `2026-05-02`.

## 3. `seating_type` Assumption Inventory (Refreshed On `v2`)

Notes on inventory scope:

- “Place” below means a logical block, function, endpoint, or grouped maintenance surface with one refactor treatment.
- Generated data snapshots and historical backup files are not enumerated row-by-row. They persist `seating_type`, but they are outputs or archives rather than active logic.
- The duplicated `src/captioning-stage23-test.mjs` file remains a parallel maintenance target.
- `public/curate.js` is now included; it was missing from the original audit.

### Tag Definitions

- `generic keyed lookup`: config-driven, easy to generalize
- `specific enum-list assumption`: prompt or code enumerates seating values explicitly
- `one-off branch on a named type`: custom logic for one or more specific seating keys
- `UI copy / labels only`: cosmetic or labeling-only usage

### Core runtime and extraction

| File | Location | Current usage | Tag | Proposed treatment |
| --- | --- | --- | --- | --- |
| `data/seating-types.json` | Whole file | Canonical routing registry is seating-only and every field entry is currently `type: "enum"` | `specific enum-list assumption` | Replace with family-aware schema registry; add field-type support beyond enum before Tables can carry numeric and dimensional traits cleanly |
| `src/utils.js` | `ROUTING_KEY_TO_PIXELSEEK_TYPE`, `ACTIVE_SEATING_TYPE_KEYS`, `normalizeRoutingTypeKey`, `getPixelSeekType`, `getPixelSeekTypeLabel` | Defines the active routing key set, seating label map, and catalog-to-routing translation helpers | `specific enum-list assumption` | Introduce family-aware routing registry that can answer type, label, family, alias, and active-type queries generically |
| `src/captioning.js` | module bootstrap (`seatingTypesPath`, `seatingTypes`, fallback type helpers) | Loads `data/seating-types.json` as the only extraction schema source | `specific enum-list assumption` | Replace with family-aware schema/prompt registry |
| `src/captioning.js` | Stage 0/1 override payloads and empty result shapes | Default payloads and confidence shapes explicitly carry `seating_type` | `generic keyed lookup` | Rename to `visual_type` canonically and preserve alias while records and clients migrate |
| `src/captioning.js` | `TYPE_LABEL_TO_KEY`, `getTypeFields`, `buildTraitFieldConfigIndex` | Resolves type labels and field config strictly within seating | `generic keyed lookup` | Keep the pattern but point it at family-aware config |
| `src/captioning.js` | consolidated Stage 1 schema and `schemaName: "seating_type_classifier"` | Stage 1 classification contract explicitly requires a seating enum | `specific enum-list assumption` | Highest-risk extraction seam; split into family-aware Stage 1 routing with family/type-neutral schema naming |
| `src/captioning.js` | `consolidatedStage123Prompt()` | Prompt instructs the model to classify a seating product and enumerates seating-only type rules | `specific enum-list assumption` | Build family-specific prompt generators; do not share seating-only Stage 1/2/3 prose with tables |
| `src/captioning.js` | Stage 2/3 combined prompt builders around `Seating type: ...` and `Stage 1 seating_type result: ...` | Stage 2/3 trait extraction handoff is keyed directly off `seating_type` and uses seating nouns throughout | `specific enum-list assumption` | Highest-risk area; convert to family-aware prompt builders with per-family field lists and rule text |
| `src/captioning.js` | per-type special rules (`stool`, `lounge_chair`, `task_collab_chair`, `guest_chair`) | Extraction prompt injects bespoke rules for named seating types | `one-off branch on a named type` | Move special handling into per-type config hooks or type-specific rule fragments under a neutral routing layer |
| `src/captioning.js` | `generateSearchQuery` prompt | Search-query writer says “Given a seating type” and forbids using seating category names | `specific enum-list assumption` | Make query-composition prompt family-aware; avoid an implicit seating fallback |
| `src/captioning.js` | `visualDescriptionPrompt` and related “primary seating item” copy | Query-time visual description prompt assumes the subject is seating and can tell the model to ignore tables | `specific enum-list assumption` | Split by family; tables cannot inherit “ignore tables” instructions |
| `src/captioning.js` | `extractTextQueryTraits()` and `inferTextQueryCategory()` | Text-query extraction, category-required decisions, and schema fields all persist `seating_type` | `specific enum-list assumption` | Introduce neutral family/type routing payloads and family-aware text-trait extraction |
| `src/captioning.js` | indexing/orchestration paths (`generateProductExtractionRecordsWithCap`, vote aggregation, progress payloads) | Indexed records, votes, progress objects, and search text persist `seating_type` throughout | `generic keyed lookup` | Rename to canonical `visual_type`; retain alias through indexed-data migration |
| `src/captioning.js` | `analyzeInspirationImage()` | Image-analysis flow uses `seatingTypeOverride`, validates against seating schema, and returns seating-focused ambiguity flows | `specific enum-list assumption` | Convert to family-neutral image-analysis contract with family-aware clarification options |
| `src/search.js` | module bootstrap (`seatingTypesPath`, config load, fallback type) | Search scoring/filtering loads only `data/seating-types.json` | `generic keyed lookup` | Point search at family-aware schema bundle |
| `src/search.js` | `STRUCTURED_BULLET_FIELD_ALIASES`, field label maps | Bullet parsing and labels are seating-oriented, including height/adjustability aliases rooted in seating vocabulary | `specific enum-list assumption` | Make aliases and labels family-scoped metadata |
| `src/search.js` | `computeTraitBoost()` | Reads `record.stage1?.seating_type` and scores against type-specific field priorities | `generic keyed lookup` | Generalize to `visual_type` with family-aware field priorities |
| `src/search.js` | `expandCompatibleSeatingTypes()` | Hard-coded compatibility aliases for named seating categories | `one-off branch on a named type` | Replace with config-driven compatibility groups per family |
| `src/search.js` | `resolveImageSearchContext()` | Resolves active routing context from `parsed.seating_type`, analysis payloads, and stored image data | `generic keyed lookup` | Rename to `visual_type` and accept compatibility alias during migration |
| `src/search.js` | `searchIndex()` stage1 compatibility filter | Filters records by seating-specific compatibility rules | `specific enum-list assumption` | Rebuild as family-aware compatibility filter; tables likely start with exact-type matching |
| `src/search.js` | result assembly and debug payloads | Hero/matching image payloads and debug blocks emit `seating_type` and `stage1.seating_type` | `generic keyed lookup` | Emit `visual_type` canonically, preserve alias temporarily |
| `src/search-category-filter.js` | `normalizeSearchCategoryFilters`, `collectActiveResultSeatingTypes`, `filterSearchResultsByCategory` | Browse/result filtering assumes a single seating routing dimension on images | `generic keyed lookup` | Rename to visual-type scope filtering backed by family-aware valid-type lists |
| `src/pipeline-diagnostics.js` | config bootstrap and `supported_categories` | Diagnostics loads seating config and publishes active categories from `ACTIVE_SEATING_TYPE_KEYS` | `specific enum-list assumption` | Point diagnostics at the same family-aware registry as runtime |
| `src/pipeline-diagnostics.js` | inconsistency rules for lounge ottomans and base/back combinations | Integrity rules branch on seating-only trait semantics and named seating patterns | `one-off branch on a named type` | Keep rules but register them by family/type so seating logic does not leak into tables |
| `src/pipeline-diagnostics.js` | aggregation keyed by `image.seating_type` and `diagnostics.seating_type` | Coverage summaries and health counts are grouped by seating type | `generic keyed lookup` | Rename to `visual_type` and make ordering/config family-aware |
| `server.js` | module bootstrap (`seatingTypesPath`, `seatingTypes`, `defaultSeatingType`) | Server globally assumes one seating schema bundle | `specific enum-list assumption` | Replace with family-aware bootstrap payload and shared schema loader |
| `server.js` | structured-bullet normalization (`normalizeStructuredBullets`) | Field resolution and bullet normalization take `seatingType` as the controlling context | `generic keyed lookup` | Rename to `visualType` and resolve fields from family-aware config |
| `server.js` | eval/search analytics (`catalog.seating_type:*`) | Persists `catalog.seating_type:*` tokens for metrics and debug profiles | `UI copy / labels only` | Preserve a legacy alias if historical comparability matters; otherwise introduce a neutral metric namespace |
| `server.js` | representative product summary and cap logging | Product-level summaries and cap logs read representative `seating_type` values | `generic keyed lookup` | Rename to `visual_type` and keep legacy log alias during migration |
| `server.js` | `/api/bootstrap` | Returns `seating_types` to the client as the only structured trait schema bundle | `specific enum-list assumption` | Return family-aware schema payload, optionally with temporary `seating_types` alias |
| `server.js` | `/api/search` | Reads request `seating_type`, validates against `ACTIVE_SEATING_TYPE_KEYS`, emits `seating_type_source` and `seating_category_options` | `specific enum-list assumption` | Highest-risk API seam; move to family/type-neutral request and clarification contract |
| `server.js` | `/api/refine-search` | Accepts `body.seating_type` and injects `{ stage1: { seating_type } }` into parsed context | `generic keyed lookup` | Rename canonical field to `visual_type`, retain alias for compatibility |
| `server.js` | `/api/analyze-image` | Accepts `seating_type_override`, checks Stage 1 seating confidence, and emits seating-specific clarification options | `specific enum-list assumption` | Convert to family-aware routing override and clarification payload |
| `server.js` | `/api/rewrite-query-traits` | Normalizes bullets relative to `body.seating_type` | `generic keyed lookup` | Rename input to `visual_type` and resolve fields family-aware |
| `server.js` | `/api/compose-query` | Reads `body.seating_type` and defaults to `"seating"` | `specific enum-list assumption` | Make family/type explicit and remove implicit seating default |

### UI and client-adjacent runtime

| File | Location | Current usage | Tag | Proposed treatment |
| --- | --- | --- | --- | --- |
| `public/app.js` | top-level state (`currentSeatingType`, `originalSeatingType`) | Core UI state is seating-named across search, refine, debug, browse, and image analysis | `generic keyed lookup` | Rename state to `currentVisualType` / `originalVisualType`; accept `seating_type` only at legacy boundaries |
| `public/app.js` | `SEATING_CATEGORY_DISPLAY_NAMES`, `CATEGORY_REQUIREMENT_OPTION_KEYS` | Explicit seating label map and option list drive browse labels and clarification prompts | `specific enum-list assumption` | Move labels/options into backend schema metadata by family |
| `public/app.js` | trait-field config bootstrap (`buildTraitFieldConfigIndex`, `state.bootstrap.seating_types`) | Client builds one seating trait registry and uses it everywhere | `generic keyed lookup` | Bootstrap a family-aware schema index and select active family/type on demand |
| `public/app.js` | structured bullet parsing and priority (`parseStructuredBulletEntry`, `defaultPriorityForBulletField`, `buildQueryBulletMap`, `normalizeSelectedBullets`) | Bullet parsing defaults to `state.currentSeatingType` and seating schema fields | `generic keyed lookup` | Rename to generic visual-type context and resolve fields from family-aware config |
| `public/app.js` | browse/result filtering helpers | Matching image and hero selection narrow to same `seating_type` | `generic keyed lookup` | Keep the pattern but rename to generic visual-type filtering |
| `public/app.js` | extraction summary title (`"By seating type"`) | UI copy frames diagnostics as seating-only | `UI copy / labels only` | Rename to family-aware or neutral wording |
| `public/app.js` | unmapped category mapping options | Mapping UI can only target seating display labels | `specific enum-list assumption` | Replace with family-aware routing targets, including table families and types |
| `public/app.js` | refine-search flow | `/api/refine-search` requests and response hydration use `seating_type` and `seating_type_source` | `generic keyed lookup` | Rename payloads to `visual_type` / `visual_type_source` with compatibility alias |
| `public/app.js` | debug lightbox and stored-image context | Debug UI reads `heroImage.seating_type`, emits `seating:` labels, and rehydrates `stage1.seating_type` | `generic keyed lookup` | Rename payload labels and client fields; keep alias during rollout |
| `public/app.js` | clarification bar and category-required prompts | Prompts ask the user to choose among seating-only options sourced from `SEATING_CATEGORY_DISPLAY_NAMES` / `seating_category_options` | `specific enum-list assumption` | Replace with family-aware clarification contract from backend schema |
| `public/app.js` | structured traits matrix / inspector entry ordering | Matrix entries are built from `bootstrap.seating_types` in seating order | `specific enum-list assumption` | Use one inspector per family with a family switcher; per-family type order should come from schema metadata |
| `public/app.js` | `composeQueryForBullets()` | `/api/compose-query` payload sends `seating_type`, defaulting through seating state | `specific enum-list assumption` | Make compose-query explicitly family/type-aware |
| `public/app.js` | `runSearch()` and image-analysis handoff | Search requests, query hydration, and image-analysis responses rely on `seating_type`, `seating_type_source`, and `seating_category_options` | `specific enum-list assumption` | Highest-risk UI/API seam; convert to neutral routing payloads and family-aware clarification logic |
| `public/app.js` | URL hydration and browse form submit | Reads and writes `seating_type` in URL/search state | `specific enum-list assumption` | Add canonical routing param and backward-compatible alias parsing |
| `public/category-scope.js` | normalization and phrase dictionaries | Scope selection and phrase stripping are explicitly seating-only | `specific enum-list assumption` | Replace with family-aware scope config and per-family phrase dictionaries |
| `public/category-scope.js` | bullet stripping and URL serialization | Treats `seating_type:` bullets specially and serializes `seating_type` query param | `specific enum-list assumption` | Introduce generic routing-scope bullet handling and canonical URL state |
| `public/curate.js` | `composeQueryForBullets()` | Curation UI posts `seating_type` to `/api/compose-query` and defaults to `"seating"` | `specific enum-list assumption` | Bring curation onto the same family-aware compose-query contract as main search |
| `public/curate.js` | `analyzeSelectedImage()` | Uses `analysis?.seating_type || analysis?.stage1?.seating_type` to compose a search query | `generic keyed lookup` | Rename to `visual_type` and preserve alias while API migrates |

### Scripts, tests, and maintenance tooling

| File | Location | Current usage | Tag | Proposed treatment |
| --- | --- | --- | --- | --- |
| `src/captioning-stage23-test.mjs` | mirrored extraction/test harness | Duplicates Stage 1/2/3 seating schemas, prompts, voting, and text-query extraction logic | `specific enum-list assumption` | Keep in lockstep with family-aware extraction refactor or retire the duplication |
| `scripts/migrate-pipeline-compliance.js` | migration report builders | Persists `seating_type` and branches specifically on `lounge_chair` | `one-off branch on a named type` | Keep seating-specific unless reused; if reused, convert to family/type-aware helpers |
| `scripts/recompute-cap-policy-savings.js` | cap-policy analysis | Hard-codes seating types while analyzing extraction cap tradeoffs | `specific enum-list assumption` | Split by family or feed from family-aware routing config |
| `scripts/analyze-category-cap-policy.js` | `getRecordSeatingType()`, `dominantSeatingType()` | Analytics roll up products by dominant `seating_type` | `generic keyed lookup` | Rename to `visual_type` and let analytics group by family/type |
| `scripts/analyze-image-marginal-value.js`, `scripts/build-mismatch-review.js`, `scripts/category-mismatch-scan.js`, `scripts/scene-text-triage.js`, `scripts/snapshot-pr1a.js` | report generation and review tooling | Consume or emit `seating_type` in analysis snapshots and review payloads | `generic keyed lookup` | Migrate scripts to read canonical `visual_type` with temporary alias support |
| `scripts/build-index.js`, `scripts/reextract-indexed-stage123.js`, `scripts/reextract-canonical-migration.js`, `scripts/reextract-stale-seating-type-records.js`, `scripts/reextract-lounge-chair-hero-only.js`, `scripts/reextract-blank-guest-chair-base-finish.js` | indexing/re-extraction orchestration | Re-extraction flows and fix-up tooling assume seating-keyed payloads | `generic keyed lookup` | Move scripts to canonical `visual_type`; retain compatibility readers for old snapshots |
| `scripts/migrate-bench-seat-finish.js` | bench-specific migration | One-off bench data repair relies on seating family semantics | `one-off branch on a named type` | Leave explicitly seating-scoped; do not generalize unless needed |
| `scripts/search-category-filter.test.js` | search-category filter tests | Test fixtures hard-code `seating_type` values and seating display labels | `specific enum-list assumption` | Refresh tests to family-aware scope and neutral naming |
| `scripts/category-scope.test.js` | category-scope tests | Exercises `seating_type` bullets and seating phrase stripping | `specific enum-list assumption` | Rewrite around generic routing scope plus per-family phrase dictionaries |
| `scripts/pipeline-diagnostics.test.js`, `scripts/test-consolidated-stage123.js`, `scripts/test-image-pipeline-stability.js`, `scripts/run-visual-summary-stability.js` | diagnostics and extraction verification | Test fixtures and assertions still assume seating-only routing outputs | `specific enum-list assumption` | Expand harnesses to family-aware expectations |
| `scripts/test-plan-view-shape.cjs`, `scripts/test-plan-view-single-seat.cjs`, `scripts/test-shell-material-two-products.js`, `scripts/compare-stage1-elimination.js`, `scripts/list-high-image-products.js` | targeted diagnostic fixtures | Several scripts filter fixtures by named seating types such as `lounge_chair` | `one-off branch on a named type` | Keep clearly seating-scoped or migrate to per-family fixture selectors |

### Refreshed inventory readout

- The highest-risk area is still `src/captioning.js`, especially the Stage 1 classifier, consolidated Stage 1/2/3 prompt, Stage 2/3 extraction handoff, query-time image analysis, and text-query category inference.
- The UI/API seam remains the second-biggest risk surface: `server.js` plus `public/app.js` still coordinate through explicitly seating-shaped payloads.
- The refresh did surface real extra maintenance surfaces outside the original inventory: `public/curate.js`, `scripts/analyze-category-cap-policy.js`, `scripts/category-scope.test.js`, and a broader cluster of re-extraction/reporting scripts.

## 4. Catalog Taxonomy Vs. Vision-Routing Taxonomy

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

Confirmed current as of `ed27817cedf8f74feae542d81f4f2d942808a29a` per gap analysis on `2026-05-02`.

## 5. UI Fork Inventory (Refreshed)

The UI fork surface is still concentrated overwhelmingly in `public/app.js`, with smaller but important seating-only seams in `public/category-scope.js` and `public/curate.js`.

### `public/app.js` concentration

The main application still contains nearly every user-visible seating assumption:

- category labels via `SEATING_CATEGORY_DISPLAY_NAMES`
- current routing state via `currentSeatingType`
- trait-field config bootstrap from `bootstrap.seating_types`
- structured-bullet parsing keyed to one seating type
- clarification bar and category-required prompts sourcing seating-only options
- browse/result filtering by `image.seating_type`
- structured traits matrix ordering built from seating order
- debug lightbox and stored-image hydration that read `stage1.seating_type`
- URL state and request payloads using `seating_type`, `seating_type_source`, and `seating_category_options`

This remains the dominant UI refactor surface.

### `public/category-scope.js`

This file is the second explicit UI fork point:

- query phrase dictionaries are seating-only
- `seating_type:` bullets are stripped specially
- results-page query state serializes `seating_type`

This is not large, but it is structurally important because it defines how routing scope becomes URL state and rewritten query text.

### `public/curate.js`

The curation tool is now a confirmed additional fork point:

- it composes queries by posting `seating_type` to `/api/compose-query`
- it defaults to `"seating"` when no analyzed type is present
- it pulls `analysis.seating_type` back out of image analysis responses

This means the family-aware migration cannot stop at the main search UI.

### Trait inspector decision

Recommendation: keep the family-switcher model as the strong default.

Current code still builds one seating-centric structured traits matrix from `bootstrap.seating_types`, with ordering, labels, and field priorities all implicitly bound to the active seating type. Extending that single matrix to mix Seating and Tables in one undifferentiated inspector would make the current assumptions harder to reason about, not easier. A family switcher lets the existing “one active schema context at a time” interaction survive while swapping in a different per-family type order, field order, labels, and clarification logic.

### Refreshed UI conclusion

- `public/app.js` is still the primary UI fork surface by a wide margin.
- `public/category-scope.js` remains the URL/query-state fork surface.
- `public/curate.js` is a newly surfaced but real seating-only client.
- The default implementation shape should be one inspector per family with a Seating/Tables switcher, not one blended mega-inspector.

## 6. Schema Extension Points For Tables

The current schema is close enough to support a family-aware architecture, but not enough to represent the locked tables taxonomy cleanly without extension.

### What the current schema already supports

- Per-type field lists already exist. `data/seating-types.json` can express different fields for different routing types, which means category-specific table traits are conceptually compatible with the existing “type owns fields” model.
- Enum-style structured fields already power labels, bullet parsing, prompt assembly, and UI rendering. That pattern can carry over to table traits that are genuinely categorical, such as `top_shape`, `base_type`, `edge_profile`, `top_material`, `base_material_finish`, `floor_interface`, or category-specific boolean-ish flags when represented as controlled values.
- The client and server already understand field metadata such as `priority`, `detectability`, and display labels derived from config. That is a good extension point for per-family tables metadata.

### What the current schema cannot represent cleanly yet

#### Continuous-ish numeric traits

Not cleanly supported today.

The current checked-in routing schema is enum-only: every field entry in `data/seating-types.json` is `type: "enum"`. That is workable for seating traits like `base_type` or `back_height`, but it does not provide a first-class representation for:

- `top_thickness` in inches
- `height` in inches when the real value matters
- `list_price` in dollars
- `lead_time` when it is not meant to collapse into a tiny bucket set

Those values could be shoved into freeform strings, but that would not be a real schema extension. It would weaken scoring, bullet normalization, and UI rendering because the rest of the stack currently expects controlled categorical values.

Required change: add field-type support beyond enums, at minimum a typed string/measurement path and likely a numeric field type with formatting metadata.

#### Dimension pairs

Not cleanly supported today.

A value like `72"x36"` is not a natural fit for the current enum schema unless it becomes a giant uncontrolled string bucket. That would technically store the value, but it would not give the rest of the system structured meaning.

Required change: add either:

- a typed dimension field that can hold paired measurements, or
- a structured string field with declared semantics and normalizer support for dimension pairs

The first option is cleaner if Tables will use dimension-driven filtering or normalization later.

#### Category-specific traits within Tables

Yes, structurally, but only after the registry becomes family-aware.

The existing per-type field-list pattern can already model “Conference has trait X, Training has trait Y” better than a single shared flat schema can. That means category-specific fields like a Training flip mechanism or an Occasional integrated power module are not the hardest part.

Required change: move from a seating-only type registry to a family-aware registry where each table type can own its own field list.

Optional change: add family-level shared-core definitions to reduce duplication across the five table categories.

### Required vs. optional schema work

Required before Tables can be represented faithfully:

- family-aware schema registry, not just `data/seating-types.json`
- canonical `visual_type` field with `seating_type` compatibility alias
- non-enum field support for numeric-ish and dimensional traits
- normalization/formatting support for those new field types across server and client

Optional but strongly beneficial:

- family-level shared-core field definitions to avoid repeating core table traits five times
- richer metadata for field formatting, units, and inspector presentation order
- compatibility/alias metadata stored in config rather than hard-coded in `src/search.js`

Bottom line: the current architecture can host per-type table fields, but it cannot represent the locked tables taxonomy faithfully without adding new schema field types and moving the registry above “seating only.”

## 7. Rollout Recommendation For Tables

Recommendation: keep the all-five-together launch recommendation, but for refreshed reasons rather than by inertia.

### Why the recommendation still holds

The refreshed inventories in Sections 3 and 5 still show that the expensive work is overwhelmingly family-level:

- `src/captioning.js` still needs a family-aware Stage 1 classifier, Stage 2/3 prompt system, query-time image-analysis flow, and text-query trait extraction
- `server.js` still needs family-neutral request/response contracts across `/api/bootstrap`, `/api/search`, `/api/analyze-image`, and `/api/compose-query`
- `public/app.js` still needs a routing-state, clarification, inspector, and URL-state conversion
- `public/category-scope.js` and `public/curate.js` still need family-aware scope/compose-query handling
- `data/seating-types.json` must become a richer family-aware schema registry before Tables can represent numeric and dimensional traits at all

Those changes do not meaningfully shrink if the first launch includes only one table category.

### What changed in the refreshed audit

The refresh did find more maintenance surfaces than the original audit:

- `public/curate.js`
- `scripts/analyze-category-cap-policy.js`
- a broader cluster of tests and re-extraction scripts

But those are still support surfaces around the same family-level abstraction break. They do not create a new credible “ship one category first and save most of the work” path.

### Why staging still looks weak

A one-category launch would still require:

- the family-aware routing rename/alias layer
- family-aware extraction prompts
- family-aware API contracts
- family-aware UI state and clarification flows
- new schema field-type support for numeric and dimensional table traits

Those are the dominant costs. Restricting the launch to a single table category does not avoid them.

### Explicit recommendation

Launch Tables with all five categories together after the family-aware refactor and schema extension work are complete.

Do not stage the public launch around a single category such as Occasional only. The refreshed inventory did not uncover a new implementation seam that becomes dramatically cheaper one category at a time. The hard part is still making the system truly family-aware and able to represent table-native trait shapes. Once that work is paid, shipping all five categories together is still the better validation of the abstraction.

## 8. Forward-Look Note: Textiles/Leather And Faucets

Most findings in Sections 1 through 5 are likely to apply to Textiles/Leather and Faucets as well, because those sections are mostly about architectural shape rather than table-specific semantics. In particular, the `visual_type` naming decision, the `seating_type` compatibility-alias migration pattern, the catalog-taxonomy versus vision-routing split, the API payload refactor in `server.js`, the URL/query-state refactor in `public/category-scope.js`, and the seating-shaped UI state in `public/app.js` are all cross-family concerns. Any new top-level family will inherit those same breakpoints until the routing layer becomes neutral.

What is more table-specific is Section 6. The need for numeric-ish traits, paired dimensions, and table-category-specific field sets comes from the locked Tables taxonomy, not from a generic future-family argument. Textiles/Leather and Faucets may need different schema extensions entirely. Textiles may stress pattern, material, grade, and color handling more than routing-compatible geometry fields. Faucets may introduce hardware/configuration traits, mount semantics, and perhaps even more model-driven dimensional fields. So the family-aware routing work should be treated as reusable v2 infrastructure, while the schema field-type additions in Section 6 should be treated as table-driven requirements that may or may not generalize intact to those later families.

## 9. Known-Deferred Bugs That Become Load-Bearing

The deferred issue documented in [docs/followups/stage0-integrated-tables-scene-routing.md](/Users/jacobslevin/Code/image-search/docs/followups/stage0-integrated-tables-scene-routing.md) becomes load-bearing once Tables is a real `visual_type`. Stage 0 currently counts tables as additional furniture and can therefore demote otherwise valid isolated seating-with-integrated-table images to `scene`. That follow-up is not part of this audit’s implementation recommendation set, but it should be treated as a concrete v2 planning dependency because the current Stage 0 bias becomes more consequential as soon as tables are part of the first-class routing taxonomy.
