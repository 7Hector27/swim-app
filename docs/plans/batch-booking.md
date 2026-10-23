# Plan: Parent multi-lesson batch booking (manual + weekly repeat)

**Status:** Planning
**Branch (future):** `feature/parent-batch-booking`
**ADR:** [030 — Parent multi-lesson batch booking](../decisions/030-parent-batch-booking.md)

---

## Overview

Parents book up to 10 lessons in one submission. Two modes: `manual` (an explicit list of 2–10 start times) and `weekly` (a first start time plus a weeks count, 2–10, server-capped by `bookingMaxAdvanceWeeks`). One household, one swimmer set, one pool, one duration per batch. Submission is all-or-nothing with per-day advisory locks, re-runs the slot engine under lock with the batch's other picks folded in as occupied, and writes `booking_batches` + N `lessons` + N `lesson_swimmers` + one `household_audit_log` row + one `lesson_email_outbox` row in a single transaction. Pool-scoped trust (ADR 021) decides whether every lesson lands as `approved` or `pending`. The parent gets exactly one email — a summary listing confirmed and pending lessons with a multi-`VEVENT` `.ics` attached for the confirmed ones. Zero per-lesson `booking_requested` or `lesson_confirmed` emails. Later per-lesson changes continue to flow through the existing single-lesson routes and emit their own per-lesson events per ADR 028.

The single-lesson parent path at `POST /lessons` is unchanged. Coach booking at `POST /coach/lessons` (ADR 029) is unchanged.

---

## Scope

**In:**
- `POST /lessons/batch/preview` — pure read, slot-engine-per-pick + conflict detection + nearby suggestions.
- `POST /lessons/batch` — one transaction, N lessons or none.
- `PATCH /coach/lessons/batch/:batchId/approve-pending` — coach convenience path to flip pending batch lessons to approved in one transaction with one summary email.
- `DELETE /lessons/batch/:batchId/remaining` — optional for v1; cancels future-dated batch lessons in one transaction and emits per-lesson cancel emails.
- Outbox changes: nullable `lesson_id`, new `batch_id`, exactly-one CHECK, two partial unique indexes, two new events (`batch_booked`, `batch_approved`).
- Render pipeline grows one new React Email template (shared across the two batch events with subject/header variants) and one `.ics` build helper that reads `payload.lessons[]` and composes multi-`VEVENT` output.
- Web app: a batch booking flow with a mode toggle and per-pick preview + inline conflict resolution.

**Out:**
- Multi-pool batches. One pool per batch.
- Multi-household batches. One household per batch.
- Coach-created batches. Coach uses `POST /coach/lessons` per ADR 029.
- An open-ended "every Tuesday forever" rule. See the shelved `recurring-lessons.md`.
- A new batch-level cancel email (per-lesson emails on cancel-remaining; flagged as an open question).
- Series-level reschedule or this-and-future changes. Each batch lesson is reschedule/cancel-able individually through the existing single-lesson routes.

---

## Decisions already made (from Jason)

- Parents only. Jason uses `/coach/book` for his own bookings.
- Per batch: one household, one swimmer set, one pool, one duration.
- Two modes: `manual` (2–10 explicit picks) and `weekly` (first time + weeks, 2–10, capped by `bookingMaxAdvanceWeeks`).
- Preview lists every pick's state; unavailable picks carry a reason and (where same-day alternatives exist) up to three suggestions. Parent either moves the pick to a different time or skips the week.
- Picks treat the batch's other picks as occupied for overlap, travel buffer, and daily cap.
- Submit is one transaction, all or nothing. Per-day advisory locks in ascending LA-date order. Re-run the slot engine for each pick under the lock. On any failure, roll back the whole transaction and return the specific conflicts.
- Approval under ADR 021 is pool-scoped; mixed approved/pending across the batch's lifetime is fine. Pending lessons keep normal per-lesson expiry.
- Coach "approve all" for the batch's pending lessons in one transaction, one audit entry, one summary email.
- Optional parent "cancel remaining lessons in this batch" (future-dated only); marked optional for v1.
- `booking_batches` table with `(id, household_id, created_by, created_at, mode)`. `lessons.batch_id` nullable FK.
- Outbox: `lesson_id` nullable, new `batch_id`, CHECK exactly one set, dedup + supersede defined for batch rows. One summary email per batch creation; one `.ics` with one `VEVENT` per confirmed lesson (per-lesson UID, `SEQUENCE:0`). No per-lesson `booking_requested` or `lesson_confirmed` emails for batch lessons. Later changes send normal per-lesson emails. Approve-all sends one summary email for the newly confirmed lessons.
- Google Calendar sync per approved lesson after commit, as today.
- Add batch paths to the lesson-change-path lists in ADR 027 and ADR 028.

See ADR 030 for the reasoning behind each.

---

## Data model

### New table — `booking_batches`

One row per submission. Immutable after insert (the batch's own fields never change; member lessons' lifecycle is separate).

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `household_id` | `uuid` | no | — | FK → `households.id` (`ON DELETE RESTRICT`). Historical reference, not cascaded. |
| `created_by` | `uuid` | no | — | FK → `profiles.id`. The parent who submitted. |
| `mode` | `text` | no | — | CHECK IN (`'manual'`, `'weekly'`). |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | `$onUpdateFn`. Reserved; nothing writes to it in v1. |

Indexes: `(household_id, created_at desc)` for the dashboard "my batches" view.

RLS: `.enableRLS()` with no policies (API-only).

### `lessons` — new column

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `batch_id` | `uuid` | yes | — | FK → `booking_batches.id` (`ON DELETE RESTRICT`). Nullable because single-lesson bookings and coach bookings don't set it. Immutable after insert in v1. |

