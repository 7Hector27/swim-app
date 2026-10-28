# Plan: Parent multi-lesson batch booking (manual + weekly repeat)

**Status:** Planning (Phase 1 implementation in progress)
**Branch:** `feature/batch-booking`
**ADR:** [030 — Parent multi-lesson batch booking](../decisions/030-parent-batch-booking.md)

---

## Overview

Parents book 2–20 lessons in one submission. Two modes: `manual` (an explicit list of 2–20 start times) and `weekly` (one or more weekdays at one time of day, a start date, and a weeks count — expanded to `weekdays.length * weeks` lessons, capped at 20 and strictly inside `bookingMaxAdvanceWeeks`). One household, one swimmer set, one pool, one duration per batch. Submission is all-or-nothing with per-day advisory locks, re-runs the slot engine under lock with the batch's other picks folded in as occupied, and writes `booking_batches` + N `lessons` + N `lesson_swimmers` + one `household_audit_log` row + one `lesson_email_outbox` row in a single transaction. Pool-scoped trust (ADR 021) decides whether every lesson lands as `approved` or `pending`. The parent gets exactly one email at creation — a summary listing confirmed and pending lessons with a multi-`VEVENT` `.ics` attached for the confirmed ones. Zero per-lesson `booking_requested` or `lesson_confirmed` emails for batch lessons. Later per-lesson changes continue to flow through the existing single-lesson routes and emit their own per-lesson events per ADR 028.

The single-lesson parent path at `POST /lessons` is unchanged. Coach booking at `POST /coach/lessons` (ADR 029) is unchanged. Viewers are rejected (403) at every batch write endpoint.

---

## Scope

**In (Phase 1):**
- `POST /lessons/batch/preview` — pure read, slot-engine-per-pick + conflict detection + nearby suggestions.
- `POST /lessons/batch` — one transaction, N lessons or none.
- Outbox changes: nullable `lesson_id`, new `batch_id`, exactly-one CHECK, two partial unique indexes, three new events (`batch_booked`, `batch_approved`, `batch_canceled`).
- `batch_booked` template, multi-`VEVENT` `.ics` renderer, send-time VEVENT filter.
- Owner/manager role enforcement on the server. Viewer 403.

**In (Phase 2):**
- Parent UI at `/dashboard/book/batch`: manual + weekly flows with inline conflict resolution.
- Small "part of your <date> batch" label on batch lesson cards on the dashboard.

**In (Phase 3):**
- `PATCH /coach/lessons/batch/:batchId/approve-pending` and the `batch_approved` template reuse.
- Coach pending list grouped by batch with an "Approve all" action per group.
- `DELETE /lessons/batch/:batchId/remaining` and the `batch_canceled` summary email with a `METHOD:CANCEL` multi-`VEVENT` `.ics`.

**Out:**
- Multi-pool batches. One pool per batch.
- Multi-household batches. One household per batch.
- Coach-created batches. Coach uses `POST /coach/lessons` per ADR 029.
- A dedicated batch detail route. Lessons carry a label on the normal dashboard; the summary email has the full list.
- An open-ended "every Tuesday forever" rule. See the shelved `recurring-lessons.md`.
- Series-level reschedule or this-and-future changes. Each batch lesson is reschedule/cancel-able individually through the existing single-lesson routes.
- Per-lesson emails inside a batch for Jason or anyone else. One summary at creation, one at approve-all, one at cancel-remaining.
- Reminders, unsubscribe links, batch-specific price lock. All deferred.

---

## Decisions already made (from Jason, after the revision pass)

- Parents only. Jason uses `/coach/book` for his own bookings.
- Per batch: one household, one pool. Length and swimmers are per pick: each manual pick and each weekly pattern entry carries its own `durationMinutes` AND its own `swimmerIds`. One batch can mix 30/45/60-minute lessons and run different kids on different picks or weekly slots. The server validates overlap, travel buffer, and daily cap against each pick's own length; lesson type (`private` vs `family`) is derived per pick from its swimmer count. (ADR 030 phase 2.)
- Two modes: `manual` (2–20 explicit picks) and `weekly` (one or more weekdays at one time of day, N weeks, cap 20 lessons, every lesson strictly inside `bookingMaxAdvanceWeeks`).
- Weekly never caps silently. Over-window lessons surface in the preview as `not_open_yet` with a count; submission rejects any over-window pick.
- Preview lists every lesson individually. Each unavailable lesson shows the reason and (where same-day alternatives exist) up to three suggestions. The parent either moves the lesson to a different open time or skips that specific lesson.
- Picks treat the batch's other picks as occupied for overlap, travel buffer, and daily cap.
- Submit is one transaction, all or nothing. Per-day advisory locks in ascending LA-date order. Re-run the slot engine for each pick under the lock. On any failure, roll back the whole transaction and return the specific conflicts.
- Owner or manager only on the server. Viewer gets 403.
- Approval under ADR 021 is pool-scoped; mixed approved/pending across the batch's lifetime is fine. Pending lessons keep normal per-lesson expiry.
- Coach "approve all" for the batch's pending lessons in one transaction, one audit entry, one summary email (Phase 3). Coach pending list grouped by batch (Phase 3).
- Parent "cancel remaining lessons in this batch" (future-dated only) **ships in v1** (Phase 3) and sends one summary `batch_canceled` email with a `METHOD:CANCEL` multi-`VEVENT` `.ics`.
- `booking_batches(id, household_id, created_by, mode, weekly_weekdays, weekly_time_of_day, weekly_start_date, weekly_weeks, created_at, updated_at)`. `lessons.batch_id` nullable FK.
- Outbox: `lesson_id` nullable, new `batch_id`, CHECK exactly one set, dedup + supersede defined for batch rows. One summary email per batch creation; one `.ics` with one `VEVENT` per approved lesson (per-lesson UID). No per-lesson `booking_requested` or `lesson_confirmed` emails for batch lessons. Later changes send normal per-lesson emails. Approve-all sends one summary email for the newly confirmed lessons. Cancel-remaining sends one summary email with the `METHOD:CANCEL` `.ics`.
- When sending any batch event, the renderer filters `payload.lessons[]` to only lessons whose current state still matches the snapshot (same `status`, same `calendar_sequence`, upcoming). Lessons changed since the snapshot are dropped from this `.ics` because they already got (or will get) their own per-lesson email.
- Google Calendar sync per approved lesson after commit, as today.
- Add batch paths to the lesson-change-path lists in ADR 027 and ADR 028.

