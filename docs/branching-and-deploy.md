# Branching and Deploy

`main` is the deploy branch. It should always be deployable and should match whatever beta users are running in production.

## Branches

- `main`
  - always deployable
  - synced to production after each deploy
- `fix/<short>`
  - bug fixes and hotfixes
  - branch from `main`
- `feature/<short>`
  - larger work such as new categories or major UX changes
  - branch from `main`

Long-running feature branches should periodically merge `main` back into themselves so they stay current with deployed fixes.

## Deploys

- Merge the release-ready branch into `main`
- Tag `main` immediately after deploy
- Push both `main` and the tag to GitHub

Versioning:

- `v0.1.x` for bug-fix releases on the beta MVP
- `v0.2.0` for the next category-expansion release
- continue semver from there

Production should be answerable by: “whatever tag is latest on `main`.”

## Pull Requests

Before merge:

- tests pass
- smoke-test locally
- no debug-only code left behind
- any migration scripts are documented and their run order is clear

## Hotfix Flow

1. Branch from `main` using `fix/<short>`
2. Make the fix
3. Open and merge the PR into `main`
4. Tag the release
5. Deploy from `main`

## Parallel Work

Bug-fix and feature work should happen on separate branches from `main`.

- bug fixes should not wait on unfinished feature branches
- feature work should regularly absorb `main` so fixes do not drift

For historical cleanup context from the MVP landing, see [docs/stash-cleanup.md](/Users/jacobslevin/Code/image-search/docs/stash-cleanup.md).
