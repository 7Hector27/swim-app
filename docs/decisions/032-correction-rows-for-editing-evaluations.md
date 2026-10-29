# 032 — Correction rows for editing evaluations

**Date:** 2026-10-29
**Status:** Accepted
**Amends:** ADR 022 (session metadata is no longer immutable; see "Amendment to ADR 022" below).

## Context

ADR 022 made `skill_ratings` and `evaluation_sessions` append-only after a 10-minute undo window: wrong ratings are corrected by **voiding** the row and inserting a new one; session metadata (date, context, coaching priority) is **immutable**. In practice Jason discovers wrong grades, missing fault tags, or wrong session dates days or weeks after the fact — long past the 10-minute delete window. The current workflow is "void everything in the bad session, create a fresh session with the right values." That loses the link between the two sessions, inflates the rating-count display on the coach swimmer page, and leaves the coach's score history scattered across two entries with no shared identity.

The goal of this ADR is to let the coach **edit a past evaluation in place** without losing the properties ADR 022 established for ratings:

- Ratings stay append-only. The original observation is never mutated.
- The original rating is always recoverable from the row history (and visible to the coach in a full history view).
- Calculations (`latestEffectiveRatings`, `calculateStartGrade`, `headPositionOverall`, category rollups, `computeScoreHistory`, golf-score trends) use the corrected value with no code duplication.
- Parents see the current effective state (no edit indicator), consistent with how voids are already hidden.

Three constraints shape the design:

- The void mechanism is already a correct, well-tested shape for "this row is still there, calculations skip it, UI can display it in a full history view." A rating correction is operationally the same thing as a void plus a new row, except we want the two rows **linked** so the UI can render an "Edited" label and show the pre-correction value side by side.
- Session metadata edits (date, context, coaching priority, breathing pattern) are frequent and typically single-field — a priority typo, a wrong date. Writing a new session row and cloning or re-pointing ratings for every such edit is far more operational surface than the correction needs. Session metadata is strictly bookkeeping on top of an already-committed observation; the audit trail belongs on the audit log, not in `evaluation_sessions` rows.
- The 10-minute hard-delete window from ADR 022 must still work for accidental taps. Corrections are the no-time-limit fallback for everything older.

## Decision

### 1. Rating corrections: supersede rows

**Add three "supersede" fields to `skill_ratings`, mirroring the three void fields exactly.** A rating correction is a new row that supersedes the previous one; the previous row stays and gains three fields that record who superseded it, when, and with which new row.

| Field (nullable, all three set together or all null) | Notes |
|---|---|
| `superseded_at timestamptz` | Mirror of `voided_at`. |
| `superseded_by uuid NOT NULL REFERENCES profiles(id)` | The coach who wrote the correction. |
| `superseded_by_rating_id uuid NOT NULL REFERENCES skill_ratings(id)` | Forward link to the correction row. |

The new (correction) row carries one forward-reference column: `supersedes_rating_id uuid NULL REFERENCES skill_ratings(id)`. Together the two directions form a doubly-linked chain: the predecessor's three supersede fields point forward to the successor, and the successor's one `supersedes_rating_id` points back. Both constraints are set in the same transaction and are consistent via a `supersede_fields_consistent` CHECK on the predecessor.

The correction row keeps `session_id = original.session_id` — ratings do not move between sessions. If a coach really needs to move a rating, the correct action is to void the rating in the old session and re-rate in the new session.

`rated_at` on the correction equals the original `rated_at`. Observation time is preserved; correction time lives on the new row's `created_at` and in the audit log row. Score history and all time-indexed charts therefore place the corrected value at the moment of observation, not at the moment of correction.

**The DB `skill_ratings_append_only` trigger (migration 0020) permits the three new supersede columns.** The trigger is updated to allow writes to `superseded_at`, `superseded_by`, `superseded_by_rating_id`, and the existing `updated_at` on `skill_ratings`. Every other column stays locked after insert.

### 2. Session metadata is editable in place

**No session chain, no supersede columns on `evaluation_sessions`, no new session rows per edit.** A session metadata edit is one `UPDATE` on the existing session row, plus one `household_audit_log` row recording each changed field's previous and new value — both in the same transaction. The columns coaches may edit are:

- `session_date`
- `context`
- `coaching_priority`
- `breathing_pattern`

Columns coaches may never edit:

- `swimmer_id`, `coach_id`, `screen_slug`, `category_id` — these define what the session is. A wrong swimmer or screen is a wrong session; the correct action is to void every rating in that session and create a new session via the normal flow.
- `id`, `created_at` — identity and the row's creation moment.
- `updated_at` — Drizzle's `$onUpdateFn` manages this on every write.

