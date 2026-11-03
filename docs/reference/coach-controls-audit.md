# Coach controls over appointments — audit

**Date:** 2026-11-02
**Scope:** Read-only. Enumerates every booking rule, where it lives, and every action the coach can and cannot take on a lesson today. No code changes.

The coach is a single-user role; "the coach" below means Jason.

## Booking rules

Values below are the live seeded defaults; the schema says what the coach is allowed to edit, not what is currently set.

| Rule | Current value | Defined in | Coach UI editable? |
| --- | --- | --- | --- |
| Notice window (parent min advance) | 16 hours | DB `availability_config.booking_min_advance_hours`; schema `AvailabilityConfigSchema` at `packages/shared/src/schemas/booking.ts:65`; seed `apps/api/src/db/migrations/0013_seed_availability_config.sql:23` | Yes — `PATCH /coach/availability-config` at `apps/api/src/routes/coachAvailability.ts:207` |
| Coach bypass of the notice window | Always on for coach-initiated bookings and coach reschedules | Flag `coachBypassNotice` at `packages/shared/src/schemas/booking.ts:167`; coach reschedule passes `skipMinAdvance=true` to `computeAvailableSlots`; ADR 029 `docs/decisions/029-coach-booking.md:33` | N/A (hardcoded policy) |
| Maximum advance window | 10 weeks | DB `availability_config.booking_max_advance_weeks`; schema `booking.ts:66`; seed `0013_seed_availability_config.sql:24` | Yes — same PATCH endpoint. Coach-booking can also acknowledge an "exceeded" warning and submit anyway (ADR 029). |
| Daily cap | 240 minutes per LA calendar day | DB `availability_config.max_daily_lesson_minutes`; schema `booking.ts:64`; seed `0013_seed_availability_config.sql:22`; enforced in `apps/api/src/lib/slots.ts` | Yes — same PATCH endpoint. Coach-booking can acknowledge a `dailyCapExceeded` warning (`apps/api/src/lib/coachBookingWarnings.ts`). |
| Travel buffer between back-to-back lessons at different pools | 30 min default; per-pair override 0–60 min | Constant `DEFAULT_TRAVEL_BUFFER_MINUTES = 30` at `apps/api/src/lib/slots.ts:44`; per-pair overrides in `travel_buffer_overrides` table | Yes — per-pair only. `PUT /coach/travel-buffers/:fromId/:toId` and `DELETE` at `coachAvailability.ts:355`, `:402`. The 30-min *default* is a hardcoded constant. |
| Lesson durations offered | 30 / 45 / 60 min | `LESSON_DURATION_MINUTES = [30, 45, 60]` at `packages/shared/src/schemas/booking.ts:147` | No — hardcoded constant |
| Auto-approval rule | First lesson at a pool → `pending`; subsequent lessons at the same pool for the same household → auto-approved | ADR 021 `docs/decisions/021-lesson-approval-rules.md`; `apps/api/src/lib/lessonApproval.ts` (`needsApproval`) | No — behavior rule, no setting |
| Coach-booked lessons | Always written as `approved` with `approved_by = <coach>`, bypass the gate | ADR 029 `docs/decisions/029-coach-booking.md`; `POST /coach/lessons` at `apps/api/src/routes/coachLessons.ts:1172` | N/A |
| Pending request expiry | 16 hours before `startsAt` | Hardcoded in `apps/api/src/routes/lessons.ts:658` (single booking) and `:1252` (batch) | No — hardcoded |
| Default teaching days / hours | Days `[1,2,3,5]` (Mon/Tue/Wed/Fri); 16:30–20:30 school year block seeded (seasons/overrides take precedence) | Schema `AvailabilityConfigSchema.defaultTeachesDays / defaultStartTime / defaultEndTime` at `booking.ts:68-70`; `PatchAvailabilityConfigBodySchema` at `booking.ts:74`; seed `0013_seed_availability_config.sql:15-21` | Yes — same PATCH endpoint |
| Seasons (named windows with their own hours) | Three-layer availability (defaults → seasons → one-off overrides); see ADR 026 | Routes `GET/POST/PATCH/DELETE /coach/seasons*` at `coachAvailability.ts:589`, `:607`, `:682`, `:820`; copy-next-year at `:871` | Yes |
| One-off date overrides | Full day off or custom hours per date | Routes `GET/POST/PATCH/DELETE /coach/overrides*` at `coachAvailability.ts:985`, `:998`, `:1053`, `:1120` | Yes |
| Blocked times (ad-hoc busy ranges) | Any time range the coach declares unavailable | Routes `GET/POST/DELETE /coach/blocked-times*` at `coachAvailability.ts:258`, `:279`, `:315` | Yes. Coach-booking can also override by acknowledging a `blockedTimeOverlap` warning. |
| Parent cancel window | Anytime before the lesson; no window, no penalty | `DELETE /lessons/:id` with `requireParentOrCoach` at `apps/api/src/routes/lessons.ts:1915` | No — no setting exists |
| Parent reschedule window | Anytime before the lesson; a reschedule re-runs the parent slot engine (16-hour notice applies to the *new* time) | `PATCH /lessons/:id` with `requireParentOrCoach` at `apps/api/src/routes/lessons.ts:1995`; body schema `UpdateLessonBodySchema` at `packages/shared/src/schemas/booking.ts:384-388` | No — no setting exists |

