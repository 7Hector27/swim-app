# Coach availability editor plan

**Branch:** `feat/coach-availability-editor` off `main`.

**Goal:** Jason sets his teaching hours the way he already thinks about them — a table of seasons — and booking follows it. One-off changes (days off, vacations, custom hours) layer on top. Everything else about booking (16-hour advance, 10-week horizon, daily cap, travel buffers, lesson lengths, Google Calendar busy times, DST correctness) stays as-is.

---

## 1. Data model

### 1.1 Seasons — `availability_seasons`

A season is a named row that owns Jason's hours from its `start_date` until the next season's `start_date`. All dates and times are interpreted in `America/Los_Angeles`. Times are stored at 15-minute precision (validated at the API layer).

| Column                      | Type               | Notes                                                                                               |
| --------------------------- | ------------------ | --------------------------------------------------------------------------------------------------- |
| `id`                        | uuid PK            |                                                                                                     |
| `name`                      | text not null      | e.g. "Winter", "Post-DST", "Summer"                                                                 |
| `start_date`                | date not null      | LA calendar date on which this season takes effect                                                  |
| `teaches_days`              | integer[] not null | ISO day numbers 1=Mon … 7=Sun; subset of `{1..7}`, non-empty                                        |
| `weekday_start_time`        | time nullable      | required when `teaches_days` intersects `{1..5}`; `null` when he doesn't teach weekdays this season |
| `weekend_start_time`        | time nullable      | required when `teaches_days` intersects `{6,7}`; `null` otherwise                                   |
| `end_time`                  | time nullable      | weekday end; DB column name kept as `end_time` (TS accessor renamed to `weekdayEndTime` in schema and shared types) |
| `weekend_end_time`          | time nullable      | weekend end; required when `teaches_days` intersects `{6,7}`; backfilled from `end_time` for rows created before migration `0040` |
| `starts_at_dst`             | boolean not null default false | When true, this season starts on that year's daylight saving start date; "Copy to next year" uses next year's DST date for it. |
| `created_at` / `updated_at` | timestamptz        |                                                                                                     |

Rules enforced at the API layer:

- `start_date` is unique (no two seasons share a start date).
- `teaches_days` is non-empty and all values are in `1..7`.
- `weekday_start_time < end_time` and `weekend_start_time < weekend_end_time` when each start is non-null.
- `weekday_end_time` and `weekend_end_time` are each required when their respective days are taught.
- All times are a multiple of 15 minutes (minute component ∈ `{00, 15, 30, 45}`).

The **active season for a date** is the latest `availability_seasons` row with `start_date <= date`. If no season has started yet (the earliest `start_date` is in the future), that date has no teaching hours. Seasons never overlap by construction.

### 1.2 One-off changes — `availability_overrides`

Covers "a day off for one date", "vacation" (date range off), and "custom hours for one date". `blocked_times` continues to cover intra-day busy ranges (its existing shape); the UI shows both lists together but they stay separate at the DB layer.

| Column                      | Type                                                            | Notes                                                                                                |
| --------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `id`                        | uuid PK                                                         |                                                                                                      |
| `kind`                      | enum `availability_override_kind` ∈ `day_off` \| `custom_hours` |                                                                                                      |
| `start_date`                | date not null                                                   | LA calendar date                                                                                     |
| `end_date`                  | date not null                                                   | LA calendar date; `end_date >= start_date` (CHECK). `custom_hours` requires `end_date = start_date`. |
| `start_time`                | time nullable                                                   | required for `custom_hours`; null for `day_off` (CHECK)                                              |
| `end_time`                  | time nullable                                                   | required for `custom_hours`; null for `day_off` (CHECK)                                              |
| `note`                      | text nullable                                                   |                                                                                                      |
| `created_at` / `updated_at` | timestamptz                                                     |                                                                                                      |

API-level rules:

- Overlapping overrides on the same date range → 422 `override_conflict` (one source of truth per date). **Kind-agnostic**: a `day_off` and a `custom_hours` on the same date (or overlapping ranges) conflict, because a date can only have one source of truth.
- `custom_hours` times are 15-minute-aligned and `start_time < end_time`.
- `note` is capped at 500 characters (Zod `max(500)` + DB `CHECK` constraint).

### 1.3 Blocked times — unchanged

`blocked_times` keeps its current shape (`starts_at`, `ends_at`, `note`). Still the right table for Calendly imports and intra-day interruptions. The editor UI shows these in the one-off list for Jason's convenience.

### 1.4 Effective hours for a date (pure function)

```
effectiveHours(date):
  // 1. one-off override
  override = latest(availability_overrides where start_date <= date <= end_date)
  if override is day_off → return CLOSED
  if override is custom_hours → window = [override.start_time, override.end_time]
  // 2. active season
  else:
    season = latest(availability_seasons where start_date <= date)
    if season is null → return CLOSED
    if dayOfWeek(date) not in season.teaches_days → return CLOSED
    start = isWeekend(date) ? season.weekend_start_time : season.weekday_start_time
    if start is null → return CLOSED
    end = isWeekend(date) ? season.weekend_end_time : season.end_time
    if end is null → return CLOSED
    window = [start, end]
  // 3. subtract blocked_times that intersect this LA date
  return window minus blockedRangesOnDate(date)
```

Returned to callers as `TeachingWindow[]` (zero or one base window; may fragment into multiple windows after subtracting blocked times — matches the existing shared type).

### 1.5 Retired fields

Dropped from `availability_config`:

- `lesson_days`
- `school_year_start_time`, `school_year_end_time`
- `summer_morning_start_time`, `summer_morning_end_time`
- `summer_evening_start_time`, `summer_evening_end_time`

Kept in `availability_config` (single-row): `max_daily_lesson_minutes`, `booking_min_advance_hours`, `booking_max_advance_weeks`, timestamps.

Dropped entirely: `season_summer_end_dates` (ISL dates become normal seasons set by Jason).

---

## 2. Seed from Jason's table

