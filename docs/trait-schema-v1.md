# Trait Schema v1

Initial normalized trait schema derived from the Herman Miller Ancillary price book (`PBHCL (4).pdf`, effective February 3, 2025). The goal is to support scalable visual search without drifting into category-specific query rules.

This schema is intentionally split into:

- a shared core used across categories
- category extensions used only when relevant

The search system should treat unspecified traits as neutral. Query traits should become desired constraints. Image traits should become observed facts. Scoring should reward agreement and penalize contradiction.

## Design principles

- Use generic fields wherever possible.
- Prefer normalized enums over freeform prose.
- Keep text arrays only for residual detail that is hard to normalize.
- Separate structurally visible traits from commercial option metadata.
- Model category-specific traits as extensions, not as one-off logic.

## Shared Core

These fields should be available to every indexed image, even if most are blank for a given product.

```json
{
  "product_type": "",
  "application_type": "",
  "visual_category": "",
  "silhouette": "",

  "base_type": "",
  "base_material": "",
  "base_finish": "",
  "leg_material": "",
  "leg_style": "",
  "glide_type": "",
  "caster_present": null,
  "ganging_capable": null,
  "stacking_capable": null,

  "frame_material": "",
  "frame_finish": "",
  "shell_material": "",
  "shell_finish": "",

  "seat_material": "",
  "back_material": "",
  "upholstery_presence": "",
  "upholstery_coverage": "",

  "arms_present": null,
  "arm_type": "",
  "arm_material": "",
  "arm_pad_present": null,
  "arm_pad_material": "",

  "headrest_present": null,
  "swivel_present": null,
  "tilt_present": null,
  "height_adjustable": null,

  "wood_species": "",
  "wood_finish_color": "",
  "finish_sheen": "",

  "dominant_materials": [],
  "secondary_materials": [],
  "minor_materials": [],
  "material_details": [],
  "notable_features": []
}
```

## Shared Value Guidance

Suggested normalized values for common shared fields.

### `product_type`

- `chair`
- `armchair`
- `side chair`
- `stacking chair`
- `lounge chair`
- `work chair`
- `stool`
- `bench`
- `sofa`
- `sectional`
- `desk`
- `table`
- `occasional table`
- `storage`
- `accessory`
- `lighting`
- `outdoor seating`
- `outdoor table`

### `application_type`

- `guest seating`
- `lounge seating`
- `dining seating`
- `task seating`
- `collaborative seating`
- `occasional`
- `storage`
- `workspace table`
- `meeting table`
- `outdoor`

### `base_type`

- `4-leg base`
- `sled base`
- `cantilever base`
- `wire base`
- `dowel base`
- `4-star base`
- `5-star base`
- `pedestal base`
- `disc base`
- `plinth base`
- `beam base`
- `wall-mounted`
- `freestanding`

### `base_material`, `leg_material`, `frame_material`, `arm_material`

- `metal`
- `aluminum`
- `steel`
- `wood`
- `molded wood`
- `plastic`
- `fiberglass`
- `foam`
- `upholstered`
- `glass`
- `stone`

### `base_finish`, `frame_finish`, `shell_finish`, `wood_finish_color`

- `black`
- `white`
- `graphite`
- `polished aluminum`
- `chrome`
- `powder-coated metal`
- `light oak`
- `walnut`
- `dark walnut`
- `white ash`
- `ebony`
- `natural maple`

### `leg_style`

- `straight legs`
- `angled legs`
- `dowel legs`
- `wire legs`
- `panel legs`
- `trestle`
- `pedestal`

### `glide_type`

- `standard glide`
- `felt glide`
- `metal swivel glide`
- `self-leveling glide`

### `shell_material`

- `molded plywood`
- `molded plastic`
- `fiberglass shell`
- `wire shell`
- `wood shell`

### `upholstery_presence`

- `none`
- `optional`
- `upholstered`

### `upholstery_coverage`

- `seat only`
- `seat and back`
- `full shell`
- `full body`
- `seat pad`
- `seat and arms`
- `shell and cushion`