**Not configurable anywhere:** lesson durations, the 30-minute default travel buffer, the 16-hour pending expiry, the parent cancel/reschedule windows (open-ended by design).

**Google Calendar is outbound-only.** The OAuth scope is `calendar.app.created`, which only grants access to the dedicated "Axiom Aquatics Lessons" calendar the app itself creates. The coach's personal calendars are never read. See ADR 027 `docs/decisions/027-google-calendar-sync.md:19,21`. The coach's personal busy times therefore do **not** block availability.

## Actions the coach can take on a lesson today

All coach endpoints are mounted under `/coach` with `requireUser, requireCoach` applied once (`apps/api/src/routes/coach.ts:18`). Cancel and reschedule are on the shared `/lessons` router with `requireParentOrCoach`.

| Action | API | UI entry |
| --- | --- | --- |
| View day schedule | `GET /coach/schedule?date=` at `coachLessons.ts:77` | `/coach/schedule` |
| View week schedule | `GET /coach/schedule/week?startDate=` at `coachLessons.ts:317` | `/coach/schedule` |
| List lessons (filter by status, date, household, calendar sync state) | `GET /coach/lessons` at `coachLessons.ts:468` | linked from schedule / notifications |
| View lesson detail | `GET /coach/lessons/:id` at `coachLessons.ts:1006` | `/coach/lessons/[id]` |
| View coach notes on a lesson | `GET /coach/lessons/:id/notes` at `coachLessons.ts:1118` | lesson detail |
| Approve a pending lesson | `PATCH /coach/lessons/:id/approve` at `coachLessons.ts:604` | lesson detail |
| Decline a pending lesson (optional reason, ≤500 chars) | `PATCH /coach/lessons/:id/decline` at `coachLessons.ts:915` | lesson detail |
| Approve all still-pending lessons in a batch | `PATCH /coach/lessons/batch/:batchId/approve-pending` at `coachLessons.ts:696` | batch view (ADR 030) |
| Create a lesson on behalf of a family (coach-initiated, auto-approved, warning-overridable) | `POST /coach/lessons` at `coachLessons.ts:1172` | `/coach/book`, plus "Book lesson" buttons on `/coach/schedule` |
| Search households for the booking flow | `GET /coach/households` at `coachLessons.ts:1456` | book flow |
| Reschedule a lesson — change **start time**, **duration**, **and/or location** (via `UpdateLessonBodySchema`) | `PATCH /lessons/:id` at `lessons.ts:1995` | `/coach/lessons/[id]/reschedule` — the form exposes a location picker (`CoachRescheduleContent.tsx:650`) and a duration picker (`:668`) |
| Cancel a lesson | `DELETE /lessons/:id` at `lessons.ts:1915` | lesson detail / reschedule page |
| Edit the availability config (notice window, max-advance weeks, daily cap, default teaching days/hours) | `PATCH /coach/availability-config` at `coachAvailability.ts:207` | `/coach/availability` |
| Create, edit, delete seasons; copy to next year | `coachAvailability.ts:607`, `:682`, `:820`, `:871` | `/coach/availability` |
| Create, edit, delete one-off date overrides | `coachAvailability.ts:998`, `:1053`, `:1120` | `/coach/availability` |
| Create, delete blocked times | `coachAvailability.ts:279`, `:315` | `/coach/availability` |
| Edit travel buffer per pool pair | `PUT/DELETE /coach/travel-buffers/:fromId/:toId` at `coachAvailability.ts:355`, `:402` | `/coach/availability` |
| Create, edit pools (locations) | `POST /coach/locations`, `PATCH /coach/locations/:id` at `coachAvailability.ts:96`, `:136` | `/coach/availability` |

## Actions the coach cannot take today (gaps)

Size key — rough implementation cost, not business value:
- **Small** — one route + body-schema addition + a status transition and/or UI control. No new table.
- **Medium** — new column(s) or multi-row operations with transactional/email/GCal fan-out, plus UI.
- **Large** — new table(s), new sensitive OAuth scope, or cross-cutting policy that touches both parent and coach paths.

