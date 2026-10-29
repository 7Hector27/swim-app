# Plan: Editing past evaluations

**Status:** Planning
**Branch:** `feature/edit-evaluations`
**ADR:** [032 — Correction rows for editing evaluations](../decisions/032-correction-rows-for-editing-evaluations.md)
**Companion:** [`docs/reference/grading-model.md`](../reference/grading-model.md)

---

## Overview

A past evaluation gains an Edit action that opens that evaluation pre-filled on the Evaluate page. Saving writes a **correction row** (new session row and/or new rating rows) that supersedes the previous value. Originals stay in the table forever; calculations use the correction. The coach swimmer page lists past evaluations (not just the latest few) with an "Edited" label on any session whose metadata or ratings have been corrected, and the progress page links into the same edit flow from the hero chart's selected point and from each skill's expanded history. Parents see the corrected values with no edit indicator — the chain is coach-only.

Scope is coach-only. Parent progress and golf-score trends gain the "or superseded" filter alongside their existing void filter, so they automatically read the leaf; nothing new surfaces in `ParentSwimmerProgressResponse`.

---

## Scope

**In:**
- Edit a rating's grade, side, fault tags, measured value (capacity, measurement, golf-score category), note, and `not_legal` / `no_concept` flags.
- Edit a session's `session_date`, `context`, `coaching_priority`, and `breathing_pattern`.
- "Edited" label on sessions and on per-skill history points when any correction has been written against them.
- Full past-evaluations list at `/coach/swimmers/[id]/evaluations` with the Edit action and the Edited label.
- Edit entry from the progress page: selected point on the Head position overall hero chart, selected point on a start progression, selected point on a golf-score card, and the per-skill expanded `SkillChart` history.
- Return-to redirect after save so the coach lands back where they started.
- Audit log row (`household_audit_log` action `evaluation_edited`) per correction, inside the same transaction as the row writes.
- Score-history, head-position overall, category rollups, start grade progression, and the per-skill `SkillChart` all read corrections automatically via `latestEffectiveRatings`.

**Out:**
- Editing `screen_slug`, `swimmer_id`, `coach_id`, or `category_id`. A wrong screen or wrong swimmer is a wrong session entirely; void + re-create is the correct action.
- Parent-facing surfacing of the edit chain or the "Edited" label.
- A time limit on corrections. The 10-minute hard-delete window from ADR 022 is unchanged.
- SMS / push alerts to the parent when a past rating is corrected. Edits are a bookkeeping action; silently reflecting them in the parent view is intentional.
- Bulk edit of many sessions in one action.
- Diff-visualizer tooling. The pre-correction value appears under the leaf value on the full-history view; a per-field diff over time is a future enhancement.

---

## Data model changes

One migration, no backfill. Every existing row leaves the four new columns null and is implicitly its own root.

### `skill_ratings`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `superseded_at` | `timestamptz` | yes | — | Set together with the two columns below when a correction supersedes this row. |
| `superseded_by` | `uuid` | yes | — | FK → `profiles.id` (`ON DELETE RESTRICT`). The coach who wrote the correction. |
| `superseded_by_rating_id` | `uuid` | yes | — | FK → `skill_ratings.id` (`ON DELETE RESTRICT`). Forward link to the correction row. |
| `supersedes_rating_id` | `uuid` | yes | — | FK → `skill_ratings.id` (`ON DELETE RESTRICT`). Backward link; set on the correction row only. |

Constraints and triggers:
- `supersede_fields_consistent` CHECK: all three predecessor-side columns set together, or all null. Mirror of `void_fields_consistent`.
- `skill_ratings_append_only` trigger (migration 0020) extended to permit writes to `superseded_at`, `superseded_by`, `superseded_by_rating_id`, and the existing `updated_at`.
- Partial index on `(supersedes_rating_id) WHERE supersedes_rating_id IS NOT NULL` so the full-history view can walk forward.

### `evaluation_sessions`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `superseded_at` | `timestamptz` | yes | — | Same role as on `skill_ratings`. |
| `superseded_by` | `uuid` | yes | — | FK → `profiles.id`. |
| `superseded_by_session_id` | `uuid` | yes | — | FK → `evaluation_sessions.id`. |
| `supersedes_session_id` | `uuid` | yes | — | FK → `evaluation_sessions.id`. Set on the correction row only. |
| `root_session_id` | `uuid` | yes | — | FK → `evaluation_sessions.id`. Null on the root; on every correction row in a chain this points to the chain's root. Lets rating reads join leaves to the root in one hop. |

