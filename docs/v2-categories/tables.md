# Tables Trait Taxonomy

**Status:** locked
**Last updated:** May 2026
**Archetype:** A (discrete object — see `docs/v2-architecture-plan.md`)

## Scope

Five sub-categories for v2:

- Conference
- Occasional
- Cafe/Dining
- Training
- Huddle/Collaborative

The five-way sub-categorization was derived in the April 29, 2026 thread and is locked.

## Known judgment-call risk

Huddle/Collaborative does not have a unique visual signature distinct from Cafe/Dining (small) or Conference (small). Sub-category routing will sometimes be a coin flip. This is the same shape of issue as the privacy-walled lounge sofa edge case from MVP. Accept the ambiguity; do not try to engineer it away through trait expansion.

## Cross-cutting traits (apply to all 5 sub-categories)

| Field name | Values | Priority | Role | Detectability | Notes |
|---|---|---|---|---|---|
| design_register | Industrial, Minimal, Organic, Sculptural, Traditional, Utilitarian, unknown | High | Ranking | Medium-high | Reused from seating verbatim. Adjacent buckets (Minimal vs. Organic) will have human and model disagreement; accepted. |
| base_type | Pedestal, 4-leg, Trestle, T-leg, X-base, Tripod, Panel-slab, unknown | High | Ranking | High | Spine of the taxonomy. Seven values. A-frame was considered and dropped (visually indistinguishable from trestle in practice). |
| top_shape | Round, Square, Rectangle, Oval, Soft-organic, unknown | High | Ranking | High | Soft-organic captures racetrack/pill/rounded-rectangle silhouettes that read distinct from true rectangles or ovals. |
| top_material | Wood-look, Stone-look, Solid-color, Glass, Metal, unknown | High | Ranking | Medium | Visual class only. Does not attempt to distinguish veneer from laminate from solid wood — those are not visually separable. |
| base_visual_weight | Heavy/grounded, Light/airy, unknown | Medium | Ranking | High | Captures the "feel" distinction between solid/massive bases (full panels, drum pedestals) and open/linear bases (thin legs, wire frames). Independent of base_type. |
| base_finish | (uses shared finish palette) | Medium | Ranking | Medium | Reused from seating verbatim. References the shared finish_palette in the registry. |
| mobility | Casters, Non-mobile, unknown | Low | Descriptive | High when visible | Reused from seating. Glides vs. levelers below detection resolution; collapsed into Non-mobile. |
| top_thickness | Thin, Standard, Thick-slab, unknown | Low | Descriptive | Medium for extremes only | Detection focuses on flagging extremes; nullable when not determinable. |
| edge_profile | Square, Eased, Beveled, unknown | Low | Descriptive | Low-medium | Most likely trait to be silently wrong. Should be willing to leave null. |

## Conditional traits (apply to a subset of sub-categories)

### height_register

Applies to: Occasional, Cafe/Dining, Training, Huddle/Collaborative
Does not apply to: Conference (sitting-only)

Values:
- Occasional: Coffee, End/Side, unknown
- Cafe/Dining, Training, Huddle/Collaborative: Sitting, Standing, unknown

Priority: Medium
Role: Ranking
Detectability: High

Field name resolved as `height_register` (not `height_class`) to match the naming convention of `design_register`.

### power_data_integration

Applies to: Conference, Training, Huddle/Collaborative
Does not apply to: Cafe/Dining, Occasional

Values: Present, Not visible, unknown
Priority: Medium
Role: Ranking
Detectability: High when present

Rationale for sub-category scope: 85% applicability rule. Power/data integration is consistently present in conference, training, and collaborative meeting contexts (tech-equipped meeting rooms); consistently absent in cafe/dining and occasional tables.

## Out of scope (explicit exclusions)

These were considered and excluded — recording them so they aren't relitigated downstream.

- **Top dimensions (exact):** spec sheet only. Vision can estimate buckets, not measurements.
- **Collection / series, designer, certifications, lead time, list price:** metadata only, not visually extractable. Out per the product thesis (visual signal only, no spec-sheet ingestion).
- **Manufacturer-specific material distinctions** (veneer vs. laminate vs. solid wood vs. melamine vs. lacquer-on-MDF): not visually separable. Collapsed into top_material visual classes.
- **Footprint / size bucket** (small/medium/large): vision model cannot reliably distinguish these from a hero image without scale reference. Size signal comes implicitly from sub-category routing.
- **Mid-Century as a design_register value:** folds cleanly into Organic or Minimal depending on the specific cues. Not a separate bucket.
- **A-frame as a base_type value:** considered and dropped. Visually indistinguishable from trestle in practice; trestle now covers all two-end-support configurations.
- **Cantilever/sled bases:** considered. Less than 1-2% of corpus. Handled by `unknown` for v1; revisit if production data shows higher rates.
- **Drum/cylinder pedestals as a separate bucket:** considered. Handled by `pedestal` base_type plus `base_visual_weight: Heavy/grounded` rather than as a separate bucket.

## Schema reuse declarations

For implementation, these field names and value sets match the existing seating schema and should be modeled as the same fields, not as parallel fields with different names:

- `design_register` — full value set match with seating
- `base_finish` — references the shared finish palette
- `mobility` — full value set match with seating
- `base_type` — field name shared with seating; tables expand the value set with table-specific values

## Open work

None. All previously-open items resolved:

- ✅ base_type buckets pressure-tested against corpus, reduced to seven (A-frame dropped)
- ✅ power_data_integration scope per sub-category resolved
- ✅ height_register naming locked

## Architectural shape

Standard Archetype A: discrete-object category with finite categorical traits. All in-scope traits are visually-bucketed enums. No new field types required; the existing enum-only schema is sufficient. Wires up through the family-aware routing foundation alongside seating and faucets.