See ADR 030 for the reasoning behind each.

---

## Data model

### New table — `booking_batches`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `household_id` | `uuid` | no | — | FK → `households.id` (`ON DELETE RESTRICT`). Historical reference. |
| `created_by` | `uuid` | no | — | FK → `profiles.id`. The parent who submitted. |
| `mode` | `text` | no | — | CHECK IN (`'manual'`, `'weekly'`). |
| `weekly_pattern` | `jsonb` | yes | — | Non-empty array of `{ weekday, timeOfDay, durationMinutes }`. NULL when `mode='manual'`. Each entry's length is independent so one batch can mix 30, 45, and 60-minute lessons. Validated with the shared `StoredWeeklyPatternSchema` on write and read. Added in migration 0056; replaces the aligned `weekly_pattern_weekdays` + `weekly_pattern_times` arrays from migration 0055. |
| `weekly_start_date` | `date` | yes | — | LA calendar date of the first candidate week. NULL when `mode='manual'`. |
| `weekly_weeks` | `integer` | yes | — | Count of weeks the parent requested. NULL when `mode='manual'`. |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | `$onUpdateFn`. Reserved; nothing writes to it in v1. |

CHECK:
```
((mode = 'weekly'
  AND weekly_pattern IS NOT NULL
  AND jsonb_typeof(weekly_pattern) = 'array'
  AND jsonb_array_length(weekly_pattern) >= 1
  AND weekly_start_date IS NOT NULL
  AND weekly_weeks IS NOT NULL)
 OR
 (mode = 'manual'
  AND weekly_pattern IS NULL
  AND weekly_start_date IS NULL
  AND weekly_weeks IS NULL))
```

Indexes: `(household_id, created_at desc)` for later dashboard listing.

RLS: `.enableRLS()` with no policies (API-only).

### `lessons` — new column

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `batch_id` | `uuid` | yes | — | FK → `booking_batches.id` (`ON DELETE RESTRICT`). Nullable because single-lesson bookings and coach bookings don't set it. Immutable after insert. |

### `lesson_email_outbox` — altered

1. `ALTER COLUMN lesson_id DROP NOT NULL`.
2. `ADD COLUMN batch_id uuid REFERENCES booking_batches(id) ON DELETE RESTRICT`.
3. Add CHECK `((lesson_id IS NOT NULL)::int + (batch_id IS NOT NULL)::int = 1)`.
4. Drop `UNIQUE (lesson_id, event, sequence)`.
5. Add two partial unique indexes:
   - `UNIQUE (lesson_id, event, sequence) WHERE lesson_id IS NOT NULL`
   - `UNIQUE (batch_id, event, sequence) WHERE batch_id IS NOT NULL`
6. Extend the CHECK on `event` to include `'batch_booked'`, `'batch_approved'`, `'batch_canceled'`.
7. Backfill: no action — existing rows all carry `lesson_id`.

Row shape for batch rows:
- `lesson_id = NULL`
- `batch_id = <batch.id>`
- `event IN ('batch_booked', 'batch_approved', 'batch_canceled')`
- `sequence` starts at 0 per `(batch_id, event)` pair
- `ics_method = NULL`, `ics_sequence = NULL` on the row itself (paired-nullability CHECK still holds)
- `payload.lessons[]` carries, per included lesson: `{ lessonId, startsAt, durationMinutes, status, calendarSequence, locationName, locationAddress, swimmerFirstNames }`. For `batch_booked` the payload lists every lesson (approved + pending); the renderer's send-time filter drops the pending ones from the `.ics` and keeps them in the body list. For `batch_approved` the payload lists only the newly-approved lessons. For `batch_canceled` the payload lists only the canceled lessons.

### `household_audit_log` — new action values

Free-text column; no schema change. New values:
- `lesson_batch_booked`
- `lesson_batch_approved`
- `lesson_batch_canceled_remaining`

