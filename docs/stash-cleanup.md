# Stash Cleanup Notes

Created: May 1, 2026

## 1. Stashed In-Progress Work

Five named stashes were created on Fri May 1 2026 to clean up the worktree after the Stage 4 lounge-sofa landing:

### `bench frame_material overhaul`

Original scope:
- `src/captioning.js`
  - bench `frame_material` prompt expansion and metal-material disambiguation guidance
- `data/seating-types.json`
  - bench `frame_material` allowed values:
    - `Cast metal`
    - `Stone / concrete`

### `category-routing + plausible_categories`

Original scope:
- `src/captioning.js`
  - `plausible_categories` work
  - `buildStage1OverrideVoteResult(...)` default support
- `public/app.js`
  - image-analysis category-requirement flow
- `public/index.html`
  - image-analysis category prompt markup
- `public/styles.css`
  - image-analysis category prompt styles
- `server.js`
  - category-required / plausible-categories request and response plumbing

### `frontend UX polish`

Original scope:
- `public/app.js`
  - `queryDisplayCleared`
  - `clearQueryButton`
  - reset behavior
  - full-image crop fix
- `public/index.html`
  - clear-query button markup
  - asset version bump
- `public/styles.css`
  - related clear-query / layout polish

### `unrelated leftovers`

Original scope:
- `README.md`
  - local deployment / known-issues notes
- `data/unmapped-category-decisions.json`
  - new unmapped-category decisions
- `server.js`
  - failed-product-attempt tracking
  - additional refresh diagnostics plumbing
  - `/api/failed-product-attempts`
- `src/utils.js`
  - `getFailedProductAttemptsPath()`
- `public/styles.css`
  - one leftover `.search-clear-query-button` CSS hunk

### `untracked local artifacts`

Original scope:
- local batch JSON files under `data/`
- local reextract / scratch scripts under `scripts/`
- local progress / report artifacts
- local failed-product-attempts data file

### Durability note

Stashes are not durable storage. If any of these are still needed after a couple of weeks, convert them to branches instead of leaving them only in `git stash`.

Recommended pattern:

```bash
git stash branch <name> stash@{N}
```

## 2. Known Stash Bookkeeping

The `.search-clear-query-button` CSS hunk ended up in the `unrelated leftovers` stash instead of `frontend UX polish` because it was still dirty after the first UX stash pass.

When the UX polish stash is eventually applied, that CSS hunk needs to be pulled from the leftovers stash and moved over so the UX changes are complete in one place.
