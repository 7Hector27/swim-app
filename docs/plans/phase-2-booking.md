# Phase 2: Scheduling and Booking

**Status:** Planning

## Context

Phase 1 built profiles, households, swimmers, and the skill catalog. Phase 2 adds the scheduling and booking system: Jason's configurable availability, open-slot calculation, booking requests with an approval gate, calendar integration, notifications, and household billing.

The Calendly link (`siteLinks.booking = null`) runs alongside until PR 10 replaces it. After PR 6 ships, Calendly bookings that appear in Jason's Google Calendar automatically block those slots in the app — no manual `blocked_times` entries needed for new Calendly bookings after that point.

**Permission summary for booking actions**

| Action | Owner | Manager | Viewer | Coach |
|---|---|---|---|---|
| Book a lesson | ✓ | ✓ | — | — |
| Cancel a lesson | ✓ | ✓ | — | ✓ |
| Reschedule a lesson | ✓ | ✓ | — | ✓ |
| Approve / decline | — | — | — | ✓ |
| View upcoming lessons | ✓ | ✓ | ✓ | ✓ |

Viewers are read-only for all booking operations.

---

## Schema introduced across Phase 2

| Table | Introduced in |
|---|---|
| `lesson_locations` | PR 1 |
| `availability_config` | PR 1 |
| `season_summer_end_dates` | PR 1 |
| `blocked_times` | PR 1 |
| `travel_buffer_overrides` | PR 1 |
| `lessons` | PR 3a |
| `lesson_swimmers` | PR 3a |
| `lesson_pricing` | PR 8 |
| `packages` | PR 8 |
| `household_balance_events` | PR 8 |

---

## PR 1 — Locations and availability config

Introduces the config tables that everything else builds on: Jason's named pools (plus per-household home pools), a single-row availability config with configurable lesson days, per-year summer end dates, blocked-time ranges, and travel-buffer overrides. Coach-only API plus household home-pool management.

### Schema

**`lesson_locations`**
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | text not null | e.g., "Egret Park" |
| `address` | text not null | |
| `city` | text not null | |
| `state` | text not null default 'CA' | |
| `zip` | text not null | |
| `household_id` | uuid nullable FK → households.id on delete cascade | null = named pool; non-null = home pool (coach + that household only) |
| `is_active` | boolean not null default true | |
| `sort_order` | integer not null default 0 | |
| `created_at` / `updated_at` | timestamptz | |

Seeded (custom migration) with Jason's three named pools: Egret Park (45 Ovation, Irvine, CA 92620), Swallows Park (60 Lawnwood, Irvine, CA 92620), The Commons Park (46 Passage, Irvine, CA 92603).

**`availability_config`** (single row)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `lesson_days` | integer[] not null | ISO day numbers: 1=Mon … 7=Sun. Default `{1,2,3,5}` (Mon/Tue/Wed/Fri). Jason-configurable. |
| `school_year_start_time` | time not null | e.g., 16:30 |
| `school_year_end_time` | time not null | |
| `summer_morning_start_time` | time not null | teaching window before Seahawks |
| `summer_morning_end_time` | time not null | must be ≤ 15:00 |
| `summer_evening_start_time` | time not null | must be ≥ 19:00 |
| `summer_evening_end_time` | time not null | |
| `max_daily_lesson_minutes` | integer not null default 240 | |
| `booking_min_advance_hours` | integer not null default 16 | |
| `booking_max_advance_weeks` | integer not null default 10 | |
| `created_at` / `updated_at` | timestamptz | |

Seeded with initial values. Summer start is always June 1 (not configurable for now).

**`season_summer_end_dates`** — ISL Championships end date varies year to year
| Column | Type | Notes |
|---|---|---|
| `year` | integer PK | e.g., 2025 |
| `end_date` | date not null | the ISL Championships end date for this summer |
| `created_at` | timestamptz | |

Jason adds a row before each summer. Slot calculator uses the row for the relevant year; falls back to August 31 of that year if no row exists.

**`blocked_times`**
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `starts_at` | timestamptz not null | |
| `ends_at` | timestamptz not null | must be > starts_at |
| `note` | text nullable | e.g., "Calendly booking", "holiday" |
| `created_at` / `updated_at` | timestamptz | |

**`travel_buffer_overrides`**
| Column | Type | Notes |
|---|---|---|
| `from_location_id` | uuid FK → lesson_locations.id on delete cascade | |
| `to_location_id` | uuid FK → lesson_locations.id on delete cascade | |
| `buffer_minutes` | integer not null | |
| PK | (from_location_id, to_location_id) | |
| Check | from_location_id ≠ to_location_id | same-pool buffer is always 0, never stored |
| `created_at` | timestamptz | |

Default travel buffer (no override): 30 minutes. Same-pool: 0 minutes (computed, not stored).

### Home pool change policy

`PUT /households/mine/home-pool` does **not** update the existing home pool row in place. It inserts a new `lesson_locations` row and sets `is_active = false` on the old one inside a single transaction. Past lessons that reference the old `location_id` keep the original address intact.

### Files

```
apps/api/src/db/schema.ts
apps/api/src/db/migrations/<ts>_add_lesson_locations.sql        (drizzle-kit generate)
apps/api/src/db/migrations/<ts>_seed_lesson_locations.sql       (--custom)
apps/api/src/db/migrations/<ts>_add_availability.sql            (drizzle-kit generate)
apps/api/src/db/migrations/<ts>_seed_availability_config.sql    (--custom)
apps/api/src/db/queries.ts                                       add location / config / blocked-time / buffer helpers
apps/api/src/routes/locations.ts                                 new
apps/api/src/routes/coachAvailability.ts                         new
apps/api/src/app.ts                                              mount new routers
packages/shared/src/schemas/booking.ts                          new — LessonLocation, AvailabilityConfig, BlockedTime, TravelBufferOverride + request/response shapes
packages/shared/src/index.ts
apps/api/src/__tests__/locations.test.ts                        new
apps/api/src/__tests__/coachAvailability.test.ts                new
docs/decisions/020-lesson-locations-home-pool-privacy.md
```