Source: docs/reference/jason-seasonal-schedule.md (create it in PR 1 with Jason's table).

Seed all 11 seasons for the current cycle, teaches_days = all seven days:

| Name          | start_date | weekday_start | weekend_start | end_time | starts_at_dst |
| ------------- | ---------- | ------------- | ------------- | -------- | ------------- |
| Jun – Jul     | 2026-06-01 | 17:00         | 17:00         | 21:00    | false         |
| Mid-Aug       | 2026-08-15 | 16:45         | 16:45         | 20:30    | false         |
| Mid-Sep       | 2026-09-15 | 16:00         | 16:00         | 19:30    | false         |
| Mid-Oct       | 2026-10-15 | 15:00         | 15:00         | 18:30    | false         |
| Nov           | 2026-11-01 | 14:30         | 13:00         | 17:30    | false         |
| Dec – mid-Jan | 2026-12-01 | 14:30         | 10:00         | 17:00    | false         |
| Mid-Feb       | 2027-02-15 | 14:30         | 14:00         | 18:00    | false         |
| Early Mar     | 2027-03-01 | 15:00         | 15:00         | 18:30    | false         |
| Mid-Mar       | 2027-03-14 | 16:00         | 16:00         | 19:30    | true          |
| Mid-Apr       | 2027-04-15 | 16:30         | 16:30         | 20:00    | false         |
| Mid-May       | 2027-05-15 | 16:45         | 16:45         | 20:30    | false         |

Inferred defaults (confirm with Jason; listed in open questions, not in season names): "mid" means the 15th; Dec – mid-Jan hours continue until mid-Feb; weekend end matches weekday end; "10–11 am" means 10:00; "~" times are exact; he teaches all seven days.

---

## 3. PR split

Four PRs, each shippable on its own.

### PR 1 — Schema, seed, and migration away from the old fields

Replaces the old availability fields with the new tables. One drizzle-kit `generate` migration for schema; one `--custom` migration for seed; one `--custom` migration for the data move + column drops.

**Files**

```
apps/api/src/db/schema.ts                                               edit — add availabilitySeasons, availabilityOverrides, drop retired columns
apps/api/src/db/migrations/<ts>_add_availability_seasons_overrides.sql  drizzle-kit generate
apps/api/src/db/migrations/<ts>_seed_availability_seasons.sql           --custom
apps/api/src/db/migrations/<ts>_drop_legacy_availability_fields.sql     --custom (also drops season_summer_end_dates table)
packages/shared/src/schemas/booking.ts                                  edit — AvailabilityConfigSchema drops retired fields; add Season / Override schemas and request shapes
packages/shared/src/index.ts                                            re-export new types
```

**Rules**

- Both custom migrations run after the generated one in a single `pnpm db:migrate`.
- The drop migration runs **last** so a rollback of PR 2 (slot engine) can still see the retired columns if needed. Per repo convention: state applied-locally status in the commit message; production migrations are never automatic.
- No column renames hand-edited into snapshots.

**Applied locally:** migrations `0032_puzzling_devos.sql`, `0033_seed_availability_seasons.sql`, and the drop migration `0034_tan_microbe.sql` were applied locally via `pnpm db:migrate`. The follow-on `0035_clumsy_agent_zero.sql` (adds the `availability_overrides_note_length` CHECK) was also applied locally.

**Tests**

- `apps/api/src/__tests__/schema.test.ts` (if present) still passes.
- `pnpm db:up && pnpm db:migrate` is idempotent on a fresh DB.
- Seed insertion is idempotent (`ON CONFLICT (start_date) DO NOTHING`).

**Out of scope**

- Any route or UI change (both come in later PRs).
- Backfilling `availability_seasons` from the old summer/school-year config — the seed replaces it wholesale; the old values live only in Jason's head and the reference doc.

### PR 2 — Slot engine switch (with tests)

Teaches `computeAvailableSlots` and `classifyDaySlots` (both in `apps/api/src/lib/slots.ts`) to read teaching windows from the new tables via an `effectiveHours(date)` resolver. Every other rule in the file stays unchanged: 15-minute cadence, lesson-day gating (now season-derived), travel buffers (forbidden intervals + merge + subtract), daily cap, 16-hour and 10-week booking windows, GCal busy times, DST handling.

**Files**

```
apps/api/src/lib/slots.ts                   edit — replace season branching with resolver-based windows
apps/api/src/lib/effectiveHours.ts          new — pure resolver: (date, seasons, overrides, blockedTimes) → TeachingWindow[]
apps/api/src/__tests__/slots.test.ts        extend — keep DST tests, add the new cases
apps/api/src/__tests__/effectiveHours.test.ts  new — resolver unit tests
apps/api/src/routes/lessons.ts              edit — callers pass `{ seasons, overrides }` instead of config season fields and `summerEndDate`
```

**Routes**

None added. `GET /lessons/available-slots`, `GET /lessons/available-range`, and `GET /coach/schedule` continue to work; their query handlers now load `availability_seasons` and `availability_overrides` and pass them through.

**Rules**

- `SlotParams` loses `summerEndDate`. `config` keeps only the three retained fields (daily cap + booking windows).
- `SlotParams` gains `seasons: SeasonRow[]` and `overrides: OverrideRow[]` (both LA-local-interpreted at the resolver).
- Lesson-day check becomes "season active for this date and `teaches_days` includes this day's ISO weekday"; identical semantics for days Jason doesn't teach → `[]`.
- A `day_off` override collapses the day to no window; a `custom_hours` override replaces the season window with the override window.

**Tests** (keep every existing test; add these)

- Season change at a boundary: date D is the day a new season starts — slots use the new hours; D−1 uses the old hours.
- Weekend start differs from weekday start: Saturday generates slots from `weekend_start_time`, Friday from `weekday_start_time`.
- Day off (single date override): the date returns `[]` even though its season would normally be open.
- Day off (date-range override, vacation): every date in the range returns `[]`.
- Custom hours override: the date uses the override's `start/end`, independent of the season.
- Season `teaches_days` excludes the date's weekday → `[]`.
- Blocked time inside an override's custom hours still removes that interval.
- DST — spring forward and fall back — tests from the current suite still pass against the resolver (the LA-wall-clock-to-UTC conversion in `laToUtc` is unchanged, so this should hold).
- Resolver returns zero windows (`CLOSED`) when no season covers the date (date is before the earliest `start_date`).

**Out of scope**

- Any editor UI (PR 4).
- Coach-facing routes to CRUD seasons and overrides (PR 3). PR 2 only wires reads into the slot engine; manual DB inserts suffice to run PR 2 tests.

### PR 3 — Coach API

Routes to list and mutate seasons and overrides. Coach-only. Reuses the existing `requireCoach` auth and `validate()` middleware.

**Files**

```
apps/api/src/routes/coachAvailability.ts        extend — seasons + overrides + copy-to-next-year
apps/api/src/__tests__/coachAvailability.test.ts  extend
packages/shared/src/schemas/booking.ts           extend — list / create / patch / delete request + response types
packages/shared/src/index.ts                     re-export
```

**Routes**

| Method | Path                          | Description                                                                                                                        |
| ------ | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| GET    | /coach/seasons                | List all seasons, ordered by `start_date`. Response includes `isCurrent: boolean` on the active one.                               |
| POST   | /coach/seasons                | Create. Body: `{ name, startDate, teachesDays, weekdayStartTime, weekendStartTime, endTime }`.                                     |
| PATCH  | /coach/seasons/:id            | Update any field; `isCurrent` recomputed.                                                                                          |
| DELETE | /coach/seasons/:id            | Remove. Returns a warning body if removing it leaves booked lessons outside the resulting hours (lessons are not changed).         |
| POST   | /coach/seasons/copy-next-year | Duplicate seasons from the current cycle (those whose `start_date` is within 12 months of the latest season's `start_date`) with `start_date + 1 year`. Skips any whose shifted `start_date` already exists. Returns the inserted rows. |
| GET    | /coach/overrides              | List all `availability_overrides`, ordered by `start_date`.                                                                        |
| POST   | /coach/overrides              | Create. Body shape: `{ kind, startDate, endDate, startTime?, endTime?, note? }`.                                                   |
| PATCH  | /coach/overrides/:id          | Update.                                                                                                                            |
| DELETE | /coach/overrides/:id          | Remove.                                                                                                                            |
| GET    | /coach/availability-preview   | `?from=YYYY-MM-DD&days=7` — returns resolver output `{ date, state, windows }[]` for the week preview UI.                          |

**Rules**

- All routes `requireCoach`; parent calls → 403 (existing middleware behavior).
- Validation at the API layer (not DB):
  - Times multiples of 15 minutes.
  - `start < end` on seasons (per non-null start) and on `custom_hours` overrides.
  - `teaches_days` non-empty subset of `{1..7}`.
  - `custom_hours` requires `endDate == startDate`.
  - `day_off` requires both `startTime` and `endTime` absent.
  - Overlapping overrides on the same date range → 422 `override_conflict`. Kind-agnostic: `day_off` + `custom_hours` on the same date (or overlapping ranges) conflict.
  - Season `start_date` collision → 422 `season_date_taken`.
  - Override `note` capped at 500 characters.
- **Impact warning on hours-removing edits** (any PATCH or DELETE of a season or override that removes hours): compute `effectiveHours` across all upcoming approved+pending lessons; return `{ warnings: [{ lessonId, startsAt, reason }] }` for any lesson that now falls outside the new window. Pure additions skip the check. Never auto-cancel or move a lesson.
- "Copy to next year" is **not** silently applied; it inserts rows and returns them so Jason sees the diff in the UI.

**Tests**

- Create season with valid body → 201.
- Create season with start on `:07` minute → 422 (`invalid_time_granularity`).
- Create two seasons on the same `start_date` → second returns 422 `season_date_taken`.
- `teaches_days = [6]` with `weekday_start_time` set → 422 `weekday_start_without_weekday`.
- `teaches_days = [1]` with `weekday_start_time` null → 422 `weekday_start_required`.
- POST override `day_off` with a date range → 201; dates in range are closed.
- POST override `custom_hours` with `endDate > startDate` → 422.
- POST override overlapping an existing override's date range → 422 `override_conflict`.
- POST `day_off` override overlapping a `custom_hours` override (same date, different kind) → 422 `override_conflict` (kind-agnostic).
- POST override with `note` longer than 500 characters → 422.
- DELETE season leaves one upcoming approved lesson outside new hours → response includes a `warnings` entry with the lesson's swimmer first names and pool name; lesson row untouched.
- `copy-next-year` on 5 seasons → inserts 5 rows with `start_date + 1 year`; a second call is a no-op (returns `[]`).
- `copy-next-year` skips seasons older than 12 months before the latest season's `start_date` (prior-year cycles aren't rolled forward again).
- Parent calling any of these → 403.

**Out of scope**

- UI (PR 4).
- Mutating `blocked_times` in this round — the editor list surfaces them read-only alongside overrides, and existing `/coach/blocked-times` routes keep working unchanged.

### PR 4 — Editor UI (desktop and phone) with "What parents see" preview

Builds the `/coach/availability` route, wires the dashboard "Edit availability" button, and adds "Availability" to the coach nav.

**Files**

```
apps/web/src/app/coach/availability/page.tsx                                       new
apps/web/src/content/CoachAvailabilityContent/CoachAvailabilityContent.tsx         new
apps/web/src/content/CoachAvailabilityContent/SeasonsTable.tsx                     new (desktop)
apps/web/src/content/CoachAvailabilityContent/SeasonCard.tsx                       new (phone — current season + upcoming list)
apps/web/src/content/CoachAvailabilityContent/SeasonFormModal.tsx                  new
apps/web/src/content/CoachAvailabilityContent/OverridesList.tsx                    new
apps/web/src/content/CoachAvailabilityContent/OverrideFormModal.tsx                new
apps/web/src/content/CoachAvailabilityContent/WeekPreview.tsx                      new ("What parents see")
apps/web/src/content/CoachAvailabilityContent/CopyToNextYearButton.tsx             new
apps/web/src/content/CoachAvailabilityContent/ImpactWarningModal.tsx               new
apps/web/src/content/CoachAvailabilityContent/index.ts                             new
apps/web/src/content/CoachAvailabilityContent/CoachAvailabilityContent.module.css  new (only if a token-covered class won't do)
apps/web/src/lib/api/coachAvailability.ts                                          new — fetchSeasons, createSeason, patchSeason, deleteSeason, copyNextYear, fetchOverrides, createOverride, patchOverride, deleteOverride
apps/web/src/lib/apiErrorMessage.ts                                                extend — new codes (override_conflict, season_date_taken, invalid_time_granularity, weekday_start_without_weekday, weekday_start_required)
apps/web/src/components/CoachNav/CoachNav.tsx                                      edit — add Availability nav entry (and an icon)
apps/web/src/content/CoachDashboardContent/CoachDashboardContent.tsx               edit — "Edit availability" button becomes a <Link href="/coach/availability">, remove the <Placeholder> wrapper
```

**Routes**

- Next.js route: `/coach/availability` — coach-only; the existing coach-route guard handles redirect for non-coach users.

**UI — desktop**

- Page header: "Availability" + a short subhead ("Set the hours parents can book. One-off changes override the season for a date.").
- **Seasons table** — columns: Season, Teaches (comma-separated weekday labels or "All week"), Weekday start, Weekend start, Ends, Delete. One row per season, ordered by `start_date`.
  - The current season has a `Now` badge next to its name (uses accent-on-section token).
  - When `weekend_start_time !== weekday_start_time`, the weekend cell shows a small marker (dot + token color) to make the difference visible at a glance.
  - Row click opens `SeasonFormModal` for edit; the Delete button inlines in the row.
- `+ Add season` button opens an empty `SeasonFormModal`.
- `Copy to next year` button sits next to Add season; confirms via a token-styled modal before calling `POST /coach/seasons/copy-next-year`; result shows an inline toast with the number inserted.
- **"What parents see" week preview**: a 7-column strip for the current week with prev/next-week buttons. Each day shows the resolved effective hours (e.g. `3:30 – 7:00 PM`) or "Day off". The preview is a client component that calls `GET /coach/availability-preview?from=YYYY-MM-DD&days=7`, which is added in PR 3.
- **One-off changes list** below: shows overrides and `blocked_times` interleaved by `start_date`. Blocked-time rows show their note and the time range; override rows show `kind` and the date range. `+ Add a day off or custom hours` opens `OverrideFormModal` with three modes (single date, date range, custom hours).
- **Impact warning**: before any destructive edit saves, if the API returned `warnings`, render `ImpactWarningModal` listing the affected lessons with their time + swimmer names + a "Keep lessons as scheduled, save changes" primary action. The lessons are never auto-modified.

**UI — phone (mobile first; tablet breakpoint flips to desktop layout)**

- Top card = current season with its three times + an Edit button.
- Below: upcoming seasons as a stacked list.
- Tabs: Seasons / One-off changes.
- Full-width `Add season` CTA at the bottom.
- Modals use the full-screen sheet pattern already used elsewhere (same tokens as `OverrideFormModal` and `SeasonFormModal`).

**Design**

- Token-only styling per `CLAUDE.md`: no hex, no default Tailwind palette. Light + dark themes work.
- 44-px minimum touch targets (every button, every row action).
- Friendly errors from `apiErrorMessage.ts` for all mutation failures.
- Follows `axiom-aquatics-design` for shape and rhythm; motion follows `emil-design-eng` (press feedback on buttons, modal in/out eases).

**Tests**

- `apps/web/src/__tests__/coachAvailabilityPage.test.tsx` (or similar — follows existing test conventions):
  - Seasons table renders rows sorted by `start_date`; the active one shows `Now`.
  - Weekend start differing from weekday start renders the marker.
  - `+ Add season` → modal opens → submit calls `POST /coach/seasons` → table updates.
  - `Copy to next year` prompts, then calls the route, then shows the inserted count.
  - Week preview renders 7 cells; a `day_off` date shows "Day off".
  - DELETE a season that triggers warnings renders `ImpactWarningModal`; lessons list the swimmer names; confirming saves.
  - Phone layout (narrow viewport) renders the current-season card + tabs.
  - Error with `override_conflict` → friendly message via `apiErrorMessage`.
- Coach dashboard: `Edit availability` is a link to `/coach/availability` and no longer wrapped in `Placeholder`.
- Coach nav includes `Availability`, active when pathname starts with `/coach/availability`.

**Out of scope**

- Parent-facing visibility into Jason's seasons (parents only see slot availability from the existing booking UI; "What parents see" is a coach-only preview).
- Automated lesson rescheduling when hours change — the plan explicitly keeps lessons untouched.
- Editing `blocked_times` from this page — Jason continues to use the existing coach API; the list surfaces them read-only so he can see conflicts.

---

## 4. Open questions

Open questions for Jason:

1. **Inferred defaults from the source table.** Confirm the normalizations in `docs/reference/jason-seasonal-schedule.md`: "mid" = the 15th; Dec – mid-Jan hours continue until mid-Feb; weekend end matches weekday end; "10–11 am" means 10:00; "~" times are exact; he teaches all seven days year-round.
2. **Summer split days.** Historically there was a summer morning window and a summer evening window (because of the Seahawks block). The new model gives each season a single `[start, end]` window per day type. Does one window per day cover summer going forward, or does the model need multiple windows per day? (v1 ships with one window per day — see Decided.)
3. **"Copy to next year" DST handling.** For non-DST-pinned seasons we add exactly one year to the `start_date`. For `starts_at_dst = true` seasons we rewrite the date to that year's DST start. Confirm this is the right behavior and that no other seasons need a similar pin.

Decided (previously open, now settled):

- **One window per day per season.** v1 ships this. If summer needs split days again, we revisit as a schema extension (`jsonb` of windows per day type), not a seasons rewrite.
- **Week preview endpoint.** PR 3 adds `GET /coach/availability-preview?from=YYYY-MM-DD&days=7` returning `{ date, state, windows }[]`. PR 4 consumes it.
- **Impact warnings.** Fired on POST / PATCH / DELETE of a season or override. The create path computes warnings too, because adding a narrower season can push already-booked lessons outside the new hours. Lessons are never auto-modified.
- **Deleting the active season.** Allowed; the API returns the standard impact warnings, and the UI confirms before saving.
- **Single-coach model.** `availability_seasons` and `availability_overrides` have no `coach_id`; they describe the one coach's schedule. The impact-warning query returns every upcoming approved+pending lesson for that reason. Adding a second coach is a model change (coach FK on seasons + overrides, scoped lookups in `fetchUpcomingLessons`, resolver takes a coach), not a filter — see `docs/architecture.md` → *Availability is single-coach*.

---

## 5. Follow-up — default hours (post-PR 4)

The resolver falls back to **default hours** on `availability_config` when no season covers a date and no override applies. This replaces the 11 auto-seeded seasons: fresh databases start with sensible defaults (Tue–Fri, 16:00–20:00 PT) and Jason only adds a season when he wants to override the default for a stretch.

### Data model

Added to `availability_config` (migration `0037_default_hours.sql`):

| Column                 | Type              | Default         | Notes                                               |
| ---------------------- | ----------------- | --------------- | --------------------------------------------------- |
| `default_teaches_days` | `integer[]` not null | `{2,3,4,5}`   | ISO day numbers; subset of `{1..7}`                 |
| `default_start_time`   | `time` not null   | `16:00`         | 15-minute step                                      |
| `default_end_time`     | `time` not null   | `20:00`         | 15-minute step; CHECK: `default_start < default_end` |

Migration `0038_remove_seeded_seasons.sql` deletes the 11 Jason seasons by `start_date` (no-op on fresh DBs). The historical rhythm stays in `docs/reference/jason-seasonal-schedule.md` for anyone recreating them.

### Resolver

`effectiveHours` now has three tiers (highest priority first):

1. **One-off override** — unchanged.
2. **Active season** — unchanged.
3. **Default hours** — used when no season has started yet AND when a date falls on a day of week included in `default_teaches_days`. If the day of week isn't in `default_teaches_days`, the day is closed.

Blocked times still apply across all three. Tests covering tier-3 fallback live in `apps/api/src/__tests__/effectiveHours.test.ts` and `apps/api/src/__tests__/rangeAvailability.test.ts`.

### API

| Method | Path                           | Notes                                                              |
| ------ | ------------------------------ | ------------------------------------------------------------------ |
| GET    | `/coach/availability-config`   | Returns the full config row (including the three default-hour fields). |
| PATCH  | `/coach/availability-config`   | Coach-only. Validates: times multiples of 15 minutes; `defaultStartTime < defaultEndTime`; `defaultTeachesDays` is a non-empty subset of `{1..7}`. |

Both routes `requireCoach`. Shared schemas live in `packages/shared/src/schemas/booking.ts` as `AvailabilityConfigSchema` and `PatchAvailabilityConfigBodySchema`.

### UI

`CoachAvailabilityContent` renders a `DefaultHoursCard` above the seasons section:

- Shows `defaultTeachesDays` as a collapsed range (`Tue to Fri`) and the window (`4:00 pm to 8:00 pm`).
- Hint copy switches: "Used until your first season starts on {date}." when a future season exists, otherwise "These hours are in effect — add a season to override them for a specific stretch."
- An Edit button opens `DefaultHoursModal` (day pill picker + 15-minute-step time inputs). Save calls `PATCH /coach/availability-config` and refreshes the week preview.
- The seasons empty state copy now points back to the default hours instead of saying "No seasons yet."

### Migrations applied locally

`0037_default_hours.sql` and `0038_remove_seeded_seasons.sql` were applied locally via `pnpm db:migrate`.

---

## 6. Fix — Season form (branch `fix/season-form2`)

### What changed

**DB** — Migration `0039_silky_vindicator.sql` adds `weekend_end_time time` to `availability_seasons`, drops `NOT NULL` on `end_time` (now the weekday-only end), and updates both check constraints. Migration `0040_backfill_weekend_end_time.sql` backfills `weekend_end_time = end_time` for any row where `weekend_start_time IS NOT NULL`. Both applied locally.

**Shared schema** — `AvailabilitySeasonSchema`, `CreateSeasonBodySchema`, and `PatchSeasonBodySchema` now use `weekdayEndTime` (maps to DB `end_time`) and `weekendEndTime` (maps to `weekend_end_time`). The old `endTime` field is gone.

**effectiveHours** — Weekend days now use `season.weekendEndTime`; weekdays use `season.weekdayEndTime`. Both branches return `[]` if the relevant end time is null.

**API** — `validateSeasonFields` checks that `weekdayEndTime` is present when weekday days are taught, and `weekendEndTime` is present when weekend days are taught. Both start-before-end checks use their own end time. All insert/patch/copy-next-year operations include both end times.

**SeasonFormModal** — New default selection is Tue–Fri `[2,3,4,5]` (matches the default hours). Day chips: filled = teaches that day (inverted was already correct; default was the bug). Added "Tap the days you teach." hint. Weekday and weekend sections are hidden unless the corresponding days are selected. Each visible time field shows a "Required" error if missing on submit. Under the start date: "Runs until [next season start] (next season)" or "Runs until you add another season."

**SeasonsTable** — Replaced the three time columns (weekday start, weekend start, ends) with two range columns: Weekday hours and Weekend hours, each showing `start – end`.

**SeasonCard** — Same range format as the table.

---

## 7. Fix — Season end date (branch `fix/season-end-date`)

### What changed

**DB** — Migration `0041_loving_lucky_pierre.sql` adds `end_date date` (nullable). Migration `0042_backfill_season_end_date.sql` backfills it (day before next season's start, or start + 3 months for the last row), then `ALTER COLUMN end_date SET NOT NULL` and adds `CHECK (end_date >= start_date)`. Both applied locally.

**Shared schema** — `AvailabilitySeasonSchema`, `CreateSeasonBodySchema`, and `PatchSeasonBodySchema` include `endDate: DateStringSchema` (required on create, optional on patch).

**effectiveHours** — `findActiveSeason` now requires `startDate <= date <= endDate`. Dates in gaps between seasons (after a season ends but before the next starts) fall through to default hours.

**API** — `validateSeasonFields` checks `end_date_before_start` (returns 422 when endDate < startDate). New `findOverlappingSeason` helper uses a range-overlap query (`lte(startDate, endDate) AND gte(endDate, startDate)`, excluding the row being patched) and returns 422 `season_overlap:<name>` on conflict. `toSeasonWithIsCurrent` uses `startDate <= today <= endDate`. POST/PATCH/copyNextYear all include `endDate`; copy-next-year shifts `endDate` by one year alongside `startDate`.

**SeasonFormModal** — Start and end dates shown side by side. Hint below end date: "After {endDate}, your default hours apply." (or names the next season if one follows immediately).

**SeasonsTable** — Season column shows `{startDate} – {endDate}` date range. Gap rows interleaved: "Default hours · {range}" on `bg-surface-soft` in italic. Always shows a trailing gap after the last season. `buildEntries()` helper computes gaps using `addDaysIso`.

**SeasonCard** — Changed "Since {startDate}" to `{startDate} – {endDate}`.

**apiErrorMessage** — Added `end_date_before_start`, `weekday_end_required`, `weekend_end_required`, and `season_overlap:` prefix handler.