### `arm_type`

- `no arms`
- `fixed arms`
- `loop arms`
- `integrated arms`
- `arms with arm pads`

### `finish_sheen`

- `low sheen`
- `matte`
- `high sheen`

## Category Extensions

Each category adds fields only when needed. These are extensions to the shared core, not separate schemas.

### Side and Stacking Chairs

Use the shared core plus:

```json
{
  "shell_flex": "",
  "waterfall_edge_present": null,
  "stacking_limit": "",
  "seat_pad_present": null
}
```

Common values:

- `shell_flex`: `flexible back`, `rigid shell`
- `waterfall_edge_present`: `true`, `false`
- `stacking_limit`: freeform summary like `stacks up to 14 high`
- `seat_pad_present`: `true`, `false`

Observed from book:

- wire base
- stacking/ganging base
- dowel base
- 4-leg base
- molded plastic, fiberglass, plywood, and wire shells
- optional seat-only vs seat-and-back upholstery
- glide variants

### Lounge Seating

Use the shared core plus:

```json
{
  "seat_height_style": "",
  "recline_profile": "",
  "cushion_type": "",
  "ottoman_present": null
}
```

Common values:

- `seat_height_style`: `low lounge`, `standard lounge`
- `recline_profile`: `upright lounge`, `reclined lounge`
- `cushion_type`: `loose cushions`, `attached cushions`, `foam pads`, `suspended upholstery`

Observed from book:

- 4-star lounge bases
- swivel and tilt options
- headrest variants
- rolled arms
- exposed wood legs on club seating

### Stools

Use the shared core plus:

```json
{
  "stool_height_band": "",
  "footrest_present": null,
  "back_present": null
}
```

Common values:

- `stool_height_band`: `counter`, `bar`, `high stool`, `low stool`
- `footrest_present`: `true`, `false`
- `back_present`: `true`, `false`

### Benches

Use the shared core plus:

```json
{
  "back_present": null,
  "arm_layout": "",
  "ganging_hardware_present": null
}
```

Common values:

- `arm_layout`: `armless`, `end arms`, `center arms`

### Work Chairs

Use the shared core plus:

```json
{
  "height_adjustable": null,
  "lumbar_present": null,
  "mechanism_type": "",
  "headrest_adjustable": null,
  "chair_size": "",
  "height_range": "",
  "back_construction": "",
  "back_support_type": "",
  "lumbar_support_type": "",
  "arm_adjustability": "",
  "arm_component_finish": "",
  "seat_depth_adjustable": null,
  "recline_control_type": "",
  "performance_material": "",
  "color_scheme": ""
}
```

Common values:

- `mechanism_type`: `task swivel`, `tilt mechanism`, `fixed-height`
- `chair_size`: `A`, `B`, `C`, `mid-back`, `high-back`
- `height_range`: `low`, `standard`, `high`
- `back_construction`: `mesh back`, `suspension back`, `polymer back`, `upholstered back`, `3d knit back`
- `arm_adjustability`: `fixed`, `height-adjustable`, `fully adjustable`, `pivot/depth/width adjustable`
- `recline_control_type`: `weight-activated`, `tilt limiter`, `seat angle`, `upright lock`
- `performance_material`: `pellicle`, `triflex`, `interweave`, `duo suspension`, `flexnet`

### Sofas

Use the shared core plus:

```json
{
  "configuration_type": "",
  "seat_count_band": "",
  "cushion_attachment": "",
  "module_orientation": "",
  "table_integrated": null
}
```

Common values:

- `configuration_type`: `straight sofa`, `sectional`, `corner sectional`, `modular sofa`
- `seat_count_band`: `2-seat`, `3-seat`, `4-seat`, `5-seat`, `6-seat`
- `cushion_attachment`: `attached cushions`, `loose cushions`
- `module_orientation`: `left`, `right`, `center`, `corner`
- `table_integrated`: `true`, `false`

Observed from book:

- sectional orientation
- seat-height variants
- integrated table configurations
- wood leg finishes

### Desks

Use the shared core plus:

```json
{
  "worksurface_shape": "",
  "storage_integrated": null,
  "modesty_panel_present": null,
  "power_access_present": null
}
```

Common values:

- `worksurface_shape`: `rectangular`, `corner`, `executive`, `writing desk`

### Tables

Use the shared core plus:

```json
{
  "table_shape": "",
  "top_material": "",
  "top_finish": "",
  "extension_present": null,
  "folding_present": null
}
```

Common values:

- `table_shape`: `round`, `square`, `rectangular`, `oval`
- `top_material`: `wood veneer`, `laminate`, `glass`, `stone`

### Occasional Tables

Use the tables extension plus:

```json
{
  "nesting_capable": null,
  "tier_count": "",
  "scale_band": ""
}
```

Common values:

- `scale_band`: `side table`, `coffee table`, `console table`

### Storage

Use the shared core plus:

```json
{
  "storage_type": "",
  "drawer_configuration": "",
  "door_style": "",
  "file_storage_present": null,
  "lock_present": null
}
```

Common values:

- `storage_type`: `credenza`, `cabinet`, `shelving`, `pedestal`
- `drawer_configuration`: freeform normalized summary such as `two file drawers`
- `door_style`: `open`, `hinged`, `sliding`

Observed from book:

- extensive veneer finish options
- file drawer configurations
- width/unit combinations

### Accessories

Use the shared core plus:

```json
{
  "accessory_type": "",
  "mount_type": "",
  "hardware_included": null
}
```

Common values:

- `accessory_type`: `ganging plate`, `dolly`, `arm pad kit`, `hardware kit`
- `mount_type`: `surface-mounted`, `kit`

### Lighting

Use the shared core plus:

```json
{
  "lighting_type": "",
  "shade_shape": "",
  "shade_material": "",
  "cord_length": "",
  "trim_finish": "",
  "mount_type": "",
  "bulb_included": null
}
```

Common values:

- `lighting_type`: `pendant`, `floor lamp`, `table lamp`
- `shade_shape`: `ball`, `saucer`, `cylinder`, `lantern`
- `shade_material`: `bubble shade`, `metal`, `glass`
- `mount_type`: `ceiling-mounted`, `plug-in`

Observed from book:

- pendant size variants
- cord length
- trim finish

### Outdoor Furniture

Use the shared core plus:

```json
{
  "outdoor_rated": null,
  "weather_resistant_materials": [],
  "drainage_features_present": null
}
```

Common values:

- `weather_resistant_materials`: `powder-coated metal`, `outdoor wood`, `polymer`, `mesh`

## Query-Trait Mapping Guidance

The parser should map phrases into normalized fields, not bespoke query rules.

Examples:

- `metal legs` -> `leg_material = metal`
- `wood base` -> `base_material = wood`
- `dowel base` -> `base_type = dowel base`
- `4-point legs` -> `base_type = 4-leg base`
- `chair with arm pads` -> `arm_pad_present = true`
- `armless lounge chair` -> `arms_present = false`, `application_type = lounge seating`
- `upholstered shell with exposed veneer` -> `upholstery_coverage = full shell`, `shell_material = molded plywood`

## Prompt / Extraction Implications

To use this schema well, the captioning pipeline should:

- keep the current one-sentence caption for embeddings
- expand the trait JSON schema to include the shared core plus relevant extension fields
- tell the vision model to fill only visually observable fields
- leave unavailable fields blank instead of guessing from catalog options

## Recommended Next Implementation Order

1. Update seating image schema first:
   - `base_material`
   - `leg_material`
   - `leg_style`
   - `arm_type`
   - `arm_pad_present`
   - `shell_material`
   - `upholstery_coverage`
2. Update query extraction for those same fields.
3. Rebuild the small seating test index.
4. Re-evaluate the known failure queries.
5. Extend to tables, storage, lighting, and outdoor after seating stabilizes.