Payload shape per action lives in the API-side implementation; the schema already has `payload jsonb` from ADR 029's migration.

### Drizzle migration

Generated via `pnpm db:generate --name=parent_batch_booking` using the `add-db-table` skill. One file. Applied locally before Phase 1 endpoints land.

### `docs/data-model.md`

Phase 1 updates:
- New `### booking_batches` section (placed after `### lesson_email_outbox`).
- Amend `### lessons` with the `batch_id` row.
- Amend `### lesson_email_outbox` with the new column, nullable `lesson_id`, the CHECK, the two partial unique indexes, and the extended `event` CHECK values.

---

## Shared Zod schemas

In `packages/shared/src/schemas/booking.ts`, exported from `packages/shared/src/index.ts`.

```ts
export const BatchModeSchema = z.enum(["manual", "weekly"]);
export type BatchMode = z.infer<typeof BatchModeSchema>;

export const BatchPickSchema = z.object({
  startsAt: z.string().datetime({ offset: true }),
  durationMinutes: LessonDurationMinutesSchema,
  // Each pick carries its own swimmer set (ADR 030 phase 2).
  swimmerIds: z.array(z.string().uuid()).min(1).max(4),
});
export type BatchPick = z.infer<typeof BatchPickSchema>;

// ── Preview ────────────────────────────────────────────────────────────────────

const BATCH_LESSON_MIN = 1;
const BATCH_LESSON_MAX = 20;

export const BatchPatternPairSchema = z.object({
  // ISO weekday (1=Mon … 7=Sun).
  weekday: z.number().int().min(1).max(7),
  // Local America/Los_Angeles time, zero-padded. Example: "16:30".
  timeOfDay: z.string().regex(/^\d{2}:\d{2}$/, "timeOfDay must be HH:MM"),
  durationMinutes: LessonDurationMinutesSchema,
  // Each pattern entry carries its own swimmer set (ADR 030 phase 2).
  swimmerIds: z.array(z.string().uuid()).min(1).max(4),
});

export const BatchManualPreviewBodySchema = z.object({
  mode: z.literal("manual"),
  householdId: z.string().uuid(),
  locationId: z.string().uuid(),
  // Each pick carries its own durationMinutes AND its own swimmerIds so one
  // batch can mix lengths and mix swimmer sets across picks. The server
  // validates every unique swimmer against the household in a single pass
  // before any availability check runs.
  picks: z.array(BatchPickSchema).min(BATCH_LESSON_MIN).max(BATCH_LESSON_MAX),
});

export const BatchWeeklyPreviewBodySchema = z.object({
  mode: z.literal("weekly"),
  householdId: z.string().uuid(),
  locationId: z.string().uuid(),
  // Ordered list of (weekday, timeOfDay, durationMinutes, swimmerIds)
  // entries. Each pattern entry owns its own swimmer set; every candidate
  // expanded from an entry inherits those swimmers unchanged.
  pattern: z.array(BatchPatternPairSchema).min(1).max(BATCH_LESSON_MAX),
  // LA calendar date of the first candidate week.
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD"),
  weeks: z.number().int().min(1).max(BATCH_LESSON_MAX),
}).refine(
  (body) => body.weekdays.length * body.weeks >= BATCH_LESSON_MIN,
  { message: `A batch must have at least ${BATCH_LESSON_MIN} lessons.` },
).refine(
  (body) => body.weekdays.length * body.weeks <= BATCH_LESSON_MAX,
  { message: `A batch cannot have more than ${BATCH_LESSON_MAX} lessons.` },
);

export const BatchPreviewBodySchema = z.discriminatedUnion("mode", [
  BatchManualPreviewBodySchema,
  BatchWeeklyPreviewBodySchema,
]);
export type BatchPreviewBody = z.infer<typeof BatchPreviewBodySchema>;

// ── Preview response ──────────────────────────────────────────────────────────

export const BatchPickStateSchema = z.enum([
  "available",
  "unavailable",       // overlaps another approved/pending lesson or fails buffer / cap
  "too_soon",          // inside bookingMinAdvanceHours
  "past",              // startsAt < now
  "not_open_yet",      // beyond bookingMaxAdvanceWeeks
  "outside_hours",     // outside teaching hours for that LA day
  "blocked_time",      // overlaps a blocked_times row
  "day_closed",        // teaching day not open
  "conflicts_batch",   // overlaps another pick in the same submission
]);
export type BatchPickState = z.infer<typeof BatchPickStateSchema>;

export const BatchPickSuggestionSchema = z.object({
  startsAt: z.string().datetime({ offset: true }),
});

export const BatchPreviewPickSchema = z.object({
  // Stable index into the submission's expanded candidate list, so overrides/skips in submit can address it.
  index: z.number().int().nonnegative(),
  startsAt: z.string().datetime({ offset: true }),
  state: BatchPickStateSchema,
  reason: z.string().optional(),
  suggestions: z.array(BatchPickSuggestionSchema).max(3).optional(),
});

export const BatchPreviewResponseSchema = z.object({
  needsApproval: z.boolean(),
  picks: z.array(BatchPreviewPickSchema),
});
export type BatchPreviewResponse = z.infer<typeof BatchPreviewResponseSchema>;

// ── Submit ────────────────────────────────────────────────────────────────────

export const BatchManualSubmitBodySchema = BatchManualPreviewBodySchema;

export const BatchWeeklyOverrideSchema = z.object({
  index: z.number().int().nonnegative(),
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
```