### Routes

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /locations | requireUser | Named pools + caller's household home pool (if set). Never returns other households' home pools. |
| PUT | /households/mine/home-pool | requireUser + requireHouseholdRole("owner") | Set or replace home pool. Creates a new row and deactivates the old one in a transaction. |
| DELETE | /households/mine/home-pool | requireUser + requireHouseholdRole("owner") | Deactivate home pool (sets is_active = false; row preserved for past lessons). |
| GET | /coach/locations | requireCoach | All locations including all home pools with full addresses. |
| POST | /coach/locations | requireCoach | Add a named pool (household_id absent). |
| PATCH | /coach/locations/:id | requireCoach | Update name, address, or is_active. |
| GET | /coach/availability-config | requireCoach | Read config. |
| PATCH | /coach/availability-config | requireCoach | Update config fields. |
| GET | /coach/blocked-times | requireCoach | List all, sorted by starts_at. |
| POST | /coach/blocked-times | requireCoach | Add a blocked-time range. |
| DELETE | /coach/blocked-times/:id | requireCoach | Remove a blocked time. |
| GET | /coach/travel-buffers | requireCoach | List overrides. |
| PUT | /coach/travel-buffers/:fromId/:toId | requireCoach | Upsert override. Body: `{ bufferMinutes }`. |
| DELETE | /coach/travel-buffers/:fromId/:toId | requireCoach | Remove override (reverts to 30-min default). |
| GET | /coach/season-end-dates | requireCoach | List all per-year summer end dates. |
| PUT | /coach/season-end-dates/:year | requireCoach | Set or update the end date for a given year. |

### Rules

- `GET /locations` filters: `household_id IS NULL OR household_id = req.householdId`.
- Only the household owner can set or change the home pool.
- `PATCH /coach/availability-config` validates: `summerMorningEndTime ≤ 15:00`, `summerEveningStartTime ≥ 19:00`, all start times < end times.
- `lesson_days` must be a non-empty subset of `{1,2,3,4,5}` (weekdays only; 6 or 7 → 422).

### Tests

- `GET /locations` returns named pools + caller's home pool; excludes other households'.
- `PUT /households/mine/home-pool` creates a new row and deactivates the prior one; old `location_id` is preserved on existing lessons.
- Second `PUT /households/mine/home-pool` creates another new row and deactivates the one before it.
- `DELETE /households/mine/home-pool` sets is_active = false (row not deleted).
- Parent from a different household cannot see household A's home pool via `GET /locations`.
- `GET /coach/locations` includes all home pools with full addresses.
- Non-owner household member calling `PUT /households/mine/home-pool` → 403.
- `PATCH /coach/availability-config` with `summerMorningEndTime = 16:00` → 422.
- `POST /coach/blocked-times` with `ends_at ≤ starts_at` → 422.
- `PUT /coach/travel-buffers/:fromId/:toId` with identical IDs → 422.
- Parent calling `/coach/*` → 403.
- `PATCH /coach/availability-config` with `lesson_days = [6]` (Saturday) → 422.

### Out of scope

- UI for config management (comes with coach setup page, after PR 5).
- Travel buffer real drive-times by time of day (later upgrade).

---

## PR 2 — Open-slot calculation (pure logic)

A pure TypeScript module — no HTTP routes. Computes available lesson slots given the availability config, existing lessons, blocked times, travel buffers, and Google Calendar busy times. Uses an injected clock for full determinism in tests.

### Schema changes

None.

### Files

```
apps/api/src/lib/slots.ts              new — exports computeAvailableSlots()
apps/api/src/__tests__/slots.test.ts   new — extensive unit tests
```

### `computeAvailableSlots` signature

```typescript
interface SlotParams {
  date: string;                  // YYYY-MM-DD (interpreted in America/Los_Angeles)
  durationMinutes: 30 | 45 | 60;
  locationId: string;
  existingLessons: {             // status 'pending' or 'approved' — both block slots
    startsAt: Date;
    durationMinutes: number;
    locationId: string;
  }[];
  blockedTimes: { startsAt: Date; endsAt: Date }[];
  travelBufferOverrides: { fromLocationId: string; toLocationId: string; bufferMinutes: number }[];
  config: AvailabilityConfig;   // includes lesson_days
  summerEndDate: string | null; // YYYY-MM-DD from season_summer_end_dates; null → Aug 31
  gcalBusyTimes: { startsAt: Date; endsAt: Date }[]; // empty until PR 6; app-created events excluded by caller
  nowUtc: Date;                 // injected for testability
}

interface Slot { startsAt: Date; endsAt: Date; }

function computeAvailableSlots(params: SlotParams): Slot[]
```

### Algorithm

1. Check if `date`'s ISO day number is in `config.lesson_days`. If not → return `[]`.
2. Determine season: `date >= June 1` of that year **and** `date <= summerEndDate` (or Aug 31 if null) → summer; else school year.
3. Build teaching window(s): school year = one interval [schoolStart, schoolEnd]; summer = two intervals [morningStart, morningEnd] ∪ [eveningStart, eveningEnd]. All times interpreted in America/Los_Angeles.
4. Build **forbidden intervals** from existing lessons + travel buffers:
   - Each lesson L at pool P is itself forbidden: `[L.startsAt, L.endsAt]`.
   - Buffer **after** L toward the candidate pool: if P ≠ `locationId`, add `[L.endsAt, L.endsAt + buffer(P→locationId)]`. Prevents a slot starting too soon after a lesson at a different pool.
   - Buffer **before** L from the candidate pool: if P ≠ `locationId`, add `[L.startsAt − buffer(locationId→P), L.startsAt]`. Prevents a slot ending too close to the next lesson at a different pool.
   - `buffer(A→B)` = override for that pair if one exists; else 30 minutes; 0 if A = B.
5. Merge forbidden intervals with `blockedTimes` and `gcalBusyTimes`.
6. Subtract merged forbidden intervals from the teaching window(s).
7. Accumulate committed lesson time (sum of `durationMinutes` for existing lessons on this date). Stop generating new slots once `maxDailyLessonMinutes − committed < durationMinutes`.
8. In each remaining gap, enumerate start times every 15 minutes.
9. Filter: `slot.startsAt ≥ nowUtc + bookingMinAdvanceHours` and `slot.startsAt ≤ nowUtc + bookingMaxAdvanceWeeks × 7 days`.
10. Return sorted list.

### Tests

