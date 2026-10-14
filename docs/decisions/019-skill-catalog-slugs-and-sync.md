# 019 — Permanent slugs and catalog sync for the skills rubric

**Date:** 2026-10-12  
**Status:** Accepted

## Context

The swimmer skills rubric (Jason's document, `docs/reference/skill-rubric.md`) defines eight categories and ~97 skills. This data needs to live in the DB so the app can build dependency maps, display descriptors, and record ratings against it. Two design questions arose:

1. **Identity:** skill UUIDs are meaningless to humans and can't be referenced in code or queries safely. We needed a stable, human-readable key.
2. **Load mechanism:** this is reference data that must also exist in production. A one-time seed is too fragile (can't update descriptors, can't rename a skill); full ORM management adds migration churn every time Jason revises the rubric.

## Decision

**Permanent slugs.** Every category and skill gets a `slug` column (unique, text). The slug is the permanent identifier — it never changes once shipped to production. The UUID is the relational FK; the slug is what code and humans use to refer to a skill. Renaming a skill changes `name`, not `slug`. Removing a skill sets `archived_at`, not a delete.

**Typed catalog file + sync script.** All catalog content lives in `apps/api/src/db/reference/skillsCatalog.ts` as a TypeScript constant. A sync script (`pnpm db:sync-catalog`) does an idempotent upsert keyed on slug, wrapped in a single transaction so a mid-sync failure leaves the catalog unchanged:

- Updates names, types, units, strokes, descriptors, and dependencies in place.
- Never deletes a skill row — sets `archived_at` on slugs that no longer appear in the catalog.
- Stale dependency edges are removed: the sync deletes all `skill_dependencies` rows for catalog skills and re-inserts from the catalog, so removed `builtOnSlugs` entries don't persist.
- Guards against an empty catalog import: throws before writing anything if the catalog has zero categories or zero skills, preventing an accidental archive wipe.
- Validates before writing: no duplicate slugs, all dependency slugs exist in the catalog, no dependency cycles, descriptor levels are 1–5.
- Safe to run against any environment deliberately; never runs automatically.

The generic rating scale (1–5, Emerging–Mastery) lives in `rating_scale_levels` and is also synced. Skills without their own descriptors fall back to it at query time.

## Consequences

- The catalog file is the source of truth. Schema changes (new columns) still require a migration; content changes (new skills, revised descriptors) only require editing the catalog file and re-running the sync.
- Slugs must be chosen carefully at creation time — they travel in URLs and query params once the app ships. The convention is `{stroke-prefix}-{skill-name}` for per-stroke skills (e.g. `free-catch`, `back-stroke-timing`) and bare kebab-case for swimmer-level skills (e.g. `core-stability`, `breath-control`).
- The illegal-turn cap logic (turns capped at 2 when called illegal), start-component averaging, and head-position rollup method are **milestone 3 logic** — not stored in the catalog. The catalog records the structure; the computation rules belong in application code once Jason finalises the open decisions in section 9 of the rubric.
- The `pnpm db:sync-catalog` script must be run manually after any catalog edit, both locally and in production deploys that include rubric changes.

## Open questions for Jason

These decisions were made to build the catalog but were not confirmed with Jason. Each inline comment in `skillsCatalog.ts` points here. They should be resolved before milestone 3 work on dependency-map display.

1. **Per-stroke head positions depend on `core-stability`, not `head-position-overall`.** The rubric says each per-stroke head position skill "builds on" the overall head position rollup, but the rollup is *calculated from* those four per-stroke grades, which would create a cycle. Per Jason's Phase 1 answers, the per-stroke head positions are inputs to the rollup and depend on `core-stability`. `buoyancy-balance` now sits above the rollup (depends on `head-position-overall` + `core-stability`). **OPEN:** confirm this restructuring is correct.

2. **Head position descriptors attached to all four per-stroke skills.** The rubric says head position "applies per stroke, then rolls up." We loaded the same five-level descriptor set onto each of the four per-stroke head position skills. Confirm whether the wording should differ per stroke.

3. **`breathing-timing-fly` builds on `fly-head-position` and `fly-two-kick-rhythm`.** RESOLVED (Phase 1, A7) — confirmed that fly breathing timing depends on fly-head-position and fly-two-kick-rhythm, not breath-control.

4. **Breaststroke breakout maps "Stroke timing" → `breast-timing`.** Breaststroke has no "Stroke timing" skill; "Timing" is the closest equivalent. **OPEN:** not answered in Phase 1 — still needs confirmation.

5. **Fly breakout maps "Stroke timing" → `fly-two-kick-rhythm`.** RESOLVED (Phase 1, A9) — confirmed builds on `udk-free-fly` and `fly-two-kick-rhythm`.

6. **Tempo is now per-stroke.** RESOLVED (Phase 1, A6) — each stroke gets its own tempo skill in that stroke's category, depending on that stroke's timing skill: `free-tempo` → `free-stroke-timing`, `back-tempo` → `back-stroke-timing`, `breast-tempo` → `breast-timing`, `fly-tempo` → `fly-two-kick-rhythm`. The shared `tempo` skill in racing-performance is archived.

7. **Stroke count is now per-stroke; DPS merged in.** RESOLVED (Phase 1, A7) — stroke count exists per stroke (`free-stroke-count`, `back-stroke-count`, `breast-stroke-count`, `fly-stroke-count`). `free-distance-per-stroke` is archived and merged into `free-stroke-count`.

8. **`freestyle-flip-turn` applies only to freestyle.** RESOLVED (Phase 1, A8) — confirmed applies only to freestyle. The IM breast-to-free case is covered by `im-breast-to-free` (its own skill, renamed to "Breast to free (open turn)").

9. **IM back-to-breast split into three skills.** RESOLVED (Phase 1, A9) — `im-back-to-breast` is archived and replaced by `im-back-to-breast-open`, `im-back-to-breast-bucket`, and `im-back-to-breast-crossover`.

10. **`stroke-breath-coordination-breast` and `stroke-breath-coordination-fly` do not depend on body rotation.** RESOLVED (Phase 1, A10) — body rotation removed from breaststroke and fly stroke-breath coordination. `stroke-breath-coordination-breast` depends only on `breathing-timing-breast`; `stroke-breath-coordination-fly` depends only on `breathing-timing-fly`.

**New open question (from Phase 1 review):**

- **Breaststroke breakout dependency** — question 4 above remains unresolved. Is `breast-timing` the correct stand-in for "Stroke timing" in the breaststroke breakout, or should it depend on something else?
