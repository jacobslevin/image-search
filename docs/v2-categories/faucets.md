# Faucets Trait Taxonomy

**Status:** locked
**Last updated:** May 2026
**Archetype:** A (discrete object — see `docs/v2-architecture-plan.md`)

## Scope

Two sub-categories for v2:

- Kitchen
- Bathroom-lavatory

Tub-and-shower, bidet, and bar/prep are deferred from v2 scope. May be added in follow-on releases as data and usage patterns warrant.

## Architectural role

Faucets is the second category through the family-aware routing foundation (after tables). Its job is to validate that the foundation generalizes — that "category-aware" actually means "category-aware" and not "tables-aware seating."

If foundation bugs surface during faucets implementation, they get fixed in the foundation, not worked around in faucets.

## Cross-cutting traits (apply to both sub-categories)

| Field name | Values | Priority |
|---|---|---|
| mounting_type | deck, wall | Ranking |
| handle_count | 0, 1, 2, 3 | Ranking |
| handle_style | lever, cross, knob, blade, wheel, none_visible | Ranking |
| finish | (uses shared finish palette) | Ranking |
| design_register | Minimal, Traditional, unknown | Ranking |
| body_geometry | round, rectangular | Ranking |
| spout_cross_section | round, rectangular | Ranking |

## Kitchen-specific traits

| Field name | Values | Priority |
|---|---|---|
| spout_style | gooseneck, straight, angular, articulating, bridge, pot-filler-folding | Ranking |
| spout_articulation | pull-spray, non-pull | Ranking |
| side_spray | (boolean) | Descriptive |

## Bathroom-lavatory-specific traits

| Field name | Values | Priority |
|---|---|---|
| spout_style | gooseneck, straight, angular, waterfall | Ranking |
| configuration | single-hole, centerset, widespread | Ranking |

## Schema reuse declarations

- `design_register` — shared with seating and tables. Faucets uses subset `{Minimal, Traditional, unknown}` of the canonical enum. Earlier proposed addition of `transitional` to the shared enumeration is rolled back.
- `finish` — references the shared finish palette in the registry.
- All other faucets traits are faucets-specific.

## Foundation infrastructure asks

### Shared finish palette

Seven canonical values shared with tables and seating:

- `polished_chrome_nickel`
- `brushed_nickel_stainless`
- `matte_black`
- `warm_gold_brass`
- `bronze_dark`
- `white`
- `colored`

Two-tone finishes are modeled as composite enum values (e.g., `chrome_polished_with_brass`) added to the palette as needed when real product data warrants them. Multi-value field support is explicitly NOT being added; single-scalar-per-field runtime assumption is preserved.

## Out of scope (explicit exclusions)

These were considered and excluded — recording them so they aren't relitigated downstream.

- **number_of_holes:** derivable from `mounting_type + configuration + accessories`. Varies dramatically by manufacturer/market while the underlying visual traits are stable. Cut per the cross-category design principle: prefer visually-meaningful traits over installation-spec traits.
- **activation_mode (touch / touchless / voice):** not visually extractable except for fully touchless (captured by `handle_count=0` + `handle_style=none_visible`). Documented as known spec-sheet-only field.
- **transitional design_register:** manufacturer filter vocabulary doesn't translate to confident visual extraction. Cut per the cross-category design principle: structural decomposition (`design_register × body_geometry`) captures the Modern-vs-Contemporary distinction better than expanding the register enum.
- **spout_height:** not confidently extractable as binary without consistent framing.
- **escutcheon_presence, integrated_features:** descriptive + unreliable extraction. Cut per the cross-category design principle: confidence bar means dropping, not hedging.
- **tub_filler_type:** redundant with `mounting_type`.
- **Manufacturer-name normalization preprocessing:** vision model never sees manufacturer names. Cleanup of manufacturer-specific terminology is Designer Pages' upstream responsibility, not v2 foundation work.

## Deferred — revisit when real catalog data is available

- `spout_style: angular` may split into sub-types (single-bend, two-bend, three-bend/bracket) if internal variation matters in real product mix
- `spout_cross_section` may gain a third value (e.g., `softsquare`) if binary under-resolves real variation
- `finish: colored` may break into named colors (red, green, blue, etc.) when volume justifies per-color buckets
- Vision extraction reliability validation on close-pair distinctions that survived the bar (gooseneck vs. straight at borderline curvatures; round vs. rectangular for hybrid bodies)
- Sub-category routing accuracy (kitchen vs. bathroom-lavatory)

## Architectural shape

Standard Archetype A: discrete-object category with finite categorical traits. All in-scope traits are visually-bucketed enums. No new field types required; the existing enum-only schema is sufficient.

Wires up through the family-aware routing foundation as the second category (after tables). Validates generalization of the foundation infrastructure.
