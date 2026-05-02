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

## 3. Stage 4 Dashboard Applicability Note

The Stage 4 lounge-sofa coverage dashboard originally used a generic "double/triple seat lounge sofa" denominator for all three Stage 4 traits. That understated `seat_construction` coverage because integrated-base lounge sofas are eligible by configuration but structurally inapplicable for the seat-construction trait.

The fix was to make per-trait coverage use per-trait applicability, sourced from the same `getLoungeSofaTraitApplicability(...)` rules the classifier uses:

- `seat_construction`: eligible lounge sofa and **not** integrated base
- `narrow_arms`: eligible lounge sofa and **not** armless
- `arms_flush_with_back`: eligible lounge sofa and **not** armless

Implementation principle:

- Dashboard coverage denominators should come from the classifier's own applicability rules, not a separate reimplementation.
- If the lounge-sofa gating logic changes in the future, both extraction and diagnostics should update together through the shared applicability module.

## 4. Privacy-Wall Arm-Trait Note

`Coact Lite - Lounge` was intentionally left with `null` arm traits. It is a privacy-walled / acoustic-divider piece, not a conventional sofa with standard arms, so the `Arm Width` / `Arm Height` taxonomy does not fit cleanly.

If similar privacy-walled lounge pieces show up in the data later, it may be worth revisiting the trait taxonomy or applicability rules at that point rather than forcing them into conventional arm classifications.

## 5. Trait Priority Source-Of-Truth Note

There was a bug where structured-trait priority drifted across three places:

- schema priority in `data/seating-types.json`
- backend scoring in `src/search.js`
- frontend debug-table recomputation in `public/app.js`

`arms_flush_with_back` for lounge seating was especially affected: the frontend treated it as essential while the backend scorer still read it as normal, so the debug table showed per-cell contributions that did not match the actual `trait_boost` used for ranking.

The fix was:

- schema is the single source of truth for trait priority
- backend and frontend both read priority from schema
- frontend no longer recomputes trait contributions locally
- backend returns the trait contribution details used for scoring, and the debug table renders those directly

Implementation principle:

- any time logic is defined in two or more places, it will drift
- priority, applicability, and scoring rules should be defined once and consumed everywhere else

## 6. Reference Image Crop Follow-Up

The `isFullImageArea` guard from the `frontend UX polish` stash was extracted into committed code so full-image uploads no longer render as cropped in the Tools / Refine reference image panel.

Related cleanup landed with it:

- stored-image / purple-button searches explicitly clear `state.focusArea` so they do not inherit a stale crop from a prior uploaded-image search
- the visible re-crop button is shown for uploaded-image searches and stays hidden for stored-image / purple-button searches
