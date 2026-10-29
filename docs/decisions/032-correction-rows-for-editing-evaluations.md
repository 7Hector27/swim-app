# 032 — Correction rows for editing evaluations

**Date:** 2026-10-29
**Status:** Accepted

## Context

ADR 022 made `skill_ratings` and `evaluation_sessions` append-only after a 10-minute undo window: wrong ratings are corrected by **voiding** the row and inserting a new one; session metadata (date, context, coaching priority) is **immutable**. In practice Jason discovers wrong grades, missing fault tags, or wrong session dates days or weeks after the fact — long past the 10-minute delete window. The current workflow is "void everything in the bad session, create a fresh session with the right values." That loses the link between the two sessions, inflates the rating-count display on the coach swimmer page, and leaves the coach's score history scattered across two entries with no shared identity.

The goal of this ADR is to let the coach **edit a past evaluation in place** without breaking any of the properties ADR 022 established:

- Ratings stay append-only. The original observation is never mutated.
- The original is always recoverable from the row history (and visible to the coach in a full history view).
- Calculations (`latestEffectiveRatings`, `calculateStartGrade`, `headPositionOverall`, category rollups, `computeScoreHistory`, golf-score trends) use the corrected value with no code duplication.
- Parents see the current effective state (no edit indicator), consistent with how voids are already hidden.

Three constraints shape the design:

- The void mechanism is already a correct, well-tested shape for "this row is still there, calculations skip it, UI can display it in a full history view." A correction is operationally the same thing as a void plus a new row, except we want the two rows **linked** so the UI can render an "Edited" label and show the pre-correction value side by side.
- A session metadata edit should not require cloning every rating in that session. Priority or date changes are frequent; rating edits are not. The two concerns should move independently.
- The 10-minute hard-delete window from ADR 022 must still work for accidental taps. Corrections are the no-time-limit fallback for everything older.

## Decision

**Add three "supersede" fields to `skill_ratings` and `evaluation_sessions`, mirroring the three void fields exactly.** A correction is a new row that supersedes the previous one; the previous row stays and gains three fields that record who superseded it, when, and with which new row.

| Table | Three new fields (nullable, all set together or all null) |
|---|---|
| `skill_ratings` | `superseded_at timestamptz`, `superseded_by uuid NOT NULL REFERENCES profiles(id)`, `superseded_by_rating_id uuid NOT NULL REFERENCES skill_ratings(id)` |
| `evaluation_sessions` | `superseded_at timestamptz`, `superseded_by uuid NOT NULL REFERENCES profiles(id)`, `superseded_by_session_id uuid NOT NULL REFERENCES evaluation_sessions(id)` |

The new (correction) row carries one forward-reference column: `supersedes_rating_id uuid NULL REFERENCES skill_ratings(id)` on `skill_ratings`, `supersedes_session_id uuid NULL REFERENCES evaluation_sessions(id)` on `evaluation_sessions`. Together the two directions form a doubly-linked chain: the predecessor's three supersede fields point forward to the successor, and the successor's one `supersedes_*_id` points back. Both constraints are set in the same transaction and are consistent by a `supersede_fields_consistent` CHECK on the predecessor and an index on the successor.

A new `evaluation_sessions.root_session_id uuid NULL REFERENCES evaluation_sessions(id)` column flattens the chain for queries. The root (original) session has `root_session_id IS NULL`; every correction node in the chain has `root_session_id` set to the root's id. Ratings keep their original `session_id` pointing at the root — the session supersede chain is metadata-only and never touches rating rows. This means a priority-only edit writes exactly two rows (one new session, one update on the old session) regardless of how many ratings were in the original session.

**Calculations drop voided OR superseded rows via one filter.** `latestEffectiveRatings` in `packages/shared/src/lib/dependencyMap.ts` already filters out voided ratings. Extend the filter to also skip rows where `superseded_at IS NOT NULL`, in the same place, with the same semantics. Every downstream calculator (`calculateStartGrade`, `headPositionOverall`, category rollups, `computeScoreHistory`, coaching priorities, `findDeepestLowFoundation`) consumes `latestEffectiveRatings`' output, so each one picks up corrections automatically with no change. The golf-score trends endpoint in `apps/api/src/routes/evaluations.ts` filters by `isNull(skillRatings.voidedAt)` directly; the SQL gains an `AND isNull(skillRatings.supersededAt)` next to it.