Phase 3 adds `CoachBatchApproveResponseSchema` and `BatchCancelRemainingResponseSchema`.

Validation notes:
- Weekly `weeks` and `weekdays` are jointly bounded so the expanded candidate list is `[2, 20]`. This check lives in `.refine` because it crosses two fields.
- Over-window picks are not rejected at the schema layer. The server reports them in the preview as `not_open_yet` and rejects the submission on write if any over-window pick is included.
- Manual `picks` must be unique on `startsAt` (`.refine`) — duplicates are a client bug and should 422.
- Weekly `overrides`/`skips` reference the expanded candidate index (0-based across all weekdays × weeks).

---

## API

### `POST /lessons/batch/preview`

Parent-only. Middleware chain:
`requireUser → requireParent → requireHouseholdMember → requireHouseholdOwnerOrManager → validate({ body: BatchPreviewBodySchema })`.

`requireHouseholdOwnerOrManager` is a new one-liner that rejects `req.householdRole === 'viewer'` with 403. It composes after `requireHouseholdMember` populates `req.householdRole`.

Flow:
1. Verify `req.householdId === body.householdId`. 403 if not.
2. Verify every swimmer referenced by any pick / pattern entry belongs to the household and is not archived (union: `collectBatchSwimmerIds(body)` for both modes). 422 if any swimmer fails the check.
3. Compute candidate picks and expanded candidate list `candidates[]`:
   - Manual: `candidates = body.picks` directly, index = array position.
   - Weekly: compute each `(weekIndex, weekdayIndex)` pair's `startsAt` by taking `startDate + weekIndex * 7 days`, advancing to the next occurrence of each listed `weekday`, applying `timeOfDay` in the LA zone. The expanded list is in week-then-weekday order; each pick has a stable `index` across the whole batch.
4. Resolve `needsApproval(householdId, locationId)` once.
5. For each candidate pick, run `computeAvailableSlots` for its LA day with:
   - All existing pending/approved lessons for that day (unchanged).
   - **Plus** every other candidate pick in the batch, folded in as if it were an approved lesson. This ensures a batch's own picks respect overlap, travel buffer, and daily cap against each other.
6. Classify each pick:
   - If `startsAt < now()` → `past`.
   - If `startsAt > now() + bookingMaxAdvanceWeeks` → `not_open_yet`.
   - If `startsAt < now() + bookingMinAdvanceHours` → `too_soon`.
   - If the day's `dayState = closed` → `day_closed`.
   - If `startsAt` is outside the day's teaching windows → `outside_hours`.
   - If overlaps a `blocked_times` row → `blocked_time`.
   - If overlaps another pick in the batch (after fold-in) → `conflicts_batch`.
   - If overlaps an existing pending/approved lesson or fails travel-buffer / daily-cap → `unavailable`.
   - Otherwise → `available`.
7. For every non-`available` pick, compute up to three nearby open slots on the same LA day (closest to the pick's `startsAt`, respecting the batch's other picks). Omit `suggestions` when the day has nothing open.
8. Return `BatchPreviewResponseSchema`.

Response: 200 with `BatchPreviewResponseSchema`.
- 403 on `householdId` mismatch or viewer role.
- 422 on invalid swimmers.

No lock, no write.

### `POST /lessons/batch`

Parent-only. Same middleware (`requireHouseholdOwnerOrManager` enforces role at server). Body: `BatchSubmitBodySchema`.

Flow:
1. Verify `req.householdId === body.householdId` and swimmers (same as preview).
2. Compute **final picks** from the mode:
   - Manual: `body.picks`.
   - Weekly: expand candidates by week × weekday with the stable index, then remove indices in `body.skips`, then apply `body.overrides` by replacing the candidate's `startsAt`.
3. Validate final-pick count `[2, 20]`. 422 `picks_underflow`/`picks_overflow` if outside.
4. **Open the transaction. Insert `booking_batches` first.** For weekly mode, record `weekly_weekdays`, `weekly_time_of_day`, `weekly_start_date`, `weekly_weeks` on the row.
5. Compute the unique set of LA dates across final picks. **Sort ascending.** For each date, `pg_advisory_xact_lock(hashtext('lesson-day:' || laDate))` inside the transaction.
6. Call `needsApproval(householdId, locationId)` once.
7. For each pick in `startsAt` ascending order:
   a. Build the "existing occupied set" from DB lessons on that day **plus** the batch's other picks (fold-in).
   b. Call `computeAvailableSlots` for that day with the fold-in; apply the parent-only `bookingMinAdvanceHours` filter.
   c. Reject `not_open_yet` (any pick strictly past `now + bookingMaxAdvanceWeeks`).
   d. If the pick's `startsAt` is not in the returned set or is `not_open_yet`, record the pick as a conflict with its state. On any conflict, roll back the transaction and return 422 `picks_conflict` with the per-pick list.
