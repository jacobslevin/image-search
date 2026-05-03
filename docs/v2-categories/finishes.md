# Finishes Architecture Spec

**Status:** architecture spec locked; specific implementation scope determined in Phase 3
**Last updated:** May 2026
**Archetype:** B (visual surface — see `docs/v2-architecture-plan.md`)

## Scope

Single category, no sub-categories.

Finishes covers carpet tile, upholstery textiles, leather, wallcovering, and similar visual surface materials. Product-type filtering within finishes (carpet vs. upholstery vs. leather vs. wallcovering) is metadata-driven, not visually extracted from the swatch image.

This decision is locked. A vision model cannot reliably distinguish carpet-vs-upholstery-vs-wallcovering from a swatch image alone without contextual cues. Treating these as separate visual categories would create a routing problem with high base-rate failure (~30-40% of submitted swatches genuinely ambiguous). Designers can filter by product type using Designer Pages metadata; the system does not try to determine product type from the image.

## Architectural decisions

### Image embedding, not caption-then-embed

The production pipeline's `visual_summary_embedding` (text embedding of a vision-generated caption) is not viable for finishes. An experiment on 94 carpet swatches across 8 Shaw Contract products tested two architectures:

- **Classical CV features** (Gabor + LBP + edges + orientation, no learned features): r@1 = 0.904, r@5 = 0.748
- **Caption-then-embed via gpt-4.1 + text-embedding-3-small** (production-shape architecture, retargeted with finishes prompt): r@1 = 0.415, r@5 = 0.405

The classical baseline outperformed the production-shape pipeline by roughly 2x on every metric. The captioning step quantizes continuous visual signal into a discrete vocabulary that's too coarse for finishes discrimination.

Finishes uses direct image embedding (CLIP-style or similar). The classical baseline is a floor, not a ceiling — modern image embeddings are expected to match or beat it.

### Two use cases, one tool

Finishes search supports both identification ("find this exact finish") and exploration ("find finishes that work for my project, using this as a starting point"). The same upload, same filters, and same result set serve both. The system surfaces clear standouts when they exist (helping identification users) and provides filter-driven navigation of the visual neighborhood (serving exploration users). Most sessions involve both flows.

### Confidence-aware ranking

When the top retrieval result has a similarity score dramatically higher than the rest, the system flags it as a likely exact match. When the top results cluster together with no clear standout, the system presents a coherent neighborhood without claiming a single answer. Implemented as a thin layer on top of standard retrieval, using the score distribution itself as the confidence signal. No additional model required.

### Independent (style, colorway) records

Each (style, colorway) is an independent searchable record. Same style = same product. Different style = different product, even when colorway codes match across styles (this is a real condition in the Shaw catalog and presumably others). No parent-product abstraction, no "sister product" relationships in the schema. Two products can be related by metadata (collection, manufacturer-curated coordination) but are independent entities for search purposes.

### Result presentation collapses colorways at the product card level

When a user search surfaces multiple colorways of the same product, they're presented as a single product card with an "expand to see all colorways" affordance, not as multiple inline results. The matched colorway (or the colorway closest to the user's color preference) is shown as the card's primary representation.

## Trait schema (visually-extractable only)

The trait set for finishes is restricted to fields that can be extracted from a swatch image with reasonable reliability both at index time (slow, batch) and at query time (fast, real-time during user upload). This is a tighter inclusion criterion than "would designers find this useful" because the UX assumes any filter can be auto-populated from an uploaded image.

### Fields in scope

- **pattern_type** — controlled vocabulary, ~15-20 values; specific list deferred to Phase 3 implementation
- **pattern_scale** — fine / medium / coarse / no-repeat
- **directionality** — vertical / horizontal / diagonal / bidirectional / radial / omnidirectional / none
- **contrast** — low / medium / high
- **surface_character** — loop pile / cut pile / woven / knit / leather grain / smooth / mixed
- **color_composition** — see dedicated section below

### Fields explicitly out of scope

- Manufacturer, product line, collection (metadata, not visually extractable)
- Fiber content, backing, durability rating, fire rating, environmental certifications (spec sheet only)
- Cost tier, regional availability (spec sheet only)
- Application type (carpet / upholstery / wallcovering — handled by metadata filtering, not visual extraction)
- Emotive/mood vocabulary (too high-drift for v2; revisit later)

## Color schema (the most distinctive structural piece)

Color in finishes is not a single primary-color field. It's a structured composition: a list of colors present in the swatch, each with a perceptually-meaningful color value and a percentage representing its prevalence in the image.

### Storage shape per swatch

A list of `(color, percentage)` pairs, typically 2-5 entries. Each color references an entry in a shared color palette. Each percentage is the swatch area occupied by that color cluster.

### Color palette

- Curated, paint-chip-style palette with ~60-100 chips total
- Organized as columns (hue families: warm gray, cool gray, taupe, beige, charcoal, blue, blue-gray, green, red, etc.) × rows (lightness steps from very light to very dark)
- More columns dedicated to neutral families than to saturated colors (reflects finishes catalog distribution)
- Underlying numeric color values (Lab or similar) drive matching; chip IDs are the user-facing labels
- Shared base across categories with category-specific extensions where needed (faucets uses the metallic finish palette; finishes uses the color composition palette)