**For session metadata reads, join to the leaf.** When reading evaluations for display or calculation, join `skill_ratings` to `evaluation_sessions` by `rating.session_id = root.id`, then join to the leaf by `leaf.root_session_id = root.id AND leaf.superseded_at IS NULL` (or `leaf.id = root.id` when the chain has one node — the root itself). Read `sessionDate`, `context`, `coachingPriority`, `screenSlug`, and `breathingPattern` from the leaf. The join is one extra left-join compared to today's queries; a partial index on `evaluation_sessions(root_session_id) WHERE superseded_at IS NULL` keeps it cheap. Non-metadata fields (`swimmer_id`, `coach_id`, `category_id`, `created_at` of the original observation) stay on the root; the leaf's `created_at` is the correction time.

**The DB `skill_ratings_append_only` trigger (migration 0020) and the equivalent for sessions permit the three new supersede columns.** The trigger is updated to allow writes to `superseded_at`, `superseded_by`, `superseded_by_rating_id`, and `updated_at` on `skill_ratings`, and to the corresponding columns on `evaluation_sessions`. Every other column stays locked after insert. The 10-minute hard-delete window from ADR 022 is unchanged — accidental taps still delete; everything else corrects.

**Corrections are rows in a transaction, not an endpoint per field.** One `PATCH /coach/sessions/:id` endpoint accepts the full desired state of the session (new sessionDate, context, coachingPriority, breathingPattern, ratings[]) and does the diff on the server. The handler:

1. Loads the session chain's leaf (resolving `id → root → leaf`) and all non-superseded ratings tied to the root.
2. Computes a diff between the submitted payload and the current effective state.
3. In one `db.transaction()`:
   - If session metadata differs, insert a new `evaluation_sessions` row with `supersedes_session_id = leaf.id` and `root_session_id = COALESCE(leaf.root_session_id, leaf.id)`, then UPDATE the previous leaf's three supersede fields.
   - For each rating diff, insert a new `skill_ratings` row with `supersedes_rating_id = oldRating.id`, `session_id = root.id`, `rated_at = oldRating.ratedAt` (observation time preserved), and the corrected fields. UPDATE the old rating's three supersede fields. Fault tags for the new rating are inserted as fresh `rating_fault_tags` rows; the old rating's fault tags stay in place.
   - Insert one `household_audit_log` row with action `evaluation_edited` and a payload that lists the diff (field-level, no body content beyond field names).
4. Returns the leaf session id so the client can rebuild its URL state.

The diff step is pure and testable in isolation. A no-op PATCH (nothing changed) returns `200` with the existing leaf id and writes no rows — valid callers naturally produce no-ops on "re-save after review" (same as voids today). The CLAUDE.md audit-log rule applies: the audit insert sits inside the same `db.transaction()` as the correction writes.

**Observation time is preserved on rating corrections; correction time is `created_at` on the new row.** `rated_at` on the correction equals the original `rated_at`. Score history and all time-indexed charts therefore place the corrected value at the moment of observation, not at the moment of correction. This matches ADR 022's definition of `rated_at` as "when the coach observed the skill (may differ from row insert time)." The `created_at` column on the new row records the correction event; the audit log row records the actor and the diff.

**Session metadata edits can change `session_date`, `context`, `coaching_priority`, and `breathing_pattern`.** `screen_slug`, `swimmer_id`, `coach_id`, and `category_id` are not editable — a wrong screen or wrong swimmer is a wrong session entirely and should be voided + re-entered through the normal flow. The leaf session's `swimmer_id` is validated to equal the root's; the DB enforces it with a CHECK that the root reference is only set to a session row with the same swimmer. (The simpler form "no CHECK; trust the API layer and the one `PATCH` endpoint" is sufficient here — the shape is covered by the integration test in part 3 of the plan.)

**No time limit on corrections.** The 10-minute undo window from ADR 022 is a hard-delete window for accidental taps and stays unchanged. Corrections are soft, auditable, and reversible, so no clock is needed. A coach who discovers a wrong grade six weeks later writes a correction row; the audit log carries the actor and timestamp; parents and future calculations see the right value. If this ever causes a problem (e.g., coaches editing far-past ratings in a way that confuses parents), we add a window later as a feature-flagged gate, not a DB constraint.