- Day not in `lesson_days` → empty array.
- School year day: no slots before `schoolYearStartTime`.
- Summer day: no slots in the 3:00–7:00 pm Seahawks window.
- Both `pending` and `approved` lessons block their slot.
- `declined`, `expired`, `canceled`, `no_show`, `completed` lessons do NOT block slots.
- Back-to-back same pool: zero gap required between them.
- Lesson at a different pool before the candidate slot: 30-min arrival buffer enforced (prevents slot starting too soon after).
- Lesson at a different pool after the candidate slot: 30-min departure buffer enforced (prevents slot ending too close to next lesson).
- Custom buffer override (10 min) respected over default.
- `maxDailyLessonMinutes = 240`: after 4 hours committed, no new slots.
- Slot exactly 16 h out is included (boundary); one second earlier is excluded.
- Slots > 10 weeks out excluded.
- A blocked time removes that window.
- A blocked time spanning the full teaching window → empty array.
- 30-min lesson fits a 30-min gap; 45-min lesson does not.
- Slots at 15-min granularity (:00, :15, :30, :45).
- GCal busy time overlapping teaching window reduces available slots.
- **DST — spring forward (second Sunday in March):** clocks jump 2:00 AM → 3:00 AM; day is 23 hours. Verify school-year slots are still generated at the correct wall-clock times with no phantom slots.
- **DST — fall back (first Sunday in November):** clocks fall 2:00 AM → 1:00 AM; day is 25 hours. Verify no duplicate slot times and that the teaching window boundaries are correct.
- Season boundary: June 1 uses summer hours; May 31 uses school-year hours.
- `lesson_days` re-read from config: removing Wednesday from `lesson_days` makes Wednesday return empty.

---

## PR 3a — Booking API and approval

The booking request and approval lifecycle — API only. No parent booking UI or coach card UI (those are PR 3b).

### Schema

**New enum `lesson_status`:** `pending` | `approved` | `declined` | `expired` | `canceled` | `no_show` | `completed`

**New enum `lesson_type`:** `private` | `family`

**`lessons`**
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `household_id` | uuid FK → households.id on delete restrict | |
| `location_id` | uuid FK → lesson_locations.id on delete restrict | |
| `starts_at` | timestamptz not null | stored in UTC; displayed in America/Los_Angeles |
| `duration_minutes` | integer not null CHECK (IN (30, 45, 60)) | |
| `type` | lesson_type_enum not null | |
| `status` | lesson_status_enum not null default 'pending' | |
| `requested_by` | uuid FK → profiles.id | |
| `approved_at` | timestamptz nullable | |
| `approved_by` | uuid nullable FK → profiles.id | null = auto-approved by system |
| `declined_at` / `declined_by` | timestamptz / uuid nullable | |
| `decline_reason` | text nullable | |
| `canceled_at` / `canceled_by` | timestamptz / uuid nullable | |
| `no_show_at` / `no_show_by` | timestamptz / uuid nullable | |
| `completed_at` | timestamptz nullable | set by cron (auto) or coach (manual) |
| `expires_at` | timestamptz nullable | = `starts_at − 16 h`; null for auto-approved |
| `google_calendar_event_id` | text nullable | populated in PR 6 |
| `calendar_sync_status` | text not null default 'not_synced' CHECK IN ('not_synced','synced','sync_failed') | populated in PR 6 |
| `calendar_sync_error` | text nullable | last sync error message |
| `calendar_sync_attempts` | integer not null default 0 | |
| `created_at` / `updated_at` | timestamptz | |

**`lesson_swimmers`**
| Column | Type | Notes |
|---|---|---|
| `lesson_id` | uuid FK → lessons.id on delete cascade | |
| `swimmer_id` | uuid FK → swimmers.id on delete restrict | |
| PK | (lesson_id, swimmer_id) | |

### Files

```
apps/api/src/db/schema.ts
apps/api/src/db/migrations/<ts>_add_lessons.sql                  (drizzle-kit generate)
apps/api/src/db/queries.ts                                        add lesson helpers
apps/api/src/lib/lessonApproval.ts                               pure fn: needsApproval(householdId, locationId, db)
apps/api/src/routes/lessons.ts                                    new — parent-facing lesson routes
apps/api/src/routes/coachLessons.ts                               new — coach lesson routes
apps/api/src/routes/internal.ts                                   new — POST /internal/cron/tick
apps/api/src/app.ts                                               mount new routers
packages/shared/src/schemas/booking.ts                           extend — LessonStatus, LessonType, CreateLessonBody, AvailableSlotsQuery, LessonResponse, PendingLessonSummary, ApproveLessonBody, DeclineLessonBody
packages/shared/src/index.ts
apps/api/src/__tests__/lessons.test.ts                           new
apps/api/src/__tests__/coachLessons.test.ts                      new
apps/api/src/__tests__/integration/lessons.integration.test.ts   new
docs/decisions/021-lesson-approval-rules.md
```

### Routes

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /lessons/available-slots | requireUser | Query: `date`, `durationMinutes`, `locationId`. Returns `{ startsAt }[]`. |
| POST | /lessons | requireUser + requireParent + requireHouseholdMember + requireHouseholdRole("manager") | Create a booking request. |
| GET | /coach/lessons | requireCoach | List lessons. Query: `status?`, `date?`, `householdId?`. |
| PATCH | /coach/lessons/:id/approve | requireCoach | Approve a pending lesson. |
| PATCH | /coach/lessons/:id/decline | requireCoach | Decline. Body: `{ reason?: string }`. |
| POST | /internal/cron/tick | internal (CRON_SECRET header) | Expire past-deadline pending lessons; auto-complete finished approved lessons. Returns counts. |

`requireHouseholdRole("manager")` passes for `manager` and `owner`; rejects `viewer` with 403.

### Calling `computeAvailableSlots`

Every caller must pass only lessons with status `pending` or `approved` in `existingLessons`. Lessons in any other status (`declined`, `expired`, `canceled`, `no_show`, `completed`) must be excluded before the call — `computeAvailableSlots` does not filter by status itself.

`summerEndDate` must be passed as a `YYYY-MM-DD` string. When reading `season_summer_end_dates.end_date` from Drizzle, use string mode (the default for `date` columns) rather than `{ mode: "date" }` — a midnight-UTC `Date` would shift to the previous LA day and misidentify the season boundary.

### Double-booking prevention

Inside the `POST /lessons` transaction:

```sql
SELECT pg_advisory_xact_lock(hashtext('lesson-day:' || date_trunc('day', $startsAt_la)::text));
```

