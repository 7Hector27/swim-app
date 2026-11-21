# Meets & Leaderboards — Survey

Read-only audit of how meets, swims, personal bests, and leaderboards work on branch `feature/charts`. Facts and file paths only; no recommendations.

## 1. Data model

All schema in `apps/api/src/db/schema.ts`. No separate `personalBests` table — PBs are computed from `meetSwims`.

**`meets`** (schema.ts:886-894)
- `id` uuid PK, `name` text, `meetDate` date, `course` courseEnum (scy/scm/lcm), `createdBy` uuid → `profiles.id` (restrict on delete), timestamps
- RLS enabled
- Inverse: `meetSwims.meetId`

**`meetSwims`** (schema.ts:896-910)
- `id`, `swimmerId` → `swimmers.id` (restrict), `meetId` → `meets.id` (restrict, **nullable** — comment line 899: "null for practice swims"), `swimType` enum meet/practice (default "meet"), `eventDistance` int, `eventStroke` enum (free/back/breast/fly/im), `course` enum, `swumOn` date, `timeHundredths` int, `createdBy` → `profiles.id`, timestamps
- RLS enabled; no explicit constraints beyond FKs

**`swimmers`** (schema.ts:204-237) — carries leaderboard consent
- `id`, `firstName`, `lastName`, `birthDate` (for age groups), `sex` enum (female/male — competition category, not identity), `householdId` → `households.id` (restrict)
- `isPublic` boolean NOT NULL (leaderboard consent flag)
- `publicConsentAt` timestamptz nullable (when consent given)
- `publicConsentBy` uuid nullable → `profiles.id` (restrict) — who gave consent; must be household owner
- `archivedAt` timestamptz nullable (soft-delete)
- `recommendedBreathingPattern` text nullable
- CHECK `public_consent_required`: `isPublic=true` ⟹ both `publicConsentAt` and `publicConsentBy` non-null
- CHECK `recommended_breathing_pattern_valid`
- RLS enabled

**`clubs`** (schema.ts:242-253)
- `id`, `name` text NOT NULL UNIQUE, `isActive` boolean NOT NULL default true (inactive clubs hidden from new registrations but retained for historical rows), timestamps
- RLS enabled

**`swimmerClubs`** (schema.ts:257-287)
- `id`, `swimmerId` → `swimmers.id` (cascade), `clubId` → `clubs.id` (restrict, nullable), `otherClubName` text nullable (free-text fallback)
- CHECK `exactly_one_club`: exactly one of `clubId` or `otherClubName` must be set
- UNIQUE INDEX `swimmer_clubs_swimmer_club_uniq` on (swimmerId, clubId) WHERE clubId IS NOT NULL
- RLS enabled

**`leagueRegistrations`** (schema.ts:349-377)
- `id`, `swimmerId` → `swimmers.id` (cascade), `league` enum (`club` | `summer_league`), `seasonStartYear` int, `registeredOn` date (preserved across withdrawals/re-registrations), `withdrawnAt` timestamptz nullable (soft-withdraw while preserving `registeredOn`), timestamps
- UNIQUE INDEX `league_registrations_swimmer_league_season_uniq` on (swimmerId, league, seasonStartYear)
- RLS enabled

**`motivationalStandards`** (schema.ts:916-946)
- `id`, `standardName` enum (B/BB/A/AA/AAA/AAAA), `eventDistance` int, `eventStroke` enum, `course` enum, `sex` enum, `ageGroup` text (`6-under`, `7-8`, `9-10`, `11-12`, `13-14`, `15-18`), `cutTimeHundredths` int, timestamps
- UNIQUE INDEX `motivational_standards_uniq` on all 6 dimensions
- CHECK `cut_time_positive`: `cutTimeHundredths > 0`
- CHECK `age_group_valid`
- RLS enabled

**`households`** (schema.ts:193-198)
- `id`, `name`, timestamps
- Referenced by swimmers for consent delegation (owner must approve public consent)

**`profiles`** (schema.ts:122-150)
- `id` (mirrors `auth.users.id`), `role` enum coach/parent, `fullName`, `phone`, `email`, `emailVerifiedAt`, `ageAttestedAt`, `disabledAt` (account deleted), timestamps
- Referenced by `meets.createdBy`, `meetSwims.createdBy`, `swimmers.publicConsentBy`

