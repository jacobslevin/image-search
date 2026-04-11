# Image Search Prototype

Standalone prototype for visual-first furniture search. It ingests the supplied catalog CSVs, normalizes product and image records, generates structured visual captions plus richer visual descriptions per image, embeds both text channels, and exposes a small local search UI and API.

## What the prototype does

- Uses only `category` and `brand` as explicit catalog constraints.
- Uses structured image captions plus richer visual descriptions as the basis for retrieval.
- Uses blended embeddings for trait precision and broader visual-language recall.
- Rolls image matches up to product results and shows the best matching image per product.
- Includes matched trait chips plus a per-card debug accordion.
- Supports inspiration-image upload, AI-generated visual bullets, and bullet-driven query composition when `OPENAI_API_KEY` is available on the server.

## Project structure

- `scripts/normalize-products.js`: reads the CSVs and writes normalized catalog JSON.
- `scripts/build-index.js`: generates per-image captions, visual descriptions, bullet highlights, trait objects, and embeddings.
- `server.js`: serves the local API and static demo UI.
- `public/`: image-first demo frontend matching the supplied direction.
- `src/`: normalization, captioning, parsing, and ranking logic.
- `docs/trait-schema-v1.md`: shared core plus category-specific trait extensions derived from the Herman Miller ancillary price book.

## Setup

1. Ensure Node 20+ is installed.
2. From this workspace, run `npm run normalize`.
   To normalize a curated single CSV instead of the legacy export folder:
   `npm run normalize -- --source "/Users/jacobslevin/Downloads/sample-project.csv"`
3. Build the image index with one of the following:

   Production-intent prototype path:
   `OPENAI_API_KEY=your_key npm run index -- --max-images 250`

   Offline UI/demo path:
   `npm run index -- --provider demo --max-images 250`

   Mixed seating plus tables sample:
   `npm run index -- --provider demo --categories seating,chair,stool,bench,table --max-products 20 --images-per-product 2`

   Append another batch to the existing local index:
   `OPENAI_API_KEY=your_key npm run index -- --append --categories guest,high-performing chair,table --max-products 6 --images-per-product 2`

   If `OPENAI_API_KEY` is set, the indexer defaults to `openai` provider automatically.

4. Start the app with `npm start`.
5. Open [http://localhost:3000](http://localhost:3000).

## Notes on caption generation

- `openai` provider:
  - Runs one vision pass per image.
  - Generates a structured caption, richer visual description, selectable visual bullets, and normalized visual trait object.
  - This is the intended path for concept validation.
- `demo` provider:
  - Generates deterministic placeholder captions from catalog context so the UI and search flow can run offline.
  - It is useful for local development, but it is not compliant with the final ranking requirement because it does not inspect the image.

Embeddings are currently generated locally with a deterministic hashed text embedding so the prototype stays dependency-free and searchable offline once captions exist. The searcher blends structured-caption embeddings with visual-description embeddings.

## API

### `GET /api/bootstrap`

Returns brands, categories, sample queries, and whether an index is available.

### `GET /api/search?q=guest seating with chrome sled base and wood arms`

### `POST /api/analyze-image`

Accepts a JSON body with `image_data_url` and returns:
- `structured_caption`
- `visual_description`
- `visual_highlights`
- `visual_traits`

This powers the inspiration-image upload workflow in the UI.

### `POST /api/compose-query`

Accepts a JSON body with selected `bullets` and rewrites them into a search query. Falls back to joining the bullets if `OPENAI_API_KEY` is not available.

Example response shape:

```json
{
  "query": "guest seating with chrome sled base and wood arms",
  "parsed": {
    "category": "Multi-Use Guest Seating",
    "brand": null,
    "visual_query": "chrome sled base and wood arms"
  },
  "total_results": 9,
  "results": [
    {
      "product_id": "product_123",
      "name": "Example Chair",
      "brand": "Keilhauer",
      "category": "Multi-Use Guest Seating",
      "best_image_url": "https://example.com/image.jpg",
      "matched_traits": ["chrome sled base", "wood arms"],
      "debug": {
        "structured_caption": "Multi-use guest chair with tubular chrome sled base, exposed wood arms, upholstered seat and back, and a clean transitional silhouette.",
        "detected_traits": ["chrome frame", "wood arms", "upholstered seat"]
      }
    }
  ]
}
```

## Query parser behavior

- Category parsing is rule-based using a controlled phrase map.
- Brand detection uses the imported manufacturer list.
- Everything not claimed by category or brand becomes the visual query.
- Ranking does not use descriptions, tags, specs, or marketing copy.

## Suggested manual evaluation queries

- `guest seating with chrome sled base and wood arms`
- `wood seating`
- `lounge chair with exposed wood frame`
- `upholstered guest chair with metal base`

## Current limitations

- The CSV importer tolerates mixed Latin-1 style exports, but does not attempt advanced schema inference beyond header names and image URL detection.
- Curated project CSVs are supported when they include at least `Product ID`, `Product Name`, `Image URL`, `Brand`, and `DP Categories`.
- The local embedding implementation is intentionally simple so the prototype runs without extra dependencies.
- The `demo` caption provider is for UI/debugging only; use the `openai` provider for actual image understanding.
