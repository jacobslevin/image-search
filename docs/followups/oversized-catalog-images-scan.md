## Oversized catalog image scan

Date:
- 2026-04-27

Context:
- Investigated after `Superkool` failed during Phase 1 full re-extraction with `OpenAI request failed with 400.`
- Goal was to understand how common large source assets are before deciding whether image-size preflight handling is necessary.

Corpus scanned:
- `11,148` normalized-catalog image URLs
- `11,144` returned `HTTP 200`
- `4` were unresolved during the scan

Counts:
- `183` images over `10 MB`
- `64` images over `20 MB`

Brand concentration:
- Over `10 MB`
  - `Andreu World America Furniture`: `145`
  - `Allsteel`: `12`
  - `David Edward`: `10`
  - `Coalesse`: `9`
  - `National by Kimball International`: `6`
- Over `20 MB`
  - `Andreu World America Furniture`: `52`
  - `Allsteel`: `7`
  - `David Edward`: `4`
  - `Coalesse`: `1`

Category concentration (`b_level`):
- Over `10 MB`
  - `Multi-use Guest Chairs`: `63`
  - `Lounge Seating`: `36`
  - `Fixed-height Stools`: `35`
  - `Workplace`: `22`
  - `Bench Seating`: `12`
- Over `20 MB`
  - `Lounge Seating`: `20`
  - `Multi-use Guest Chairs`: `16`
  - `Fixed-height Stools`: `15`
  - `Workplace`: `11`

Observed pattern:
- Oversized assets are not limited to banners or environment shots.
- Many appear to be ordinary product or variant packshots.
- This means large-image handling is a real corpus concern, but not a dominant-volume one.

Superkool-specific note:
- `Superkool` has `10` images over `10 MB`
- `4` images over `20 MB`
- Largest observed asset:
  - `product_dp_14105680_img_010`
  - `DESuperkool10.jpg`
  - `33.0 MB`

OpenAI limit reference:
- Official image-input docs state:
  - up to `512 MB total payload size per request`
  - up to `1500` individual image inputs per request
- Source:
  - https://developers.openai.com/api/docs/guides/images-vision

Interpretation:
- Oversized source images are common enough to recur during large re-extractions.
- But `Superkool`'s `33 MB` asset is still well below the documented OpenAI image-input limit, so image size alone was not proven to be the direct cause of that `400`.

Deferred follow-up:
- After per-image failure handling lands, watch whether failed images cluster on oversized assets.
- If failures do cluster there, the next investigation should be byte-size preflight handling or server-side resize/normalization before sending to OpenAI.