8. Insert N `lessons` rows:
   - `status`: `'approved'` if `!needsApproval` else `'pending'`.
   - `approved_at`: `now()` if approved; `NULL` otherwise.
   - `approved_by`: `NULL` either way (system auto-approval when approved; `NULL` on pending).
   - `requested_by`: the submitting profile id.
   - `expires_at`: `starts_at − bookingMinAdvanceHours` for pending; `NULL` for approved.
   - `batch_id`: the just-inserted batch's id.
9. Insert `lesson_swimmers` rows: for each lesson, one row per swimmer in that pick's / pattern entry's `swimmerIds`. The counts can differ per lesson so one batch can mix private and family rows.
10. For each approved lesson, snapshot `calendar_sequence` (initial `0`) into the outbox payload, then set `calendar_sequence = 1` and `calendar_invite_sent_at = now()`. **Only approved lessons bump their sequence.** Pending lessons get their first invite later (through approve-all or per-lesson approve).
11. Resolve recipient profile ids via `SELECT profile_id FROM household_members WHERE household_id = :h AND role IN ('owner','manager')`.
12. Insert one `lesson_email_outbox` row:
    - `batch_id = <new batch id>`, `lesson_id = NULL`
    - `event = 'batch_booked'`, `sequence = 0`
    - `recipient_profile_ids = <resolved>`
    - `ics_method = NULL`, `ics_sequence = NULL`
    - `payload`: see payload shape below
13. Insert one `household_audit_log` row with `action='lesson_batch_booked'`, `actor_id=<requester>`, `household_id`, `target_swimmer_id=NULL`, `payload={ batchId, mode, locationId, swimmerIds: <union across all picks/pattern entries>, picks: [{ lessonId, startsAt, durationMinutes, status }], ...weekly fields if applicable }`. Each pick carries its own `durationMinutes` AND `swimmerIds` so a mixed-length + mixed-swimmer batch stays reconstructible via the `lesson_swimmers` join.
14. Commit.
15. After `res.json()`:
    - For each approved lesson, `queueMicrotask(() => void syncLessonToGoogle(id))`.
    - `queueMicrotask(() => void sendLessonEmailOutboxRow(outboxId))`.

Response: 201 with `BatchSubmitSuccessResponseSchema`. On any conflict, 422 with `BatchSubmitConflictResponseSchema` and the whole transaction rolled back.

### `batch_booked` outbox payload

```jsonc
{
  "batchId": "uuid",
  "mode": "manual" | "weekly",
  "weekly": {                        // only when mode = 'weekly'
    "pattern": [
      { "weekday": 2, "timeOfDay": "16:30", "durationMinutes": 30 },
      { "weekday": 4, "timeOfDay": "16:30", "durationMinutes": 45 }
    ],
    "startDate": "2026-11-02",
    "weeks": 8
  },
  "locationId": "uuid",
  "locationName": "Egret Park",
  "locationAddress": "45 Ovation, Irvine, CA 92620",
  "swimmerFirstNames": ["Alex"],
  "deepLink": "/dashboard",
  "lessons": [
    {
      "lessonId": "uuid",
      "startsAt": "2026-11-04T16:30:00-08:00",
      "status": "approved" | "pending",
      "calendarSequence": 0,         // snapshot at write time; renderer verifies at send time
      "locationName": "Egret Park",
      "locationAddress": "..."       // follows the ADR 028 home-pool privacy rule
    }
  ]
}
```

### Future endpoints (Phase 3)

- `PATCH /coach/lessons/batch/:batchId/approve-pending` — writes `batch_approved` outbox row. Shape covered in ADR 030.
- `DELETE /lessons/batch/:batchId/remaining` — writes `batch_canceled` outbox row with `payload.lessons[]` carrying only the canceled lessons; the renderer builds a `METHOD:CANCEL` `.ics` with one `VEVENT` per canceled lesson (each with incremented `calendar_sequence`).

Zod schemas and route details for Phase 3 land with Phase 3's commit; the Phase 1 schemas above cover preview + submit only.

---

## Transaction and lock order (Phase 1 submit)

