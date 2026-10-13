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

1. **Per-stroke head positions depend on `buoyancy-balance`, not `head-position-overall`.** The rubric says each per-stroke head position skill "builds on" the overall head position rollup, but the rollup is *calculated from* those four per-stroke grades, which would create a cycle. We broke it by depending on `buoyancy-balance` (the shared foundation) instead. Confirm this is the right substitution, or propose a different structure.

2. **Head position descriptors attached to all four per-stroke skills.** The rubric says head position "applies per stroke, then rolls up." We loaded the same five-level descriptor set onto each of the four per-stroke head position skills. Confirm whether the wording should differ per stroke.

3. **`breathing-timing-fly` is the fly instance of Breathing timing (not a separate skill).** The fly rubric table (section 6) lists "Breathing timing — Head position, Breath control," which matches the breathing-timing-fly entry in Breathing & Coordination. Confirm that fly has no separate stroke-timing dependency for breathing.

4. **Breaststroke breakout maps "Stroke timing" → `breast-timing`.** Breaststroke has no "Stroke timing" skill; "Timing" is the closest equivalent. Confirm or provide the correct dependency.

5. **Fly breakout maps "Stroke timing" → `fly-two-kick-rhythm`.** Fly has no explicit stroke-timing skill; two-kick-rhythm is the structural analog for fly stroke coordination. Confirm or provide the correct dependency.

6. **`tempo` (Racing & Performance) has no builds-on link.** The rubric says it builds on "Stroke timing," but at the Racing & Performance level there is no stroke-agnostic stroke timing skill. Left unlinked for now. Confirm which skill(s) tempo should depend on, or whether it should depend on each stroke's timing skill.

7. **`stroke-count` builds on `free-distance-per-stroke` only.** Freestyle DPS is the only distance-per-stroke skill currently in the catalog. If DPS should exist for other strokes, add them and link stroke-count to each.

8. **`freestyle-flip-turn` applies only to freestyle.** The rubric lists "Free, IM breast to free" as its context. IM is not a stroke value in the current `stroke` enum. Confirm whether IM turns need a separate enum value or category, or whether the freestyle-flip-turn skill covers the IM case implicitly.

9. **IM turns store both stroke values in `applies_to`.** `im-fly-to-back` uses `["fly", "back"]`, etc. This may be insufficient once IM events are modelled. Confirm whether IM transitions need their own enum entry.

10. **`stroke-breath-coordination-breast` depends on `body-rotation`.** The rubric lists "Breathing timing, Body rotation" for all four stroke-breath coordination skills. Breaststroke does not rotate the way freestyle and backstroke do. Confirm whether the body-rotation dependency is intentional for breaststroke.
