# Plan: Coach booking on behalf of a family

**Status:** Planning
**Branch:** `feature/coach-booking` (stacked on `feature/parent-booking-emails`)
**ADR:** [029 — Coach booking on behalf of a family](../decisions/029-coach-booking.md)

---

## Overview

A coach-only "Book lesson" flow that lets Jason create an approved lesson for any household without going through pending. The flow reuses the existing booking calendar components, the slot engine, the booking transaction (advisory day lock + slot re-check), the Google Calendar sync hook, and the email outbox. The one new piece is a custom-time path that lets Jason book outside his teaching hours or inside the 16-hour notice window, with warnings for travel buffer and daily-cap violations he can acknowledge.

Entry points:
- `/coach/schedule` — a "Book lesson" button on the day view and the week view.
- `/coach/swimmers/[id]` — a "Book lesson" button pre-filled with that swimmer and their household.

Mobile-first; Jason uses this on the pool deck.

**Explicitly out of scope:** recurring lessons, booking for families without an account, payments/packages.

---

## Decisions already made (see ADR 029)

- Coach-only. No parent-facing surface area.
- Household picker searches by swimmer name or family name; swimmer picker is scoped to the chosen household (siblings never mix families); archived swimmers are skipped.
- Location choices: the household's active home pool and any named pool.
- Approved immediately, no pending step. `approved_by = <coach profile id>` (ADR 021 distinguishes system auto-approval, `approved_by = null`, from coach approval, `approved_by` non-null — this path uses the non-null form).
- Audit log entry (`household_audit_log`, `action = 'lesson_booked_by_coach'`) written in the **same transaction** as the lesson insert (CLAUDE.md rule).
- Trust: a coach-booked approved lesson counts as trust at that pool for that household, same as any other approved lesson under ADR 021. The approval gate `needsApproval()` already checks `status IN ('approved', 'completed')` without looking at `approved_by`, so this is free.
- Parents can cancel and reschedule coach-booked lessons the same as their own — no code change needed; the existing `DELETE /lessons/:id` and `PATCH /lessons/:id` already allow managers/owners to act on any lesson in their household.
- Emails: the family gets the existing `lesson_confirmed` outbox event with the `.ics` invite. Copy varies on `initiatedBy = 'coach'` so the body says "Jason scheduled a lesson for you" rather than "Your lesson is confirmed." No new outbox event, no new template file — only a payload field and a conditional in the existing template.
- Calendar sync fires after commit via the standard `queueMicrotask(() => void syncLessonToGoogle(id))` hook. This path is added to the list of lesson-change paths in ADR 027 and ADR 028.
- Custom-time override: time overlap with any existing pending/approved lesson is a **hard reject** (the advisory day lock plus the same slot-overlap check as parent booking). Travel-buffer and daily-cap violations show warnings the coach can accept and submit. Outside teaching hours and inside the 16-hour notice window are warnings. The UI makes the warning explicit before confirming.
- **The server is the sole computer of override warnings.** The client sends `overrideWindow: boolean` plus an `acknowledgedWarnings` object describing which warnings the coach already saw-and-accepted. The server recomputes every warning from the request against the live DB state and returns `409 warnings_not_acknowledged` with the list of newly-computed warnings if the client's acknowledgement set is missing any of them. The audit log records the server-computed flags, never the client's — a client cannot "pre-acknowledge" a warning that doesn't actually apply, and cannot avoid auditing a warning that does.

---

## Data model

**No new columns on `lessons`.** The existing shape covers it:

- `status = 'approved'`, `approved_at = now()`, `approved_by = <coach profile id>` (non-null, per ADR 021).
- `requested_by = <coach profile id>`. The coach is the requester. The audit-log row below is the authoritative "booked by coach" signal; callers who need to tell the two mechanisms apart (parent vs. coach) can join `requested_by → profiles.role`.
- `expires_at = null` (same as any auto-approved booking).