Constraints and triggers:
- `supersede_fields_consistent` CHECK: same shape as on `skill_ratings`.
- `root_session_id_matches_predecessor` CHECK: `(supersedes_session_id IS NULL AND root_session_id IS NULL) OR (supersedes_session_id IS NOT NULL AND root_session_id IS NOT NULL)`.
- `evaluation_sessions_append_only` trigger (added in this PR; symmetric to the ratings trigger — ADR 022's "sessions are immutable" rule applied in SQL rather than only in English). Writes to `superseded_at`, `superseded_by`, `superseded_by_session_id`, and `updated_at` are allowed; every other column is locked after insert.
- Partial index on `(root_session_id) WHERE superseded_at IS NULL` so leaf lookups by root are O(log n).
- Partial index on `(swimmer_id, superseded_at)` WHERE `superseded_at IS NULL` so the "evaluations for this swimmer, newest first" query stays cheap.

### Fault tags

`rating_fault_tags` is unchanged. Correction rows get their own fault-tag rows via normal inserts. The old rating's fault tags stay in place (the old rating stays in the table).

### Rules of the chain

- A rating correction keeps `session_id = root.id` (the chain's root). Ratings do not move between sessions. If a coach really needs to move a rating, the correct action is to void the rating in the old session and re-rate in the new session.
- A session metadata correction never clones rating rows. One session metadata edit writes exactly two rows: one new session, one UPDATE on the leaf.
- `rated_at` on a rating correction equals the predecessor's `rated_at`. Observation time is preserved; correction time lives on the new row's `created_at` and in the audit log row.
- A correction can itself be edited. The chain is unbounded in schema and shown in full only in the coach-only "Edit history" affordance; the main surfaces always show the leaf.

---

## Reading corrected data

### Append-only filter extension

`latestEffectiveRatings` in `packages/shared/src/lib/dependencyMap.ts` already filters by `voidedAt === null`. Extend the filter to **also skip `supersededAt !== null`** in the same place. One line, same semantics. Every downstream calculator (`calculateStartGrade`, `headPositionOverall`, category rollups, `computeScoreHistory`, `findDeepestLowFoundation`) consumes this function, so corrections propagate without any further code changes.

The golf-score trends endpoint at `apps/api/src/routes/evaluations.ts:711` filters directly: `isNull(skillRatings.voidedAt)` becomes `and(isNull(skillRatings.voidedAt), isNull(skillRatings.supersededAt))`.

The parent progress route's existing EXISTS subquery for "session has at least one non-voided rating" (`apps/api/src/routes/parentProgress.ts:81`) similarly gains the superseded check: `voided_at IS NULL AND superseded_at IS NULL`. The session metadata read in the same route joins to the leaf (see below).

### Leaf join for session metadata

Every read that currently joins `evaluation_sessions` by `rating.session_id` gains a second join to the leaf:

```sql
JOIN evaluation_sessions root ON root.id = skill_ratings.session_id
LEFT JOIN evaluation_sessions leaf
  ON leaf.root_session_id = root.id
  AND leaf.superseded_at IS NULL
```

Reads use `COALESCE(leaf.session_date, root.session_date)` etc. When the chain has one node (root with no corrections), the LEFT JOIN finds nothing and the coalesce falls back to the root. When the chain has more than one node, the leaf wins. The partial index on `(root_session_id) WHERE superseded_at IS NULL` keeps this cheap.

Call sites that need the update (one per PR follow-up patch):
- `apps/api/src/lib/progressCalculation.ts` — session date and context on each history point.
- `apps/api/src/routes/evaluations.ts` — golf-score trends, score history, deeper dependency-map suggestion.
- `apps/api/src/routes/parentProgress.ts` — latest coaching note per screen and latest coaching priority.
- `apps/api/src/lib/scoreHistory.ts` — the `session_date` column feeding the per-point x-axis.
- `apps/api/src/routes/evaluations.ts` for the "evaluations list" response (new PR, see below).

The web client never reads sessions directly today; all displays flow from the responses above.

### Computed "edited" flag

A session is `edited` when any of:
- `supersedes_session_id IS NOT NULL`, or
- any rating with `session_id = root.id` has `superseded_at IS NOT NULL` or `supersedes_rating_id IS NOT NULL`.

A rating point is `edited` when `supersedes_rating_id IS NOT NULL` (i.e., the point visible to the UI is a correction leaf — the pre-correction row sits underneath). Both flags are computed by the server at response build time and included as a boolean on each row of the evaluations list response, and as a per-rating boolean on each history point in `SwimmerProgressResponse["skills"][number]["history"]`.

The "pre-correction value" for the full-history affordance walks `supersedes_rating_id` backward; the per-skill `SkillChart` surfaces this on expand (see UI).

---

## API

### `GET /coach/swimmers/:id/evaluations`

New route. Returns a paginated list of a swimmer's evaluation sessions, newest first. The response is driven by the leaf join rule above — each item represents one session chain.

```ts
GetEvaluationsResponse = {
  evaluations: Array<{
    sessionId: string;       // leaf id
    rootSessionId: string;   // root id, used as the stable identifier for links and edit
    screenSlug: string;
    screenName: string;      // resolved from SCREEN_NAMES
    sessionDate: string;     // leaf's date
    context: "drill" | "practice" | "race";
    coachingPriority: string | null;  // leaf's priority
    ratingCount: number;     // non-voided, non-superseded ratings only
    edited: boolean;
    editedAt: string | null; // leaf's created_at when edited=true, else null
    createdAt: string;       // root's created_at (when the observation happened)
  }>;
  // Simple cursor pagination keyed by (sessionDate, rootSessionId) so a
  // tie-break on same-date corrections is deterministic.
  nextCursor: string | null;
};
```

Query params: `?limit=20&cursor=<opaque>`. Default limit 20, max 100. Entirely coach-only; mounted under the existing `coachRouter.use("/swimmers", evaluationsRouter)` chain so the `requireUser` + `requireCoach` middleware already covers it.

### `GET /coach/sessions/:id`

New route. Returns one session's full state for pre-fill. `:id` may be the root id or any node in the chain — the handler resolves to the leaf. Shape:

```ts
GetSessionResponse = {
  sessionId: string;        // leaf id (same as :id when caller passed the leaf)
  rootSessionId: string;
  screenSlug: string;
  swimmerId: string;
  categoryId: string | null;
  sessionDate: string;
  context: "drill" | "practice" | "race";
  coachingPriority: string | null;
  breathingPattern: BreathingPattern | null;
  edited: boolean;
  ratings: Array<{
    ratingId: string;        // leaf rating id
    rootRatingId: string;    // the original rating id (equal to ratingId when never corrected)
    skillId: string;
    slug: string;
    grade: 1 | 2 | 3 | 4 | 5 | null;
    notLegal: boolean;
    noConcept: boolean;
    side: "left" | "right" | null;
    capacityValue: string | null;
    capacityUnit: CapacityUnit | null;
    measurementValue: string | null;
    measurementUnit: MeasurementUnit | null;
    golfScoreCategory: GolfScoreCategory | null;
    note: string | null;
    faultTags: string[];
    ratedAt: string;         // preserved observation time
    edited: boolean;         // true when this rating is a correction leaf
  }>;
};
```

Only non-voided, non-superseded ratings are returned; the caller sees the current effective state, which is what pre-fill needs. Voided ratings are not in scope for edit — a voided rating is already a decision; re-rating is the correct way to add a new observation.

### `PATCH /coach/sessions/:id`

New route. Accepts the full desired state (same shape as the pre-fill, minus the `edited` flags and `rootRatingId`), diffs it against the current effective state, and writes the correction rows atomically. The request body:

```ts
PatchSessionBody = {
  sessionDate: string;
  context: "drill" | "practice" | "race";
  coachingPriority: string | null;
  breathingPattern: BreathingPattern | null;
  ratings: Array<{
    ratingId: string;         // leaf id as returned by GET /coach/sessions/:id
    grade: 1 | 2 | 3 | 4 | 5 | null;
    notLegal: boolean;
    noConcept: boolean;
    side: "left" | "right" | null;
    capacityValue: string | null;
    capacityUnit: CapacityUnit | null;
    measurementValue: string | null;
    measurementUnit: MeasurementUnit | null;
    golfScoreCategory: GolfScoreCategory | null;
    note: string | null;
    faultTags: string[];
  }>;
};
```

Handler:

1. Resolve `:id` to the leaf and verify `leaf.coachId === req.profile.id` (enforce "only the creating coach can edit"). 404 if not found; 403 if the caller is a different coach.
2. Load the leaf and all non-voided, non-superseded ratings tied to the chain's root.
3. Compute per-field diffs for session metadata and per-rating diffs.
4. If the diff is empty, return `200 { sessionId: leaf.id, rootSessionId: leaf.rootSessionId ?? leaf.id, writeCount: 0 }` and skip the transaction. Idempotent re-saves write nothing.
5. Open `db.transaction()`:
   - If session metadata differs: INSERT new `evaluation_sessions` row with `supersedes_session_id = leaf.id`, `root_session_id = leaf.rootSessionId ?? leaf.id`, same `swimmer_id`, `coach_id`, `category_id`, `screen_slug` as the leaf. UPDATE leaf's three supersede fields. `created_at` on the new row is `now()`.
   - For each rating diff: INSERT new `skill_ratings` row with the corrected columns, `session_id = root.id`, `supersedes_rating_id = oldRating.id`, `rated_at = oldRating.ratedAt`. INSERT `rating_fault_tags` for the new rating's fault tag list. UPDATE the old rating's three supersede fields.
   - INSERT one `household_audit_log` row with action `evaluation_edited`, `target_swimmer_id = swimmerId`, and a payload describing the field-level diff (schema below). The payload names fields but does not carry note bodies, to keep audit size bounded.
6. Return `{ sessionId: newLeafId, rootSessionId, writeCount }`.

**Audit payload shape:**

```ts
{
  rootSessionId: "...",
  previousLeafSessionId: "...",
  newLeafSessionId: "...",      // null when no metadata edit
  sessionFieldsChanged: ["sessionDate", "coachingPriority"],  // just the field names
  ratingsChanged: [
    { ratingId: "old-id", newRatingId: "new-id", fieldsChanged: ["grade", "faultTags"] }
  ]
}
```

Validation (reused from the existing session create flow):
- `grade_xor_no_concept`, `not_legal_requires_grade`, `capacityValue`/`capacityUnit` pairing, `measurementValue`/`measurementUnit` pairing, `golfScoreCategory` required on `score`-type skills unless `noConcept = true`, `side` set only on `rated_per_side = true` skills — all re-run from `packages/shared/src/schemas/evaluations.ts` so there's one validator.
- `coachingPriority !== ''` (empty string normalizes to `null`).

Error responses:
- `404` if the session doesn't exist, if the leaf's `coachId !== req.profile.id`, or if any `ratingId` in the body doesn't belong to this chain.
- `409` if any `ratingId` in the body has `supersededAt !== null` (the client must fetch the leaf and resubmit — this is the "stale edit tab" case).
- `422` on any validation failure, with `issues` from the Zod error same as the create flow.

### `GET /coach/sessions/:id/history` (follow-up PR)

Coach-only history walk. Returns every node in the chain from the current leaf back to the root, each with its metadata and ratings. Used by the "Edit history" affordance on the evaluations list and on the per-skill expanded chart. Not required for the first PR — a session's "edited" badge + the pre-correction value in the per-rating expand are enough to ship the loop.

### Shared schemas (`packages/shared`)

Add to `packages/shared/src/schemas/evaluations.ts`:

- `GetEvaluationsItemSchema`, `GetEvaluationsResponseSchema`.
- `GetSessionRatingSchema`, `GetSessionResponseSchema`.
- `PatchSessionRatingBodySchema`, `PatchSessionBodySchema`.
- Reuse existing `RatingInputSchema`'s `.superRefine()` validators by extracting the per-rating body shape into a helper.

Add to `apps/web/src/lib/api/evaluations.ts`:

- `fetchSwimmerEvaluations(swimmerId, cursor?)` → `GetEvaluationsResponse`.
- `fetchSession(sessionId)` → `GetSessionResponse`.
- `patchSession(sessionId, body)` → `{ sessionId, rootSessionId, writeCount }`.

---

## UI

### Entry point: `/coach/swimmers/[id]`

The current "Recent evaluations" section (`apps/web/src/content/CoachSwimmerDetailContent/CoachSwimmerDetailContent.tsx:820`) is replaced with "Evaluations":

- Lists the 5 most recent sessions, newest first, each a row with:
  - Session date (leaf's) in bold.
  - Screen name (resolved from `SCREEN_NAMES`).
  - Rating count (non-voided, non-superseded).
  - Coaching priority (leaf's), truncated to one line.
  - "Edited" pill next to the date when `edited === true`. The pill uses the muted token (`--color-border` background, `--color-text` foreground) — this is a neutral status, not a warning.
  - An `Edit` affordance on the right side of the row (icon + text on tablet+, icon-only on phone), min-tap 44px. Href: `/coach/swimmers/[id]/evaluate?editSession=<rootSessionId>&returnTo=/coach/swimmers/[id]`.
- A "See all evaluations" link under the list that opens `/coach/swimmers/[id]/evaluations`.
- Shows a plain "No evaluations yet" state when the swimmer has none.

The data source is the new `GET /coach/swimmers/:id/evaluations` endpoint (not the timeline-derived grouping used today). Replacing the derivation also fixes the "ratingCount is bucketed from `rating_note` timeline items" shortcut noted in a comment on the current implementation.

### Full list: `/coach/swimmers/[id]/evaluations`

New route. Server component. Fetches the first page from `GET /coach/swimmers/:id/evaluations` and renders a scrollable list. Items match the row shape on the detail page; a cursor-based "Load more" button at the bottom fetches the next page. No filters in the first PR — the list is reverse-chronological and typically short enough to scroll. Filters by screenSlug and by date range are a follow-up when the list grows past one screen regularly.

Mobile: full-width stacked rows. Tablet+: two columns (date + screen on the left, priority + ratings on the right, Edit on the far right). Design tokens only; `WaveDivider` not needed because this is a plain list inside the existing coach surface.

### Edit mode: `/coach/swimmers/[id]/evaluate?editSession=<id>`

The Evaluate page gains an edit mode when the URL carries `editSession`. On arrival:

1. Server pre-fetch calls `GET /coach/sessions/<editSession>` alongside the existing screens + prev-grades fetches.
2. If the fetched session's `coachId !== auth.coach.id`, the page 404s via `notFound()`.
3. The response pre-fills:
   - `screenSlug` on the Session setup form, locked (the Screen picker renders as a read-only pill with the screen name — screen can't change in an edit).
   - `sessionDate`, `context`, `coachingPriority`, `breathingPattern` in the Session setup form, all editable.
   - Each rating row with grade, side, not legal / no concept, measured values, golf score category, note, and fault tags.
4. The page's existing localStorage draft-restore logic is skipped for edit mode (no `evaluate-draft-meta-<swimmerId>` key is read or written when `editSession` is set). Edit mode is a one-shot form; a half-filled edit is not persisted locally. The server draft banner is also hidden.
5. The submit button says "Save changes" instead of "Save evaluation." It POSTs to `PATCH /coach/sessions/<editSession>`.
6. After a successful save: redirect to the sanitized `returnTo` query param (same `isSafeReturnTo` helper used by signup), or fall back to `/coach/swimmers/<swimmerId>` if `returnTo` is missing or unsafe. The UndoToast does not render in edit mode — the server already preserves the pre-correction row for recovery via a second edit.
7. If the server returns `409 stale`, the page re-fetches `GET /coach/sessions/<editSession>` and surfaces a one-line banner: "This evaluation was edited elsewhere. Review and save again."
8. Pre-save validation and section-tab navigation reuse the existing logic in `EvaluateContent.tsx`; the only behavior changes are the four points above.

The `?skill=<slug>` deep-link from the progress page already supported there continues to work: when `editSession` and `skill` are both present, the page opens in edit mode and scrolls to the matching skill (same effect as today for new evaluations). This is the "edit this rating" entry point from a chart point.

### Progress page: `/coach/swimmers/[id]/progress`

- **Hero chart point**: the selected-point detail line underneath `HeroTrendChart` already shows "{date} · grade N". Add an "Edit this evaluation" link next to it. The link opens `/coach/swimmers/[id]/evaluate?editSession=<rootSessionId>&returnTo=/coach/swimmers/[id]/progress`. The session id for a given chart point comes from the extended `ScoreHistoryPointSchema` (new field `rootSessionId` carrying the primary session for that date — when multiple sessions share a date, the latest one is the primary; the full-history affordance on the sessions list is the fallback).
- **Start progression**: same affordance on the selected point.
- **Golf-score card**: same affordance on the selected point. The underlying `GolfScoreTrendPoint` already carries `ratedAt` + `sessionDate`; add `rootSessionId` to that shape too (one new field, backward compatible).
- **Per-skill expanded `SkillChart`**: each history point grows a small "Edit" icon that becomes visible on hover (desktop) or tap (phone), linking to the same edit flow with `?skill=<slug>` so the Evaluate form scrolls to that skill. The `SkillChart.tsx:148` dot is already keyboard-focusable; the Edit icon is a sibling button in the point's `<g>` with `tabindex="0"` so it reads next in the tab order.
- **"Edited" indicator**: on the per-skill expanded panel, next to each history point's date in the sr-only accessible table, append " (edited)" when that point's `edited === true`. The visual chart adds a hollow ring around the dot (same accent color, no fill) for points where `edited === true`. The ring is a design-token-friendly way to say "this value replaced a prior reading" without adding color noise.

### "What to work on next" is unchanged

The coaching priorities section already links to the evaluate page via `?skill=<slug>`. Those links continue to open a fresh evaluation; they do not route through edit mode (editing a priority means editing a session, which is a different intent).

### Design tokens, dark mode, no em dashes

Every surface uses the existing tokens from `axiom-aquatics-design`. Dark mode comes from the shared tokens — no hex values in any component. Status pills use `--color-border` + `--color-text` for "Edited" (neutral), and `--color-danger` for the existing voided-row display in the full-history view (coach-only, out of scope for this PR beyond the badge).

---

## PRs

Four PRs. Each depends on the previous.

### PR EV-0: Schema and shared schemas (`apps/api`, `packages/shared`)

Migration adds the four columns per table, the two partial indexes, the `supersede_fields_consistent` CHECK on each table, the `root_session_id_matches_predecessor` CHECK on `evaluation_sessions`, and the `evaluation_sessions_append_only` trigger. Extends the existing `skill_ratings_append_only` trigger to permit the three new supersede columns.

Shared schemas gain `GetEvaluationsItemSchema`, `GetSessionResponseSchema`, `PatchSessionBodySchema`, and the `edited` boolean fields on existing response shapes (`SwimmerProgressResponse["skills"][number]["history"][number].edited`, `ScoreHistoryPoint.rootSessionId`, `StartGradeHistoryPoint.rootSessionId`, `GolfScoreTrendPoint.rootSessionId`).

`latestEffectiveRatings` gains the `superseded_at` filter. One-line change in `packages/shared/src/lib/dependencyMap.ts`, mirrored by a unit test ensuring voided-OR-superseded is one filter.

Unit tests on the migration (schema shape only) and on the extended filter.

### PR EV-1: Read endpoints (`apps/api`)

- `GET /coach/swimmers/:id/evaluations` with the cursor-based pagination.
- `GET /coach/sessions/:id` with the leaf-resolution rule.
- Extend `apps/api/src/lib/progressCalculation.ts`, `apps/api/src/lib/scoreHistory.ts`, `apps/api/src/routes/evaluations.ts` (golf-score trends, dependency map), and `apps/api/src/routes/parentProgress.ts` to join to the leaf session for metadata, and to add the superseded filter alongside the voided filter.
- Expose `edited: boolean` on each `ProgressRatingPoint` in `computeSwimmerProgress`.
- Expose `rootSessionId: string` on each `ScoreHistoryPoint`, `StartGradeHistoryPoint`, and `GolfScoreTrendPoint`.

Integration tests under `apps/api/src/__tests__/integration/`:
- A seeded session with one rating; corrections to the rating via a direct DB write; `GET /coach/swimmers/:id/progress` returns the corrected grade and marks the rating `edited`.
- A session-metadata correction; `GET /coach/sessions/:id` returns the leaf's values; the ratings carry the original observation times.
- Score history after a correction: a past date's score reflects the corrected grade; the point carries the correct `rootSessionId`.
- Parent progress: `latestCoachingPriority` returns the leaf's priority; no `edited` fields appear in the parent response.
- `GET /coach/swimmers/:id/evaluations` paginates correctly; `edited` flags are accurate; ratings count equals non-voided + non-superseded.

### PR EV-2: `PATCH /coach/sessions/:id` and the audit row (`apps/api`)

- Implements the diff + transaction logic from the API section above.
- Writes one `household_audit_log` row per PATCH with the payload shape above, inside the same transaction as the rating / session inserts and updates.
- Adds `fetchSession` and `patchSession` to `apps/web/src/lib/api/evaluations.ts`.

Integration tests:
- Edit a rating's grade: new rating row with `supersedes_rating_id` set, old row with `superseded_at/by/by_rating_id` set, calculations use the new grade.
- Edit a rating's side: a correction with the new side; the old row's side is preserved.
- Edit a rating's fault tags: new rating with its own `rating_fault_tags` rows; old rating keeps its tags.
- Edit a rating's measured value: new `measurement_value`/`measurement_unit` on the correction; old row preserved.
- Edit a session's date: new session row with the new date, `supersedes_session_id` + `root_session_id` set, old session's three supersede fields set, ratings unchanged.
- Edit a session's context: same as above with `context` instead of `session_date`.
- Edit a session's coaching priority: same shape; parent progress's `latestCoachingPriority` now returns the new priority.
- Combined edit (session metadata + two ratings): one new session row + two new rating rows + updates, all in one transaction; the audit row describes both changes.
- No-op edit: no rows written, response is `200` with `writeCount: 0`.
- Stale edit (client submits a rating that was superseded by another tab): `409`.
- Non-owning coach attempts to edit: `404`.
- Attempt to edit a voided rating via the body: the server treats the voided rating as absent — the submitted rating is a fresh entry attached to the chain's root session with no `supersedes_rating_id`, matching the "voided rating is a decision" rule. (Alternative behavior rejected: a 422 on this case blocks a reasonable UX of "re-add this rating after voiding"; the add-as-new-rating semantics is strictly more useful.)
- Edit chain depth 2 (edit a correction): the second correction supersedes the first; the chain's `root_session_id` on the second node points at the root; `latestEffectiveRatings` picks the second correction.
- `household_audit_log` row contents: actor, target swimmer, action `evaluation_edited`, payload describes the fields that changed.

### PR EV-3: UI (`apps/web`)

- `/coach/swimmers/[id]/evaluations` route and the Evaluate link on the detail page.
- Edit mode on `/coach/swimmers/[id]/evaluate` triggered by `?editSession=<id>`, including the sanitized `returnTo` redirect.
- "Edited" pills on the detail page's evaluations list and on the full-list page.
- Edit affordance on the hero `HeroTrendChart`, start progressions, golf-score card, and per-skill `SkillChart` points.
- Hollow-ring styling on edited history points in `SkillChart`.
- Removal of the current timeline-derived "Recent evaluations" grouping and replacement with the new endpoint-driven list on the detail page.

Web unit tests under `apps/web/src/__tests__/`:
- Detail page renders the new evaluations list from a mock `GET /coach/swimmers/:id/evaluations` response.
- "Edited" pill appears when `edited === true` and is absent otherwise.
- Edit button href includes `editSession=<rootSessionId>&returnTo=<current>`.
- Evaluate page in edit mode: when `?editSession=<id>` is present, screen picker is locked, submit button reads "Save changes", draft banner is hidden, localStorage keys are not written.
- Evaluate page `returnTo`: honored when safe, dropped when unsafe (same tests as the signup `returnTo` sanitizer).
- Progress page: hero chart's selected-point detail line shows an Edit link that opens the edit mode with the right session + skill.
- Per-skill `SkillChart` ring styling: a history point with `edited: true` renders a hollow ring; `edited: false` renders a filled dot.
- Full-list page: pagination button fetches the next cursor and appends rows.

### PR EV-4 (follow-up): Full edit history view and extra entry points

- `GET /coach/sessions/:id/history` returning the chain back to the root.
- "Edit history" affordance on each evaluations-list row that opens a drawer showing every prior value with its coach + timestamp. Coach-only.
- Edit affordance on the parent progress page is deliberately not shipped — this stays coach-only forever.

---

## Observations and failure modes

- **Chain depth growth over time.** Chains are expected to stay shallow (0–2 nodes) because a coach edits a session once or twice at most. If a session accumulates a chain depth greater than 10, the audit log row from PR EV-2 is enough to debug. We do not add a `max_chain_depth` CHECK; it would be a hostile constraint if someone genuinely needs it.
- **A correction after a void.** Voiding a corrected (leaf) rating voids the leaf, not the root — the void endpoint resolves `:id` to the leaf first. The old row's void fields remain null; its supersede fields are already set. The chain plus the leaf's void is a correct "this reading was wrong, we tried to correct it, but then voided the correction too" trail.
- **A correction that then gets voided and un-voided.** Un-void doesn't exist. Once a leaf is voided, re-rating from scratch is the correct path; the chain's root is unchanged and new ratings for the same `(skillSlug, side)` sit alongside the chain.
- **Deleting a session is unaffected.** The 10-minute hard-delete endpoint from ADR 022 still cascades to all ratings for that session. If the session is already a chain's root with corrections written against it, the delete endpoint rejects with `409 chain_has_corrections` and the caller must void instead. Covered by one of the EV-2 tests.
- **Timezones.** `sessionDate` is a date-only column with no timezone. All existing day-boundary rules (LA calendar day for cadence buckets, score-history point ordering) continue to hold because the leaf's `sessionDate` is read from the same column, not derived from a timestamp. The audit log row's `createdAt` is a UTC timestamp as before.
- **Draft collisions with edit mode.** A coach with an in-progress draft on the freestyle screen who then clicks "Edit" on a backstroke evaluation sees edit mode render on top of a different screen; the draft is unaffected because edit mode skips the draft read/write entirely. When the coach exits edit mode (back button, returnTo, or submits), the draft remains on freestyle. If the coach clicks "Edit" on a freestyle session while a freestyle draft is active, edit mode still skips the draft; the draft is not merged into the edit form (merging two intents would surprise the coach). Covered by one web unit test.
- **A rating correction with the same values as the original.** The diff step detects this and drops the rating from the write set. If every rating is a no-op and the metadata is unchanged, the entire PATCH is a no-op. The one case where this matters: a coach opens Edit, taps around, and taps Save without changing anything. No rows are written; the audit log is not spammed.
- **A session metadata correction that happens to re-use the previous value in one field.** The diff compares each field individually. Only fields that actually changed appear in the audit log's `sessionFieldsChanged` list, which keeps the audit record truthful.
- **Load.** The leaf join adds one indexed lookup per read. On a swimmer with 100 sessions and 10 ratings per session, the extra cost on the progress endpoint is a single index scan — orders of magnitude under the per-swimmer catalog + rating fetch that already dominates the request.

---

## Open questions

1. **Pre-correction value in `SkillChart`'s sr-only table.** Should the sr-only accessible table show "(edited; was: 3)" next to the current value? Shows the full value swap for screen reader users without a dedicated history view. Low cost, high accessibility value — probably yes, but confirming the format with Jason first.
2. **Should fault-tag edits write the full new list or a diff (added, removed)?** The plan writes the full new list as fresh `rating_fault_tags` rows on the correction. A diff-based approach would be smaller but more complex to render. Default to "full new list"; revisit only if the fault-tag table balloons.
3. **"Edited" pill color token.** The plan uses `--color-border` background + `--color-text` foreground (neutral). An alternative is `--color-accent` tinted (`--color-accent` with low opacity), which would make the pill more visible. Visual judgment call for Jason.
4. **Chain history visibility in the coach swimmer page.** The first PR shows only the leaf. The follow-up (EV-4) adds a drawer. Should the leaf's row carry a chain-depth count ("Edited 2 times") in the first PR? Shows the audit depth at a glance; adds one query. Default to no; add later if the signal is useful.
5. **Edit from the parent-facing progress page?** The ADR says no (coach-only). Jason might eventually want a "flag this to the coach for review" affordance for parents, which is a different feature entirely — a feedback loop, not a correction. Out of scope here.
