# ADR-024: Screen model replaces per-session category

**Date:** 2026-10-16
**Status:** Accepted

## Context

Skills were previously organized by category (`skill_categories` table). Coaches selected a category per evaluation session, and progress was bucketed by that category. As the skill set grew — particularly when IM turns and starts were added — some skills became relevant in multiple evaluation contexts. The category model grew awkward: a coach evaluating freestyle also needs to assess starts and underwaters, but those belong to a different category. The result was coaching sessions that didn't map cleanly to a single category, and progress queries that dropped sessions with a missing or mismatched `category_id`.

## Decision

Replace the per-session category with a **screen** — a named, ordered subset of skills that a coach evaluates in one sitting.

Key points:

- Screens are defined in code (`SCREEN_SKILLS` in `packages/shared/src/lib/screenSkills.ts`), not in the database. Adding or modifying a screen requires a code change, not a migration.
- A session now stores a `screen_slug` (text, NOT NULL) instead of relying on `category_id`. The `category_id` column is kept on `evaluation_sessions` as a nullable field for backward compatibility with any rows that predate this change.
- Skills can appear on multiple screens and still receive a single shared grade (the grade key is `skill.id`, not `skill.id:screenSlug`).

## Section layout

Each screen has UI sections (e.g., "The swim", "Numbers", "Starts") defined in `SCREEN_SECTIONS` in the web app (`apps/web/src/content/EvaluateContent/screenSections.ts`). Section layout is UI-only and has no database representation. The same skill slug can appear in multiple sections within one screen without duplication concerns — the draft grade key is `skill.id`, so the grade is shared.

## Shared skills

Push-off (`push-off`), streamline-in-motion (`streamline-in-motion`), and wall-approach (`wall-approach`) appear on multiple stroke screens (freestyle, backstroke, breaststroke, butterfly). `buildSectionGroups` does not deduplicate — the same skill can render in multiple sections within one screen. Because the draft grade key is `skill.id`, grading the skill in any section updates the same value.

## Backward compatibility

`category_id` on `evaluation_sessions` is kept nullable. Existing rows that were created with a category and no screen slug were cleaned up by migration `0028_backfill_screen_slug_not_null.sql` (deleted rows where `screen_slug IS NULL`) before the NOT NULL constraint was applied.

## Consequences

- **Progress queries must NOT join `evaluation_sessions` to `skill_categories`** via `category_id`. The parent progress endpoint (`GET /swimmers/:id/progress`) groups coaching notes by `screen_slug` and resolves the human-readable name via `SCREEN_NAMES` in shared code.
- The `GET /coach/screens` endpoint returns the full screen list with skills for the evaluation form — replacing the legacy `GET /coach/categories` endpoint (which remains for backward compatibility).
- The `screen_slug` column has a CHECK constraint enforcing it to one of the known slugs. Adding a new screen requires: updating `SCREEN_SKILLS` in shared, updating `SCREEN_SECTIONS` in the web app, and generating a new migration to widen the CHECK constraint.
- Breathing pattern (`breathing_pattern`) is required on sessions for the `freestyle` and `butterfly` screens, and is enforced both in the API route handler and in the `canSubmit` UI helper.
