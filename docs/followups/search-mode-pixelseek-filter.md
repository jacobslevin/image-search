# Follow-Up: Expose PixelSeek Category Filter In Search Mode

## Why this is separate

The category mismatch patch fixes the API contract and removes the hidden browse-state leak into `/api/search` and `/api/refine-search`.
It does not expose a user-facing PixelSeek category filter in search mode yet.

## Current state after the patch

- Browse mode still exposes raw DP catalog categories.
- Search mode no longer forwards those raw categories to the search endpoints.
- `/api/search` and `/api/refine-search` now interpret `category` as a PixelSeek seating type filter and reject raw DP category values.

## Follow-up scope

Add an explicit search-mode category control wired to canonical PixelSeek types:

- `task_collab_chair`
- `guest_chair`
- `lounge_chair`
- `stool`
- `bench`

## Acceptance criteria

- Search-mode UI exposes PixelSeek category choices independently from browse-mode raw catalog categories.
- Requests sent from search mode use canonical PixelSeek values only.
- Browse mode keeps its existing raw DP category behavior.
- Context pills and saved URL state distinguish browse raw categories from search PixelSeek categories clearly.