```
BEGIN;

  INSERT booking_batches (id, household_id, created_by, mode,
                          weekly_weekdays, weekly_time_of_day,
                          weekly_start_date, weekly_weeks, created_at)
    VALUES (...);

  -- Deterministic lock order; sort ascending to avoid deadlock with single-lesson writes.
  FOR each unique LA_date IN sorted(picks) ASC DO
    SELECT pg_advisory_xact_lock(hashtext('lesson-day:' || LA_date));
  END FOR;

  -- Pool-scoped trust check, one call.
  needsApproval := needsApproval(household_id, location_id);

  -- Re-check every pick under the lock, with batch's other picks folded in.
  FOR pick IN picks ORDER BY starts_at ASC DO
    IF pick.starts_at > now() + bookingMaxAdvanceWeeks THEN
      ROLLBACK;
      RETURN 422 picks_conflict (not_open_yet for pick);
    END IF;
    occupied := existing_lessons_for_day(pick.day)
                UNION other_batch_picks_in_same_day_except(pick);
    available_set := computeAvailableSlots(day, duration, location, occupied,
                                           parent_min_advance_hours=true);
    IF pick.starts_at NOT IN available_set THEN
      ROLLBACK;
      RETURN 422 picks_conflict with specific state;
    END IF;
  END FOR;

  INSERT INTO lessons (..., batch_id, status, approved_at, expires_at, calendar_sequence) VALUES
    (...),  -- status = approved OR pending per needsApproval
    ...;

  INSERT INTO lesson_swimmers (lesson_id, swimmer_id) VALUES
    (...), ...;

  -- Approved lessons: snapshot 0 into payload, bump to 1, set calendar_invite_sent_at.
  UPDATE lessons SET calendar_sequence = 1, calendar_invite_sent_at = now()
    WHERE id = ANY(approved_lesson_ids);

  INSERT INTO lesson_email_outbox (
    batch_id, lesson_id = NULL, event = 'batch_booked', sequence = 0,
    recipient_profile_ids, payload, ics_method = NULL, ics_sequence = NULL, ...
  );

  INSERT INTO household_audit_log (
    household_id, actor_id, action = 'lesson_batch_booked',
    target_swimmer_id = NULL, payload
  );

COMMIT;

-- Post-commit microtasks.
for each approved_lesson_id: queueMicrotask(() => void syncLessonToGoogle(lessonId));
queueMicrotask(() => void sendLessonEmailOutboxRow(outboxId));
```

**Lock-ordering invariant:** every batch acquires per-day locks in ascending LA-date order. Single-lesson bookings acquire exactly one day lock. Any two concurrent writers on overlapping days therefore acquire locks in the same relative order, so no deadlock is possible. The transaction never calls out to Google or Resend; those are post-commit microtasks.

---

## Preview and conflict response shapes

Preview response:

```jsonc
{
  "needsApproval": false,
  "picks": [
    { "index": 0, "startsAt": "2026-11-04T16:30:00-08:00", "state": "available" },
    { "index": 1, "startsAt": "2026-11-06T16:30:00-08:00", "state": "available" },
    { "index": 2, "startsAt": "2026-11-11T16:30:00-08:00",
      "state": "blocked_time", "reason": "coach_vacation",
      "suggestions": [
        { "startsAt": "2026-11-11T17:00:00-08:00" },
        { "startsAt": "2026-11-11T17:30:00-08:00" }
      ]
    },
    { "index": 15, "startsAt": "2027-02-02T16:30:00-08:00",
      "state": "not_open_yet", "reason": "beyond_booking_window" }
  ]
}
```

Submit conflict response (422):

```jsonc
{
  "error": "picks_conflict",
  "conflicts": [
    { "index": 2, "startsAt": "2026-11-11T16:30:00-08:00",
      "state": "blocked_time", "reason": "coach_vacation" },
    { "index": 4, "startsAt": "2026-12-02T16:30:00-08:00",
      "state": "unavailable", "reason": "slot_taken_since_preview" }
  ]
}
```

---

## Email

### Template

Phase 1 ships one React Email template at `apps/api/src/services/emails/templates/Batch.tsx`, parameterized by `event`. Phase 1 only exercises the `batch_booked` branch; Phase 3 reuses the same template for `batch_approved` and `batch_canceled`.

### Subject lines (Phase 1 — `batch_booked`)

- All confirmed, manual mode: "Your {N} lessons at {pool} are booked"
- All confirmed, weekly mode: "Your {N} weekly lessons at {pool} are booked"
- All pending: "Request received: {N} lessons at {pool}"
- Mixed: "{N} lessons at {pool}: {C} confirmed, {P} waiting for Jason"

Phase 3 adds `batch_approved` and `batch_canceled` subjects.

### Body outline

```
Hi {firstName},

{summary paragraph: counts, mode, pool}

Confirmed lessons
──────────────────────
{for each approved lesson in the filtered payload:}
  {day} {date} at {time}
  {duration} min · {pool}
  {address if the privacy rule allows}

Waiting for Jason                                   -- batch_booked only
──────────────────────
{for each pending lesson in the filtered payload (batch_booked only):}
  {day} {date} at {time}
  {duration} min · {pool}
  Expires {X hours} before start if Jason doesn't respond

View your lessons
  {deep link to /dashboard}

{footer}
```

### Attached `.ics` and send-time filter

- One `VCALENDAR` with one `VEVENT` per lesson that **both** was in the payload snapshot AND currently matches that snapshot:
  - Lesson's `status` matches (`approved` for `batch_booked`/`batch_approved`; `canceled` for `batch_canceled`).
  - Lesson's `calendar_sequence` equals the snapshot's `calendarSequence`.
  - Lesson's `starts_at > now()` (CANCEL rows are exempt from the start-time check, matching ADR 028).