**`lessons.requested_by` read audit.** Nothing in `apps/api/src/` (routes, services, lib), nothing in `apps/web/src/`, and nothing in `packages/shared/src/` reads `lessons.requested_by`. The only writer is `POST /lessons` at `apps/api/src/routes/lessons.ts:580`. The column is not surfaced in any response schema, not joined into any read query, and not referenced by any outbox-write or Google-sync code path. No code assumes the requester is a household member, because no code reads the column at all. Writing a coach profile id here therefore cannot break any existing read path — a prerequisite the plan was correct to call out even though it turned out trivially satisfied. Tests seed the column with the owner's profile id, which stays the common case for parent bookings; the new coach path will write the coach's profile id with no downstream consequence.

**One new column on `household_audit_log`:** `payload jsonb` (nullable). See the "Audit log" subsection below. One-line migration generated via `pnpm db:generate`.

**No new column on `profiles`.**

**No new tables.**

### Audit log

A new `action` value on the existing `household_audit_log` table:

- `action = 'lesson_booked_by_coach'`
- `actor_id = <coach profile id>`
- `household_id = <booked household id>`
- `target_swimmer_id`: null — the junction `lesson_swimmers` carries the swimmer list; the audit log has only one `target_swimmer_id` column and we don't want to pick one of several siblings. The lesson id is in `payload` instead.
- `payload` (jsonb — see migration note): `{ lessonId, locationId, startsAt, durationMinutes, swimmerIds: uuid[], override: null | { outsideHours: boolean, insideNoticeWindow: boolean, maxAdvanceExceeded: boolean, travelBufferViolated: boolean, dailyCapExceeded: boolean, blockedTimeOverlap: boolean } }`. **The booleans are the server-computed flags**, not the client's acknowledgements — the server never trusts the client to self-report which warnings fired. `override` is `null` for a submission that triggered zero warnings, otherwise the full object with each flag at its true/false server value.

**Migration required.** `household_audit_log` has no `payload jsonb` column today (unlike `coach_audit_log`, which added one in migration 0048 for the retry-batch summary). Phase 1 adds the column via `pnpm db:generate`. One line, nullable, no backfill needed. Mirrors the exact shape of `coach_audit_log.payload` so the two audit tables stay consistent.

Written **inside the same `db.transaction()`** as the lesson insert and the `lesson_swimmers` inserts. If any of the three writes fail, the whole thing rolls back — CLAUDE.md rule.

### Email outbox payload

Per ADR 028, `lesson_email_outbox` payloads carry whatever the template needs. The `LessonEmailPayload` interface gains a field:

- `initiatedBy: 'parent' | 'coach' | null`

For `lesson_confirmed` events, `initiatedBy` is `'coach'` when a coach booked and `'parent'` when a parent did. For every other event the field is `null` (the field is only read by `LessonConfirmed.tsx`). The template renders coach-scheduled copy when it is `'coach'`. This is an API-internal type change (`apps/api/src/services/emails/types.ts`), not a database schema change — the outbox row's `payload` column is already `jsonb`.

### Durations

The lesson-duration enum (`30 | 45 | 60`) is inlined as `z.union([z.literal(30), z.literal(45), z.literal(60)])` in four places in `packages/shared/src/schemas/booking.ts` today. Phase 1 extracts it into a single shared schema and reuses it everywhere, including this feature's new body:

```ts
export const LESSON_DURATION_MINUTES = [30, 45, 60] as const;
export const LessonDurationMinutesSchema = z.union([
  z.literal(30),
  z.literal(45),
  z.literal(60),
]);
export type LessonDurationMinutes = z.infer<typeof LessonDurationMinutesSchema>;
```

`CoachCreateLessonBodySchema.durationMinutes` uses `LessonDurationMinutesSchema`, as do the four existing inlined schemas (`CreateLessonBodySchema`, `LessonResponseSchema`, `UpdateLessonBodySchema`, `AvailableSlotsQuerySchema`). No new hardcoded `30 | 45 | 60` is introduced by this feature.

---

## API

### `POST /coach/lessons`

Lives in `apps/api/src/routes/coachLessons.ts`. Follows the standard middleware stack already in `coachRouter` (`requireUser` → `requireCoach` → `validate({ body })` → handler).