The specific chip selection is deferred to Phase 3.

### Query interaction

- Users select chips from the palette and specify percentage ranges per chip ("primary chip at 40-70%, secondary chip at 10-25%")
- Results update in real-time as ranges adjust
- Multiple colors can be specified; the system finds swatches whose color composition matches all specified constraints
- Users can also pick a chip directly without an upload (no-image-needed search flow)

## Image-as-query behavior

Uploading an image populates all filters automatically. The image is treated as a high-bandwidth way to express search intent. On upload, the system:

1. Computes the image embedding for similarity ranking
2. Extracts color composition (color cluster + percentage per cluster, mapped to chip palette)
3. Extracts other visual traits (pattern type, scale, directionality, contrast, surface character)
4. Pre-fills every filter in the UI with what was extracted
5. Returns ranked results with filters editable

Sub-second response time is a future optimization target, not a v1 requirement. V1 supports query-time extraction with progressive UI surfacing — return image embedding similarity results immediately, populate filters as extraction completes.

Users can adjust any pre-filled filter to refine results, and results update live. The image establishes the starting point; the filter adjustments let the user navigate from there to the specific finish they want, which may differ meaningfully from the uploaded image.

## What this requires from the platform

Finishes cannot be supported by the existing platform architecture. New platform capabilities required:

1. **A non-furniture indexing pipeline.** The current Stage 1/2/3 architecture is furniture-shaped at the captioning prompt level and can't be retrofitted with a finishes prompt without giving up the architecture's intended behavior. Finishes needs a parallel indexing path that uses image embedding directly, not vision-to-caption-to-text-embedding.

2. **Query-time visual trait extraction with progressive UI surfacing.** The current system extracts traits at index time only. Finishes UX requires the same extraction to run on user-uploaded images. Sub-second is a future optimization target; v1 surfaces results progressively.

3. **Structured color storage with percentage proportions.** Current color handling is a single field. Finishes requires a list of `(chip, percentage)` pairs per record, plus the chip palette as shared infrastructure.

4. **Range-based filter queries with live updates.** Current filtering is set-based. Finishes requires range queries on numeric percentages, fast enough to support live UI updates as the user drags sliders.

5. **Confidence-aware ranking presentation.** Current results are a flat ranked list. Finishes UX distinguishes "we think this is an exact match" from "here's the visual neighborhood" based on the score distribution.

6. **Colorway-collapse in result presentation.** Current results show every record as a separate card. Finishes UX collapses colorways under a single product card with expansion.

Items 1, 3, and 4 are likely required for other future visual-surface categories as well (wallcovering as its own searchable category, materials, etc.). Items 2, 5, and 6 are more finishes-specific but would benefit other visual-heavy categories if added.

## What's deferred to Phase 3 (architecture exploration)

These are unknowns the architecture spec acknowledges but does not resolve. Phase 3's job is to convert these into design decisions before Phase 4 implementation begins.

- **Embedding model selection.** Which model, based on retrieval quality and inference cost. Modern image embeddings (CLIP variants, SigLIP) likely match or beat the classical CV baseline (r@1 = 0.904) but inference cost varies.
- **Color composition palette curation.** Which chips, how granular, sourced from existing standards or self-curated.
- **Domain robustness.** Untested on phone photos. Real users will not always upload clean catalog swatches. The system needs to degrade gracefully on lower-quality inputs.
- **Query-time extraction performance.** Target is "results page populates without perceptible delay" but the specific latency budget depends on UX testing.
- **Final pattern_type vocabulary list.** ~15-20 values; specifics deferred.
- **Auto-extract accuracy thresholds and "indeterminate" handling.**

Phase 3 produces a scoped implementation plan: which finishes capabilities ship in v2's first release vs. which are explicitly deferred to follow-on releases. Phase 3 does NOT decide whether finishes ships — finishes is committed scope for v2. Phase 3 decides which version.

## What was tested

A retrieval experiment was run on 94 carpet tile swatches across 8 Shaw Contract products. Two architectures were tested:

- **Classical CV features** (Gabor + LBP + edges + orientation, no learned features): r@1 = 0.904, r@5 = 0.748
- **Caption-then-embed via gpt-4.1 + text-embedding-3-small** (production-shape architecture, retargeted with finishes prompt): r@1 = 0.415, r@5 = 0.405

The classical baseline outperformed the caption-then-embed pipeline by roughly 2x on every metric. This is the empirical basis for ruling out caption-then-embed for finishes.

A specific discrimination test was run on two products (5T352 and 5T354) that share all 12 colorway codes but are independent products. Both architectures struggled to discriminate them, but per the product-strategy decision in this thread, this is no longer treated as a failure — visually-adjacent products surfacing together in results is a feature for the exploration use case, and the colorway-collapse UI handles it cleanly.

## Architectural shape

Archetype B: visual-surface category with parallel indexing pipeline. Runs alongside Archetype A's pipeline, sharing the family-aware routing foundation but using separate extraction and scoring logic.

"Alongside" specifically means: shared platform shell (server, app, registry, deployment plumbing) with separate category pipeline modules. Archetype B introduces new finishes-specific ingestion and query modules that run parallel to `src/captioning.js` and `src/search.js`, not extensions to those files.