The advisory lock serializes concurrent bookings for the same calendar day. After acquiring the lock, the handler re-runs `computeAvailableSlots` against the current DB state and confirms the slot is still available before inserting. The lock releases automatically when the transaction commits or rolls back.

### Booking validation (422 on failure)

1. `durationMinutes` must be 30, 45, or 60.
2. `swimmerIds`: 1–4 items, all belonging to caller's household, none archived.
3. `starts_at` day must be in `config.lesson_days`. Error: `not_a_lesson_day`.
4. `starts_at ≥ now + 16 h`. Error: `too_soon`.
5. `starts_at ≤ now + 10 weeks`. Error: `too_far`.
6. If `locationId` is a home pool: must belong to caller's household. Error: 403 `not_your_home_pool`.
7. Re-check slot availability with advisory lock held. Error: `slot_unavailable`.

Type: 1 swimmer → `private`; 2+ → `family`.

### Approval gate (`lessonApproval.ts`)

- Needs approval if: no prior `approved` lessons exist for this household at all, or no prior `approved` lessons at this specific location.
- If approval needed: `status = 'pending'`, `expires_at = starts_at − 16 h`.
- If no approval needed: `status = 'approved'`, `approved_at = now()`, `approved_by = null` (system).
- Declined and canceled lessons do not count.

### Scheduled job (cron)

A Railway cron (or equivalent) calls `POST /internal/cron/tick` with the `CRON_SECRET` header. Recommended schedule: every 5 minutes.

Each tick runs two passes in a transaction:

1. **Expire:** `UPDATE lessons SET status = 'expired' WHERE status = 'pending' AND expires_at < now()` → collect expired rows → queue expiry notification emails (stubs until PR 7).
2. **Auto-complete:** `UPDATE lessons SET status = 'completed', completed_at = now() WHERE status = 'approved' AND (starts_at + interval '1 minute' * duration_minutes) < now()` → collect completed rows → queue lesson charges (stubs until PR 8).

Lazy expiry in read routes stays as a safety net.

Env var: `CRON_SECRET` (random string; set in Railway and in local dev).

### Tests

- `POST /lessons` creates `pending` for a household's first lesson.
- `POST /lessons` auto-approves when household has prior approved lessons at this pool.
- `POST /lessons` → `pending` when household has approved lessons at other pools only.
- `POST /lessons` → 422 `too_soon` (< 16 h).
- `POST /lessons` → 422 `too_far` (> 10 weeks).
- `POST /lessons` → 422 `not_a_lesson_day` for a day not in `lesson_days`.
- `POST /lessons` with 5 swimmers → 422.
- `POST /lessons` with swimmer from another household → 422.
- `POST /lessons` at another household's home pool → 403 `not_your_home_pool`.
- `POST /lessons` at an already-taken slot → 422 `slot_unavailable`.
- **Concurrent booking:** two simultaneous `POST /lessons` requests for the same slot — exactly one succeeds (201) and the other gets 422 `slot_unavailable`. (Integration test using two parallel DB connections.)
- Viewer calling `POST /lessons` → 403.
- `PATCH /coach/lessons/:id/approve` → `approved`.
- `PATCH /coach/lessons/:id/decline` → `declined`, stores reason.
- Parent calling approve/decline → 403.
- `POST /internal/cron/tick` without `CRON_SECRET` → 401.
- Cron tick expires a pending lesson past its deadline.
- Cron tick does not affect a lesson whose deadline hasn't passed.
- Lazy expiry: pending lesson with `expires_at` in the past is returned as `expired` on next read.

### Out of scope

- Booking UI (PR 3b).
- Coach approve/decline UI card (PR 3b).
- Email and push notifications on booking events (PR 7; routes stub the calls).
- Google Calendar sync (PR 6).
- Balance charges on completion (PR 8).

---

## PR 3b — Booking UI and coach approve/decline card

Adds the parent booking form and wires the coach dashboard's `BookingRequestsCard` to real data. No new API routes or schema changes.

### Schema changes

None.

### Files

```
apps/web/src/app/dashboard/book/page.tsx                          new
apps/web/src/content/BookLessonContent/BookLessonContent.tsx      new — multi-step booking form
apps/web/src/content/BookLessonContent/index.ts                   new
apps/web/src/content/BookLessonContent/actions.ts                 new
apps/web/src/content/CoachDashboardContent/BookingRequestsCard.tsx  extracted + wired (removes Placeholder wrapper)
apps/web/src/lib/api/lessons.ts                                    new — fetchAvailableSlots, createLesson, coachGetPendingLessons, approveLesson, declineLesson
```

### Booking flow (`/dashboard/book`)

1. Select location (named pools + household home pool if set).
2. Select date (lesson days only, within 10-week window).
3. Select time slot (`GET /lessons/available-slots`).
4. Select swimmers (1–4 non-archived, multi-select).
5. Confirm summary + submit (`POST /lessons`).
6. Success: "Confirmed — you're all set" (auto-approved) or "Request sent — Jason will confirm shortly" (pending).

If no home pool is set and the parent selects it: show inline prompt "Add your home pool address first" linking to household settings.

### Coach approve/decline card

`BookingRequestsCard` removes its `Placeholder` wrapper and fetches `GET /coach/lessons?status=pending`. Approve and Decline buttons call the PATCH routes from PR 3a.

### Tests (UI)

- Booking form shows only lesson days in the date picker.
- Selecting a date calls `GET /lessons/available-slots` and shows the returned slots.
- Form shows "No available slots" on empty response.
- Submitting as a viewer → server returns 403; error state shown.
- Success screen shows correct message for auto-approved vs. pending.
- Home pool prompt appears if no home pool is set.
- Coach card renders real pending lessons; Approve/Decline buttons send the correct requests.

### Out of scope

- Coach creating a lesson on behalf of a household.
- Full available-slots calendar browse.

---

## PR 4 — Parent and coach schedule views

Wires the dashboard placeholders to real data and adds the coach's full-calendar day page. Read-only; no new schema.

### Schema changes

None.

### Files