Request body (new Zod schema in `packages/shared/src/schemas/booking.ts`, exported from `packages/shared/src/index.ts`):

```ts
export const CoachBookingWarningsSchema = z.object({
  outsideHours: z.boolean().default(false),
  insideNoticeWindow: z.boolean().default(false),
  maxAdvanceExceeded: z.boolean().default(false),
  travelBufferViolated: z.boolean().default(false),
  dailyCapExceeded: z.boolean().default(false),
  blockedTimeOverlap: z.boolean().default(false),
});
export type CoachBookingWarnings = z.infer<typeof CoachBookingWarningsSchema>;

export const CoachCreateLessonBodySchema = z.object({
  householdId: z.string().uuid(),
  swimmerIds: z.array(z.string().uuid()).min(1).max(4),
  locationId: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }),
  durationMinutes: LessonDurationMinutesSchema,
  // When true, the server allows the lesson to land even if the submission
  // triggers one or more non-overlap warnings. Each warning must still appear
  // in `acknowledgedWarnings` set to true — overrideWindow=true alone does
  // not suppress acknowledgment; it only tells the server "I was prepared to
  // see warnings." When overrideWindow=false, any warning causes 409.
  overrideWindow: z.boolean().default(false),
  acknowledgedWarnings: CoachBookingWarningsSchema.default({}),
});
export type CoachCreateLessonBody = z.infer<typeof CoachCreateLessonBodySchema>;
```

`LessonDurationMinutesSchema` is the shared duration schema introduced alongside this feature (see Item 3 — "Durations come from the shared schema").

Response on success: existing `LessonResponseSchema` with `status === 'approved'`, HTTP 201.

Response on unacknowledged warnings: HTTP 409 with body `{ error: 'warnings_not_acknowledged', warnings: CoachBookingWarnings }`. The `warnings` object carries exactly the server-computed flags — the UI uses it to render the warning card the coach must then re-submit with acknowledged.

#### Validation ordering (pre-transaction)