**`evaluation_sessions_immutable_columns` trigger (new in this ADR; replaces the "immutable after creation" English rule from ADR 022).** A `BEFORE UPDATE FOR EACH ROW` trigger raises an exception if `swimmer_id`, `coach_id`, `screen_slug`, `category_id`, `id`, or `created_at` changes on an UPDATE. This is symmetric to `skill_ratings_append_only` but inverted in spirit: ratings lock everything except the three void fields and the three supersede fields; sessions lock only the identity columns and allow metadata edits.

### 3. One `edited_at` column on `evaluation_sessions`, bumped by both paths

**`evaluation_sessions.edited_at timestamptz NULL`.** Written to `now()` in two places:

- The session metadata UPDATE path, whenever any editable column actually changes.
- The rating correction INSERT path, on the rating's parent session.

Both writes sit inside the same `db.transaction()` as the row they describe. A session is `edited` when `edited_at IS NOT NULL`; the API returns this as a boolean. The UI renders the "Edited" pill from this flag directly.

**Alternative considered: compute `edited` from the audit log and from the ratings table at read time.** Rejected because it requires a per-row EXISTS subquery against `household_audit_log` plus an EXISTS over `skill_ratings` (checking whether any rating in the session has `superseded_at IS NOT NULL` or `supersedes_rating_id IS NOT NULL`). The two EXISTS subqueries fire on every evaluations-list read and the result is a boolean — exactly the shape a cached column stores better. The `edited_at` column is one timestamp column, written exactly where corrections happen, and read directly by callers.

The audit log remains authoritative for what changed. `edited_at` is a presentation signal, not an audit trail.

### 4. Reading corrected data

**Append-only filter extension.** `latestEffectiveRatings` in `packages/shared/src/lib/dependencyMap.ts` already filters by `voidedAt === null`. Extend the filter to **also skip `supersededAt !== null`** in the same place. One line, same semantics. Every downstream calculator (`calculateStartGrade`, `headPositionOverall`, category rollups, `computeScoreHistory`, `findDeepestLowFoundation`) consumes this function, so corrections propagate without any further code changes.

The golf-score trends endpoint at `apps/api/src/routes/evaluations.ts:711` filters directly: `isNull(skillRatings.voidedAt)` becomes `and(isNull(skillRatings.voidedAt), isNull(skillRatings.supersededAt))`. The parent progress route's existing EXISTS subquery for "session has at least one non-voided rating" (`apps/api/src/routes/parentProgress.ts:81`) similarly gains `AND superseded_at IS NULL`.

**No leaf join for session metadata.** Session metadata is current by construction — the row holds the latest values. Reads join `skill_ratings → evaluation_sessions` by `rating.session_id = session.id` as they do today, with no second join. This is the main simplification over an earlier draft of this ADR that proposed a session supersede chain with a `root_session_id` leaf-join rule.

### 5. One `PATCH /coach/sessions/:id` endpoint

The handler accepts the full desired state of the session (date, context, coaching priority, breathing pattern, ratings) and does the diff on the server. In one `db.transaction()`:

1. If any session metadata column actually differs, `UPDATE evaluation_sessions SET ... , edited_at = now() WHERE id = :id`.
2. For each rating diff, `INSERT INTO skill_ratings` with `supersedes_rating_id = oldRating.id`, `session_id = original.session_id`, `rated_at = oldRating.rated_at`, and the corrected fields; `INSERT` the new fault-tag rows; `UPDATE` the old rating's three supersede fields; `UPDATE evaluation_sessions SET edited_at = now()` on the parent session (idempotent with step 1).
3. `INSERT household_audit_log` with action `evaluation_edited`, `target_swimmer_id = session.swimmer_id`, and a payload that lists field-level diffs with previous and new values for session metadata, plus a list of superseded rating ids and the specific fields each correction changed.

A no-op PATCH (nothing changed) is a `200` with `writeCount: 0` and skips the transaction. The CLAUDE.md audit-log rule applies: the audit insert sits inside the same `db.transaction()` as the correction writes.

### 6. Scope

- **No time limit on corrections.** The 10-minute undo window from ADR 022 is a hard-delete window for accidental taps and stays unchanged. Corrections are soft, auditable, and reversible, so no clock is needed.
- **Parents see the current effective state only, with no edit indicator.** `ParentSwimmerProgressResponse` is unchanged in shape. The leaf-join rule from the earlier draft is gone — parents read session metadata directly from the (now-mutable) `evaluation_sessions` row, and ratings via the existing `latestEffectiveRatings` filter extension.
- **Parents cannot edit.** Edit mode is a coach-only flow; the parent progress page does not surface the Edit action.
- **Only the creating coach may edit.** Enforced by the API gate (`req.profile.id === session.coach_id`). Not enforced in the DB because the pattern mirrors the existing void endpoint's identity check.
- **Rating-correction chain depth is unbounded in schema and bounded in UI.** The DB allows any chain depth — edit1 can be edited into edit2, into edit3, and so on. The UI never shows more than the leaf and the pre-correction value underneath; the full chain is surfaced only in a coach-only "Edit history" affordance that walks the `supersedes_rating_id` back-references.