```
apps/api/src/routes/lessons.ts                                      add GET /lessons
apps/api/src/routes/coachLessons.ts                                 add GET /coach/schedule, GET /coach/stats
packages/shared/src/schemas/booking.ts                              add UpcomingLessonsResponse, ScheduleDay, ScheduleItem
packages/shared/src/index.ts
apps/web/src/content/ParentDashboardContent/ParentDashboardContent.tsx   replace Placeholder on header text + UpcomingLessonsCard
apps/web/src/content/ParentDashboardContent/UpcomingLessonsCard.tsx      new (extracted from stub)
apps/web/src/content/CoachDashboardContent/CoachDashboardContent.tsx     replace Placeholder on stat cards + TodayScheduleCard
apps/web/src/content/CoachDashboardContent/TodayScheduleCard.tsx         new (extracted from stub)
apps/web/src/app/coach/schedule/page.tsx                            new
apps/web/src/content/CoachScheduleContent/CoachScheduleContent.tsx  new
apps/web/src/content/CoachScheduleContent/index.ts                  new
apps/web/src/lib/api/lessons.ts                                     add fetchUpcomingLessons, fetchCoachSchedule, fetchCoachStats
```

### Routes

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /lessons | requireUser + requireHouseholdMember | Upcoming pending + approved lessons for caller's household, sorted by starts_at. Query: `limit?`, `after?`. |
| GET | /coach/schedule | requireCoach | Day view. Query: `date`. Returns lesson rows, travel buffer rows, and open slot rows in chronological order. |
| GET | /coach/stats | requireCoach | `{ lessonsToday, lessonsThisWeek, pendingRequests, activeSwimmers, calendarSyncFailures }`. |

### Rules

- `GET /lessons` excludes past lessons and statuses `declined`, `expired`, `canceled`, `no_show`, `completed`.
- `GET /coach/schedule` calls `computeAvailableSlots` to produce open-slot rows and inserts `travel_buffer` rows between consecutive lessons at different pools.
- Any household member (owner, manager, viewer) can read upcoming lessons.

### Tests

- `GET /lessons` returns only future pending + approved lessons for the caller's household.
- `GET /lessons` excludes declined, expired, canceled lessons.
- `GET /coach/schedule` returns lesson rows with swimmer names, travel buffer rows, and open slot rows.
- `GET /coach/stats` returns accurate counts.

### UI

Parent dashboard: "Your next lesson is [Day] at [time]." resolves from the first item of `GET /lessons`. `UpcomingLessonsCard` removes `Placeholder` wrapper, shows real lesson rows with status badges.

Coach dashboard: `TodayScheduleCard` fetches `GET /coach/schedule?date=<today>`. Stat cards fetch `GET /coach/stats`. "Full calendar" → `/coach/schedule`.

### Out of scope

- Parent-facing full lesson calendar.
- Week or month view for coach.
- Filtering lessons by location or swimmer.

---

## PR 5 — Cancel and reschedule

Parents (manager or owner) can cancel or reschedule upcoming lessons at any time. The source lesson may be inside the 16-hour window (honor system), but the **new** time must still be ≥ 16 hours out. Jason is notified (calls stubbed; wired in PR 7).

### Schema changes

None.

### Files

```
apps/api/src/routes/lessons.ts                                    add DELETE /lessons/:id, PATCH /lessons/:id
packages/shared/src/schemas/booking.ts                            add UpdateLessonBody
packages/shared/src/index.ts
apps/web/src/content/ParentDashboardContent/UpcomingLessonsCard.tsx   wire "Change" button → lesson detail
apps/web/src/app/dashboard/lessons/[id]/page.tsx                  new
apps/web/src/content/LessonDetailContent/LessonDetailContent.tsx  new
apps/web/src/content/LessonDetailContent/index.ts                 new
apps/web/src/content/LessonDetailContent/actions.ts               new
apps/web/src/lib/api/lessons.ts                                   add cancelLesson, updateLesson
apps/api/src/__tests__/lessons.test.ts                            extend
```

### Routes

| Method | Path | Auth | Description |
|---|---|---|---|
| DELETE | /lessons/:id | requireUser + requireHouseholdRole("manager") or coach | Cancel. Sets `status = 'canceled'`, `canceled_at`, `canceled_by`. |
| PATCH | /lessons/:id | requireUser + requireHouseholdRole("manager") or coach | Reschedule / change duration or location. Body: `{ startsAt?, durationMinutes?, locationId? }`. |

### Rules