**Parents see the current effective state only, with no edit indicator.** `ParentSwimmerProgressResponse` is unchanged. The leaf-join rule means parents read the leaf's `coachingPriority` and the latest non-superseded rating per `(skillSlug, side)` — same reads as today, with the superseded filter added. Edit history is coach-only; the audit log row and the `supersedes_*_id` references are not exposed in parent routes. The rationale mirrors ADR 022's rationale for hiding voids from parents: parents care about the swimmer's current level, not the coach's bookkeeping.

**"Edited" is a computed flag, not a stored one.** A session is edited when its `supersedes_session_id IS NOT NULL` OR any rating tied to its root has a non-null `superseded_at` OR a non-null `supersedes_rating_id`. The flag is computed per-row at read time from the already-joined data; no denormalized column, no trigger. The coach-facing session list surface reads it from a single additional field on the response (`edited: boolean`); the per-skill history on the progress page reads it per rating point. Rendering is covered in the plan doc.

**Rating-level `supersedes_rating_id` is cross-session-safe.** The successor's `session_id` is always the root of the predecessor's session chain. A rating correction never changes which session a rating belongs to — if a coach wants to move a rating to a different session, the correct action is to void the rating in the old session and re-rate in the new session. The one-session constraint keeps the chain traversal cheap and avoids a "which session owns this rating now?" question that would otherwise force a per-rating `root_session_id` column.

**Chain depth is unbounded in schema and bounded in UI.** The DB allows any chain depth — edit1 can be edited into edit2, into edit3, and so on. In practice the UI only shows the leaf and the pre-correction value underneath; the full chain is surfaced in a coach-only "Edit history" affordance that walks the `supersedes_*_id` back-references on demand. The API returns the leaf plus a count of chain nodes; callers that need the full history use a separate `GET /coach/sessions/:id/history` endpoint (plan doc part 2).

## Alternatives considered

- **Mutable rating rows with a shadow `skill_rating_history` table.** Rejected on the same grounds as ADR 022: two tables are harder to query than one append-only table with a chain field. The supersede chain reuses the void-fields pattern and keeps every observation in one place.
- **Clone every rating when a session metadata edit happens, so a session always owns its own ratings.** Rejected — a priority typo would write N new rating rows. The `root_session_id` + leaf-join rule gets the same correctness for one row per metadata edit.
- **Store the "edited" flag as a column on `evaluation_sessions`.** Rejected — the flag is a function of the chain and derivable in one query. A stored column drifts and needs a trigger to maintain.
- **A dedicated `evaluation_corrections` table that records diffs.** Rejected — a diff table loses the full observation. The row-per-observation model keeps every corrected version queryable in its own right (useful for future "show me every grade this skill ever had, including the ones we edited" surfaces).
- **Allow in-place UPDATE on session metadata with no supersede chain, and rely on the audit log for history.** Rejected on the same grounds ADR 022 used to reject in-place rating updates — the audit log alone cannot answer "what did the old value look like" without reconstructing from a diff, and we would be building the shadow table of alternative A one hard-to-undo audit entry at a time.
- **Hard cap chain depth at 1 (one correction per original).** Rejected because a coach correcting the same session twice would need to void their previous correction and start over, which is strictly worse UX for no gain. The DB supports arbitrary depth; the UI never shows more than the leaf and the pre-correction value.

## Consequences

- **New migration adds supersede columns, the `root_session_id` column, two partial indexes, and relaxes the two append-only triggers.** One migration file, no backfill (every existing row leaves all four new columns null and remains its own root).
- **`latestEffectiveRatings` gains one line.** The void filter becomes a "void or supersede" filter.
- **Every API read that currently joins `evaluation_sessions` by `rating.session_id` adds a second join to the leaf.** The partial index on `root_session_id WHERE superseded_at IS NULL` makes it a cheap lookup.
- **Score history and progress charts automatically reflect corrections** because they consume the `latestEffectiveRatings` output. The coach's existing "golf score" trend already filters by `voided_at`; the new filter sits beside it.
- **Parent-facing routes are unchanged in shape** and get the leaf's priority / date / context by the same join rule. No new fields appear in `ParentSwimmerProgressResponse`.
- **A full history view (coach-only) is a new route** that walks the chain back from a leaf. Plan doc part 2 specifies it; it is not required for the first PR.
- **No time limit on corrections**, matching the no-time-limit void rule.
- **The 10-minute hard-delete window from ADR 022 is unchanged.** Accidental taps still delete; corrections are the fallback for everything older.