- Lessons that fail the filter are dropped from the `.ics` **and** rendered as a soft "already changed" note in the email body (for example, "Note: 1 lesson changed before this email went out; you'll receive a separate note about it."). The body text still lists the lessons, just without an inline invite row.
- Each `VEVENT` carries:
  - `UID:${lessonId}@axiomaquatics.io` — per-lesson UID preserved so later per-occurrence reschedules can supersede via `SEQUENCE:N`.
  - `SEQUENCE` from the lesson's current `calendar_sequence` (which, for `batch_booked`, equals the snapshot's 0 — the sequence was already incremented inside the submit transaction).
  - `DTSTART` / `DTEND` from `startsAt` + `durationMinutes`.
  - `SUMMARY` using the swimmer-first-name rule (ADR 028).
  - `LOCATION` using the home-pool / named-pool rule (ADR 028).
  - `DTSTAMP` at render time.
- `METHOD:REQUEST` for `batch_booked` and `batch_approved`; `METHOD:CANCEL` for `batch_canceled`.

The `.ics` body is a pure function of the filtered `payload.lessons[]` plus `now()`. If the filter leaves zero `VEVENT`s, the renderer still sends the email (the body still has useful information: "the batch you booked is no longer in the state we snapshotted; see your dashboard") but attaches no `.ics`. The supersede rule above catches the opposite case where the whole batch is terminal/past — in that case the row is `superseded` and nothing goes out.

---

## Integration with existing systems

### ADR 027 — Google Calendar sync

No new sync surface. Approved batch lessons get `syncLessonToGoogle(id)` scheduled per-lesson post-commit. ADR 027's lesson-change-path list grows by:

- `POST /lessons/batch` (one microtask per approved lesson)
- `PATCH /coach/lessons/batch/:batchId/approve-pending` (Phase 3)
- `DELETE /lessons/batch/:batchId/remaining` (Phase 3)

### ADR 028 — Email outbox

Covered above. Changes:

- Outbox columns and constraints (nullable `lesson_id`, new `batch_id`, two partial unique indexes, CHECK on event, CHECK on exactly-one).
- Three new events (`batch_booked`, `batch_approved`, `batch_canceled`).
- One new template (shared, parameterized by event with METHOD/REQUEST vs METHOD/CANCEL branch).
- `.ics` renderer gains a batch branch that walks `payload.lessons[]`, applies the send-time filter, and produces either `METHOD:REQUEST` or `METHOD:CANCEL`.
- Supersede rules for batch rows (newer sent batch row + all-terminal/all-past + zero-after-filter).

ADR 028's lesson-change-path list grows the same way as ADR 027's.

### ADR 029 — Coach booking

No interaction. Coach bookings don't batch; they stay on `POST /coach/lessons`. The coach convenience path `PATCH /coach/lessons/batch/:batchId/approve-pending` (Phase 3) operates on parent-created batches only.

### Shelved recurring plan

`docs/plans/recurring-lessons.md` stays **shelved**. The `lesson_series` rule shape (cron-extended window, per-occurrence vs this-and-future, open-ended rules) is deferred. If Jason later wants an open-ended "every Tuesday forever" rule, that doc is the starting point.

---

## Test plan (Phase 1, integration-first, each behavior once)

All under `apps/api/src/__tests__/integration/parentBatchBooking.integration.test.ts`. One file, nine `it(...)` blocks (one per listed behavior) grouped under a few top-level `describe` sections for readability. Shared helpers from `apps/api/src/__tests__/integration/helpers.ts`. Each test seeds its own household + swimmer + pool + (where needed) existing lessons.

**T1 — all-or-nothing rollback.** Seed a trusted-household batch with 3 valid picks. Insert a conflicting approved lesson for pick 2 just before submit. **Assert** 422 `picks_conflict` on pick 2; zero `lessons` for this batch; zero `booking_batches` rows; zero `household_audit_log` rows with `action='lesson_batch_booked'`; zero `lesson_email_outbox` rows with the batch id.

**T2 — picks conflicting through buffer and daily cap.** Seed an existing Pool B lesson at 3:00 PM on the test day. Submit a manual batch with (3:15 PM Pool A, 4:00 PM Pool A, 45 min). **Assert** preview flags pick 0 as `unavailable` (buffer against Pool B lesson) and pick 1 as `conflicts_batch` (overlaps pick 0's duration + batch's own occupancy). Submit returns 422 with both picks listed. Zero rows written.

**T3 — weekly with two weekdays generates the right dates.** Seed a trusted household. Preview a weekly batch with `weekdays=[2, 4]` (Tue + Thu), `timeOfDay="16:30"`, `startDate=2026-11-02` (a Monday), `weeks=3`. **Assert** the response has 6 picks in order: Tue 2026-11-03, Thu 2026-11-05, Tue 2026-11-10, Thu 2026-11-12, Tue 2026-11-17, Thu 2026-11-19 — each at 16:30 LA.

**T4a — a flagged week moved (server side).** Block 2026-11-18 4:00–5:00 PM. Preview a weekly batch at 4:30 PM for 4 Wednesdays starting 2026-11-04. Submit with `overrides=[{ index: 2, startsAt: '2026-11-18T15:00:00-08:00' }]`. **Assert** 201; four lessons written; the third at 2026-11-18T15:00:00-08:00; one `batch_booked` outbox row.

**T4b — a flagged week skipped (server side).** Same seed as T4a. Submit with `skips=[2]`. **Assert** 201; three lessons written; none on 2026-11-18; one `batch_booked` outbox row with three entries in `payload.lessons`.