1. **Household exists.** `households` lookup by `householdId`. 404 if missing. (The requested swimmers must belong to this household — a sibling-mix prevention check that mirrors ADR 029's "siblings never mix families".)
2. **Swimmers belong to the household and are active.** `swimmers.household_id = householdId AND archived_at IS NULL AND id IN (:swimmerIds)`. 422 `swimmers_not_in_household` if any swimmer is missing, archived, or belongs to a different household. (The Zod schema caps the array at 4 and the `type` enum does the same, so no separate `too_many_swimmers` error path is needed.)
3. **Location exists and is accessible.** `lesson_locations` lookup. If `household_id IS NOT NULL`, it must equal the booked household's id. 422 `not_this_households_home_pool` otherwise. Inactive locations rejected.
4. **Lesson type.** `swimmerIds.length === 1 ? 'private' : 'family'`.
5. **Compute override warnings on the server.** Independent of `overrideWindow`, the handler computes a `CoachBookingWarnings` object from the request and the current DB state:
   - `outsideHours` = `effectiveHours(laDateStr).length === 0 || the slot's wall-clock is outside today's teaching window`.
   - `insideNoticeWindow` = `startsAt < now + bookingMinAdvanceHours`.
   - `maxAdvanceExceeded` = `startsAt > now + bookingMaxAdvanceWeeks`.
   - `travelBufferViolated` = another pending/approved lesson at a different pool is within its travel-buffer-minutes of this slot.
   - `dailyCapExceeded` = adding this lesson's minutes to the LA-day's existing lesson minutes would exceed `maxDailyLessonMinutes`.
   - `blockedTimeOverlap` = the slot's time range overlaps any row in `blocked_times`.

   Then:
   - If **every** computed warning is `false`: proceed to the transaction (whether `overrideWindow` is true or false — it's a no-op in this case).
   - If **any** computed warning is `true` and `overrideWindow === false`: 409 `warnings_not_acknowledged` with the server-computed warnings object. The audit log is NOT written for a 409 — nothing landed.
   - If **any** computed warning is `true` and `overrideWindow === true`: for each `true` warning, verify `acknowledgedWarnings[warning] === true`. If any true warning is not acknowledged → 409 `warnings_not_acknowledged` with the full server-computed warnings object (not just the missing ones; the UI needs the full picture to re-render the acknowledgement card). If every true warning is acknowledged → proceed to the transaction and persist the server-computed warnings object as `payload.override` on the audit row.

Note: nothing in step 5 is skippable client-side. There is no "I don't want warnings computed" switch — the client's `overrideWindow` is a question ("may I proceed if there ARE warnings?"), not an answer ("there aren't any").

#### Transaction (same shape as parent booking)

```ts
await db.transaction(async (tx) => {
  // Serialize concurrent bookings on the same LA calendar day.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"lesson-day:" + laDateStr}))`);

  // Re-fetch inside the lock.
  const [blockedRows, bufferRows, existingLessonRows] = await Promise.all([...]);

  // HARD REJECT: time overlap with any existing pending/approved lesson,
  // regardless of location — Jason cannot physically be in two places at once.
  // This is NOT the same as the slot engine's travel-buffer check; it checks
  // bare time intervals only. Any overlap → return null → 422 slot_unavailable.
  const overlaps = existingLessonRows.some((row) => {
    const existingEnd = row.startsAt.getTime() + row.durationMinutes * 60_000;
    const newEnd = startsAt.getTime() + durationMinutes * 60_000;
    return startsAt.getTime() < existingEnd && row.startsAt.getTime() < newEnd;
  });
  if (overlaps) return null;

  // Insert the lesson in status='approved' with approved_by = coach id.
  const [inserted] = await tx.insert(lessons).values({
    householdId, locationId, startsAt, durationMinutes,
    type, status: "approved",
    requestedBy: coachProfileId,
    approvedAt: now, approvedBy: coachProfileId,
    expiresAt: null,
  }).returning();

  await tx.insert(lessonSwimmers).values(swimmerIds.map((id) => ({ lessonId: inserted.id, swimmerId: id })));

  // Audit log — SAME transaction (CLAUDE.md rule). `overrideFlags` is the
  // SERVER-computed warnings object, not what the client sent, and is null
  // if no warnings fired for this submission.
  await tx.insert(householdAuditLog).values({
    householdId, actorId: coachProfileId,
    action: "lesson_booked_by_coach",
    payload: { lessonId: inserted.id, locationId, startsAt, durationMinutes,
               swimmerIds, override: serverComputedWarningsOrNull },
  });

  // Outbox row — SAME transaction (ADR 028 rule).
  await tx.insert(lessonEmailOutbox).values({
    lessonId: inserted.id,
    event: "lesson_confirmed",
    icsMethod: "REQUEST",
    icsSequence: /* read + increment lessons.calendar_sequence atomically here */,
    recipientProfileIds: /* owner + manager profile ids for the household */,
    payload: { ...lessonSnapshot, initiatedBy: "coach" },
  });

  return inserted;
});
```

Post-response (fire-and-forget microtasks, same pattern as every other lesson route):

```ts
res.status(201).json(responseBody);
queueMicrotask(() => { void syncLessonToGoogle(newLesson.id); });
queueMicrotask(() => { void sendLessonEmailOutboxRow(outboxRowId); });
```

Both are reconcile-safe: `syncLessonToGoogle` already handles approved lessons idempotently (ADR 027), and `sendLessonEmailOutboxRow` is a no-op if a terminal row is picked up (ADR 028).

#### What this reuses

- **Slot engine.** `computeAvailableSlots` is used by the frontend to populate the normal "available times" list on the booking screen. The server does *not* call it for coach custom-time submissions — only the overlap check above runs. For non-override submissions, the server calls `computeAvailableSlots` under the lock exactly like `POST /lessons` and rejects with `slot_unavailable` if the chosen time isn't in the returned set.
- **Advisory day lock.** `pg_advisory_xact_lock(hashtext('lesson-day:' + laDate))` — identical to parent booking. Serializes same-day writes across the two paths.
- **Approval gate function.** Not called; coach bookings are always `approved`.
- **Calendar sync hook.** `queueMicrotask(() => void syncLessonToGoogle(id))` — identical. The lesson row is written with `calendar_sync_status = 'not_synced'` (DB default) and the hook flips it.
- **Email outbox.** Reuses `lesson_confirmed` event; payload gets `initiatedBy: 'coach'`.

### `GET /coach/households?q=<string>` (lightweight support endpoint)

The household picker needs to find a family when the coach types a swimmer's first name, a swimmer's last name, a member's full name, or the household's own name. Full-text isn't justified at Jason's roster size, so the query is a **case-insensitive contains match** (`ILIKE '%' || :q || '%'`) across these four columns via a `UNION` on household ids:

- `swimmers.first_name`
- `swimmers.last_name`
- `profiles.full_name` (joined through `household_members`)
- `households.name`

A household matches if ANY of the four produces a hit for ANY of its members/swimmers. Prefix-only would miss "Smith" when a coach types "mi"; concatenation ("Alex Rivers") would miss matching last-name-only queries because of word-boundary noise — a per-column `ILIKE %q%` is both simpler and gives the right UX for a small roster.

```ts
GET /coach/households?q=<search>&limit=20
```

Returns `{ householdId, householdName, memberFullNames: string[], swimmers: [{ id, firstName, lastName, archivedAt }], homePoolLocationId: string | null }[]` ordered by `households.name` ascending.

The response includes archived swimmers so the UI can grey them in the swimmer-pick step. Home pool id is included so the location step can preselect "Home pool" without a second request.

Zod schemas: `CoachHouseholdSearchQuerySchema`, `CoachHouseholdSearchResultSchema`. Both in `packages/shared/src/schemas/booking.ts`, exported from the package index.

Minimum query length: 2 characters. A 0- or 1-character search returns an empty array (not an error) — the UI shouldn't spam the API on each keystroke, and a one-letter contains match would return the whole roster.

---

## UI

Three screens, mobile-first, all under `apps/web/src/content/CoachBookLessonContent/` (one Content folder per plan rules). Entry buttons live in `CoachScheduleContent` and `CoachSwimmerDetailContent`.

### Entry points

- `/coach/schedule` — a "Book lesson" button in the toolbar.
- `/coach/swimmers/[id]` — a "Book lesson" button near the top of the swimmer card. Pre-fills `householdId` and selects the current swimmer by default.

Both navigate to `/coach/book` (new route in `apps/web/src/app/coach/book/page.tsx`) with query params for pre-selection: `/coach/book?household=<id>&swimmer=<id>`.

### Screen 1 — Household and swimmer

- Search field at top. Debounced hit to `GET /coach/households?q=...`. Results list below as cards: family name + member names + swimmer names (archived swimmers greyed and un-tappable).
- Tap a household → swimmer picker expands under the household card: a chip per active swimmer. Multi-select, 1–4. "Sibling lessons never mix families" enforced by the UI only exposing swimmers from the chosen household (and the server rechecking).
- When pre-filled from `/coach/swimmers/[id]`, this screen is skipped.
- "Next" is enabled when ≥1 swimmer is selected.

### Screen 2 — Location, duration, date, time

Layout mirrors the parent `BookCalendarContent` so the components can be shared:

- **Location row.** Two tabs: "Home pool" (if the household has an active one — pulled from the household response) and "Named pool" (opens a dropdown of all active named pools, sorted by `sort_order`).
- **Duration selector.** 30 / 45 / 60.
- **Calendar.** Reuses `BookCalendarContent` subcomponents (`WeekNav`, `DayColumn`, `MonthDayCell`, `MonthGrid`, `PhoneTimeList`) — these already render the slot-state grid. Hits `GET /lessons/available-range` with the chosen location/duration (that endpoint already accepts coach callers: `requireParentOrCoach`). The approval banner "Jason will confirm this one" is suppressed since this is a coach booking.
- **"Pick a custom time" link** below the calendar. Tapping opens the custom-time picker:
  - Date picker (any day — no `lessonDays` restriction).
  - Time picker (any 15-minute step within 00:00–23:45).
  - A yellow warning card lists the specific overrides the chosen date/time triggers:
    - "Outside teaching hours (M–F 4–8 PM)" / "Not a lesson day"
    - "Less than 16 hours away"
    - "Travel buffer too tight after your lesson at X" / "...before your lesson at Y"
    - "Would push the day over your 4-hour lesson cap"
    - "Overlaps a blocked time: *note*"
  - If the chosen time would time-overlap another lesson at any location, show a hard-red error ("Overlaps the X lesson at Y — pick a different time") and keep "Confirm" disabled. **No override is possible for direct time overlap.**
- "Confirm" button at the bottom. Shows a summary dialog with household, swimmer list, pool, date/time, duration, and (if applicable) the list of warnings being acknowledged. On tap, calls `POST /coach/lessons`.

### Screen 3 — Confirmation

- Success state: "Lesson booked" with the lesson summary and a link to `/coach/lessons/<id>`.
- Email note: "The family will get a confirmation email with a calendar invite."
- Google Calendar sync badge if the integration is connected (optional nicety; polls `/coach/calendar/status` once or just shows "Syncing to your Google Calendar…" and trusts the normal retry UI).

### States

- Loading: spinner while fetching household search / available range.
- Empty household search: "No households found" with a hint to try a swimmer's first name.
- Household has no active home pool: Home-pool tab is disabled with a hint "This family hasn't set a home pool."
- Household has no active swimmers (all archived): the household card shows but the swimmer picker says "No active swimmers" and "Next" is disabled.
- Submit error: show the error message inline on the confirmation dialog without closing it so the coach can adjust and retry (e.g., `slot_unavailable` after someone else booked in the window between page-load and submit).

### Accessibility

- All chips, buttons, calendar cells are keyboard-reachable.
- Warning card has `role="alert"` so screen readers announce the override requirements.
- Confirm dialog is a proper modal with focus trap (reuse existing `ConfirmDialog` component).

---

## Test plan

### Unit tests (API)

In `apps/api/src/__tests__/coachLessons.test.ts` under a new `describe("POST /coach/lessons", ...)` block, using the existing `createApp(logger)` + silent-pino setup and the integration DB (same pattern as the current coach-lesson tests):

- **Lesson created with status `approved` immediately.** No pending step; `approved_at` is set; `approved_by === coach.id` (non-null, distinct from system auto-approval); `expires_at === null`; `requested_by === coach.id`.
- **Audit row written in the same transaction.** Insert `household_audit_log` row has `action = 'lesson_booked_by_coach'`, correct `household_id`, `actor_id`, and `payload`.
- **Audit row rollback.** Mock `householdAuditLog` insert to throw; assert the lesson row and the `lesson_swimmers` rows are also absent (transaction rolled back).
- **Siblings must share a household.** Request with two swimmers from different households → 422 `swimmers_not_in_household`.
- **Archived swimmers rejected.** Request including an archived swimmer → 422 `swimmers_not_in_household` (the active-filter catches it).
- **Home pool must belong to the booked household.** Pass another household's home pool id → 422 `not_this_households_home_pool`.
- **Trust is created for subsequent bookings.** After a coach-booked approved lesson, `needsApproval(householdId, locationId)` returns `false`.
- **Window checks apply when `overrideWindow === false`.** Outside hours / too soon / too far all return 422.
- **Override skips window checks.** Same inputs with `overrideWindow: true` → 201. The audit payload's `override` field reflects which specific warnings fired.
- **Overlap is never allowed, even under override.** Create an approved lesson at 4 PM at pool A. Submit a coach booking at 4:15 PM at pool B with `overrideWindow: true` and all warnings acknowledged → 422 `slot_unavailable`. Then same instant at the same pool → also 422.
- **Advisory day lock serializes.** Fire two `POST /coach/lessons` requests at the same slot in parallel; exactly one succeeds, the other returns 422 `slot_unavailable`. (The lock-fairness test already covers the mechanism via `POST /lessons`; this test confirms the coach path uses the same key.)
- **Outbox row written in the same transaction.** After a successful insert, exactly one `lesson_email_outbox` row exists for the lesson with `event = 'lesson_confirmed'`, `ics_method = 'REQUEST'`, `payload.initiatedBy = 'coach'`.
- **Calendar hook fires.** Spy on `syncLessonToGoogle`; after `res.json()`, the microtask runs with the new lesson id. (Pattern already used in `apps/api/src/__tests__/lessons.test.ts`.)

### Integration tests

In `apps/api/src/__tests__/integration/` (requires `pnpm db:up`):

- **Full happy path.** Coach books a lesson for an untrusted household at a new pool → row is `approved`, outbox row drains, `.ics` attachment carries `METHOD:REQUEST` and `SEQUENCE:0`, calendar sync writes a Google event id, audit row is in place. Then parent attempts a second booking at the same pool via `POST /lessons` → auto-approves (trust created).
- **Overlap under high concurrency.** Two concurrent coach `POST /coach/lessons` calls for the same slot. Exactly one commits; the other returns `slot_unavailable`. No duplicate outbox rows.
- **Parent can cancel a coach-booked lesson.** After a coach booking, parent `DELETE /lessons/:id` succeeds, outbox row for `lesson_canceled` written in the cancel's transaction, Google event deleted on microtask. (Confirms the parent path treats coach-booked lessons like any other.)
- **Parent can reschedule a coach-booked lesson.** `PATCH /lessons/:id` with new `startsAt` works the same, including the honor-system edit path.

### UI tests

Playwright or vitest-browser once the feature is wired, covering:

- Entry from `/coach/schedule` lands on the screen with no pre-fill.
- Entry from `/coach/swimmers/[id]` lands on screen 2 with that swimmer and their household pre-selected.
- Household search finds a household by swimmer first name.
- Custom-time warnings render for each override reason.
- Direct time-overlap error disables Confirm regardless of override state.

---

## Rollout and migration

- One migration (generated): `household_audit_log` gains a nullable `payload jsonb` column, mirroring `coach_audit_log.payload` from migration 0048. No backfill. The new `action` string is a free value, not an enum, so no enum alteration is required.
- No new env vars.
- No feature flag — the feature ships behind coach role already.
- Stacked on `feature/parent-booking-emails`: once that merges, this plan's ADR 028 updates (adding this path to the "every lesson-change path writes an outbox row" list) land cleanly. Until it merges, this branch cannot be tested end-to-end for email delivery; integration tests on the outbox row insert still work because the table exists in the parent branch.

---

## Open questions for Jason

1. **Max-advance-weeks under override.** The 10-week forward cap is a parent-facing rule meant to prevent speculative bookings. Should coach custom-time be able to bypass it (same warning treatment) or should it stay a hard reject? Current plan: warning.
2. **Blocked_times under override.** Jason adds blocked_times himself (holidays, Calendly). If he tries to book a coach-created lesson over one, should the UI block it hard, warn and let him proceed, or silently delete the blocked_time? Current plan: warning (he can proceed and the blocked time still shows on his schedule view).
3. **Audit payload override detail.** Is the five-field `{outsideHours, insideNoticeWindow, travelBufferViolated, dailyCapExceeded, blockedTimeOverlap}` payload the right granularity, or does Jason want a free-text "reason" field he types when overriding? A reason field is a quick addition but it's PII/noise if nobody reads it.
4. **Swimmer picker when the roster is huge.** The household search returns up to 20 households by prefix match; swimmer-only families with ten kids won't exist in practice, but if a household has >8 swimmers the chip row needs a scroll affordance. Confirm Jason's largest household size so we size the picker right.
5. **Google-sync event summary for coach-booked lessons.** Current ADR 027 ships `"Swim lesson: <first>"` for all lessons. Coach-booked lessons are no different in Google's view — same title. Confirm Jason doesn't want a visual tell (e.g., prefix "📘 Swim lesson:") so he can scan the calendar for lessons he booked vs. parent-booked. Current plan: no tell.
6. **Entry from a parent-facing surface?** We explicitly said coach-only, but if a parent asks Jason to book during a lesson, does he always use the coach surface, or does he sometimes want a shortcut from the parent's lesson detail page while impersonating? Current plan: no impersonation; coach-only entry points.
