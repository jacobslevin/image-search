# v2 Deploy Notes

This document covers production deployment of `v2` to Elastic Beanstalk using the already-populated RDS PostgreSQL database.

## Runtime database configuration

The server reads PostgreSQL configuration from environment variables:

- `PGHOST`
- `PGPORT`
- `PGDATABASE`
- `PGUSER`
- `PGPASSWORD`
- `PGSSLMODE`

Local development behavior:

- defaults to `pixelseek_dev`
- does not enable SSL unless `PGSSLMODE=require`

Production behavior:

- point all `PG*` variables at the RDS instance
- set `PGSSLMODE=require` so Node `pg` uses SSL

## Elastic Beanstalk environment variables

Set these on the EB environment:

- `PGHOST=image-search.cluster-ccvqwwr6c4yt.us-east-1.rds.amazonaws.com`
- `PGPORT=5432`
- `PGDATABASE=imagesearch`
- `PGUSER=imagesearchuser`
- `PGPASSWORD=ImageSearch2026!!`
- `PGSSLMODE=require`

OpenAI:

- `OPENAI_API_KEY` must remain set in EB

## Deployment expectations

- `v2` completely replaces `v1`
- no parallel `v1` runtime is needed
- the canonical Postgres layer in RDS is already populated
- the first `v2` deploy does not need to run migrations against production

## Deploy steps for Ariel

1. Pull the intended release tag or deploy `v2` at the same commit.
2. Set the EB environment variables listed above.
3. Verify `OPENAI_API_KEY` is still present.
4. Deploy the application via Elastic Beanstalk.
5. After deploy, verify:
   - homepage loads
   - the UI version label matches the release tag
   - browse returns products
   - text search works
   - table search works

## Notes

- Phase 1.5 moved the app read paths from JSON files to canonical PostgreSQL tables.
- Source-data refresh and extraction write paths still remain JSON-backed for now; that does not block the production read deployment.
- Bump `package.json`'s `version` field alongside each release tag so the UI version indicator stays accurate.

## Current Local Findings

### 2026-05-16

- Cross-category similar-look feature is now functional end-to-end:
  - Apply Priorities preservation: commit `d7896b9` (state correctly preserves through trait adjustments)
  - 0-results fix: commit `56dad18` (dropping `imageAnalysis` from `beginSimilarLookCategorySwitch()` restored normal result return)
- Chip narrowing fix shipped (`d7896b9`): stage-1 prompt updated to require non-empty `plausible_categories` for `product_detail` cases
- Admin route payload reduced from ~35.5 MB to ~8 MB via `field_confidence` strip (`d6e8d4f`) and `visual_summary_embedding` lazy-fetch (Phase 2)