| Gap | Evidence | Size | Notes |
| --- | --- | --- | --- |
| Edit **swimmers** on an existing lesson | `UpdateLessonBodySchema` at `packages/shared/src/schemas/booking.ts:384-388` only allows `startsAt`, `durationMinutes`, `locationId`. No endpoint touches `lesson_swimmers` for an existing lesson. | **Medium** | Needs a `swimmerIds` field on the update schema, a diff against `lesson_swimmers` inside the existing lesson transaction, a `lesson_rescheduled`-equivalent outbox event (or a new one — ADR 028 would need an update), GCal attendee resync, audit-log row, and a swimmer picker in the reschedule UI. |
| Edit **duration** of a lesson | Allowed — not a gap. `UpdateLessonBodySchema.durationMinutes` at `booking.ts:386`; UI picker at `CoachRescheduleContent.tsx:668`. | n/a | |
| Edit **location** of a lesson | Allowed — not a gap. `UpdateLessonBodySchema.locationId` at `booking.ts:387`; UI picker at `CoachRescheduleContent.tsx:650`. | n/a | |
| Mark **no-show** | Columns `no_show_at`, `no_show_by` exist in `apps/api/src/db/schema.ts:510-511` and the `no_show` enum value is in `LessonStatusSchema` (`booking.ts:130-138`), but no route in `apps/api/src/routes/` writes them. The auto-complete cron only promotes approved → completed. | **Small** | DB and enum are already in place. Need one `PATCH /coach/lessons/:id/no-show` handler, an audit-log row, a status transition rule (approved → no_show only after `startsAt`), a decision on GCal (keep event vs. delete), a UI button on `/coach/lessons/[id]`, and a decision on whether a `lesson_no_show` email fires. |
| Mark **late cancel** (distinct from a normal cancel) | No DB column, no enum value, no endpoint. `lesson_canceled` is the only cancel signal. | **Small–Medium** | Simplest shape: add `canceled_late boolean` (or `cancel_reason` enum) to `lessons`, let the cancel endpoint accept the flag when the coach is the actor, record it in the audit payload. Larger if we want threshold rules (e.g. auto-tag "late" when `startsAt - now < X hours`), a separate email, or a trust/strike signal fed back into the approval rule. |
| **Bulk cancel a day** | Only `DELETE /lessons/:id` exists; no multi-lesson handler. Each cancel runs its own transaction with its own outbox write and GCal sync. | **Medium** | Needs a `POST /coach/lessons/bulk-cancel` taking a date (and optional location filter), iterating affected approved/pending lessons inside one transaction (so a partial failure rolls back), fanning out an outbox row per lesson, and triggering GCal sync per lesson post-commit. Add rate-limiting / confirm UI since this fires N parent emails at once. |
| **Bulk cancel a pool** | Same as above — no bulk endpoint. | **Medium** | Same shape as "bulk cancel a day" with the filter being `locationId` (optionally scoped to a date range). Share the handler; the filter is the only difference. |
| **Block or restrict a specific family** | No concept exists. No table like `household_blocks`, no middleware check on `POST /lessons` or `POST /lessons/batch`, no UI. | **Large** | New table (`household_blocks` with reason + created_by + created_at), a guard inside the parent booking transaction (both single and batch), surfaced errors on the parent UI, a coach-side management screen, audit-log entries, and a product decision about whether "block" means "cannot request" vs. "requests go straight to pending with no auto-approval" vs. "cannot see the booking UI at all". |
| **Google Calendar busy times block availability** | Explicitly rejected: `calendar.app.created` scope only; ADR 027 `docs/decisions/027-google-calendar-sync.md:13,19` ("The coach's existing Google Calendar must not be read, scanned, or modified"); two-way sync rejected at line 58. | **Large** | Requires widening the OAuth scope to `calendar.readonly` (sensitive-scope — needs Google review), a free/busy fetch layered into `computeAvailableSlots`, a caching strategy to stay inside Google's quota, a sync-failure fallback (show what?), and a reversal of ADR 027's "existing calendar is never read" guarantee. Should be its own ADR before any code. |

## Notes for later

- Lesson statuses in the enum but never written: `no_show`, `late_cancel` (not even in the enum). Adding these is the smallest cluster of gaps.
- All coach-booking warning computation already lives server-side in `apps/api/src/lib/coachBookingWarnings.ts` — new override categories (e.g. "lesson is at a blocked family") plug in there.
- `household_audit_log.payload jsonb` was added in migration 0054 and is the natural landing spot for no-show / late-cancel / bulk-cancel audit payloads — no new schema needed.
