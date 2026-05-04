# Tables Extraction Verification

Date: 2026-05-03

Verification status: tables extraction works end-to-end, conditional traits are respected per spec, and the pipeline is ready for 9b (search scoring on tables records).

## Scope

This verification reran `generateCaption(...)` end-to-end on the four locked table fixtures after 9a-4 landed:

- `Thumbfaceoff8803.png` -> `visual_type="cafe_dining"`
  Local fixture: [Thumbfaceoff8803.png](/Users/jacobslevin/Documents/Documents%20-%20Jacob%27s%20Mac%20Studio/Jake%202.0/Codex/PixelSeek/Thumbfaceoff8803.png)
  Source URL: <https://content.designerpages.com/assets/82063931/Thumbfaceoff8803.png>
- `PrismaMultipurposeIndex011_large.jpg` -> `visual_type="cafe_dining"`
  Local fixture: [PrismaMultipurposeIndex011_large.jpg](/Users/jacobslevin/Documents/Documents%20-%20Jacob%27s%20Mac%20Studio/Jake%202.0/Codex/PixelSeek/PrismaMultipurposeIndex011_large.jpg)
  Source URL: <https://content.designerpages.com/assets/81882870/PrismaMultipurposeIndex011_large.jpg>
- `SerenadeGatheringTables400x400px_large.jpg` -> `visual_type="training"`
  Local fixture: [SerenadeGatheringTables400x400px_large.jpg](/Users/jacobslevin/Documents/Documents%20-%20Jacob%27s%20Mac%20Studio/Jake%202.0/Codex/PixelSeek/SerenadeGatheringTables400x400px_large.jpg)
  Source URL: <https://content.designerpages.com/assets/82730196/SerenadeGatheringTables400x400px_large.jpg>
- `FOApplauseFlipNestDOWNweb0_large.jpg` -> `visual_type="training"`
  Local fixture: [FOApplauseFlipNestDOWNweb0_large.jpg](/Users/jacobslevin/Documents/Documents%20-%20Jacob%27s%20Mac%20Studio/Jake%202.0/Codex/PixelSeek/FOApplauseFlipNestDOWNweb0_large.jpg)
  Source URL: <https://content.designerpages.com/assets/81784115/FOApplauseFlipNestDOWNweb0_large.jpg>

Each run used caller-provided routing plus `precomputedImageDimensions` to bypass the short-side gate for the downsampled fixtures.

## Run Summary

- Total wall-clock time across all four fixtures: ~20.7s
- All four extractions completed successfully
- Stage 1 was deterministic and identical across runs
- Conditional trait scope was deterministic and identical across runs
- Stage 2 and Stage 3 values were mostly stable, with one notable trait variation on the Faceoff cafe table

## Fixture Outputs

### 1. Thumbfaceoff8803.png (`cafe_dining`)

Time taken: ~6.3s

Stage 1:

```json
{
  "visual_type": "cafe_dining",
  "family": "tables",
  "type_routing_source": "caller_provided",
  "seating_type": "cafe_dining"
}
```

Stage 2 visual_summary:

> Cafe table with a round glass top and a sculptural, interlacing wood base forming an X-shaped footprint. The central support is composed of multiple curved wood elements that intersect and flare outward, creating a dynamic, airy structure beneath the clear, thin-edged glass surface. The interplay of transparent top and intricate base gives the table a light yet visually striking presence.

Stage 3 traits:

```json
{
  "design_register": "Sculptural",
  "base_type": "X-base",
  "top_shape": "Round",
  "top_material": "Glass",
  "base_visual_weight": "Light/airy",
  "base_finish": "colored",
  "mobility": "Non-mobile",
  "top_thickness": "Thin",
  "edge_profile": "Square",
  "height_register": "Sitting"
}
```

Conditional trait scope:

- Present: `height_register`
- Absent: `power_data_integration`

Run-to-run notes vs 9a-4:

- Stable: `design_register`, `top_shape`, `top_material`, `base_visual_weight`, `base_finish`, `mobility`, `top_thickness`, `edge_profile`, `height_register`
- Varied: `base_type`
  9a-4 returned `Pedestal`
  9a-5 returned `X-base`
- Interpretation: this is a legitimate ambiguity in how the sculptural central support is bucketed, not a scope/control-flow issue

### 2. PrismaMultipurposeIndex011_large.jpg (`cafe_dining`)

Time taken: ~4.3s

Stage 1:

```json
{
  "visual_type": "cafe_dining",
  "family": "tables",
  "type_routing_source": "caller_provided",
  "seating_type": "cafe_dining"
}
```

Stage 2 visual_summary:

> A round cafe table with a thin wood-look top and four slender, straight legs positioned at the perimeter. The support structure is minimal, with legs finished in matte black for a light, airy presence. The table is distinguished by its thin top and understated, contemporary silhouette.

Stage 3 traits:

```json
{
  "design_register": "Minimal",
  "base_type": "4-leg",
  "top_shape": "Round",
  "top_material": "Wood-look",
  "base_visual_weight": "Light/airy",
  "base_finish": "matte_black",
  "mobility": "Non-mobile",
  "top_thickness": "Thin",
  "edge_profile": "Square",
  "height_register": "Sitting"
}
```

Conditional trait scope:

- Present: `height_register`
- Absent: `power_data_integration`

Run-to-run notes vs 9a-4:

- All Stage 3 trait values were stable
- Stage 2 wording varied slightly but was substantively the same

### 3. SerenadeGatheringTables400x400px_large.jpg (`training`)

Time taken: ~5.7s

Stage 1:

```json
{
  "visual_type": "training",
  "family": "tables",
  "type_routing_source": "caller_provided",
  "seating_type": "training"
}
```

Stage 2 visual_summary:

> Training table with a rectangular top and full panel-slab sides forming a solid, grounded base. The wood-look surface and square edge profile emphasize a straightforward, utilitarian character. The proportions are balanced and the construction is simple, with no visible ornamentation or hardware.

Stage 3 traits:

```json
{
  "design_register": "Utilitarian",
  "base_type": "Panel-slab",
  "top_shape": "Rectangle",
  "top_material": "Wood-look",
  "base_visual_weight": "Heavy/grounded",
  "base_finish": "colored",
  "mobility": "Non-mobile",
  "top_thickness": "Standard",
  "edge_profile": "Square",
  "height_register": "Sitting",
  "power_data_integration": "Not visible"
}
```

Conditional trait scope:

- Present: `height_register`
- Present: `power_data_integration`

Run-to-run notes vs 9a-4:

- All Stage 3 trait values were stable
- Stage 2 wording varied only slightly

### 4. FOApplauseFlipNestDOWNweb0_large.jpg (`training`)

Time taken: ~4.3s

Stage 1:

```json
{
  "visual_type": "training",
  "family": "tables",
  "type_routing_source": "caller_provided",
  "seating_type": "training"
}
```

Stage 2 visual_summary:

> Training table with a long rectangular top and a thin, square-edged profile, supported by two T-leg metal bases on casters. The base structure is light and functional, allowing for mobility and nesting, while the tabletop has a wood-look finish and a minimal, utilitarian character. The flip-top mechanism and mobile base distinguish this table for flexible training or conference environments.

Stage 3 traits:

```json
{
  "design_register": "Utilitarian",
  "base_type": "T-leg",
  "top_shape": "Rectangle",
  "top_material": "Wood-look",
  "base_visual_weight": "Light/airy",
  "base_finish": "brushed_nickel_stainless",
  "mobility": "Casters",
  "top_thickness": "Thin",
  "edge_profile": "Square",
  "height_register": "Sitting",
  "power_data_integration": "Not visible"
}
```

Conditional trait scope:

- Present: `height_register`
- Present: `power_data_integration`

Run-to-run notes vs 9a-4:

- All Stage 3 trait values were stable
- Stage 2 wording varied only slightly

## Conditional Trait Scope Check

Deterministic scope behavior matched the locked tables spec on every run:

- `cafe_dining`
  - includes `height_register`
  - excludes `power_data_integration`
- `training`
  - includes `height_register`
  - includes `power_data_integration`

This scope behavior matched both 9a-4 and 9a-5 exactly.

## Stability Notes

- Stage 1 was fully stable and identical across runs because routing was caller-provided
- Stage 2 free-text summaries varied modestly in wording, which is expected
- Stage 3 was stable on 3/4 fixtures
- The only observed Stage 3 trait drift between 9a-4 and 9a-5 was:
  - `Thumbfaceoff8803.png`
    - `base_type`: `Pedestal` -> `X-base`

No conditional-scope drift was observed.

## Outcome

Tables extraction now operates end-to-end through:

1. Stage 1 caller-provided routing
2. Stage 2 registry-derived visual summary guidance
3. Stage 3 registry-backed structured trait extraction

Status: ready for 9b (search scoring on tables records).