- Cancel and reschedule: household `manager` or `owner` only; viewer → 403. Coach can act on any lesson.
- **Reschedule timing:** the source lesson may be at any time including inside 16 hours (honor system — no validation on the existing lesson's time). The **new** `starts_at` must pass all standard validations: ≥ 16 h from now, ≤ 10 weeks, valid lesson day, slot available.
- Changing to a new pool re-evaluates the approval gate; lesson may revert to `pending` with a new `expires_at`.
- Cancel on status `declined`, `expired`, `canceled`, `no_show`, or `completed` → 422 `lesson_not_active`.
- Reschedule on those same statuses → 422 `lesson_not_active`.
- Stub: `notifyCoachOfChange(lesson)` no-op (wired in PR 7).

### Tests

- `DELETE /lessons/:id` → `canceled`, `canceled_at`, `canceled_by` set.
- `DELETE /lessons/:id` for another household's lesson → 404.
- `DELETE /lessons/:id` on an already-canceled lesson → 422 `lesson_not_active`.
- `PATCH /lessons/:id` with a new time ≥ 16 h → 200.
- `PATCH /lessons/:id` with a new time < 16 h → 422 `too_soon`, even when the source lesson is already inside 16 h.
- `PATCH /lessons/:id` rescheduling an inside-16h lesson to a valid future time → 200 (source time not validated).
- `PATCH /lessons/:id` to a new pool triggers re-approval check if needed.
- Viewer calling `DELETE` or `PATCH` → 403.
- Coach can cancel any lesson.

### Out of scope

- Coach-initiated reschedule on behalf of a household.
- Bulk cancel.

---

## PR 6 — Google Calendar sync

Lessons write to Jason's Google Calendar on approval and stay in sync through the lesson lifecycle. Busy times from his calendar block slots, enabling automatic Calendly interop during the transition. Sync failures are tracked and surface as a dashboard warning.

### Schema changes

`google_calendar_event_id`, `calendar_sync_status`, `calendar_sync_error`, `calendar_sync_attempts` columns were included in the PR 3a migration. This PR activates their logic. No additional migration unless PR 3a deferred them.

### Credentials

All GCal credentials live in env vars (one coach; no DB table needed):

| Env var | Purpose |
|---|---|
| `GOOGLE_CALENDAR_CLIENT_ID` | OAuth 2.0 client ID |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | OAuth 2.0 client secret |
| `GOOGLE_CALENDAR_REFRESH_TOKEN` | Long-lived refresh token |
| `GOOGLE_CALENDAR_CALENDAR_ID` | ID of Jason's calendar |

### OAuth setup checklist (prevents refresh token expiry)

1. Create a Google Cloud project; enable the Google Calendar API.
2. Create an OAuth 2.0 **Web application** credential (not Desktop).
3. Set the OAuth consent screen to **Production** mode — **not Testing**. Testing mode tokens expire after 7 days; Production tokens are long-lived.
4. For a private app used only by Jason, choose "External" audience + Production. The Google Calendar API (`calendar.events`) is classified as a **sensitive scope**, so Jason will see a one-time "Google hasn't verified this app" warning screen when he completes the auth flow. He can click "Advanced → Go to [app name] (unsafe)" to proceed. This warning is expected and does not affect token longevity. Full verification is only required if the app is published to arbitrary users.
5. Run the one-time auth flow locally: build the authorization URL with `access_type=offline&prompt=consent`, open it as Jason, complete consent, capture the `refresh_token` from the response.
6. Store the refresh token in `GOOGLE_CALENDAR_REFRESH_TOKEN` in Railway's environment variables.
7. The API service fetches a new access token at startup using the refresh token; refreshes it in-memory on 401 responses. The refresh token itself never rotates unless explicitly revoked.

### Files

```
apps/api/src/lib/googleCalendar.ts                              new — createCalendarEvent, updateCalendarEvent, deleteCalendarEvent, fetchBusyTimes, gcalBusyTimeCache
apps/api/src/routes/lessons.ts                                  wire GCal on create/auto-approve, reschedule, cancel
apps/api/src/routes/coachLessons.ts                             wire GCal on approve, decline
apps/api/src/routes/internal.ts                                 extend cron tick: retry sync_failed lessons
apps/api/src/routes/lessons.ts (GET /lessons/available-slots)   fetch cached busy times; pass to computeAvailableSlots
apps/web/src/content/CoachDashboardContent/CoachDashboardContent.tsx  add warning banner when calendarSyncFailures > 0
apps/api/src/__tests__/googleCalendar.test.ts                   new — mock googleapis
docs/decisions/023-gcal-single-coach-env-creds.md
```

### Sync points

| Event | Action |
|---|---|
| Lesson auto-approved (POST /lessons) | `createCalendarEvent` |
| Lesson approved by coach | `createCalendarEvent` |
| Lesson rescheduled | `updateCalendarEvent` |
| Lesson canceled | `deleteCalendarEvent` |
| Lesson declined | `deleteCalendarEvent` (if event exists) |
| GET /lessons/available-slots | `fetchBusyTimes` (read-only, cached) |
| Cron tick | Retry `sync_failed` lessons (up to 3 total attempts) |

### App-created event tagging

When creating a calendar event, set `extendedProperties.private.app = 'jg-swim'`. When fetching busy times via the Events API, filter out events where this property is set. This prevents the app's own lesson events from double-blocking the slot calculator.

### Busy time cache

`googleCalendar.ts` maintains an in-memory `Map<string, { data: BusyTime[]; fetchedAt: number }>` keyed by YYYY-MM-DD. TTL: 5 minutes. The available-slots route checks the cache before calling GCal. Cache resets on process restart (acceptable).

### Retry and failure handling

- Each sync call increments `calendar_sync_attempts`.
- On failure: set `calendar_sync_status = 'sync_failed'`, write to `calendar_sync_error`. Do **not** fail the HTTP response.
- Cron tick retries `sync_failed` lessons. After 3 total attempts, stop retrying; leave as `sync_failed` for manual resolution.
- `GET /coach/stats` returns `calendarSyncFailures`. If > 0, the coach dashboard shows: "Some lessons aren't synced to your calendar."

### Calendly transition

If Jason has Calendly connected to his Google Calendar (Calendly's default), Calendly bookings appear as GCal events. The app reads these as busy times when computing available slots — automatically blocking double-booking with Calendly sessions. No manual `blocked_times` entries are needed for new Calendly bookings after this PR ships. The only manual blocking still needed is for any Calendly bookings that predate this PR and were never written to GCal.

### Tests

- On approval, `createCalendarEvent` called; event ID stored; `calendar_sync_status = 'synced'`.
- On cancel, `deleteCalendarEvent` called with stored event ID.
- On reschedule, `updateCalendarEvent` called.
- GCal call throws → lesson still saved; `calendar_sync_status = 'sync_failed'`; `calendar_sync_attempts = 1`.
- Cron retries a `sync_failed` lesson; on success → `synced`.
- Cron does not retry after 3 attempts.
- Available-slots route excludes GCal busy times.
- Second request within 5 minutes uses cache; no additional GCal API call.
- Events tagged `extendedProperties.private.app = 'jg-swim'` excluded from busy times.
- `GOOGLE_CALENDAR_REFRESH_TOKEN` absent → GCal calls are no-ops; sync status stays `not_synced`.
- `GET /coach/stats` returns `calendarSyncFailures = 1` when one lesson has `sync_failed`.

### Out of scope

- In-app OAuth flow for Jason (one-time script, not a UI).
- GCal → app write (app never creates lessons from calendar events).
- Multiple calendars or coaches.

---

## PR 7 — Notifications

Wires the notification stubs placed in PRs 3a, 3b, and 5. Emails can include lesson details; push notifications to Jason contain no names, dates, or session content.

### Schema changes

None.

Env vars:
| Env var | Purpose |
|---|---|
| `RESEND_API_KEY` | Transactional email provider |
| `COACH_EMAIL` | Jason's email address |
| `NTFY_TOPIC` | Jason's private ntfy.sh topic |
| `NTFY_TOKEN` | Optional; for authenticated ntfy.sh topic |

### Files

```
apps/api/src/lib/email.ts                    new — thin wrapper; accepts template name + data
apps/api/src/lib/emailTemplates.ts           new — per-event HTML templates
apps/api/src/lib/push.ts                     new — HTTP POST to ntfy.sh for Jason only
apps/api/src/routes/lessons.ts               replace stubs with real calls
apps/api/src/routes/coachLessons.ts          replace stubs with real calls
apps/api/src/routes/internal.ts              extend cron tick to send expiry emails
apps/api/src/__tests__/notifications.test.ts new
docs/decisions/023-notifications-resend-ntfy.md
```

### Notification events

| Event | Parent email | Jason email | Jason push |
|---|---|---|---|
| Lesson auto-approved | "Your lesson on [date] is confirmed." | — | — |
| Lesson pending approval | "Your request is pending Jason's approval." | "New booking request from [name] on [date]." | "New booking request." |
| Jason approves | "Your lesson on [date] is confirmed." | — | — |
| Jason declines | "Jason declined your request." + reason if given | — | — |
| Jason cancels | "Your lesson on [date] was canceled." | — | — |
| Parent cancels | — | "[Name] canceled a lesson on [date]." | "A lesson was canceled." |
| Parent reschedules | — | "[Name] rescheduled a lesson." | "A lesson changed." |
| Request expires | "Your lesson request expired without approval." | — | — |

**Push notification rule:** push messages contain no names, dates, lesson details, or household information — only generic status strings. The message includes a link to the app dashboard. Email may include full details.

### Rules

- Email and push failures are non-fatal: log and continue.
- Parent's email comes from Supabase `getUser`; never logged.

### Tests

- Email to parent when lesson auto-approved.
- Email to parent + Jason + push to Jason when approval required.
- Push message for "approval required" contains no names or dates.
- Push message for "parent canceled" contains no lesson details.
- Email to parent when Jason approves.
- Email to parent (with reason) when Jason declines.
- Email + push to Jason when parent cancels.
- Email + push to Jason when parent reschedules.
- Email to parent when request expires.
- Provider throws → HTTP response still 200; error logged.

### Out of scope

- In-app notification center.
- SMS (later upgrade).
- Per-user notification preferences.
- Lesson reminders (later upgrade).

---

## PR 8 — Household balance, payments, and packages

Tracks one balance per household. Jason records payments and completes lessons. The cron job auto-completes approved lessons past their end time and charges the household. Jason can adjust attending swimmers before or after completion; the charge uses the attending count.

> **Flag for Jason to confirm:** Balance and full payment history are visible only to the household **owner**. Managers and viewers cannot see the balance. Reply before this PR is built if this should change.

### Schema

**`lesson_pricing`**
| Column | Type | Notes |
|---|---|---|
| `swimmer_count` | integer PK | 1, 2, 3, or 4 |
| `hourly_rate_cents` | integer not null | |
| `updated_at` | timestamptz | |

Seeded: 1 → 12000 ($120/hr), 2 → 18000, 3 → 19800, 4 → 21600.

**`packages`**
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `slug` | text unique not null | e.g., `private-10h` |
| `name` | text not null | |
| `swimmer_count` | integer nullable | 1 for private; null = any count |
| `hours` | integer not null | |
| `price_cents` | integer not null | what the family pays outside the app |
| `credit_cents` | integer not null | credit added to balance |
| `is_active` | boolean not null default true | |
| `created_at` / `updated_at` | timestamptz | |

Seeded: `private-10h` (1 swimmer, 10 h, $1,080, $1,200 credit), `private-20h` (1 swimmer, 20 h, $1,920, $2,400 credit). 3-sibling package seeded as `is_active = false` placeholder (details TBD).

**`household_balance_events`**
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `household_id` | uuid FK → households.id | |
| `type` | text CHECK IN ('payment','lesson_charge','lesson_charge_reversal','package_purchase','manual_adjustment') | |
| `amount_cents` | integer not null | positive = credit; negative = debit |
| `description` | text nullable | |
| `lesson_id` | uuid nullable FK → lessons.id | for `lesson_charge` |
| `package_id` | uuid nullable FK → packages.id | for `package_purchase` |
| `created_by` | uuid FK → profiles.id | |
| `created_at` | timestamptz not null | |

**Balance** = `SELECT COALESCE(SUM(amount_cents), 0) FROM household_balance_events WHERE household_id = ?`. Negative = owes money; positive = prepaid credit.

`household_balance_events` is **append-only**. Events are never updated or deleted. Corrections are made by inserting additional events: a `lesson_charge_reversal` (positive, equal to the original charge) followed by a new `lesson_charge` (negative, with the corrected amount).

### Auto-completion

The cron tick (PR 3a) is extended: after the expiry pass it runs:

```sql
UPDATE lessons SET status = 'completed', completed_at = now()
WHERE status = 'approved'
  AND (starts_at + (duration_minutes * interval '1 minute')) < now()
RETURNING *
```

For each auto-completed lesson, in a single transaction: count `lesson_swimmers` rows, look up `hourly_rate_cents` for that count, calculate `ROUND(duration_minutes / 60.0 * hourly_rate_cents)`, insert a `household_balance_events` row with type `lesson_charge` and `amount_cents = -(charge)`.

Jason can preempt auto-completion by marking a lesson `canceled` (no charge) or `no_show` (no charge by default; no-show fee policy TBD). If a `completed` lesson is subsequently marked `canceled` or `no_show`, a `lesson_charge_reversal` event is inserted for the original charge amount.

### Adjusting attending swimmers

`PATCH /coach/lessons/:id/swimmers` — Body: `{ swimmerIds: string[] }`. If the lesson is already `completed`, this atomically replaces `lesson_swimmers` rows AND inserts a `lesson_charge_reversal` for the prior charge followed by a new `lesson_charge` at the updated count — all inside a single transaction. The original charge event is never modified.

### Files

```
apps/api/src/db/schema.ts
apps/api/src/db/migrations/<ts>_add_balance_tables.sql       (drizzle-kit generate)
apps/api/src/db/migrations/<ts>_seed_lesson_pricing.sql      (--custom)
apps/api/src/db/migrations/<ts>_seed_packages.sql            (--custom)
apps/api/src/db/queries.ts
apps/api/src/routes/coachLessons.ts                          add PATCH /:id/complete, /:id/no-show, /:id/swimmers
apps/api/src/routes/coachBalance.ts                          new
apps/api/src/routes/balance.ts                               new — owner-only household balance
apps/api/src/routes/internal.ts                              extend cron tick for auto-complete charges
apps/api/src/app.ts
packages/shared/src/schemas/billing.ts                       new — BalanceEvent, BalanceSummary, Package, RecordPaymentBody, ApplyPackageBody
packages/shared/src/index.ts
apps/web/src/app/dashboard/balance/page.tsx                  new (owner only)
apps/web/src/content/BalanceContent/BalanceContent.tsx        new
apps/web/src/content/BalanceContent/index.ts                 new
apps/web/src/content/ParentDashboardContent/                 add balance card to sidebar (owner only)
apps/api/src/__tests__/balance.test.ts                       new
```

### Routes

| Method | Path | Auth | Description |
|---|---|---|---|
| PATCH | /coach/lessons/:id/complete | requireCoach | Mark completed; charge household in one transaction. |
| PATCH | /coach/lessons/:id/no-show | requireCoach | Mark no-show; no charge. |
| PATCH | /coach/lessons/:id/swimmers | requireCoach | Update attending swimmers. Recalculates charge if already completed. |
| GET | /coach/balance | requireCoach | Query: `householdId`. Balance + full event history. |
| POST | /coach/balance/payments | requireCoach | Record payment. Body: `{ householdId, amountCents, description? }`. |
| POST | /coach/balance/packages | requireCoach | Apply package. Body: `{ householdId, packageId }`. Inserts event with `amount = credit_cents`. |
| POST | /coach/balance/adjustments | requireCoach | Manual credit or debit. |
| PATCH | /coach/pricing/:swimmerCount | requireCoach | Update hourly rate for 1–4 swimmers. |
| GET | /coach/packages | requireCoach | List packages. |
| PATCH | /coach/packages/:id | requireCoach | Update details or is_active. |
| GET | /households/mine/balance | requireUser + requireHouseholdRole("owner") | Caller's household balance + event history. |

### Rules

- Charge: `ROUND(duration_minutes / 60.0 * hourly_rate_cents)` using the swimmer count in `lesson_swimmers` at completion time.
- Charge + status update in one transaction.
- Completing a non-`approved` lesson → 422 `lesson_not_completable`.
- `GET /households/mine/balance` enforces owner only; manager/viewer → 403.
- `household_balance_events` is append-only. Never update or delete an event. Corrections use a `lesson_charge_reversal` + new `lesson_charge`.
- Swimmer adjustment on a completed lesson: inserts reversal + new charge atomically; original event untouched.

### Tests

- Completing a 30-min solo lesson charges $60.
- Completing a 45-min 2-swimmer lesson charges $135.
- Balance is sum of events; negative when charges exceed credits.
- Recording a payment creates a positive event.
- Applying a package adds `credit_cents` (not `price_cents`) to balance.
- Completing a non-approved lesson → 422.
- Cron auto-completes an approved lesson past its end time and charges the household.
- `PATCH .../swimmers` on a completed lesson inserts a `lesson_charge_reversal` + new `lesson_charge`; original event is untouched; balance reflects the corrected amount.
- Marking a completed lesson as `no_show` inserts a `lesson_charge_reversal`; balance returns to its pre-charge value.
- Marking a completed lesson as `canceled` inserts a `lesson_charge_reversal`; balance returns to its pre-charge value.
- Balance is the sum of all events including reversals.
- Manager calling `GET /households/mine/balance` → 403.
- Viewer calling `GET /households/mine/balance` → 403.
- Balance with no events returns 0.
- Transaction test: completion and charge insert are atomic.

### Out of scope

- In-app package purchase by parent.
- Refunds or credit expiry.
- Invoices or PDF receipts.
- 3-sibling package (TBD; placeholder seed only).

---

## PR 9 — Recurring lessons (TBD)

**Status:** TBD — blocked on a yes/no decision.

If approved: each recurrence generates a full `lessons` row; a `recurrence_group_id` column links the series. Parents or Jason can cancel one lesson individually or all future ones.

Proposed schema if approved:
- `recurrence_groups`: id, household_id, location_id, day_of_week, duration_minutes, start_time, created_at.
- `lessons.recurrence_group_id` uuid nullable FK → recurrence_groups.id.

Routes: `POST /lessons/recurring`; `DELETE /lessons/recurring/:groupId/future`.

**This PR does not begin until the decision is confirmed.**

---

## PR 10 — Calendly switch-off

Replaces the Calendly link with the in-app booking route and removes all remaining `Placeholder` wrappers. Jason manually removes the Calendly link from his social and public profile after this PR ships.

### Schema changes

None.

### Files

```
apps/web/src/lib/siteLinks.ts                                         remove booking field; update all references
apps/web/src/content/ParentDashboardContent/ParentDashboardContent.tsx  replace external link with <Link href="/dashboard/book">
apps/web/src/content/LessonsContent/LessonsContent.tsx                 "Book a lesson" CTA: authenticated → /dashboard/book; unauthenticated → /login?returnTo=/dashboard/book
apps/web/src/content/CoachDashboardContent/CoachDashboardContent.tsx   remove any remaining Placeholder wrappers
```

### Rules

- Before editing `LessonsContent.tsx`, confirm it is the only page with a public "Book a lesson" button. Check the homepage (`HomepageContent`) and any other public-facing pages for additional instances.
- The sign-in flow already honors `returnTo` (wired in the household invite PR); verify it still works for `/dashboard/book`.
- No `Placeholder` components may remain in `CoachDashboardContent` or `ParentDashboardContent`.

### Tests

- Unauthenticated access to `/dashboard/book` redirects to `/login?returnTo=/dashboard/book`.
- After login, user lands at `/dashboard/book`.
- No `Placeholder` component in `CoachDashboardContent` or `ParentDashboardContent`.

---

## Open (TBD)

| Item | Status |
|---|---|
| Recurring weekly lessons | Decision pending; PR 9 blocked until resolved |
| 3-sibling package details and pricing | TBD; PR 8 seeds a disabled placeholder |
| No-show fee policy | Not specified; current plan charges $0 for no-shows |
| Balance visibility for managers/viewers | Flagged for Jason to confirm (currently owner-only) |
| Lesson price lock | Current plan uses pricing at completion time (rate in effect when Jason marks the lesson done). Alternative: lock the price at booking time. Decision deferred; completion-time pricing is in place until changed. |
| Jason's actual summer teaching hours | The morning and evening windows in `availability_config` are placeholder values. Jason must supply the real hours before PR 1 is seeded. |