**T5 — batch rejected when over cap or past the window.** (a) Submit a manual batch with 21 picks → schema 422. (b) Submit a weekly batch where any expanded pick falls past `now + bookingMaxAdvanceWeeks` → preview shows `not_open_yet` for those; submit returns 422 `picks_conflict` on the first over-window pick. Zero rows written in both cases.

**T6 — viewer gets 403.** Add a viewer to the household. Submit any batch body from the viewer's session. **Assert** 403 on both preview and submit; zero rows written.

**T7 — one email with the right invites and no per-lesson booking emails.** Trusted-household 4-pick manual batch (all approved). **Assert**: exactly one outbox row with `batch_id=:b AND event='batch_booked'`; zero rows with `lesson_id IN (:batchLessonIds) AND event IN ('booking_requested','lesson_confirmed')`; the row's `payload.lessons` has 4 entries each with `calendarSequence=0`; the row's `ics_method` is NULL and `ics_sequence` is NULL. Then: reschedule one of the lessons via `PATCH /lessons/:id`; **assert** this emits a standard per-lesson `lesson_rescheduled` outbox row (unchanged ADR 028 path).

**T8 — a lesson canceled before the summary sends is left out of its .ics.** Trusted-household 3-pick manual batch. Immediately after `POST /lessons/batch` returns 201 (but before the sender actually finishes), cancel one of the three lessons via `DELETE /lessons/:id`. Then run the outbox sender directly (bypassing the post-commit microtask, which may have raced). **Assert** the batch_booked email is sent, its `.ics` has only 2 `VEVENT`s, and the canceled lesson's `VEVENT` is absent; the per-lesson cancel path has written its own `lesson_canceled` outbox row that will carry the `METHOD:CANCEL` for the canceled lesson.

**T9 — concurrent single-lesson booking vs batch booking on the same day.** Trusted household. In parallel via `Promise.all`, fire a single-lesson booking at 2026-11-04 4:30 PM AND a batch submit including that same slot. **Assert** exactly one commits (verified by `COUNT(*) FROM lessons WHERE starts_at = ... AND status IN ('pending','approved')`); the other returns `slot_unavailable` (single-lesson path) or `picks_conflict` (batch path). Advisory lock ordering guarantees serialization.

### Unit coverage (same PR, alongside the integration file)

- Zod schema edge cases: `weekdays=[]` (rejected), `weeks=0` (rejected), weekly expansion over cap (rejected), duplicate `startsAt` in manual picks (rejected), `overrides` for a non-existent `index` (rejected).
- Multi-`VEVENT` `.ics` composition: snapshot test on the output for a 4-approved-lesson batch.
- Send-time filter: unit test the per-condition behavior (sequence mismatch, status mismatch, past, canceled).

### Not covered in Phase 1

- Phase 3 approve-all + cancel-remaining tests. Those tests live in the Phase 3 commit alongside the endpoints they exercise.
- Load / concurrency past the two-request case in T9.
- Cross-client email rendering. React Email's preview server handles that.

---

## Open questions (post-revision)

**Resolved:**
- Cancel-remaining ships in v1 with its own `batch_canceled` event.
- No per-lesson emails inside a batch for Jason.
- No batch detail page in v1; dashboard shows a small per-card label.
- No reminders beyond the existing per-lesson expiry.
- No unsubscribe link (transactional email).
- Cap is 20 lessons.
- Price lock is deferred to the payments plan.
- Archived swimmers behave as in single-lesson booking (lesson rows retain their `swimmer_ids`).
- Season changes surface through the preview's existing flags (`outside_hours`, `day_closed`).

**Remaining open (not blockers for Phase 1):**
- Should the dashboard batch label show the mode ("part of your weekly batch") or just the date ("part of your Nov 4 batch")? Default: date. Decided in Phase 2 when the UI lands.
- Should concurrent approve-all + per-lesson approve on the same batch be handled with any special audit? Default: the per-lesson approve wins its lesson; approve-all picks up whatever is still pending at its transaction's `FOR UPDATE`. Phase 3 concern.

---

## Rollout — one PR, three phases

- **Phase 1 (this commit series).** Schema (`booking_batches` with weekly columns, `lessons.batch_id`, outbox alterations), `POST /lessons/batch/preview`, `POST /lessons/batch`, `batch_booked` outbox row + template + multi-`VEVENT` `.ics` with send-time filter, integration tests. No UI.
- **Phase 2.** Parent UI at `/dashboard/book/batch` with the manual + weekly flows and per-pick inline conflict resolution. Dashboard entry points and a per-card batch label.
- **Phase 3.** `PATCH /coach/lessons/batch/:batchId/approve-pending` with `batch_approved`. Coach pending list grouped by batch with "Approve all" per group. `DELETE /lessons/batch/:batchId/remaining` with `batch_canceled` + `METHOD:CANCEL` multi-`VEVENT` `.ics`.
- **Doc updates (each phase's commit set):** `docs/data-model.md` entries; ADR 027 + ADR 028 lesson-change-path lists; this plan's status flipped to Shipped after Phase 3.

Nothing in any phase requires a backfill or a destructive migration.