**Enums** (schema.ts)
- `courseEnum` scy/scm/lcm (line 882)
- `swimTypeEnum` meet/practice (884)
- `swimStrokeEnum` free/back/breast/fly/**im** (46) — used by `meetSwims.eventStroke`, `motivationalStandards.eventStroke`
- `strokeEnum` free/back/breast/fly without IM (43) — skills catalog only
- `sexEnum` female/male (202)
- `leagueEnum` club/summer_league (119)
- `standardNameEnum` B/BB/A/AA/AAA/AAAA (914)
- `userRoleEnum` coach/parent (referenced from profiles)
- `evaluationContextEnum` drill/practice/race (referenced from evaluationSessions)

**No seasons table.** Season = computed by `currentSeasonStartYear(league, today)` in `packages/shared/src/lib/currentSeasonStartYear.ts:14-21`:
- `summer_league`: always the calendar year
- `club`: current year if month ≥ 9 (`CLUB_SEASON_START_MONTH = 9`), else prior year

**Relationships summary (meet/swim flow)**
```
profiles (coach)
  └─ meets.createdBy
       ├─ meets.id
       │   └─ meetSwims.meetId (nullable for practice)
       │        └─ meetSwims.swimmerId → swimmers.id → households.id
       └─ meetSwims.createdBy
```

**Leaderboard eligibility inputs**
```
swimmers.isPublic + publicConsentAt + publicConsentBy
swimmers.sex + swimmers.birthDate (for age group)
leagueRegistrations.league + seasonStartYear + withdrawnAt (club/ISL only)
meetSwims (swimType='meet' only)
motivationalStandards (master board only)
```

**No evaluation ↔ meet FK.** `evaluationSessions.context` enum includes `"race"` (`packages/shared/src/schemas/evaluations.ts:6`, `apps/api/src/db/schema.ts:712`) but there is no `meetId` column on `evaluationSessions` or `skillRatings`.

**Documentation**
- `docs/data-model.md` — table reference
- `packages/shared/src/schemas/meets.ts` — meet/swim/PB Zod schemas
- `packages/shared/src/schemas/leaderboard.ts` — leaderboard query/response schemas
- `packages/shared/src/schemas/swimmer.ts` — swimmer base schema

**No orphan tables** in this domain; every table above is read or written by code in `apps/api`.

---

## 2. Entering data

### Create meet

- **Route**: `POST /coach/meets` (`apps/api/src/routes/meets.ts:65-95`)
- **Auth**: `requireUser` + `requireCoach` (stacked at router level in `apps/api/src/routes/coach.ts:23`)
- **Schema**: `CreateMeetBodySchema` (`packages/shared/src/schemas/meets.ts:25-29`) — `name` min(1), `meetDate` regex YYYY-MM-DD, `course` from `CourseSchema`
- **Action**: INSERT into `meets`; sets `createdBy = req.profile.id`
- **Response**: `MeetResponse` with id, name, meetDate, course, `swimCount: 0`, timestamps
- **Web UI**: `apps/web/src/app/coach/swimmers/page.tsx` mounts the "Meets" tab (lines 40-49) via `?tab=meets`; `CoachRosterContent` toggles tabs; `CoachMeetsContent` (`apps/web/src/content/CoachMeetsContent/index.ts`) renders create/list UI

### Add swim

Single API endpoint used by both UI entry points: `POST /coach/swimmers/:id/meet-swims` (`apps/api/src/routes/coachSwimmers.ts:588-660`).

- **Auth**: `requireUser` + `requireCoach`
- **Schema**: `CreateMeetSwimBodySchema` (`packages/shared/src/schemas/meets.ts:51-69`)
  - `swimType` enum meet/practice, default "meet"
  - `meetId` uuid optional
  - `eventDistance` int positive
  - `eventStroke` from `SwimStrokeSchema`
  - `course` from `CourseSchema`
  - `timeString` min(1)
  - `swumOn` regex YYYY-MM-DD
  - **Custom refine (lines 61-69)**: if `swimType="meet"` and `meetId` undefined → error "meetId is required for meet swims"
- **Server-side checks** (`coachSwimmers.ts:606-640`)
  - `isValidEvent()` validates distance+stroke pairing (line 606)
  - `parseSwimTime(timeString)` — rejects invalid times with 422 `invalid_time` (line 611; helper at `packages/shared/src/lib/swimTime.ts`)
  - If `meetId` provided: verify meet exists; verify `swumOn >= meet.meetDate`; else 422 `swum_on_before_meet` (line 633)
- **Action**: INSERT into `meetSwims`; `createdBy = req.profile.id`
- **Response**: `MeetSwimResponse` with `swimId`, `timeString`, `swimType`, `meetName`, `meetDate`

**UI entry points** (both call the same endpoint):
1. Coach swimmer detail → `AddSwimForm` (`apps/web/src/content/CoachSwimmerDetailContent/AddSwimForm.tsx`): two-step edit → review flow. Fields: stroke, distance, course, time, date, optional meet picker.
2. Coach meet detail (`apps/web/src/content/CoachMeetDetailContent/CoachMeetDetailContent.tsx` + `actions.ts`): meetId prebound; form includes swimmer picker (lines 96-110).

### 20% personal-best warning

- **Location**: client-side only, `AddSwimForm.tsx:41-86`
- **Threshold**: `DEVIATION_THRESHOLD = 0.2` at line 42
- **Helper**: `deviationFromBest(timeHundredths, bestHundredths)` in `packages/shared/src/lib/swimTime.ts:63-69` — returns signed fraction `(new - best) / best`; returns 0 when best ≤ 0
- **Trigger**: `|deviation| > 0.2` (line 82)
- **UI**: review-step alert (lines 127-135), e.g. "This time is 25% slower than {swimmer}'s best (1:02.34). Double-check before saving." Faster direction shows an equivalent warning.
- **Enforcement**: advisory only. User can confirm & save past the warning. **No server-side 20% check anywhere.**

### Edit / delete swim

- `PATCH /coach/swimmers/:id/meet-swims/:swimId` (`coachSwimmers.ts:664-734`) — `PatchMeetSwimBodySchema` (`packages/shared/src/schemas/meets.ts:72-82`) with `timeString`, `eventDistance`, `eventStroke` all optional (requires at least one)
- `DELETE /coach/swimmers/:id/meet-swims/:swimId` (`coachSwimmers.ts:735+`)
- UI: `SwimRow` in `CoachSwimmerDetailContent.tsx` (~line 198) with inline edit and delete dialog

### Fetch meets

- `GET /coach/meets` (`meets.ts:23-61`) — returns array of `MeetResponse` ordered by `meetDate ASC`, with `swimCount` per meet (join `meetSwims` excluding archived swimmers)
- `GET /coach/meets/:id` (`meets.ts:99-159`) — returns `MeetWithSwimsResponse`; joins `meet_swims` and `meets` to include meetName/meetDate on each swim; swims ordered by `swumOn ASC, eventDistance ASC, eventStroke ASC`
- `DELETE /coach/meets/:id` (`meets.ts:164-191`) — cascade-deletes all `meetSwims` first, then meet; returns count of deleted swims
- `GET /coach/swimmers/:id/meet-swims` (`coachSwimmers.ts:507-585`) — swims for one swimmer, ordered by `swumOn DESC`, with computed personal bests inline

### Authorization

- `requireUser` (`apps/api/src/middleware/requireUser.ts:7-86`): verifies Bearer token against Supabase; 403 if `email_confirmed_at` null; 401 if profile missing or `disabled_at` set; 403 if `age_attested_at` null
- `requireCoach` (`apps/api/src/middleware/requireCoach.ts:3-14`): 403 if `req.profile.role !== "coach"`
- `requireParent` (`apps/api/src/middleware/requireParent.ts:3-14`): 403 if `req.profile.role !== "parent"`
- All coach-side meet/swim routes mount both.

### Can a swim exist without a meet?

Yes at the schema level — `meetSwims.meetId` is nullable, and `swimType='practice'` paired with null `meetId` is valid. But **no UI exposes `swimType="practice"`**, so practice swims are unreachable from the app today. The API's create endpoint still requires `meetId` for the default `swimType="meet"`. Practice swims (if they existed) are excluded from PB calculation and all leaderboards.

---

## 3. Personal bests

### Calculation

**No persisted table or view.** Computed on-read via SQL:

```sql
SELECT eventDistance, eventStroke, course, MIN(timeHundredths)
FROM meetSwims
WHERE swimmerId = ? AND swimType = 'meet'
GROUP BY eventDistance, eventStroke, course
```

- Practice swims (`swimType='practice'`) are excluded
- PBs are **per (event, stroke, course)** — e.g., 50 Free SCY and 50 Free LCM are separate PBs
- The fastest row's `swimId` is joined back so the UI can mark the originating swim

**Compute sites**
- `apps/api/src/routes/coachSwimmers.ts:548-580` — coach GET /meet-swims (returns swims + PBs together)
- `apps/api/src/routes/parentProgress.ts:267-339` — `GET /swimmers/:id/personal-bests` (adds `meetName` / `meetDate` via join on `meets`)
- `apps/api/src/routes/parentProgress.ts:376-451` — parent dashboard summary; per-swimmer aggregation
- `apps/api/src/routes/parentProgress.ts:534-558` — `pickBestEvent()`: prefers fastest 50 Free (any course), else falls back by stroke order (free→back→breast→fly→im), then shortest distance
- `apps/api/src/lib/leaderboard.ts:41-54` — `fetchPbs()` across many swimmers for leaderboard

### Schemas

- `PersonalBestSchema` (`packages/shared/src/schemas/meets.ts:117-125`): `eventDistance`, `eventStroke`, `course`, `timeHundredths`, `timeString`, `swimId`
- `ParentPersonalBestSchema` (`packages/shared/src/schemas/meets.ts:138-147`): adds `meetDate: string | null`, `meetName: string | null`

### Display sites

1. **Coach swimmer detail → Times section** (`CoachSwimmerDetailContent.tsx:152-240+`)
   - Fetched via `fetchSwimmerMeetSwims()` → GET /coach/swimmers/:id/meet-swims
   - `SwimRow` marks each swim with `isPB={true}` when matching a personal best
   - "PB" badge rendered at lines 187-191
   - Swims ordered by `swumOn DESC`

2. **Coach swimmer detail → Golf Score Trends chart** (`GolfScoreTrends.tsx`)
   - Separate from meet-swim PBs; shows stroke-count + time series (golf scores)

3. **Parent swimmer profile → Personal Bests section** (`apps/web/src/content/SwimmerProfileContent/PersonalBestsSection.tsx`)
   - Fetched via `fetchParentPersonalBests()` → GET /swimmers/:id/personal-bests
   - Card grid; event name, timeString, course label (lines 48-64)
   - Sorted stroke order → distance → course (lines 78-87)
   - Empty state at lines 24-32: "No meet times recorded yet"

4. **Parent dashboard → Swimmer cards** (`ParentDashboardContent.tsx:250,280`)
   - Per-swimmer "Best Event" card uses `pickBestEvent()` output from the parent summary endpoint

5. **Parent progress → Score history chart** (`apps/api/src/routes/parentProgress.ts:188-233` + `apps/web/src/content/ParentProgressContent/index.ts`)
   - Chart data includes `personal_best` milestones (`packages/shared/src/schemas/evaluations.ts:650,692-700,808`)
   - Milestone shape: `type="personal_best"`, `sessionDate`, `eventDistance`, `eventStroke`, `course`, `timeHundredths`, `timeString`, `meetName`
   - `sessionId` stripped for parents (lines 217-222)
   - `meetName` is a **denormalized string copy** — no FK join to `meets`

6. **Coach / public leaderboards** — ranked lists of PBs (see §4)

7. **Coach meet detail → Swims list** (`CoachMeetDetailContent.tsx`)
   - Shows swimmer + event + time + date
   - No PB badges in this view (meet-scoped)

### Course rules

PBs are always per-course. Database `GROUP BY course`, schema includes `course`, UI renders a course label per card, and leaderboard endpoints filter by a single course per request. A swimmer may hold up to ~45 PBs (5 strokes × several distances × 3 courses).

### Special calculations

- **Leaderboard ranking** (`apps/api/src/lib/leaderboard.ts:71-102`): partition by `(sex, ageGroup, eventDistance, eventStroke, course)`; sort by time ascending; ties share rank (1, 1, 3)
- **Master-board ranking** (`apps/api/src/lib/leaderboard.ts:106-145`): sort by highest standard first, then fastest time; `highestStandard()` at lines 149-171 — matches on event, stroke, course, sex, ageGroup and returns the highest standard whose `cutTimeHundredths >= PB.timeHundredths`

---

## 4. Leaderboards

### Pages

Under `apps/web/src/app/leaderboard/`:
- `/leaderboard` → `LeaderboardLandingContent` (`apps/web/src/content/LeaderboardLandingContent/LeaderboardLandingContent.tsx:1-48`) — three cards
- `/leaderboard/club` → `ClubBoardContent` (`apps/web/src/content/ClubBoardContent/ClubBoardContent.tsx`) — "Top times from the current club season, age-grouped and ranked"
- `/leaderboard/isl` → `ISLBoardContent` (`apps/web/src/content/ISLBoardContent/ISLBoardContent.tsx`) — "Times from league registration, age-grouped at first entry"
- `/leaderboard/master` → `MasterBoardContent` (`apps/web/src/content/MasterBoardContent/MasterBoardContent.tsx`) — "Personal bests from swimmers whose families opted in to public display"

### Public API (`apps/api/src/routes/leaderboard.ts`)

Unauthenticated, rate-limited to 60 requests/min:
- `GET /leaderboard/club` (44-118) → `PublicBoardResponseSchema` (rows: `PublicBoardRow[]`)
- `GET /leaderboard/isl` (123-205) → `PublicBoardResponseSchema`
- `GET /leaderboard/master` (211-290) → `PublicMasterResponseSchema` (`standardsAvailable: boolean`, rows: `PublicMasterRow[]`)

### Coach API (`apps/api/src/routes/coachLeaderboard.ts`)

Mounted via `coachLeaderboardRouter` in `apps/api/src/routes/coach.ts:47`, behind `requireUser` + `requireCoach`:
- `GET /coach/leaderboard/club` (35-109) → `CoachBoardResponseSchema` (full names)
- `GET /coach/leaderboard/isl` (114-196) → `CoachBoardResponseSchema`
- `GET /coach/leaderboard/master` (202-283) → `CoachMasterResponseSchema`

### Eligibility (how a swimmer ends up on each board)

**Club**
- Active `leagueRegistrations` row with `league='club'`, `seasonStartYear = currentSeasonStartYear("club", today)`, `withdrawnAt IS NULL`
- `isActiveSwimmer` (not archived)
- Public only: `swimmers.isPublic = true`
- Coach view: same minus `isPublic` filter — coaches see all club-registered swimmers

**ISL (summer league)**
- Active `leagueRegistrations` row with `league='summer_league'`, `seasonStartYear = currentSeasonStartYear("summer_league", today)`, `withdrawnAt IS NULL`
- `isActiveSwimmer`
- Public only: `isPublic = true`
- Coach view: no `isPublic` filter

**Master**
- Any swimmer where `isActiveSwimmer` and (public only) `isPublic = true`
- **No league registration required**
- Requires at least one row in `motivational_standards`; otherwise returns `{ standardsAvailable: false, rows: [] }`
- Coach view: no `isPublic` filter

### Ranking

`PublicBoardRow` shape (`packages/shared/src/schemas/leaderboard.ts:21-32`):
```typescript
{
  firstName: string
  lastInitial: string
  ageGroup: string
  sex: string
  time: string               // MM:SS.HH or SS.HH
  eventDistance: number
  eventStroke: "free" | "back" | "breast" | "fly" | "im"
  course: "scy" | "scm" | "lcm"
  rank: number
}
```

- **Club / ISL** (`apps/api/src/lib/leaderboard.ts:69-102`): partition by `(sex, ageGroup, eventDistance, eventStroke, course)`; sort by time ascending; ties share rank
- **Master** (`apps/api/src/lib/leaderboard.ts:104-145`): same partition; sort by standard (highest first: `AAAA > AAA > AA > A > BB > B`), then time; ties on `(standard, time)` share rank

**Data source**: `fetchPbs()` (`apps/api/src/lib/leaderboard.ts:41-54`) — `MIN(timeHundredths)` per `(swimmer, distance, stroke, course)` from `meetSwims WHERE swimType='meet'`. Formatted with `formatSwimTime()` (`packages/shared/src/lib/swimTime.ts:22-31`).

### Age groups

Values (`packages/shared/src/lib/ageGroup.ts:3-14`):
- `6-under`, `7-8`, `9-10`, `11-12`, `13-14`, `15-18`; ages > 18 return `null` (ineligible)

Age calc (`packages/shared/src/lib/calculateAge.ts:1-14`): input `birthDate` + `today` ISO strings; returns whole years accounting for month/day.

Determination timing:
- **Club** (`apps/api/src/routes/leaderboard.ts:87`): age as of `todayLA()` (America/Los_Angeles, `packages/shared/src/lib/todayLA.ts`)
- **ISL** (`apps/api/src/routes/leaderboard.ts:174`): age as of `registeredOn` (frozen at registration — see ADR 023, comment at `leaderboard.ts:121`)
- **Master** (`apps/api/src/routes/leaderboard.ts:255`): age as of `todayLA()`

### Displayed name

**Public rows**: `firstName` + `lastInitial.` — e.g., "John D."
- Derived in API: `lastInitial: swimmer.lastName.charAt(0).toUpperCase()` (`apps/api/src/routes/leaderboard.ts:91`)
- Rendered: `apps/web/src/components/BoardTable/BoardTable.tsx:85` as `${firstName} ${lastInitial}.`
- Full `lastName`, `birthDate`, and swimmer `id` are **never** included in the public response (comment at `leaderboard.ts:82-99`)

**Coach rows**: full first + last (`packages/shared/src/schemas/leaderboard.ts:50-61`), no masking.

### Clickthrough

**None.** `BoardTable.tsx` renders rows as plain text with no `href`, `onClick`, or navigation. There is no public swimmer profile page to click through to.

Fields per row: rank, swimmer (first + last initial), event (distance/stroke/course), age group + sex, time; master board adds a standard badge.

### Consent

- **Columns**: `swimmers.isPublic` (bool NOT NULL), `swimmers.publicConsentAt` (timestamptz nullable), `swimmers.publicConsentBy` (uuid nullable → profiles)
- **DB CHECK** (`apps/api/src/db/schema.ts:231-234`): `NOT is_public OR (public_consent_at IS NOT NULL AND public_consent_by IS NOT NULL)`
- **UI**: `apps/web/src/components/PublicToggleSection/PublicToggleSection.tsx`
  - If public: "`{firstName}` is currently visible on public leaderboards (first name, last initial, age group, and meet times)."
  - If not: "`{firstName}` is currently hidden from public leaderboards"
  - Warning: "Changes can take up to a minute to reflect on public leaderboards"
- **Permission** (`PublicToggleSection.tsx:48-49`): only household **owner** can enable (`canEnable = householdRole === "owner"`); any member can disable
- **Backend** (`apps/api/src/routes/swimmers.ts:335-338`): rejects non-owner enabling with 403 "Only the household owner can make a swimmer public"
- **Acknowledgment flow** (`apps/web/src/content/EditSwimmerContent/actions.ts:124-181`):
  1. Owner checks box: "I understand that `{firstName}`'s first name, last initial, age group, and meet times will be visible to anyone on the public leaderboard"
  2. UI requires checkbox before submit button is enabled (`PublicToggleSection.tsx:112`)
  3. Request body includes `consentAcknowledged: true` (actions.ts:152-154)
  4. Backend verifies checkbox was set (actions.ts:138-142)
  5. On enable: writes `isPublic=true`, `publicConsentAt=now()`, `publicConsentBy=callerId`; audit entry `consent_granted`. On disable: `isPublic=false`, audit entry `consent_revoked` (`apps/api/src/routes/swimmers.ts:389-402`)
- **Enforcement at query time**: `eq(swimmers.isPublic, true)` filter at `apps/api/src/routes/leaderboard.ts:76, 161, 244`

### League / club reference data

- **Leagues**: hardcoded Postgres enum `["club", "summer_league"]` (`apps/api/src/db/schema.ts:119`). No league table. Season years computed by `currentSeasonStartYear()` (`packages/shared/src/lib/currentSeasonStartYear.ts:14-21`); club season starts September (constant at line 4).
- **Clubs**: real DB rows (`clubs` table). Seeded with placeholders `[Club 1]`, `[Club 2]` per `docs/data-model.md:374`. Swimmers can escape via `swimmerClubs.otherClubName` free-text. **Not shown on any leaderboard** — clubs are metadata only; leaderboards filter by league registration.
- **Motivational standards**: `motivational_standards` table **seeded empty**. No admin route or UI to load them. Determined by `highestStandard()` (`apps/api/src/lib/leaderboard.ts:149-171`). `MasterBoardContent.tsx:37-40` shows "Standards coming soon" header when the table is empty.

### Summary table

| Leaderboard | URL | Public? | Eligibility | Ranking | Age calc date | Name shown | Coach view |
|---|---|---|---|---|---|---|---|
| Club | `/leaderboard/club` | Yes | club league reg (current season) + isPublic | Time | `todayLA()` | First + last initial | `/coach/leaderboard/club` (no isPublic filter) |
| ISL | `/leaderboard/isl` | Yes | summer_league reg (current year) + isPublic | Time | `registeredOn` | First + last initial | `/coach/leaderboard/isl` (no isPublic filter) |
| Master | `/leaderboard/master` | Yes | active + isPublic | Standard then time | `todayLA()` | First + last initial | `/coach/leaderboard/master` (no isPublic filter) |

---

## 5. Navigation

### Public / logged-out visitor

- **Top nav** (`apps/web/src/components/SiteNav/SiteNav.tsx:36-50`): ThemeLogo → `/`; Login → `/login`
- **Footer** (`apps/web/src/components/SiteFooter/SiteFooter.tsx:10-13`): `/privacy`, `/terms`, `/#lessons`, `/#leaderboards`, `/#coach`, `/#faq`, and `/leaderboard`
- **Homepage leaderboard section** (`apps/web/src/content/HomepageContent/LeaderboardSection.tsx:24-45`): three cards linking to `/leaderboard/club`, `/leaderboard/isl`, `/leaderboard/master`
- **Reachable routes**: `/`, `/login`, `/leaderboard`, `/leaderboard/{club,isl,master}`
- **No path to meets** (coach-only). No clickthrough from leaderboard rows (public swimmer profile does not exist).

### Parent (household member/owner)

- **Top nav** (`apps/web/src/components/ParentNav/ParentNav.tsx:15-19`) `ALL_NAV_LINKS`:
  - `/dashboard` (Home)
  - `/dashboard/book` (Book) — hidden from viewer role (line 34)
  - `/dashboard/lessons` (Lessons)
  - `/dashboard/progress` (Progress)
  - Logo → `/`
  - Desktop center nav (line 128); mobile bottom tabs (lines 164-193)
- **No "Meets" and no "Leaderboards" link in top nav.**
- **Profile menu** (`apps/web/src/components/ProfileMenu/ProfileMenu.tsx:10-14`): Dashboard, Leaderboards, Household, Account settings — this is the only in-app link to leaderboards for parents
- **Footer**: `/leaderboard` link (`SiteFooter.tsx:11`)
- **Dashboard cards** (`ParentDashboardContent.tsx`):
  - Swimmer cards (line 250) → `/dashboard/swimmers/{id}` and `/dashboard/swimmers/{id}/progress`
  - "Add a swimmer" (line 280) → `/dashboard/swimmers/new`
  - Upcoming lessons deep-link to `/dashboard/lessons/{id}`
- **Progress hub** (`apps/web/src/app/dashboard/progress/page.tsx`): redirects to first swimmer's progress or shows swimmer list; each → `/dashboard/swimmers/{id}/progress`
- **Swimmer profile** (`SwimmerProfileContent.tsx:85`): Dashboard link → `/dashboard`; Next lesson → `/dashboard/book`; Lessons → `/dashboard/lessons/{id}`

### Coach

- **Top nav** (`apps/web/src/components/CoachNav/CoachNav.tsx:34-40`) desktop `DESKTOP_NAV_LINKS`:
  - `/dashboard`, `/coach/schedule`, `/coach/availability`, `/coach/swimmers`, `/coach/families`
- **Mobile bottom tabs** (lines 16-20): Home, Schedule, Swimmers
- **Mobile "More" sheet** (lines 27-31): Families, Availability, Account settings
- **No "Meets" and no "Leaderboards" link in top nav.**
- **Dashboard** (`CoachDashboardContent.tsx:149`): "Swimmers" section → `/coach/swimmers`
- **Meets**: reached via `/coach/swimmers?tab=meets` (`CoachRosterContent` with Meets tab, `apps/web/src/app/coach/swimmers/page.tsx:14-54`). `/coach/meets/page.tsx:10` is a permanent redirect to that tab. `/coach/meets/{id}` is reached by clicking a meet row from the tab.
- **Coach leaderboard UI**: **none**. Three `/coach/leaderboard/*` endpoints exist and are integration-tested, but no fetch helpers in `apps/web/src/lib/api/`, no pages, no links.

### Hard-to-reach / orphan pages

- `/coach/meets/page.tsx` — permanent redirect stub to `?tab=meets`; standalone route folder still present
- Coach leaderboards at the API layer — no web callers
- No public swimmer profile page; leaderboard rows do not link anywhere

---

## 6. Connections to the rest of the site

### Swimmer profile (parent) — `apps/web/src/content/SwimmerProfileContent/SwimmerProfileContent.tsx`

- Line 44: `personalBests: SectionResult<ParentPersonalBestsResponse>` (fetched at page.tsx:50)
- Line 126: `PersonalBestsSection` renders event, time, course, PB badge
- Lines 138-142: `ProgressSnapshotSection` renders radar (from `scoreHistory` screen-group rollups) and latest coaching priorities; links to progress page
- `ProgressSnapshotSection.tsx:54-61`: `latestScreenGroupSnapshot()`, `firstScreenGroupSnapshot()` compute rollups
- Lines 81-85: `CategoryRadar` displays category averages

### Parent dashboard — `apps/web/src/content/ParentDashboardContent/ParentDashboardContent.tsx`

- Lines 250, 280: swimmer cards with "Best Event" (from `pickBestEvent()`)
- Upcoming lessons card deep-links to lesson detail

### Coach swimmer detail — `apps/web/src/content/CoachSwimmerDetailContent/CoachSwimmerDetailContent.tsx`

- Lines 60-62 receive `swims: MeetSwimResponse[]`, `personalBests: PersonalBest[]`, `meets: MeetResponse[]`
- Line 29: `SwimmerTimeline` — timeline of notes, ratings, coaching priorities
- Lines 148+: swim rows with editable time input
- Page fetch (`apps/web/src/app/coach/swimmers/[id]/page.tsx:50-51`): `fetchSwimmerMeetSwims()`, `fetchMeets()` (for the Add Swim form's meet picker)

### Parent swimmer progress — `apps/web/src/content/ParentSwimmerProgressContent/ParentSwimmerProgressContent.tsx`

- Lines 72-74: screen-group rollups from `scoreHistory` (snapshot + first-evaluation overlay)
- Lines 88-99: `RecentWins`, `SummaryCard` built from `displaySkills` + sessionDates
- Lines 100-104: `hasAnyData` filter
- Lines 115-120: `GolfScoreList` when golf-score trends exist
- Line 120: `StartsSection`
- Page fetch (`apps/web/src/app/dashboard/swimmers/[id]/progress/page.tsx:49-61`): `fetchScoreHistory()` — stripped to parent variant (no `sessionId`)

### Coach swimmer progress — `apps/web/src/app/coach/swimmers/[id]/progress/page.tsx:32`

- `fetchScoreHistory()` returns coach variant with `sessionId` for edit links
- Score history includes `personal_best` milestones (with `meetName`)

### Coach swimmer timeline — `apps/web/src/content/CoachSwimmerDetailContent/SwimmerTimeline.tsx`

- Lines 60-64: `TimelineItem` kinds — `all`, note types (observation, correction, drill, recommendation), `rating_note`, `coaching_priority`
- **Does not render meet swims.**

### Coach meet detail — `apps/web/src/content/CoachMeetDetailContent/CoachMeetDetailContent.tsx`

- Lists swims in the meet (swimmer, event, time, date)
- Hosts `AddSwimForm` with meetId prebound
- No PB badges in this view

### Evaluations and the "Race" context

- Enum: `EvaluationContextSchema = z.enum(["drill", "practice", "race"])` (`packages/shared/src/schemas/evaluations.ts:6`)
- Stored on `evaluationSessions.context` (`apps/api/src/db/schema.ts:702-731`, column at line 712)
- **No `meetId` column** on `evaluationSessions` or `skillRatings` (`apps/api/src/db/schema.ts:739-810`)
- A "race" evaluation is a labeled session, not a meet-linked record. No SQL join between `evaluation_sessions` and `meets`.
- The only connection between the two domains is the **denormalized `meetName` string** on `personal_best` score-history milestones (`packages/shared/src/schemas/evaluations.ts:650-701, 692-700`), which is rendered on the parent and coach progress charts.

---

## 7. Gaps and rough edges

### Placeholder data (confirmed)

- **`clubs` seeded with placeholders.** `docs/data-model.md:374` documents hardcoded `[Club 1]`, `[Club 2]` rows: "placeholder names until the real club list is provided." Referenced by `league_registrations` for "club" league swimmers but never replaced. Swimmers can escape via `swimmerClubs.otherClubName` free-text, so this blocks nothing operationally.
- **Homepage leaderboard hero is dummy data.** `apps/web/src/content/HomepageContent/LeaderboardSection.tsx:20` — TODO comment "replace with real API data (filter by public_profile = true)". All six preview rows are hardcoded (`Maya R.`, `Liam T.`, …, `[50 Free]`, `[0:00.00]`). Parent-facing surface.
- **`motivational_standards` seeded empty.** ADR 023 (§Consequences) documents that all three `/leaderboard/master` endpoints return `{ standardsAvailable: false, rows: [] }` until standards are loaded. No admin UI, no API write endpoint; must be inserted via raw SQL or custom migration.

### Dead or duplicate code

- **Coach leaderboard routes have zero callers.** `/coach/leaderboard/{club,isl,master}` (`apps/api/src/routes/coachLeaderboard.ts`) are fully implemented and covered by integration tests, but `apps/web/src/lib/api/` has no fetch helper, no page uses them, and no link points at them. Mentioned in `docs/architecture.md:91-93` but never surfaced in the UI.

### Half-built features

- **`/coach/meets` page is a redirect stub.** `apps/web/src/app/coach/meets/page.tsx:10` permanently redirects to `/coach/swimmers?tab=meets` (per ADR 036 Phase 8 Part B Stop 3 piece 6). The old route folder still exists, and `CoachMeetsContent` remains — future standalone use is possible but unmotivated.
- **Practice swims unreachable in UI.** Schema supports `swimType='practice'` with nullable `meetId`, and PB/leaderboard queries explicitly filter it out, but no form exposes the option. Coach can only create `swimType='meet'` records.
- **Motivational standards have no load path.** Table + query logic exist; no route, no UI, no documented process to populate. Master leaderboard remains empty until a manual SQL/migration load.
- **No swimmer clickthrough from leaderboard.** `BoardTable.tsx` renders inert text. No public swimmer profile page exists for public rows to link to.
- **Parents have no top-nav path to leaderboards**; only `ProfileMenu` and footer surface it.

### Contradictions with docs

- **ADR 023 is marked "draft — confirm with Jason"**: master-board eligibility (any active swimmer vs. league-registered only) is noted as inferred. Code implements "any active + `isPublic`". No follow-up visible in `docs/decisions/`.
- `docs/accounts.md` (owner-only `isPublic=true`) matches code enforcement at `apps/api/src/routes/swimmers.ts:335-338` — no contradiction, but critical gate worth flagging.
- `docs/architecture.md:91-93` lists coach leaderboard endpoints as existing without noting they have no UI.

### Orphans

- **`motivational_standards` table**: read-only in code (no `INSERT`/`UPDATE`/`DELETE` route). Only readers are the two master leaderboard paths.
- **Three `/coach/leaderboard/*` API routes**: no web callers.
- **`apps/web/src/app/coach/meets/page.tsx`**: redirect stub; the route folder is retained but unreachable as a page.

### Overall shape

The meets/leaderboards domain is structurally sound — clean API separation, rate limiting on public endpoints, DB-level consent CHECK constraint, no RLS yet (all tables marked "policies TBD" in `docs/data-model.md`). The user-visible gaps are: placeholder clubs, dummy homepage data, master board empty until standards are loaded, coach leaderboards unmounted, and no public swimmer profile for leaderboard clickthrough.