No index needed in v1 (the batch's own `(household_id, created_at)` plus `SELECT ... WHERE batch_id = :b` on the batch detail page is enough; add an index when the dashboard surfaces aggregations).

### `lesson_email_outbox` — altered

The outbox grows a batch dimension. One migration:

1. Drop `UNIQUE (lesson_id, event, sequence)`.
2. `ALTER COLUMN lesson_id DROP NOT NULL`.
3. `ADD COLUMN batch_id uuid REFERENCES booking_batches(id) ON DELETE RESTRICT`.
4. Add CHECK `((lesson_id IS NOT NULL)::int + (batch_id IS NOT NULL)::int = 1)`.
5. Replace the dropped unique with two partial unique indexes:
   - `UNIQUE (lesson_id, event, sequence) WHERE lesson_id IS NOT NULL`
   - `UNIQUE (batch_id, event, sequence) WHERE batch_id IS NOT NULL`
6. Extend the CHECK on `event` to include `'batch_booked'` and `'batch_approved'`.
7. Backfill: no action — existing rows all carry `lesson_id`, so the new CHECK is satisfied automatically.

The partial index on `(next_attempt_at) WHERE status IN ('pending','failed','sending')` continues to apply unchanged; it indexes both namespaces.

Row shape for batch rows:
- `lesson_id = NULL`
- `batch_id = <batch.id>`
- `event IN ('batch_booked', 'batch_approved')`
- `sequence` starts at 0 for the batch's first row and increments per `(batch_id, event)` pair
- `ics_method = NULL`, `ics_sequence = NULL` on the row itself (paired-nullability CHECK still holds)
- `payload.lessons[]` carries, per-lesson, `{ lessonId, startsAt, durationMinutes, status, calendarSequence, locationName, locationAddress, swimmerFirstNames }` — the renderer reads this to build `VEVENT`s

The `ics_method` on batch rows stays `NULL` because the row's `.ics` is a multi-event aggregate; a single `(method, sequence)` pair can't represent it. The renderer branches on `event` to decide whether to use the row's single-event fields or to walk `payload.lessons[]`.

### `household_audit_log` — new action values

Free-text column; no schema change needed. New values:

- `lesson_batch_booked` — written in the batch submit transaction.
- `lesson_batch_approved` — written in the coach approve-all transaction.
- `lesson_batch_canceled_remaining` — written in the (optional) parent cancel-remaining transaction.

`payload jsonb` already exists on `household_audit_log` (added in the coach-booking migration per ADR 029). Shape per action:

```jsonc
// lesson_batch_booked
{
  "batchId": "uuid",
  "mode": "manual" | "weekly",
  "locationId": "uuid",
  "durationMinutes": 30 | 45 | 60,
  "swimmerIds": ["uuid", ...],
  "picks": [
    { "startsAt": "2026-11-04T16:30:00-08:00", "status": "approved" | "pending" }
  ]
}

// lesson_batch_approved
{
  "batchId": "uuid",
  "approvedLessonIds": ["uuid", ...]
}

// lesson_batch_canceled_remaining
{
  "batchId": "uuid",
  "canceledLessonIds": ["uuid", ...]
}
```

### Drizzle migration

One generated pair:

- `pnpm db:generate --name=parent_batch_booking` — creates `booking_batches`, adds `lessons.batch_id`, alters `lesson_email_outbox` (nullable `lesson_id`, new `batch_id`, CHECKs, replaced UNIQUE with the two partial unique indexes, extended `event` CHECK).

No hand-authored SQL required: Drizzle handles the table add, column alter, CHECK adjustments, and index swap. Verify the generated SQL matches this plan before applying. State whether applied locally in the PR per CLAUDE.md's rule.

### `docs/data-model.md`

Add a `### booking_batches` section (placed after `### lesson_email_outbox`), update the `### lessons` table with the `batch_id` row, and amend the `### lesson_email_outbox` section's columns + constraints to reflect nullable `lesson_id`, new `batch_id`, the CHECK, and the two partial unique indexes.

---

## Shared Zod schemas

In `packages/shared/src/schemas/booking.ts`, exported from `packages/shared/src/index.ts`.

```ts
export const BatchModeSchema = z.enum(["manual", "weekly"]);
export type BatchMode = z.infer<typeof BatchModeSchema>;

export const BatchPickSchema = z.object({
  startsAt: z.string().datetime({ offset: true }),
});
export type BatchPick = z.infer<typeof BatchPickSchema>;

// Common fields for both modes. Not exported directly; inlined into each mode schema.
const BatchCommonFields = {
  householdId: z.string().uuid(),
  locationId: z.string().uuid(),
  durationMinutes: LessonDurationMinutesSchema,  // existing shared schema
  swimmerIds: z.array(z.string().uuid()).min(1).max(4),
};

// ── Preview ────────────────────────────────────────────────────────────────────

export const BatchManualPreviewBodySchema = z.object({
  mode: z.literal("manual"),
  ...BatchCommonFields,
  picks: z.array(BatchPickSchema).min(2).max(10),
});

export const BatchWeeklyPreviewBodySchema = z.object({
  mode: z.literal("weekly"),
  ...BatchCommonFields,
  firstStartsAt: z.string().datetime({ offset: true }),
  weeks: z.number().int().min(2).max(10),
});

export const BatchPreviewBodySchema = z.discriminatedUnion("mode", [
  BatchManualPreviewBodySchema,
  BatchWeeklyPreviewBodySchema,
]);
export type BatchPreviewBody = z.infer<typeof BatchPreviewBodySchema>;

// ── Preview response ──────────────────────────────────────────────────────────

export const BatchPickStateSchema = z.enum([
  "available",
  "unavailable",        // overlaps another approved/pending lesson or has no travel buffer / cap room
  "too_soon",           // inside bookingMinAdvanceHours
  "past",               // startsAt < now
  "not_open_yet",       // beyond bookingMaxAdvanceWeeks (should not happen for weekly: server clamps)
  "outside_hours",      // outside teaching hours for that LA day
  "blocked_time",       // overlaps a blocked_times row
  "day_closed",         // teaching day not open
  "conflicts_batch",    // overlaps another pick in the same submission
]);
export type BatchPickState = z.infer<typeof BatchPickStateSchema>;

export const BatchPickSuggestionSchema = z.object({
  startsAt: z.string().datetime({ offset: true }),
});

export const BatchPreviewPickSchema = z.object({
  index: z.number().int().nonnegative(),  // manual: picks array index; weekly: week index (0..weeks-1)
  startsAt: z.string().datetime({ offset: true }),
  state: BatchPickStateSchema,
  reason: z.string().optional(),           // short code suitable for i18n lookup
  suggestions: z.array(BatchPickSuggestionSchema).max(3).optional(),
});

export const BatchPreviewResponseSchema = z.object({
  needsApproval: z.boolean(),              // one call to needsApproval(householdId, locationId)
  picks: z.array(BatchPreviewPickSchema),
});
export type BatchPreviewResponse = z.infer<typeof BatchPreviewResponseSchema>;

// ── Submit ────────────────────────────────────────────────────────────────────

export const BatchManualSubmitBodySchema = BatchManualPreviewBodySchema;

export const BatchWeeklyOverrideSchema = z.object({
  weekIndex: z.number().int().nonnegative(),
  startsAt: z.string().datetime({ offset: true }),
});

export const BatchWeeklySubmitBodySchema = BatchWeeklyPreviewBodySchema.extend({
  overrides: z.array(BatchWeeklyOverrideSchema).optional().default([]),
  skips: z.array(z.number().int().nonnegative()).optional().default([]),
});

export const BatchSubmitBodySchema = z.discriminatedUnion("mode", [
  BatchManualSubmitBodySchema,
  BatchWeeklySubmitBodySchema,
]);
export type BatchSubmitBody = z.infer<typeof BatchSubmitBodySchema>;

// ── Submit response ───────────────────────────────────────────────────────────

export const BatchSubmitSuccessResponseSchema = z.object({
  batchId: z.string().uuid(),
  mode: BatchModeSchema,
  lessonIds: z.array(z.string().uuid()),
  confirmedCount: z.number().int().nonnegative(),
  pendingCount: z.number().int().nonnegative(),
});
export type BatchSubmitSuccessResponse = z.infer<typeof BatchSubmitSuccessResponseSchema>;

export const BatchConflictPickSchema = z.object({
  index: z.number().int().nonnegative(),
  startsAt: z.string().datetime({ offset: true }),
  state: BatchPickStateSchema,
  reason: z.string().optional(),
});

export const BatchSubmitConflictResponseSchema = z.object({
  error: z.literal("picks_conflict"),
  conflicts: z.array(BatchConflictPickSchema).min(1),
});
export type BatchSubmitConflictResponse = z.infer<typeof BatchSubmitConflictResponseSchema>;

// ── Coach approve-all ─────────────────────────────────────────────────────────

export const CoachBatchApproveResponseSchema = z.object({
  batchId: z.string().uuid(),
  approvedLessonIds: z.array(z.string().uuid()),
  approvedCount: z.number().int().positive(),
});
export type CoachBatchApproveResponse = z.infer<typeof CoachBatchApproveResponseSchema>;

// ── Optional: cancel remaining ────────────────────────────────────────────────

export const BatchCancelRemainingResponseSchema = z.object({
  batchId: z.string().uuid(),
  canceledLessonIds: z.array(z.string().uuid()),
  canceledCount: z.number().int().nonnegative(),
});
```

Validation notes:
- Weekly `weeks` is bounded [2, 10] at the schema level. The server applies the additional cap `weeks ≤ floor(bookingMaxAdvanceWeeks * 7 / 7) = bookingMaxAdvanceWeeks` and `firstStartsAt + weeks * 7 days ≤ now + bookingMaxAdvanceWeeks` silently — overshoot is truncated, not rejected. The preview's response reflects the truncated set.
- Manual `picks` must be unique on `startsAt` at the schema level (`.refine` on the array). Duplicates are a client bug and should 422 rather than silently dedupe.
- `swimmerIds` are validated as household-member swimmers in the route handler. The schema just enforces UUID + min/max count.

---

## API

### `POST /lessons/batch/preview`

Parent-only. Middleware: `requireUser → requireParent → requireHouseholdMember → validate({ body: BatchPreviewBodySchema })`.

Flow:
1. Verify `req.householdId === body.householdId`. If not, 403.
2. Verify `swimmerIds` all belong to the household and are not archived. 422 if any fails.
3. Compute candidate picks:
   - Manual: `body.picks` directly.
   - Weekly: `[0..weeks-1].map(i => firstStartsAt + i * 7 days)`, then clamp any pick that would exceed `now + bookingMaxAdvanceWeeks` to `not_open_yet`.
4. Resolve `needsApproval(householdId, locationId)` once.
5. For each candidate pick, run `computeAvailableSlots` for its LA day with:
   - All existing pending/approved lessons for that day (unchanged).
   - **Plus** every other candidate pick in the batch, folded in as if it were an approved lesson. This ensures a batch's own picks respect overlap, travel buffer, and daily cap against each other.
6. Classify each pick:
   - If `startsAt < now()` → `past`.
   - If `startsAt > now() + bookingMaxAdvanceWeeks` → `not_open_yet`.
   - If `startsAt < now() + bookingMinAdvanceHours` → `too_soon`.
   - If the day has `dayState = closed` or `not_open_yet` → `day_closed` / `not_open_yet`.
   - If `startsAt` is outside the day's teaching windows → `outside_hours`.
   - If overlaps a `blocked_times` row → `blocked_time`.
   - If overlaps another pick in the batch (after the fold-in in step 5) → `conflicts_batch`.
   - If overlaps an existing pending/approved lesson or fails travel-buffer / daily-cap → `unavailable`.
   - Otherwise → `available`.
7. For every non-`available` pick, compute up to three nearby open slots on the same LA day (closest to the pick's `startsAt`, within the day's teaching windows, respecting the batch's other picks). Omit the suggestions field when the day has nothing open.
8. Return `BatchPreviewResponseSchema`.

Response: 200.
- 422 if swimmers invalid.
- 403 if `householdId` mismatch.

No lock, no write.

### `POST /lessons/batch`

Parent-only. Middleware: same as preview. Body: `BatchSubmitBodySchema`.

Flow:
1. Verify `req.householdId === body.householdId` and swimmers (same checks as preview).
2. Compute **final picks** from the mode:
   - Manual: `body.picks`.
   - Weekly: start from the computed `weeks` picks (clamped), remove indices in `body.skips`, apply `body.overrides` by replacing the pick at the matching `weekIndex` with the override `startsAt`.
3. Validate final-pick count is between 2 and 10 (`picks_underflow` 422 if below 2 after skips).
4. Open the transaction. Insert `booking_batches`.
5. Compute the unique set of LA dates across final picks. Sort ascending. For each date, `pg_advisory_xact_lock(hashtext('lesson-day:' + laDate))` inside the transaction.
6. Call `needsApproval(householdId, locationId)` once.
7. For each pick in `startsAt` ascending order:
   a. Build the "existing occupied set" from DB lessons on that day **plus** the batch's other picks (fold-in).
   b. Call `computeAvailableSlots` for that day with the fold-in; also apply the parent-only `bookingMinAdvanceHours` filter.
   c. If the pick's `startsAt` is not in the returned set, record the pick as a conflict with its state (same enum as preview). On any conflict, roll back the transaction and return 422 `picks_conflict` with the per-pick list.
8. Insert N `lessons` rows:
   - `status`: `'approved'` if `!needsApproval` else `'pending'`.
   - `approved_at`: `now()` if approved; `NULL` otherwise.
   - `approved_by`: `NULL` either way (system auto-approval when approved; `NULL` on pending until a coach approves per-lesson or via approve-all).
   - `requested_by`: the submitting profile id.
   - `expires_at`: `starts_at − bookingMinAdvanceHours` for pending; `NULL` for approved.
   - `batch_id`: the just-inserted batch's id.
   - All other fields per the existing single-lesson insert.
9. Insert N × swimmer-count rows into `lesson_swimmers`.
10. If any lessons are approved, snapshot each approved lesson's `calendar_sequence` (initial value `0`) into the outbox payload, increment the lesson's `calendar_sequence` to `1`, and set `calendar_invite_sent_at = now()` on each approved lesson. **Only approved lessons get an invite line in the `.ics` and only approved lessons bump their sequence.** Pending lessons do not change `calendar_sequence` here — they get their first invite when (or if) a coach approves them individually or via approve-all.
11. Resolve recipient profile ids via `SELECT profile_id FROM household_members WHERE household_id = :h AND role IN ('owner','manager')`.
12. Insert one `lesson_email_outbox` row:
    - `batch_id` = the new batch id
    - `lesson_id` = NULL
    - `event = 'batch_booked'`
    - `sequence = 0` (first batch-level row for this batch)
    - `recipient_profile_ids` = resolved list
    - `ics_method = NULL`, `ics_sequence = NULL`
    - `payload = { mode, locationId, locationName, locationAddress, durationMinutes, swimmerFirstNames, batchId, lessons: [{ lessonId, startsAt, status, calendarSequence (0 for approved, 0 for pending), ... }] }`
13. Insert one `household_audit_log` row with `action='lesson_batch_booked'`, `actor_id=<requester>`, `household_id`, `target_swimmer_id=NULL`, and the payload described in the data-model section.
14. Commit.
15. After `res.json()`:
    - For each approved lesson, `queueMicrotask(() => void syncLessonToGoogle(id))`.
    - `queueMicrotask(() => void sendLessonEmailOutboxRow(outboxId))`.

Response: 201 with `BatchSubmitSuccessResponseSchema`. On any conflict, 422 with `BatchSubmitConflictResponseSchema` and the whole transaction rolled back.

### `PATCH /coach/lessons/batch/:batchId/approve-pending`

Coach-only. Middleware: `requireUser → requireCoach → validate({ params: { batchId: uuid } })`.

Flow:
1. In one transaction:
   a. `SELECT * FROM booking_batches WHERE id = :batchId FOR UPDATE`. 404 if missing.
   b. `SELECT * FROM lessons WHERE batch_id = :batchId AND status = 'pending' FOR UPDATE`. 409 `no_pending_lessons` if empty.
   c. Take the per-day advisory lock for every unique LA date in the pending set, ascending.
   d. Re-check each pending lesson's slot against the current DB state (approval doesn't change the schedule, but a race condition where another lesson has taken the slot since the batch was created should surface — treat as 409 `slot_unavailable` for that lesson id and roll back the whole transaction).
   e. `UPDATE lessons SET status='approved', approved_at=now(), approved_by=:coachId, expires_at=NULL WHERE id IN (...)`.
   f. For each newly-approved lesson, snapshot its current `calendar_sequence` and increment it by 1; set `calendar_invite_sent_at = now()` if it is NULL.
   g. Insert one `lesson_email_outbox` row with `batch_id = :batchId`, `lesson_id = NULL`, `event = 'batch_approved'`, `sequence = coalesce(max(sequence),-1)+1` scoped to `(batch_id, event='batch_approved')`, recipient profile ids snapshot, payload listing the newly-approved lessons' details.
   h. Insert one `household_audit_log` row with `action='lesson_batch_approved'`.
   i. Commit.
2. After `res.json()`:
   - For each newly-approved lesson, `queueMicrotask(() => void syncLessonToGoogle(id))`.
   - `queueMicrotask(() => void sendLessonEmailOutboxRow(outboxId))`.

Response: 200 with `CoachBatchApproveResponseSchema`.
- 404 if batch not found.
- 409 `no_pending_lessons` if no pending lessons remain.
- 409 `slot_unavailable` if any pending lesson's slot has been taken since the batch was created; the slot-lost lesson's id is returned alongside the error so the coach can see it.

### `DELETE /lessons/batch/:batchId/remaining` (optional for v1)

Parent-only. Middleware: `requireUser → requireParent → requireHouseholdMember → validate({ params: { batchId: uuid } })`.

Flow:
1. Verify the batch belongs to the caller's household (403 if not).
2. In one transaction:
   a. `SELECT * FROM lessons WHERE batch_id = :batchId AND status IN ('approved','pending') AND starts_at > now() FOR UPDATE`.
   b. For each selected lesson, update to `status='canceled'`, `canceled_at=now()`, `canceled_by=:actor`.
   c. For each canceled lesson, follow the standard per-lesson cancel path from ADR 028: write one `lesson_canceled` outbox row with `ics_method='CANCEL'` iff `calendar_invite_sent_at IS NOT NULL`, snapshot-then-increment `calendar_sequence` if CANCEL. The outbox dedup key `(lesson_id, event, sequence)` applies per lesson.
   d. Insert one `household_audit_log` row with `action='lesson_batch_canceled_remaining'`.
3. After `res.json()`:
   - For each canceled lesson, `queueMicrotask(() => void syncLessonToGoogle(id))` (will delete the event because status is no longer approved/completed).
   - For each canceled lesson, `queueMicrotask(() => void sendLessonEmailOutboxRow(outboxId))` for the per-lesson cancel row.

Response: 200 with `BatchCancelRemainingResponseSchema`.
- 403 if the batch is not the caller's.
- 404 if the batch does not exist.

**Not shipping in v1 unless Jason asks.** Flagged below.

---

## Transaction and lock order (reference summary)

For `POST /lessons/batch`:

```
BEGIN;

  INSERT booking_batches (id, household_id, created_by, mode, created_at)
    VALUES (...);

  -- Deterministic lock order; sort ascending to avoid deadlock with single-lesson writes.
  FOR each unique LA_date IN sorted(picks) ASC DO
    SELECT pg_advisory_xact_lock(hashtext('lesson-day:' || LA_date));
  END FOR;

  -- Pool-scoped trust check, one call.
  needsApproval := needsApproval(household_id, location_id);

  -- Re-check every pick under the lock, with batch's other picks folded in.
  FOR pick IN picks ORDER BY starts_at ASC DO
    occupied := existing_lessons_for_day(pick.day)
                UNION other_batch_picks_in_same_day_except(pick);
    available_set := computeAvailableSlots(day, duration, location, occupied,
                                           parent_min_advance_hours=true);
    IF pick.starts_at NOT IN available_set THEN
      ROLLBACK;
      RETURN 422 picks_conflict { conflicts: [...] };
    END IF;
  END FOR;

  -- Write N lessons rows.
  INSERT INTO lessons (..., batch_id, status, approved_at, expires_at, calendar_sequence) VALUES
    (...),  -- status = approved OR pending per needsApproval
    ...;

  INSERT INTO lesson_swimmers (lesson_id, swimmer_id) VALUES
    (...), ...;

  -- Approved lessons: snapshot calendar_sequence (0 → 0 in payload), bump to 1, set calendar_invite_sent_at.
  UPDATE lessons SET calendar_sequence = 1, calendar_invite_sent_at = now()
    WHERE id = ANY(approved_lesson_ids);

  -- Recipient snapshot.
  recipient_profile_ids := SELECT profile_id FROM household_members
    WHERE household_id = :h AND role IN ('owner','manager');

  INSERT INTO lesson_email_outbox (
    batch_id, lesson_id = NULL, event = 'batch_booked', sequence = 0,
    recipient_profile_ids, payload, ics_method = NULL, ics_sequence = NULL, ...
  );

  INSERT INTO household_audit_log (
    household_id, actor_id, action = 'lesson_batch_booked', target_swimmer_id = NULL, payload
  );

COMMIT;

-- Post-commit, outside the lock, outside the transaction.
queueMicrotask(() => void syncLessonToGoogle(lessonId)) foreach approved_lesson_id;
queueMicrotask(() => void sendLessonEmailOutboxRow(outboxId));
```

**Lock-ordering invariant:** every batch acquires per-day locks in ascending LA-date order. Single-lesson bookings acquire exactly one day lock. Any two concurrent writers on overlapping days therefore acquire locks in the same relative order, so no deadlock is possible. The Postgres pool holds the locks for the duration of the transaction only; the transaction never calls out to Google, Resend, or any other slow dependency.

For `PATCH /coach/lessons/batch/:batchId/approve-pending`: same lock-ordering rule — collect unique LA dates across pending lessons, sort ascending, take advisory locks, do the state flips. Resend / Google calls are post-commit microtasks.

For `DELETE /lessons/batch/:batchId/remaining` (optional): same rule. The cancels don't technically need the day lock (no slot allocation happens), but taking it keeps the ordering uniform and makes any concurrent reschedule-into-this-slot deterministic (the cancel wins or the reschedule wins; no interleaved state).

---

## Preview and conflict response shapes (reference)

Preview response:

```jsonc
{
  "needsApproval": false,
  "picks": [
    { "index": 0, "startsAt": "2026-11-04T16:30:00-08:00", "state": "available" },
    { "index": 1, "startsAt": "2026-11-11T16:30:00-08:00", "state": "available" },
    { "index": 2, "startsAt": "2026-11-18T16:30:00-08:00",
      "state": "blocked_time", "reason": "coach_vacation",
      "suggestions": [
        { "startsAt": "2026-11-18T17:00:00-08:00" },
        { "startsAt": "2026-11-18T17:30:00-08:00" }
      ]
    },
    { "index": 3, "startsAt": "2026-11-25T16:30:00-08:00",
      "state": "day_closed", "reason": "holiday", "suggestions": [] },
    { "index": 4, "startsAt": "2026-12-02T16:30:00-08:00", "state": "available" }
  ]
}
```

Submit conflict response (422):

```jsonc
{
  "error": "picks_conflict",
  "conflicts": [
    { "index": 2, "startsAt": "2026-11-18T16:30:00-08:00",
      "state": "blocked_time", "reason": "coach_vacation" },
    { "index": 4, "startsAt": "2026-12-02T16:30:00-08:00",
      "state": "unavailable", "reason": "slot_taken_since_preview" }
  ]
}
```

The UI uses this response to annotate the pick list with per-pick error badges, re-run preview to refresh suggestions, and let the parent either adjust or skip the flagged picks.

---

## UI (web)

Flow lives at `/dashboard/book/batch` (new route) alongside the existing single-lesson `/dashboard/book`. Entry points:

- A "Book multiple lessons" link on `/dashboard/book` next to the single-lesson flow.
- A direct button on `/dashboard` under the "Upcoming lessons" area (visible to owners / managers only).

### Step 1 — Mode + shared parameters

- Mode toggle: "Pick dates" (manual) / "Weekly repeat" (weekly). Default `manual`.
- Household: implicit (owner/manager context).
- Swimmers: multi-select from the household's active swimmers. Minimum 1, maximum 4.
- Pool: dropdown of named pools and the household's home pool.
- Duration: 30 / 45 / 60 minute toggle.
- Mobile-first (same conventions as `/dashboard/book`).

### Step 2a — Manual mode: pick dates

- An editable list of 2–10 slots. Each row is a date-time picker.
- "Add another date" button adds a row (disabled at 10).
- "Remove" per row (disabled when only 2 remain).
- "Preview" button submits to `POST /lessons/batch/preview` and transitions to step 3.

### Step 2b — Weekly repeat: first date + weeks

- A single date-time picker for `firstStartsAt`.
- A `weeks` slider (2 to 10, labeled with the resulting end date).
- Server-side cap: if the parent sets `weeks` such that the final occurrence would exceed `bookingMaxAdvanceWeeks`, the preview response reports the server-truncated set. The UI shows the truncated count ("We can schedule 7 of your 10 requested weeks; the rest fall outside Jason's 10-week booking window") and offers the choice to proceed with the shorter batch or shorten the series start.
- "Preview" button submits to the preview endpoint.

### Step 3 — Preview with inline conflict resolution

- A scrollable list of picks with state badges:
  - `available` → green dot, no inline UI
  - `too_soon` / `past` → red, no suggestions (parent must pick a different date entirely)
  - `outside_hours` / `blocked_time` / `day_closed` → red, with the suggestion panel showing up to 3 nearby times on the same LA day. Each suggestion is a one-click button that updates the pick's `startsAt` and re-runs preview.
  - `unavailable` / `conflicts_batch` → red, with suggestions. For `conflicts_batch`, the suggestion panel is filtered to times that don't collide with the batch's other picks.
  - `not_open_yet` → gray badge "beyond booking window." For weekly mode this is a UI-side signal that `weeks` was clamped; the pick is not sent to submit.
- A "Skip this week" button on each flagged weekly pick (hidden for manual, where "remove" is the equivalent affordance).
- A footer line summarizes: "N confirmed · M pending · K skipped." A "Confirm and book" button, disabled while any pick is flagged with a non-skipped state.
- An approval-state banner above the list:
  - `needsApproval = false`: "Your lessons will be confirmed instantly."
  - `needsApproval = true`: "Jason will confirm each lesson. Pending lessons expire 16 hours before their start if he doesn't respond."

### Step 4 — Submit

- On confirm, the UI sends `POST /lessons/batch` with the resolved manual picks, or with `(firstStartsAt, weeks, overrides, skips)` for weekly mode.
- On 422 `picks_conflict`, the UI re-renders step 3 with the conflicts panel highlighting the server-returned entries. The parent either adjusts or skips, then confirms again.
- On 201, the UI transitions to a success screen listing the batch summary and a link to the batch detail route (`/dashboard/lessons/batch/:batchId`).

### Batch detail route

- Lists every lesson in the batch, grouped by status (confirmed / pending / canceled).
- Each row links to the per-lesson detail at `/dashboard/lessons/:lessonId`.
- If `cancel-remaining` ships: a "Cancel remaining lessons" button, visible only to owners / managers, confirming with "This cancels every future lesson in the batch. Each cancellation sends its own confirmation email."

### Viewer role

- `requireHouseholdMember` on the batch write routes already gates viewers out; the UI entry points are hidden for viewers. Batch detail is readable (viewer can see the lesson list), but write actions are hidden.

---

## Email

### Templates

A new React Email template at `apps/api/src/services/emails/templates/Batch.tsx`, parameterized by `event` so one component covers both `batch_booked` and `batch_approved`. Rationale: the two emails share 95% of their visual language (same header, same lesson list render, same `.ics` composition logic), differing only in subject, header copy, and footer.

### Subject lines

For `batch_booked`:
- All confirmed, manual mode: "Your {N} lessons at {pool} are booked"
- All confirmed, weekly mode: "Your {N} weekly lessons at {pool} are booked"
- All pending: "Request received: {N} lessons at {pool}"
- Mixed: "{N} lessons at {pool}: {C} confirmed, {P} waiting for Jason"

For `batch_approved`:
- "Jason confirmed {N} more lessons at {pool}"

### Body outline

```
Hi {firstName},

{summary paragraph}

Confirmed lessons
──────────────────────
{for each approved lesson in the payload:}
  {day} {date} at {time}
  {duration} min · {pool}
  {home-pool address only shown when the pool belongs to this household;
   named pools show the full address — ADR 028 privacy rule}

Waiting for Jason
──────────────────────
{for each pending lesson in the payload (batch_booked only):}
  {day} {date} at {time}
  {duration} min · {pool}
  Expires {X hours} before start if Jason doesn't respond

View your lessons
  {deep link to /dashboard/lessons/batch/:batchId}

{footer}
```

### Attached `.ics`

- One `VCALENDAR` with one `VEVENT` per approved lesson in the payload.
- Each `VEVENT` carries:
  - `UID:${lessonId}@axiomaquatics.io` — per-lesson, preserving the ADR 028 UID rule so later per-lesson reschedules can supersede this specific event via `SEQUENCE:N`.
  - `SEQUENCE:0` for the initial `batch_booked`; `SEQUENCE:1` for lessons newly approved via `batch_approved` (because approve-all bumps each lesson's `calendar_sequence` from 0 to 1 inside the approve transaction).
  - `DTSTART` / `DTEND` from the lesson's `startsAt` + `durationMinutes`.
  - `SUMMARY` using the swimmer-first-name rule from ADR 028.
  - `LOCATION` using the home-pool / named-pool rule from ADR 028.
  - `DTSTAMP` set at render time.
- Pending lessons are **not** included in the `.ics`. Only confirmed lessons produce calendar invites.
- `METHOD:REQUEST` on the `VCALENDAR`.

The `.ics` body is a pure function of `payload.lessons[]` plus `now()` (for `DTSTAMP`); nothing else is read at render time.

---

## Approve-all (coach convenience)

Design covered in the API section above. The important properties:

- **One transaction** flips every currently-pending lesson in the batch to approved. If any lesson's slot has been lost to another booking in the meantime (race condition), the whole transaction rolls back and the client sees a 409 with the lost slot's lesson id.
- **One outbox row** (`batch_approved`), one `.ics` with `VEVENT`s for the newly-approved lessons only (lessons that were already approved before approve-all ran are not re-invited).
- **One audit row** (`lesson_batch_approved`).
- Idempotency: approve-all is not idempotent in the trivial sense (running it twice when the batch has pending lessons both times would email twice), but the typical case is "once, after a batch's pending lessons accumulate." If the coach runs it twice back-to-back, the second call returns 409 `no_pending_lessons` because the first already flipped everyone.

The coach retains the per-lesson approve route (`PATCH /coach/lessons/:lessonId/approve`) for the case where they want to approve only some of the batch's pending lessons. Those per-lesson approvals emit the standard `lesson_confirmed` outbox event per ADR 028.

---

## Cancel-remaining (optional v1)

Design covered in the API section. Important properties:

- Future-dated only. Already-started lessons are untouched.
- **Per-lesson** `lesson_canceled` outbox rows. Each cancels its own `VEVENT` via `METHOD:CANCEL` and `SEQUENCE:N+1`. N emails for an N-lesson batch cancel.
- One `household_audit_log` row covers the whole operation.
- If Jason prefers a single batch-level cancel email, this becomes a new `batch_canceled` event. Flagged in open questions.

---

## Integration with existing systems

### ADR 027 — Google Calendar sync

No new sync surface. Approved batch lessons get `syncLessonToGoogle(id)` scheduled per-lesson post-commit, identical to coach-booked lessons. ADR 027's lesson-change-path list grows by:

- `POST /lessons/batch` (one microtask per approved lesson)
- `PATCH /coach/lessons/batch/:batchId/approve-pending` (one microtask per newly-approved lesson)
- `DELETE /lessons/batch/:batchId/remaining` if it ships (one microtask per canceled lesson)

Burst-rate note: a 10-lesson batch queues up to 10 sequential microtasks, each with the sync service's existing 100 ms gap. 10 × ~500 ms (p99 Google latency including the gap) = 5 s to drain. Well under the per-user quota.

### ADR 028 — Email outbox

Covered above. Changes:

- Outbox columns and constraints (nullable `lesson_id`, new `batch_id`, two partial unique indexes, CHECK on event, CHECK on exactly-one).
- Two new events (`batch_booked`, `batch_approved`).
- One new template (shared, parameterized by `event`).
- `.ics` renderer gains a batch branch that walks `payload.lessons[]`.
- Supersede rules: a batch row is superseded if (a) a newer batch outbox row for the same `batch_id` has sent, or (b) every lesson in the batch is in a terminal non-active state or has `starts_at < now()`.

ADR 028's lesson-change-path list grows the same way as ADR 027's.

### ADR 029 — Coach booking

No interaction. Coach bookings don't batch; they stay on `POST /coach/lessons`. The coach convenience path `PATCH /coach/lessons/batch/:batchId/approve-pending` operates on parent-created batches only.

### APP_ENV, email allowlist, logging

Nothing new. Batch emails go through the same transport, verification, and logging rules as single-lesson emails. Swimmer first names and (for home-pool lessons) full addresses in the payload follow ADR 028's privacy rules unchanged — home-pool addresses only ship to that household's owners / managers.

### Shelved recurring plan

`docs/plans/recurring-lessons.md` is marked **shelved** by this plan: the `lesson_series` rule shape (cron-extended window, per-occurrence vs this-and-future, open-ended rules) is deferred. If Jason later wants an open-ended "every Tuesday forever" rule, that doc is the starting point — but batch covers "every Tuesday for 10 weeks" without any of the heavier machinery.

---

## Test plan (integration-first, each behavior once)

All seven under `apps/api/src/__tests__/integration/`. Shared helpers from `apps/api/src/__tests__/integration/helpers.ts`. Each test seeds its own household + swimmer + pool + (where needed) existing lessons, then exercises the full HTTP surface via `supertest`.

**T1 — all-or-nothing rollback.**
- Seed a household with trust at Pool A, two swimmers, three valid picks for `POST /lessons/batch` (manual, picks 2026-11-04 / 2026-11-11 / 2026-11-18 at 4:30 PM).
- Just before submit, insert a conflicting approved lesson into the DB for 2026-11-11 at 4:30 PM (simulating a race under lock).
- Submit the batch.
- **Assert:** 422 `picks_conflict` with pick index 1 in conflicts; zero `lessons` rows written for this batch; zero `booking_batches` rows; zero `household_audit_log` rows with `action='lesson_batch_booked'`; zero `lesson_email_outbox` rows with `batch_id` for this batch.

**T2 — picks interacting through buffer and daily cap.**
- Seed a household with trust at Pool A and an unrelated existing approved lesson at Pool B at 3:00 PM on 2026-11-04. Travel buffer from Pool B to Pool A is 30 minutes.
- Submit a manual batch with picks: (2026-11-04 at 3:15 PM at Pool A) and (2026-11-04 at 4:00 PM at Pool A), 45-minute duration. (The first pick fails the buffer against the existing Pool B lesson; the two batch picks also stack past the daily cap when combined with the Pool B lesson.)
- **Assert:** preview returns pick 0 state `unavailable` (buffer violation against the Pool B lesson) and pick 1 state `conflicts_batch` or `unavailable` depending on the actual cap arithmetic — the exact state is a function of `max_daily_lesson_minutes` and both the fixture and the test's assertion verify the server's computed classification matches. Submit returns 422 with both picks in the conflict list and zero rows written.

**T3 — flagged week moved vs skipped.**
- Seed a household with trust at Pool A. Insert a `blocked_times` row covering 2026-11-18 from 4:00 PM to 5:00 PM.
- Preview a weekly batch starting 2026-11-04 at 4:30 PM for 4 weeks.
- **Preview assertions:** picks 0, 1, 3 are `available`; pick 2 (2026-11-18) is `blocked_time` with up to 3 suggestions (e.g., 3:00, 3:30, 5:30 PM) in the response.
- **Submit variant A (moved):** send the request with `overrides=[{ weekIndex: 2, startsAt: '2026-11-18T15:00:00-08:00' }]`. Expect 201. Expect four lessons written, the third with `starts_at = 2026-11-18T15:00:00-08:00`. Expect one `batch_booked` outbox row.
- **Submit variant B (skipped):** send the request with `skips=[2]`. Expect 201. Expect three lessons written, none on 2026-11-18. Expect one `batch_booked` outbox row listing three lessons in `payload.lessons`.

Both variants in one test file; one of them in each `it(...)` block to keep each behavior isolated.

**T4 — mixed approval (through time).**
- Seed a household with **no trust** at Pool A. Submit a 3-pick manual batch.
- **After submit:** 201; three `lessons` rows all `status='pending'`; one `batch_booked` outbox row with `payload.lessons` listing all three as pending; `.ics` has zero `VEVENT`s (or the renderer emits no attachment; verify the row's payload-driven render path handles the empty case). Email subject reflects "Request received: 3 lessons at Pool A". Zero per-lesson outbox rows.
- Run `PATCH /coach/lessons/batch/:batchId/approve-pending` as a coach.
- **After approve-all:** all three lessons `status='approved'`, `approved_by=<coach>`, `expires_at=NULL`, each with `calendar_sequence=1`. One `batch_approved` outbox row with payload listing all three. One `lesson_batch_approved` audit row.
- Assert the two outbox rows together carry exactly three pending-at-submit and three approved-via-approve-all representations — no per-lesson `lesson_confirmed` row was emitted anywhere.

**T5 — approve-all idempotency.**
- Seed a batch with 3 pending lessons.
- Call approve-all. Expect 200 with `approvedCount=3`.
- Call approve-all again. Expect 409 `no_pending_lessons`. Expect no second outbox row.

(This complements T4 and could be combined if we want to keep the test count low; splitting keeps the error path explicit.)

**T6 — one email with the right invites and no duplicate per-lesson emails.**
- Seed a household with trust at Pool A. Submit a 4-pick manual batch (all approved).
- **Assertions:**
  - Exactly one `lesson_email_outbox` row where `batch_id = :batchId AND event = 'batch_booked'`.
  - Zero rows where `lesson_id IN (:batchLessonIds) AND event IN ('booking_requested','lesson_confirmed')`.
  - The row's `payload.lessons` has 4 entries, each with its `lessonId` and `calendarSequence=0`.
  - The row's `ics_method` is NULL and `ics_sequence` is NULL (paired-nullability CHECK satisfied).
- Then: reschedule one of the lessons via `PATCH /lessons/:id`. Assert this emits a standard per-lesson `lesson_rescheduled` outbox row (unchanged ADR 028 path) — the batch_id has no effect on the reschedule path's outbox write.

**T7 — concurrent single-lesson booking vs batch booking.**
- Seed a household with trust at Pool A. Pre-stage: no existing lessons on 2026-11-04.
- In parallel, two HTTP requests:
  - A: single-lesson booking at 2026-11-04 T 4:30 PM for Pool A.
  - B: batch booking with manual picks including 2026-11-04 T 4:30 PM at Pool A.
- **Assertions:** exactly one of A or B commits; the other receives `slot_unavailable` (for A) or `picks_conflict` with that specific pick index flagged (for B). Rows written match the winner only. Advisory lock ordering guarantees serialization — the test runs the two requests via `Promise.all` and verifies exactly-one by checking `COUNT(*) FROM lessons WHERE starts_at = ... AND status IN ('pending','approved')`.

Each test exercises one listed behavior exactly once; the full suite is seven files or one file with seven `it(...)` blocks (preference: one file at `apps/api/src/__tests__/integration/parentBatchBooking.integration.test.ts` with seven top-level `describe` sections).

### Not covered by integration tests, worth unit coverage

- Zod schema validation of edge cases: `weeks=1` (rejected), `picks.length=1` (rejected), overrides pointing to a non-existent `weekIndex` (rejected), duplicate `startsAt` in manual picks (rejected).
- Multi-`VEVENT` `.ics` composition: snapshot test on the output for a 4-lesson approved batch.
- Supersede guard for batch rows: unit test the two conditions in isolation.

### Not covered

- Load / concurrency past the two-request case in T7. If Jason wants a stress test (10 parallel batches at the same pool and day), it's a straightforward extension.
- Email cross-client rendering of the summary template. React Email's preview server exercises Gmail / Outlook / Apple Mail during template development; cross-client issues surface there, not in integration tests.

---

## Open questions

1. **Does `cancel-remaining` ship in v1, or is it a follow-up?** If follow-up, parents cancel individual lessons until the convenience path lands.
2. **Should `cancel-remaining` emit per-lesson cancel emails (one per canceled lesson, current plan) or one batch-level cancel summary email (new `batch_canceled` event)?** For a 10-lesson cancellation the per-lesson approach is 10 emails; the summary variant is 1 email but requires a new outbox event + template.
3. **Does Jason want per-lesson emails for his own visibility inside a batch?** The current plan intentionally suppresses per-lesson `lesson_confirmed` / `booking_requested` emails at batch creation time. If Jason uses the Resend inbox as a feed, a single summary email per batch could feel sparse.
4. **Should the batch detail route (`/dashboard/lessons/batch/:batchId`) have a dedicated UI, or is a filter on the existing lessons list enough?** Current plan assumes a dedicated detail route; the alternative is a `?batch={id}` filter on `/dashboard/lessons`.
5. **How should the weekly mode behave when `firstStartsAt + weeks * 7d` straddles the summer boundary (June 1), where afternoon teaching hours change?** Current plan: picks at times outside the new season's teaching hours are flagged `outside_hours` in preview, parent moves or skips. Does Jason want the server to auto-suggest a morning time for summer weeks, or leave the whole decision with the parent?
6. **Price lock across the batch — same rule as single-lesson (completion-time pricing) or lock at booking?** The balance-events plan locks at completion today for single lessons. A batch spanning rate changes could cost the parent more or less than they expected. Deferred to the pricing plan if unchanged.
7. **Should an un-touched 60-day-old pending batch lesson trigger a different reminder than a single pending lesson?** v1 says no — the existing per-lesson expiry pass handles pending lessons individually and emits `request_expired`. No batch-level expiry email.
8. **Is 10 the right cap?** The decisions set 2–10. If Jason wants to allow longer batches (e.g., 12 for a trimester) the cap can go up without any schema impact; the only concern is the sync-service burst rate for a bigger batch, which is still comfortably under Google's quota.
9. **Does the summary email need an unsubscribe or preference link?** These are transactional emails, so no — ADR 028 explicitly rules them out of list traffic. Reconfirming because the volume per parent could spike at semester starts.
10. **What is the behavior if the household loses a swimmer (archival) between batch creation and some lessons starting?** Current plan: no action — the batch's lessons retain their `swimmer_ids`. Each lesson's state is independent of the batch rule.

---

## Rollout order

Each step is an independently shippable PR.

1. **PR A — Schema.** `booking_batches`, `lessons.batch_id`, outbox nullable + `batch_id` + CHECKs + partial unique indexes + event CHECK. Drizzle migration + snapshot. Doc updates to `docs/data-model.md`.
2. **PR B — Preview endpoint.** `POST /lessons/batch/preview`. Zod schemas in `packages/shared`. No writes. Integration-first tests on classification states and `conflicts_batch` detection.
3. **PR C — Submit.** `POST /lessons/batch`. Writes `booking_batches`, N lessons, N lesson_swimmers, one outbox row, one audit row, inside one transaction with the advisory-lock loop. Post-commit sync + sender microtasks. New React Email template for the summary. Multi-`VEVENT` `.ics` renderer. T1 / T2 / T3 / T6 / T7 pass here.
4. **PR D — Coach approve-all.** `PATCH /coach/lessons/batch/:batchId/approve-pending`. New outbox event `batch_approved`. T4 / T5 pass here.
5. **PR E — Web app.** New routes `/dashboard/book/batch` and `/dashboard/lessons/batch/:batchId`. Mode toggle, preview with inline conflict resolution, batch detail page. Dashboard entry point.
6. **PR F — Optional cancel-remaining.** `DELETE /lessons/batch/:batchId/remaining`. If Jason wants it in v1, ships before go-live; otherwise after.
7. **Doc updates (same PR as code):** `docs/data-model.md` entries; ADR 027 + ADR 028 lesson-change-path lists extended; `docs/plans/recurring-lessons.md` status banner (shelved); this plan's status flipped to Shipped at the end.

Each PR carries its own tests. Nothing above requires a backfill or a destructive migration.