## Amendment to ADR 022

Section 2 of ADR 022 said: "Session metadata is immutable after creation." That rule is amended by this ADR as follows:

> `evaluation_sessions` rows are editable in place for the four metadata columns `session_date`, `context`, `coaching_priority`, and `breathing_pattern`. The columns `swimmer_id`, `coach_id`, `screen_slug`, `category_id`, `id`, and `created_at` remain immutable after insert and are enforced by the `evaluation_sessions_immutable_columns` BEFORE UPDATE trigger. Every metadata edit writes a `household_audit_log` row inside the same transaction, recording the previous and new value for each changed field. `edited_at` is set on the row by the same UPDATE.

Section 1 of ADR 022 ("Ratings are append-only (except the three void fields)") stands with one extension: the append-only trigger permits three additional columns — `superseded_at`, `superseded_by`, `superseded_by_rating_id` — on the predecessor row of a correction, exactly symmetric to the three void fields.

Section 3 ("Void keeps the row; voided ratings are excluded from all calculations") stands as written. The filter extension in this ADR adds "or superseded" to the same filter and does not touch void semantics.

## Alternatives considered

- **Mutable rating rows with a shadow `skill_rating_history` table.** Rejected on the same grounds as ADR 022: two tables are harder to query than one append-only table with a chain field. The supersede chain reuses the void-fields pattern and keeps every observation in one place.
- **A dedicated `evaluation_corrections` table that records diffs for ratings.** Rejected — a diff table loses the full observation. The row-per-observation model keeps every corrected version queryable in its own right (useful for future "show me every grade this skill ever had, including the ones we edited" surfaces).
- **Session supersede chain mirroring the rating supersede chain.** Rejected — session metadata is bookkeeping on top of an already-committed observation, not an observation itself. Mirroring the chain pattern would require either cloning every rating per metadata edit (expensive) or a `root_session_id` leaf-join rule on every session read (an extra join on hot paths). An in-place UPDATE with an audit log row is strictly simpler and produces the same user-visible outcome.
- **In-place UPDATE on rating rows too, with the audit log carrying the before/after.** Rejected on the same grounds ADR 022 used to reject mutable grades: the row-per-observation model is the simplest data structure that preserves the full history for calculations ("what did the chart look like at the moment I rated this?"). An audit-log-only history for ratings would force every chart that walks `rated_at` to also consult the audit log.
- **Compute the `edited` flag at read time instead of storing `edited_at`.** Rejected — the computation requires two EXISTS subqueries (one against the audit log, one against the ratings table filtered by supersede columns). For a boolean that renders a pill, a nullable timestamp column is cheaper and clearer.
- **Allow editing `screen_slug` on `evaluation_sessions`.** Rejected — the screen defines which skills are ratable in the session. Editing it would retroactively mark ratings as "orphaned from the wrong screen" or require re-pointing them, neither of which is useful. A wrong screen is a wrong session.
- **Allow editing `swimmer_id` or `coach_id`.** Rejected — these are identity. Editing them silently reassigns an observation to a different person.
- **Hard cap rating chain depth at 1 (one correction per original).** Rejected — a coach correcting the same rating twice would need to void their previous correction and start over, which is strictly worse UX for no gain. The DB supports arbitrary depth; the UI never shows more than the leaf and the pre-correction value.

## Consequences

- **One migration adds supersede columns to `skill_ratings`, the `edited_at` column to `evaluation_sessions`, one partial index, the `evaluation_sessions_immutable_columns` trigger, and relaxes the existing `skill_ratings_append_only` trigger.** No backfill — every existing session leaves `edited_at` null; every existing rating leaves the three supersede columns null.
- **`latestEffectiveRatings` gains one line.** The void filter becomes a "void or supersede" filter.
- **Session metadata reads are unchanged in query shape.** Every join from `skill_ratings → evaluation_sessions` reads the row directly; metadata is current by construction.
- **Score history and progress charts automatically reflect rating corrections** because they consume the `latestEffectiveRatings` output. The coach's existing "golf score" trend already filters by `voided_at`; the new filter sits beside it.
- **Parent-facing routes are unchanged in shape.** The leaf-join concern from the earlier draft is gone; parents read session metadata from the single `evaluation_sessions` row and ratings via the existing filter path.
- **A full history view (coach-only) is a new route** that walks a rating chain back from a leaf. It is not required for the first release; the per-rating "Edited" badge plus the pre-correction value in the per-skill expand are enough for day one.
- **No time limit on corrections**, matching the no-time-limit void rule.
- **The 10-minute hard-delete window from ADR 022 is unchanged.** Accidental taps still delete; corrections are the fallback for everything older.
- **ADR 022's section 2 is amended.** Future readers should treat the ADR 022 rule "session metadata is immutable" as superseded by the amendment at the top of this ADR.
