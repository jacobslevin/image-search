## Stage 0 systematically drops seating products with integrated tables

Source location:
- [src/captioning.js](/Users/jacobslevin/Code/image-search/src/captioning.js:2719)

Failure mode:
- Stage 0 first runs a furniture-count prompt.
- That prompt explicitly counts `tables` as furniture.
- If the parsed furniture count is greater than `1`, Stage 0 immediately returns `scene` and does not continue to the full-vs-partial product check.
- As a result, seating products with integrated or attached table surfaces can be routed to `scene` even when the image is a clean isolated product shot.

Affected product shape:
- Ottomans with attached tablets
- Lounge systems with integrated side tables
- Seating with worksurfaces or attached table arms

Concrete example:
- `Boost` image `product_dp_13931117_img_012`
- URL: `https://content.designerpages.com/assets/81760306/FOFboostexpansionwr15.jpg`
- Likely route: attached white tablet counted as a second furniture item, triggering automatic `scene`

Deferred-fix rationale:
- The current rule is still doing its main job of filtering true lifestyle and multi-piece scene imagery.
- A robust fix would require distinguishing `attached-to-the-primary-seat` from `nearby separate furniture`, which is a non-trivial classifier change.
- For now this is accepted as a conservative Stage 0 bias, and affected products should surface through low-coverage audit results for manual spot checks.
