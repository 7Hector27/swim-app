# 018 — Permanent slugs and catalog sync for the skills rubric

**Date:** 2026-10-12  
**Status:** Accepted

## Context

The swimmer skills rubric (Jason's document, `docs/reference/skill-rubric.md`) defines eight categories and ~97 skills. This data needs to live in the DB so the app can build dependency maps, display descriptors, and record ratings against it. Two design questions arose:

1. **Identity:** skill UUIDs are meaningless to humans and can't be referenced in code or queries safely. We needed a stable, human-readable key.
2. **Load mechanism:** this is reference data that must also exist in production. A one-time seed is too fragile (can't update descriptors, can't rename a skill); full ORM management adds migration churn every time Jason revises the rubric.

## Decision

**Permanent slugs.** Every category and skill gets a `slug` column (unique, text). The slug is the permanent identifier — it never changes once shipped to production. The UUID is the relational FK; the slug is what code and humans use to refer to a skill. Renaming a skill changes `name`, not `slug`. Removing a skill sets `archived_at`, not a delete.

**Typed catalog file + sync script.** All catalog content lives in `apps/api/src/db/reference/skillsCatalog.ts` as a TypeScript constant. A sync script (`pnpm db:sync-catalog`) does an idempotent upsert keyed on slug:

- Updates names, types, units, strokes, descriptors, and dependencies in place.
- Never deletes a skill row — sets `archived_at` on slugs that no longer appear in the catalog.
- Validates before writing: no duplicate slugs, all dependency slugs exist in the catalog, no dependency cycles, descriptor levels are 1–5.
- Safe to run against any environment deliberately; never runs automatically.

The generic rating scale (1–5, Emerging–Mastery) lives in `rating_scale_levels` and is also synced. Skills without their own descriptors fall back to it at query time.

## Consequences

- The catalog file is the source of truth. Schema changes (new columns) still require a migration; content changes (new skills, revised descriptors) only require editing the catalog file and re-running the sync.
- Slugs must be chosen carefully at creation time — they travel in URLs and query params once the app ships. The convention is `{stroke-prefix}-{skill-name}` for per-stroke skills (e.g. `free-catch`, `back-stroke-timing`) and bare kebab-case for swimmer-level skills (e.g. `core-stability`, `breath-control`).
- The illegal-turn cap logic (turns capped at 2 when called illegal), start-component averaging, and head-position rollup method are **milestone 3 logic** — not stored in the catalog. The catalog records the structure; the computation rules belong in application code once Jason finalises the open decisions in section 9 of the rubric.
- The `pnpm db:sync-catalog` script must be run manually after any catalog edit, both locally and in production deploys that include rubric changes.
