# Plan: Editing past evaluations

**Status:** Planning
**Branch:** `feature/edit-evaluations` (starts after `feature/progress-charts` merges to `main`)
**ADR:** [032 — Correction rows for editing evaluations](../decisions/032-correction-rows-for-editing-evaluations.md)
**Amends:** ADR 022 — session metadata is no longer immutable (see ADR 032's "Amendment to ADR 022" section).
**Companion:** [`docs/reference/grading-model.md`](../reference/grading-model.md)

---

## Overview

A past evaluation gains an Edit action that opens that evaluation pre-filled on the Evaluate page. Saving writes rating corrections as supersede rows (the void pattern from ADR 022, extended with a forward/backward link), and writes session metadata changes as a plain `UPDATE` on the session row. Originals of corrected ratings stay in the table forever; calculations use the correction. Session metadata changes are preserved in `household_audit_log` with previous and new values per changed field. The coach swimmer page lists past evaluations (not just the latest few) with an "Edited" label on any session whose metadata or ratings have been edited, and the progress page links into the same edit flow from the hero chart's selected point and from each skill's expanded history. Parents see the corrected values with no edit indicator — the chain and the audit log are coach-only.

Scope is coach-only. Parent progress and golf-score trends gain the "or superseded" filter alongside their existing void filter, so they automatically read the current effective rating; nothing new surfaces in `ParentSwimmerProgressResponse`.

---

## Scope

**In:**
- Edit a rating's grade, side, fault tags, measured value (capacity, measurement, golf-score category), note, and `not_legal` / `no_concept` flags, via supersede rows.
- Edit a session's `session_date`, `context`, `coaching_priority`, and `breathing_pattern`, via one in-place `UPDATE` and one audit log row recording previous and new values.
- "Edited" label on sessions, driven by a single `edited_at` timestamp column on `evaluation_sessions`.
- Full past-evaluations list at `/coach/swimmers/[id]/evaluations` with the Edit action and the Edited label.
- Edit entry from the progress page: selected point on the Head position overall hero chart, selected point on a start progression, selected point on a golf-score card, and the per-skill expanded `SkillChart` history.
- Return-to redirect after save so the coach lands back where they started.
- Audit log row (`household_audit_log` action `evaluation_edited`) per PATCH, inside the same transaction as the row writes.
- Score-history, head-position overall, category rollups, start grade progression, and the per-skill `SkillChart` all read rating corrections automatically via `latestEffectiveRatings`.

**Out:**
- Editing `screen_slug`, `swimmer_id`, `coach_id`, or `category_id`. A wrong screen or wrong swimmer is a wrong session entirely; void + re-create is the correct action. Enforced by a `BEFORE UPDATE` trigger on `evaluation_sessions`.
- Parent-facing surfacing of the edit history, the "Edited" label, or an Edit action. Edit mode is coach-only.
- A time limit on corrections. The 10-minute hard-delete window from ADR 022 is unchanged.
- SMS or push alerts to the parent when a past rating is corrected. Edits are a bookkeeping action; silently reflecting them in the parent view is intentional.
- Bulk edit of many sessions in one action.
- A chain-depth count ("Edited 2 times") on the evaluations list.
- A per-field diff visualizer or timeline. The pre-correction value appears under the leaf value on expand; a time-series of every value a skill ever had is a future enhancement.

---

## Data model changes

One migration, no backfill. Every existing session leaves `edited_at` null; every existing rating leaves the three supersede columns null.

### `skill_ratings` (append-only + supersede chain)

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
- Rating correction rows carry `session_id = original.session_id` and `rated_at = original.rated_at`. Ratings do not move between sessions; observation time is preserved.

### `evaluation_sessions` (editable in place)

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `edited_at` | `timestamptz` | yes | — | Set to `now()` by the metadata UPDATE path and by the rating correction INSERT path. Null for untouched sessions. The `edited` boolean on API responses is `edited_at IS NOT NULL`. |

Constraints and triggers:
- `evaluation_sessions_immutable_columns` BEFORE UPDATE trigger (new in this release). Raises an exception if `swimmer_id`, `coach_id`, `screen_slug`, `category_id`, `id`, or `created_at` changes on an UPDATE. All other columns — `session_date`, `context`, `coaching_priority`, `breathing_pattern`, `edited_at`, `updated_at` — are writable.
- No supersede columns on `evaluation_sessions`. No `root_session_id`. No session chain. A metadata edit is one UPDATE; the audit log row records the previous and new value per changed field.

### Fault tags

`rating_fault_tags` is unchanged. Correction rows get their own fault-tag rows via normal inserts. The old rating's fault tags stay in place (the old rating stays in the table). Fault tag edits write the **full new list** on the correction row (we do not compute an add / remove diff) — the whole new list is explicit, easy to render, and matches the shape every other rating field uses.

### Rules

- Rating corrections stay in the same session (`session_id = original.session_id`). If a coach needs to move a rating to a different session, void the rating in the old session and re-rate in the new one.
- Session metadata edits do not touch rating rows. One UPDATE, one audit log row.
- `rated_at` on a rating correction equals the predecessor's `rated_at`. Observation time is preserved; correction time lives on the new row's `created_at` and in the audit log row.
- A rating correction can itself be edited. The chain is unbounded in schema and shown in full only in the coach-only "Edit history" affordance; the main surfaces always show the leaf.

---

## Reading corrected data

### Append-only filter extension

`latestEffectiveRatings` in `packages/shared/src/lib/dependencyMap.ts` already filters by `voidedAt === null`. Extend the filter to **also skip `supersededAt !== null`** in the same place. One line, same semantics. Every downstream calculator (`calculateStartGrade`, `headPositionOverall`, category rollups, `computeScoreHistory`, `findDeepestLowFoundation`) consumes this function, so corrections propagate without any further code changes.

The golf-score trends endpoint at `apps/api/src/routes/evaluations.ts:711` filters directly: `isNull(skillRatings.voidedAt)` becomes `and(isNull(skillRatings.voidedAt), isNull(skillRatings.supersededAt))`.

The parent progress route's existing EXISTS subquery for "session has at least one non-voided rating" (`apps/api/src/routes/parentProgress.ts:81`) gains the superseded check: `voided_at IS NULL AND superseded_at IS NULL`.

### Session metadata reads: no leaf join

Session metadata lives on the single `evaluation_sessions` row and is current by construction. Every join from `skill_ratings → evaluation_sessions` reads `session.session_date`, `session.context`, `session.coaching_priority`, `session.breathing_pattern`, and `session.screen_slug` directly — the same join shape every current reader uses. No `root_session_id`, no leaf-resolution step, no second join.

### Computed "edited" flag

`edited_at` is the one timestamp column on `evaluation_sessions` that drives the flag. It's set to `now()` in exactly two places (both inside their respective transactions):

- The session metadata `UPDATE` path, when any editable column actually changes.
- The rating correction `INSERT` path, on the rating's parent session.

API responses expose `edited: boolean` on each session item (true when `edited_at IS NOT NULL`). The web client never computes `edited` itself.

A per-rating `edited: boolean` is also returned on each history point in `SwimmerProgressResponse["skills"][number]["history"]`, driven by `supersedes_rating_id IS NOT NULL` on the leaf row. The screen-reader table under `SkillChart` reads this per-point flag plus the pre-correction value — see UI below.

Why `edited_at` and not a derived flag: a per-row EXISTS against the audit log plus an EXISTS over `skill_ratings` (for supersede-leaf detection) on every evaluations-list read is strictly more work than a timestamp column written at the exact two transactions that need to set it. The audit log remains authoritative for what changed; `edited_at` is a presentation signal.

---

## API

### `GET /coach/swimmers/:id/evaluations`

New route. Returns a paginated list of a swimmer's evaluation sessions, newest first.

```ts
GetEvaluationsResponse = {
  evaluations: Array<{
    sessionId: string;
    screenSlug: string;
    screenName: string;      // resolved from SCREEN_NAMES
    sessionDate: string;
    context: "drill" | "practice" | "race";
    coachingPriority: string | null;
    ratingCount: number;     // non-voided, non-superseded ratings only
    edited: boolean;         // edited_at IS NOT NULL
    editedAt: string | null; // the row's edited_at
    createdAt: string;       // when the observation happened
  }>;
  nextCursor: string | null;
};
```

Query params: `?limit=20&cursor=<opaque>`. Default limit 20, max 100. Cursor is keyed by `(session_date, session_id)` so corrections on the same date tie-break deterministically. Mounted under the existing `coachRouter.use("/swimmers", evaluationsRouter)` chain so the `requireUser` + `requireCoach` middleware covers it.

### `GET /coach/sessions/:id`

New route. Returns one session's full state for pre-fill. `:id` is the session row's id — no chain resolution. Shape:

```ts
GetSessionResponse = {
  sessionId: string;
  screenSlug: string;
  swimmerId: string;
  categoryId: string | null;
  sessionDate: string;
  context: "drill" | "practice" | "race";
  coachingPriority: string | null;
  breathingPattern: BreathingPattern | null;
  edited: boolean;
  editedAt: string | null;
  ratings: Array<{
    ratingId: string;        // leaf rating id (the one calculations use)
    rootRatingId: string;    // the original rating id — equal to ratingId when never corrected
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
    edited: boolean;         // supersedes_rating_id IS NOT NULL
  }>;
};
```

Only non-voided, non-superseded ratings are returned; the caller sees the current effective state, which is what pre-fill needs. Voided ratings are not in scope for edit — a voided rating is already a decision; re-rating is the correct way to add a new observation.

### `PATCH /coach/sessions/:id`

New route. Accepts the full desired state (same shape as the pre-fill, minus the `edited` flags and `rootRatingId`), diffs it against the current effective state, and writes the corrections atomically. The request body:

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
    faultTags: string[];       // full new list on correction
  }>;
};
```

Handler:

1. Load the session row and all non-voided, non-superseded ratings for it. Verify `session.coachId === req.profile.id` (only the creating coach can edit). 404 if not found; 403 if the caller is a different coach.
2. Compute per-field diffs for session metadata and per-rating diffs. Rating diffs include fault tags via array equality (unordered).
3. If every diff is empty, return `200 { sessionId, writeCount: 0 }` and skip the transaction.
4. Open `db.transaction()`:
   - If any session metadata column differs: `UPDATE evaluation_sessions SET <changed columns>, edited_at = now() WHERE id = :id`. The `evaluation_sessions_immutable_columns` trigger blocks any attempt to update the identity columns.
   - For each rating diff: `INSERT INTO skill_ratings` with `supersedes_rating_id = oldRating.id`, `session_id = oldRating.sessionId`, `rated_at = oldRating.ratedAt`, and the corrected columns. `INSERT INTO rating_fault_tags` the new tag rows. `UPDATE` the old rating's three supersede fields.
   - If any rating correction was written and the metadata UPDATE did not run: `UPDATE evaluation_sessions SET edited_at = now() WHERE id = :id`.
   - `INSERT INTO household_audit_log` one row with action `evaluation_edited`, `target_swimmer_id = session.swimmer_id`, actor = req.profile.id, and the payload below.
5. Return `{ sessionId, writeCount }`.

**Audit payload shape:**

```ts
{
  sessionId: "...",
  sessionFieldsChanged: [
    { field: "sessionDate",       previous: "2026-10-14",       new: "2026-10-15" },
    { field: "coachingPriority",  previous: "Head position",    new: "Catch" }
  ],
  ratingsChanged: [
    { ratingId: "old-id", newRatingId: "new-id", fieldsChanged: ["grade", "faultTags"] }
  ]
}
```

Session fields carry previous and new values explicitly (the UPDATE loses the previous value otherwise). Ratings don't carry previous/new in the payload because the predecessor row is still in the table with its original fields — the chain itself is the before/after record.

Validation (reused from the existing session create flow):
- `grade_xor_no_concept`, `not_legal_requires_grade`, `capacityValue`/`capacityUnit` pairing, `measurementValue`/`measurementUnit` pairing, `golfScoreCategory` required on `score`-type skills unless `noConcept = true`, `side` set only on `rated_per_side = true` skills — all re-run from `packages/shared/src/schemas/evaluations.ts` so there's one validator.
- `coachingPriority !== ''` (empty string normalizes to `null`).

Error responses:
- `404` if the session doesn't exist, if `session.coach_id !== req.profile.id`, or if any `ratingId` in the body doesn't belong to this session.
- `409` if any `ratingId` in the body has `supersededAt !== null` (the client must fetch the leaf and resubmit — this is the "stale edit tab" case).
- `422` on any validation failure, with `issues` from the Zod error same as the create flow.

### `GET /coach/sessions/:id/history` (future, not in this release)

Coach-only history walk for a rating chain. Returns the leaf back to the root for each rating in the session. Not needed for day one — the per-rating "Edited" badge plus the pre-correction value on the per-skill expand are enough. Added if coaches start asking for a full timeline per skill.

### Shared schemas (`packages/shared`)

Add to `packages/shared/src/schemas/evaluations.ts`:

- `GetEvaluationsItemSchema`, `GetEvaluationsResponseSchema`.
- `GetSessionRatingSchema`, `GetSessionResponseSchema`.
- `PatchSessionRatingBodySchema`, `PatchSessionBodySchema`.
- Extract the per-rating body shape used by both the create flow and the PATCH flow into a shared helper so the `.superRefine()` validators run once.

Add to `apps/web/src/lib/api/evaluations.ts`:

- `fetchSwimmerEvaluations(swimmerId, cursor?)` → `GetEvaluationsResponse`.
- `fetchSession(sessionId)` → `GetSessionResponse`.
- `patchSession(sessionId, body)` → `{ sessionId, writeCount }`.

---

## UI

### Entry point: `/coach/swimmers/[id]`

The current "Recent evaluations" section (`apps/web/src/content/CoachSwimmerDetailContent/CoachSwimmerDetailContent.tsx:820`) is replaced with "Evaluations":

- Lists the 5 most recent sessions, newest first, each a row with:
  - Session date in bold.
  - Screen name (resolved from `SCREEN_NAMES`).
  - Rating count (non-voided, non-superseded).
  - Coaching priority, truncated to one line.
  - "Edited" pill next to the date when `edited === true`. Neutral style: `--color-border` background, `--color-text` foreground. Not a warning — the Edited state is informational.
  - An `Edit` affordance on the right side of the row (icon + text on tablet+, icon-only on phone), min-tap 44px. Href: `/coach/swimmers/[id]/evaluate?editSession=<sessionId>&returnTo=/coach/swimmers/[id]`.
- A "See all evaluations" link under the list that opens `/coach/swimmers/[id]/evaluations`.
- Plain "No evaluations yet" state when the swimmer has none.

Data source is the new `GET /coach/swimmers/:id/evaluations` endpoint (not the timeline-derived grouping used today). The replacement also fixes the "ratingCount is bucketed from `rating_note` timeline items" shortcut noted in the current implementation's comment.

### Full list: `/coach/swimmers/[id]/evaluations`

New route. Server component. Fetches the first page from `GET /coach/swimmers/:id/evaluations` and renders a scrollable list. Items match the row shape on the detail page; a cursor-based "Load more" button at the bottom fetches the next page. No filters in the first release — the list is reverse-chronological and typically short enough to scroll. Filters by screenSlug and by date range are a follow-up when the list grows past one screen regularly.

Mobile: full-width stacked rows. Tablet+: two columns (date + screen on the left, priority + ratings on the right, Edit on the far right). Design tokens only.

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
6. After a successful save: redirect to the sanitized `returnTo` query param (same `isSafeReturnTo` helper used by signup), or fall back to `/coach/swimmers/<swimmerId>` if `returnTo` is missing or unsafe. The UndoToast does not render in edit mode — the server preserves the pre-correction row for recovery via a second edit.
7. If the server returns `409 stale`, the page re-fetches `GET /coach/sessions/<editSession>` and surfaces a one-line banner: "This evaluation was edited elsewhere. Review and save again."
8. Pre-save validation and section-tab navigation reuse the existing logic in `EvaluateContent.tsx`; the only behavior changes are the five points above.

The `?skill=<slug>` deep-link from the progress page already supported there continues to work: when `editSession` and `skill` are both present, the page opens in edit mode and scrolls to the matching skill (same effect as today for new evaluations). This is the "edit this rating" entry point from a chart point.

### Progress page: `/coach/swimmers/[id]/progress`

- **Hero chart point**: the selected-point detail line underneath `HeroTrendChart` already shows "{date} · grade N". Add an "Edit this evaluation" link next to it. The link opens `/coach/swimmers/[id]/evaluate?editSession=<sessionId>&returnTo=/coach/swimmers/[id]/progress`. The session id for a given chart point comes from the extended `ScoreHistoryPointSchema` (new field `sessionId` carrying the primary session for that date — when multiple sessions share a date, the latest one is the primary).
- **Start progression**: same affordance on the selected point.
- **Golf-score card**: same affordance on the selected point. The underlying `GolfScoreTrendPoint` already carries `ratedAt` + `sessionDate`; add `sessionId` to that shape too (one new field, backward compatible).
- **Per-skill expanded `SkillChart`**: each history point grows a small "Edit" icon that becomes visible on hover (desktop) or tap (phone), linking to the same edit flow with `?skill=<slug>` so the Evaluate form scrolls to that skill. The `SkillChart.tsx` dot is already keyboard-focusable; the Edit icon is a sibling button in the point's `<g>` with `tabindex="0"` so it reads next in the tab order.
- **"Edited" indicator in `SkillChart`**: edited history points render a hollow ring around the dot (same accent color, no fill); the sr-only accessible table under the chart shows the format `"(edited, was N)"` next to the current value, where `N` is the pre-correction grade (or `Not legal` / `No concept` when the predecessor carried one of those). The pre-correction value is read from the leaf's `supersedes_rating_id → predecessor.grade` walk, included on each history point by the server as `previousValue: SkillGrade | null`.

### "What to work on next" is unchanged

The coaching priorities section already links to the evaluate page via `?skill=<slug>`. Those links continue to open a fresh evaluation; they do not route through edit mode (editing a priority means editing a session, which is a different intent).

### Design tokens, dark mode, no em dashes

Every surface uses the existing tokens from `axiom-aquatics-design`. Dark mode comes from the shared tokens — no hex values in any component. The "Edited" pill uses the neutral style (`--color-border` background + `--color-text` foreground). No warning color; the Edited state is informational.

---

## Rollout

**One PR on `feature/edit-evaluations`, in three phases.** The branch starts **after `feature/progress-charts` merges to `main`** — the plan assumes the extended `latestEffectiveRatings`, the score-history endpoint, and the new progress page are in place. The three phases ship together in one PR because every piece needs the others to be useful: schema without endpoints is dead code; endpoints without UI are untestable in the browser; UI without endpoints is a dead link.

Within the single PR, commits are organized by phase so a code reviewer can read them in order.

### Phase 1: schema and read changes

- **Migration.** Adds the three supersede columns to `skill_ratings`, the `edited_at` column to `evaluation_sessions`, the `evaluation_sessions_immutable_columns` trigger, the `supersede_fields_consistent` CHECK on `skill_ratings`, and the partial index on `(supersedes_rating_id) WHERE supersedes_rating_id IS NOT NULL`. Relaxes the existing `skill_ratings_append_only` trigger to permit the three new supersede columns.
- **`latestEffectiveRatings`.** One-line extension in `packages/shared/src/lib/dependencyMap.ts` to drop both voided and superseded rows. Unit test covers the extension in isolation.
- **Golf-score trends and parent progress.** Add `AND superseded_at IS NULL` next to the existing void filter in `apps/api/src/routes/evaluations.ts` and `apps/api/src/routes/parentProgress.ts`. The EXISTS subquery for "non-voided session" in `parentProgress.ts` gains the same filter.
- **Response shape additions.** `edited: boolean` on each history point in `SwimmerProgressResponse["skills"][number]["history"]`, computed from `supersedes_rating_id IS NOT NULL`. `previousValue: SkillGrade | null` on the same shape (null when the history point is not an edit; the predecessor's effective grade otherwise). `sessionId: string` added to each `ScoreHistoryPoint`, `StartGradeHistoryPoint`, and `GolfScoreTrendPoint`.
- **New read endpoints.** `GET /coach/swimmers/:id/evaluations` with cursor pagination. `GET /coach/sessions/:id` returning the current effective state.
- **Shared schemas.** `GetEvaluationsItemSchema`, `GetEvaluationsResponseSchema`, `GetSessionRatingSchema`, `GetSessionResponseSchema`. Exported from `packages/shared/src/index.ts`.

Integration tests under `apps/api/src/__tests__/integration/`:
- Seeded session with one rating; a correction row inserted via a direct DB write; `GET /coach/swimmers/:id/progress` returns the corrected grade and marks the rating `edited: true` with the predecessor's grade in `previousValue`.
- `GET /coach/sessions/:id` returns the current effective state of each rating; a corrected rating's `ratingId` is the leaf id and `rootRatingId` is the original.
- Score history after a correction: a past date's score reflects the corrected grade; the point carries the correct `sessionId`.
- Parent progress: `latestCoachingPriority` returns the session row's current `coachingPriority`; no `edited` fields appear in the parent response.
- `GET /coach/swimmers/:id/evaluations` paginates correctly; `edited` flags are accurate; `ratingCount` equals non-voided + non-superseded.
- Migration smoke: insert a session, UPDATE `screen_slug`, expect the trigger to raise.

### Phase 2: `PATCH /coach/sessions/:id` and the audit row

- Diff + transaction logic from the API section above.
- Writes one `household_audit_log` row per PATCH with the payload shape above, inside the same transaction as the row writes.
- Updates `latestEffectiveRatings`-driven calculations in `apps/api/src/lib/progressCalculation.ts` and `apps/api/src/lib/scoreHistory.ts` to pass through the extended filter — most of this is already covered by phase 1's filter change, but score-history additionally computes `previousValue` for the leaf and populates `sessionId`.
- Adds `fetchSession` and `patchSession` to `apps/web/src/lib/api/evaluations.ts`.

Integration tests:
- Edit a rating's grade: new rating row with `supersedes_rating_id` set, old row with `superseded_at/by/by_rating_id` set, calculations use the new grade, session's `edited_at` is set.
- Edit a rating's side: a correction with the new side; the old row's side is preserved.
- Edit a rating's fault tags: new rating with its own full `rating_fault_tags` list; old rating keeps its tags.
- Edit a rating's measured value: new `measurement_value`/`measurement_unit` on the correction; old row preserved.
- Edit a session's date: `evaluation_sessions.session_date` is updated in place, `edited_at` is set, audit payload carries `{ field: "sessionDate", previous: ..., new: ... }`.
- Edit a session's context: same shape with `context`.
- Edit a session's coaching priority: parent progress's `latestCoachingPriority` returns the new priority.
- Edit a session's breathing pattern: same shape.
- Attempt to edit an immutable column (e.g., `screen_slug`): the trigger raises; the API never writes it (the shared body schema doesn't accept it).
- Combined edit (session metadata + two ratings): one UPDATE on the session + two new rating rows + updates on the two predecessors, all in one transaction; the audit row describes both changes and includes per-field previous and new values for the metadata.
- No-op edit: no rows written, response is `200` with `writeCount: 0`.
- Stale edit (client submits a rating that was superseded by another tab): `409`.
- Non-owning coach attempts to edit: `404`.
- Attempt to edit a voided rating via the body: the voided rating is treated as absent — the submitted rating becomes a fresh entry attached to the session with no `supersedes_rating_id`, matching the "voided rating is a decision" rule.
- Edit chain depth 2 (edit a correction): the second correction supersedes the first; `latestEffectiveRatings` picks the second correction; `previousValue` on the UI leaf is the first correction's grade (not the root's), because the leaf chain shows the most recent prior value.
- `household_audit_log` row contents: actor, target swimmer, action `evaluation_edited`, payload matches the shape.

### Phase 3: UI

- `/coach/swimmers/[id]/evaluations` route and the Evaluate link on the detail page.
- Edit mode on `/coach/swimmers/[id]/evaluate` triggered by `?editSession=<id>`, including the sanitized `returnTo` redirect.
- "Edited" pills on the detail page's evaluations list and on the full-list page. Neutral style.
- Edit affordance on the hero `HeroTrendChart`, start progressions, golf-score card, and per-skill `SkillChart` points.
- Hollow-ring styling on edited history points in `SkillChart`; the sr-only table shows `"(edited, was N)"` next to the current value for each edited point.
- Removal of the current timeline-derived "Recent evaluations" grouping on the detail page and replacement with the new endpoint-driven list.

Web unit tests under `apps/web/src/__tests__/`:
- Detail page renders the new evaluations list from a mock `GET /coach/swimmers/:id/evaluations` response.
- "Edited" pill appears when `edited === true` and is absent otherwise.
- Edit button href includes `editSession=<sessionId>&returnTo=<current>`.
- Evaluate page in edit mode: when `?editSession=<id>` is present, screen picker is locked, submit button reads "Save changes", draft banner is hidden, localStorage keys are not written.
- Evaluate page `returnTo`: honored when safe, dropped when unsafe (same tests as the signup `returnTo` sanitizer).
- Progress page: hero chart's selected-point detail line shows an Edit link that opens the edit mode with the right session + skill.
- Per-skill `SkillChart` ring styling: a history point with `edited: true` renders a hollow ring; `edited: false` renders a filled dot. The sr-only table shows `"(edited, was N)"` for the edited point and plain text for the others.
- Full-list page: pagination button fetches the next cursor and appends rows.

---

## Resolved decisions

The questions left open in the earlier draft are resolved as follows:

- **Screen-reader table phrasing.** `"(edited, was N)"` where `N` is `3`, `Not legal`, or `No concept` as appropriate. One format for the full-value swap, read next to the current value in the sr-only table.
- **Fault-tag edit payload.** The correction row carries the **full new list** of fault tags. We do not compute an add / remove diff. The current list is the easy-to-render source of truth; a diff would double the state the UI has to track for a secondary signal.
- **"Edited" pill color.** Neutral style (`--color-border` background + `--color-text` foreground). The Edited state is informational, not a warning.
- **Chain-depth count on the evaluations list.** Not in this release. A plain "Edited" pill is enough; if coaches start asking "how many times has this changed?" we add the count then.
- **Parent editing.** No. Parents cannot edit evaluations and the parent progress page does not surface the Edit action. The ADR 032 "no parent edit" rule stands.

---

## Observations and failure modes

- **Chain depth growth over time.** Rating chains are expected to stay shallow (0–2 nodes) because a coach edits a rating once or twice at most. If a rating accumulates a chain depth greater than 10, the audit log rows are enough to debug. We do not add a `max_chain_depth` CHECK; it would be a hostile constraint if someone genuinely needs it.
- **A correction after a void.** Voiding a corrected (leaf) rating voids the leaf, not the root — the void endpoint resolves `:id` to the row the caller passes. The predecessor's void fields remain null; its supersede fields are already set. The chain plus the leaf's void is a correct "this reading was wrong, we tried to correct it, but then voided the correction too" trail.
- **A correction that then gets voided and un-voided.** Un-void doesn't exist. Once a leaf is voided, re-rating from scratch is the correct path; the chain's root is unchanged and new ratings for the same `(skillSlug, side)` sit alongside the chain.
- **Deleting a session is unaffected.** The 10-minute hard-delete endpoint from ADR 022 still cascades to all ratings for that session. If the session has corrections written against any of its ratings, the delete endpoint still succeeds — hard-delete at < 10 minutes wipes everything in the session anyway and is reserved for accidental taps. Corrections on day-old sessions sit outside the window.
- **Timezones.** `sessionDate` is a date-only column with no timezone. All existing day-boundary rules (LA calendar day for cadence buckets, score-history point ordering) continue to hold because `sessionDate` is read from the same column, updated in place. The audit log row's `createdAt` is a UTC timestamp as before.
- **Draft collisions with edit mode.** A coach with an in-progress draft on the freestyle screen who then clicks "Edit" on a backstroke evaluation sees edit mode render on top of a different screen; the draft is unaffected because edit mode skips the draft read/write entirely. When the coach exits edit mode (back button, returnTo, or submits), the draft remains on freestyle. If the coach clicks "Edit" on a freestyle session while a freestyle draft is active, edit mode still skips the draft; the draft is not merged into the edit form (merging two intents would surprise the coach). Covered by one web unit test.
- **A rating correction with the same values as the original.** The diff step detects this and drops the rating from the write set. If every rating is a no-op and the metadata is unchanged, the entire PATCH is a no-op. The one case where this matters: a coach opens Edit, taps around, and taps Save without changing anything. No rows are written; the audit log is not spammed.
- **A session metadata correction that happens to re-use the previous value in one field.** The diff compares each field individually. Only fields that actually changed appear in the audit log's `sessionFieldsChanged` list, which keeps the audit record truthful.
- **`edited_at` after a reversal.** `edited_at` is sticky — it never clears. A coach who edits a priority to "Catch" and then edits it back to "Head position" leaves `edited_at` set, and the pill remains. The audit log carries both transitions; the pill reflects "someone changed this at some point." If reset behavior ever becomes useful, the audit log is enough to reconstruct it.
- **Load.** The supersede filter adds one indexed condition to reads that already filter on `voided_at`. Session metadata reads unchanged. The migration adds four columns to the two biggest tables and one trigger; no backfill, no index on hot columns, no risk to existing queries.
