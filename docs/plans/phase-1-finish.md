# Phase 1: Finish

**Status:** In progress

## Context

Phase 1 built profiles, households, swimmers, the skill catalog, and the evaluation/rating system. These remaining items close the gaps before Phase 2: coach notes with a timeline, meet swims with validated times, leaderboard navigation and rate-limiting.

---

## CN-1 — Coach notes + swimmer timeline

Adds standalone coach notes (free-form text not tied to a rating), validates session and lesson membership when a note references them, and exposes a single timeline endpoint that merges notes, rating notes, and coaching priorities for the swimmer profile UI.

### Decisions

| Decision | Resolution |
|---|---|
| **Note types.** Three item types appear in the timeline: standalone coach notes, skill rating notes (ratings where `note` is non-null), and coaching priorities from evaluation sessions. They are not stored as a single type — they are merged at query time from `coach_notes`, `skill_ratings`, and `evaluation_sessions`. | Inferred; confirm with Jason. |
| **Note ties.** A coach note can be tied to a session, a lesson, both, or neither (standalone). It cannot be tied to an individual skill rating — `session_id` on `coach_notes` is the finest granularity. | Inferred; confirm with Jason. |
| **Editing notes.** Coach notes are editable and deletable by their author at any time. Unlike ratings (which are append-only and use a void pattern), notes have no audit significance beyond their current text. `PATCH` updates `body`; `DELETE` hard-deletes the row. Only the original `created_by` coach may edit or delete a note. | Inferred; confirm with Jason. |
| **Note visibility to parents.** Parents cannot see standalone coach notes or rating notes via any household-facing route. Parents can see coaching priorities through their existing access to evaluation session data (the coaching priority is shown on the swimmer progress page). The `/coach/swimmers/:id/timeline` endpoint is coach-only. | Inferred; confirm with Jason. |
| **Timeline sort key.** All three sources are sorted by `created_at` descending. For `coaching_priority` items the key is `evaluation_sessions.created_at`; for rating notes it is `skill_ratings.created_at` (not `rated_at`). | Inferred; confirm with Jason. |

### Schema

**`coach_notes`**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `swimmer_id` | uuid not null FK → swimmers.id on delete restrict | |
| `session_id` | uuid nullable FK → evaluation_sessions.id on delete restrict | null = standalone note |
| `lesson_id` | uuid nullable FK → lessons.id on delete restrict | null = not tied to a lesson |
| `body` | text not null | non-blank enforced by check |
| `created_by` | uuid not null FK → profiles.id on delete restrict | |
| `created_at` | timestamptz not null default now() | |
| `updated_at` | timestamptz not null default now() | |

Constraints:
- `check(body <> '')` — blank notes rejected at the DB layer.
- When `session_id` is non-null: `evaluation_sessions.swimmer_id` must equal `coach_notes.swimmer_id` — enforced at the API layer (422, not a DB constraint).
- When `lesson_id` is non-null: a `lesson_swimmers` row must exist for `(lesson_id, swimmer_id)` — enforced at the API layer (422).

### Files

```
apps/api/src/db/schema.ts
apps/api/src/db/migrations/<ts>_add_coach_notes.sql           (drizzle-kit generate)
apps/api/src/db/queries.ts                                     add coach note helpers
apps/api/src/routes/coachSwimmers.ts                          add POST /coach/swimmers/:id/notes, PATCH and DELETE /coach/swimmers/:id/notes/:noteId, GET /coach/swimmers/:id/timeline
apps/api/src/app.ts                                            no new router mount needed (uses coachSwimmers)
packages/shared/src/schemas/notes.ts                          new — CoachNoteBody, UpdateCoachNoteBody, TimelineItem, TimelineResponse
packages/shared/src/index.ts
apps/api/src/__tests__/coachNotes.test.ts                     new
```

### Routes

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /coach/swimmers/:id/notes | requireCoach | Create a standalone or session/lesson-tied note. |
| PATCH | /coach/swimmers/:id/notes/:noteId | requireCoach | Update `body`. Author-only: 403 if the caller is not `created_by`. |
| DELETE | /coach/swimmers/:id/notes/:noteId | requireCoach | Hard-delete a note. Author-only: 403 if the caller is not `created_by`. |
| GET | /coach/swimmers/:id/timeline | requireCoach | Merged timeline: standalone notes + non-voided rating notes + coaching priorities, newest first. |

### Validation (422 on failure)

- `POST /coach/swimmers/:id/notes` with a `sessionId` whose `swimmer_id` ≠ `:id` → 422 `session_swimmer_mismatch`.
- `POST /coach/swimmers/:id/notes` with a `lessonId` that has no `lesson_swimmers` row for `:id` → 422 `lesson_swimmer_mismatch`.
- `PATCH /coach/swimmers/:id/notes/:noteId` called by a different coach → 403.
- `DELETE /coach/swimmers/:id/notes/:noteId` called by a different coach → 403.
- `PATCH` or `DELETE` on a note where `:id` does not match the note's `swimmer_id` → 404.

### Timeline response shape

```typescript
interface TimelineItem {
  type: "note" | "rating_note" | "coaching_priority";
  id: string;          // coach_notes.id | skill_ratings.id | evaluation_sessions.id
  body: string;        // coach_notes.body | skill_ratings.note | evaluation_sessions.coaching_priority
  createdAt: string;   // ISO timestamp used for sort order
  tiedTo?: {           // present when the item is attached to a session or lesson
    sessionId?: string;
    lessonId?: string;
    skillId?: string;  // for rating_note items
  };
}
```

`GET /coach/swimmers/:id/timeline` merges all three sources in memory and returns them sorted by `createdAt` descending. `rating_note` items exclude any `skill_ratings` row where `voided_at` is non-null. `coaching_priority` items are one entry per `evaluation_sessions` row; they appear alongside rating notes from the same session rather than being deduplicated.

The timeline UI (`SwimmerTimelineCard` or equivalent) calls only this endpoint — no separate fetches for each source.

### Tests

- `POST /coach/swimmers/:id/notes` with a valid standalone body → 201, row created.
- `POST /coach/swimmers/:id/notes` with `sessionId` belonging to a different swimmer → 422 `session_swimmer_mismatch`.
- `POST /coach/swimmers/:id/notes` with `lessonId` that does not include `:id` → 422 `lesson_swimmer_mismatch`.
- `POST /coach/swimmers/:id/notes` with `sessionId` belonging to `:id` → 201.
- `POST /coach/swimmers/:id/notes` with `lessonId` that includes `:id` → 201.
- `POST /coach/swimmers/:id/notes` where `:id` is an archived swimmer → 404.
- `POST /coach/swimmers/:id/notes` where `:id` does not exist → 404.
- `PATCH /coach/swimmers/:id/notes/:noteId` by the note's author → 200, `body` updated, `updated_at` advances.
- `PATCH /coach/swimmers/:id/notes/:noteId` by a different coach → 403.
- `PATCH /coach/swimmers/:id/notes/:noteId` with a blank `body` → 422.
- `DELETE /coach/swimmers/:id/notes/:noteId` by the note's author → 200, row removed.
- `DELETE /coach/swimmers/:id/notes/:noteId` by a different coach → 403.
- `PATCH` or `DELETE` where `:id` does not match the note's `swimmer_id` → 404.
- `GET /coach/swimmers/:id/timeline` returns items from all three sources sorted newest first.
- `GET /coach/swimmers/:id/timeline` excludes voided skill ratings.
- `GET /coach/swimmers/:id/timeline` includes non-voided skill ratings that have a non-null note.
- `GET /coach/swimmers/:id/timeline` excludes skill ratings whose note is null (no `rating_note` entry emitted).
- `GET /coach/swimmers/:id/timeline` where `:id` is an archived swimmer → 404.
- `GET /coach/swimmers/:id/timeline` where `:id` does not exist → 404.
- Parent calling `POST /coach/swimmers/:id/notes` → 403.
- Parent calling `GET /coach/swimmers/:id/timeline` → 403.

---

## MT-1 — Meet swims + time helper

Adds meets and per-swimmer meet swims. Course consistency and date order are validated at the API layer. A shared time helper is the single source of truth for parsing and formatting swim times in both API validation and web form display.

### Decisions

| Decision | Resolution |
|---|---|
| **Course casing.** Enum values are stored and transmitted as lowercase (`scy`, `scm`, `lcm`). The UI displays them in uppercase. This matches the pattern used for other enums in this codebase. | Inferred; confirm with Jason. |
| **Standard event names.** Events are represented as a distance integer plus a stroke from the existing `stroke_enum`, not as a free-text string. Display format follows USAS convention (e.g., "50 Free", "100 Back"). | Inferred; confirm with Jason. |
| **Events enforced in shared code.** The set of valid distance/stroke combinations (e.g., 50/100/200/400/800/1500 × free; 50/100/200 × back, breast, fly; 200/400 IM) is enumerated in `packages/shared` as a `VALID_EVENTS` constant. Both the API Zod schema and the web form's event dropdown import from this constant so the list is never duplicated. | Inferred; confirm with Jason. |
| **Heats and finals.** `meet_swims` does not track whether a swim is a heat or a final. If a swimmer competes in an event twice (prelim + final), two rows are recorded. The leaderboard uses the fastest row for each swimmer/event/course combination. | Inferred; confirm with Jason. |
| **Meet deletion and editing.** A meet with no associated swims can be hard-deleted. A meet that has swims cannot be deleted until all its swims are removed first (the FK on delete restrict enforces this). Meets are not editable after creation — correct by deleting and re-creating. | Inferred; confirm with Jason. |
| **Swim deletion and editing.** Individual meet swims can be hard-deleted at any time. They carry no financial or session chain, so a hard delete is safe. Swims are not editable; correct by deleting and re-entering. | Inferred; confirm with Jason. |

### Schema

**New enum `course`:** `scy` | `scm` | `lcm`

**`meets`**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | text not null | |
| `meet_date` | date not null | first day of the meet |
| `course` | course_enum not null | |
| `created_at` | timestamptz not null default now() | |
| `updated_at` | timestamptz not null default now() | |

**`meet_swims`**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `swimmer_id` | uuid not null FK → swimmers.id on delete restrict | |
| `meet_id` | uuid not null FK → meets.id on delete restrict | |
| `event_distance` | integer not null | validated against `VALID_EVENTS` in shared code |
| `event_stroke` | stroke_enum not null | validated against `VALID_EVENTS` in shared code |
| `course` | course_enum not null | must equal meet.course — enforced at API layer (422) |
| `swum_on` | date not null | must be ≥ meet.meet_date — enforced at API layer (422) |
| `time_hundredths` | integer not null | parsed from the submitted time string via the shared helper |
| `created_by` | uuid not null FK → profiles.id on delete restrict | |
| `created_at` | timestamptz not null default now() | |
| `updated_at` | timestamptz not null default now() | |

Constraints:
- `meet_swims.course = (SELECT course FROM meets WHERE id = meet_swims.meet_id)` — enforced at the API layer, not as a DB constraint.
- `meet_swims.swum_on >= (SELECT meet_date FROM meets WHERE id = meet_swims.meet_id)` — enforced at the API layer.

### Shared time helper (`packages/shared`)

```typescript
// Accepts: "1:05.32" (m:ss.hh), "65.32" (ss.hh), "38.4" (ss.t — tenths)
// Returns hundredths as an integer, or null if the string is not a valid time.
function parseSwimTime(value: string): number | null

// Converts hundredths back to the canonical "m:ss.hh" format (or "ss.hh" when < 60 s).
function formatSwimTime(hundredths: number): string
```

Parsing rules:
- `"1:05.32"` → 1 × 6000 + 5 × 100 + 32 = **6532**
- `"65.32"` → 65 × 100 + 32 = **6532**
- `"38.4"` → 38 × 100 + 40 = **3840** (single decimal digit = tenths, multiply by 10)
- Leading zeros in seconds are not required.
- Minutes part (before `:`) must be a non-negative integer; seconds must be 0–59; fractional part may be one or two digits.
- Returns `null` for any input that does not match these patterns.

### Files

```
apps/api/src/db/schema.ts
apps/api/src/db/migrations/<ts>_add_meet_swims.sql              (drizzle-kit generate)
apps/api/src/db/queries.ts                                       add meet + meet-swim helpers
apps/api/src/routes/coachSwimmers.ts                            add meet-swim CRUD routes
apps/api/src/app.ts
packages/shared/src/lib/swimTime.ts                             new — parseSwimTime, formatSwimTime
packages/shared/src/__tests__/swimTime.test.ts                  new
packages/shared/src/lib/events.ts                               new — VALID_EVENTS constant
packages/shared/src/schemas/meets.ts                            new — CreateMeetBody, CreateMeetSwimBody, MeetSwimResponse
packages/shared/src/index.ts                                     export parseSwimTime, formatSwimTime, VALID_EVENTS
apps/api/src/__tests__/meetSwims.test.ts                        new
```

### Routes

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /coach/meets | requireCoach | Create a meet. |
| GET | /coach/meets | requireCoach | List meets, sorted by meet_date desc. |
| DELETE | /coach/meets/:id | requireCoach | Hard-delete a meet with no swims; 422 if swims exist. |
| POST | /coach/swimmers/:id/meet-swims | requireCoach | Record a swim. Parses `timeString` via `parseSwimTime`. |
| GET | /coach/swimmers/:id/meet-swims | requireCoach | List meet swims for a swimmer. |
| DELETE | /coach/meet-swims/:id | requireCoach | Hard-delete a swim. |

### Validation (422 on failure)

- `event_distance` / `event_stroke` combination not in `VALID_EVENTS` → 422 `invalid_event`.
- `course` in the swim body ≠ `meets.course` → 422 `course_mismatch`.
- `swum_on` < `meets.meet_date` → 422 `swum_on_before_meet`.
- `timeString` not parseable by `parseSwimTime` → 422 `invalid_time`.
- `DELETE /coach/meets/:id` when swims exist → 422 `meet_has_swims`.

### Tests

**Time helper (`swimTime.test.ts`)**

- `parseSwimTime("1:05.32")` → 6532
- `parseSwimTime("65.32")` → 6532
- `parseSwimTime("38.4")` → 3840
- `parseSwimTime("0:38.40")` → 3840
- `parseSwimTime("2:00.00")` → 12000
- `parseSwimTime("59.99")` → 5999
- `parseSwimTime("")` → null
- `parseSwimTime("abc")` → null
- `parseSwimTime("1:60.00")` → null (seconds ≥ 60)
- `parseSwimTime("1:05.321")` → null (three decimal digits)
- `formatSwimTime(6532)` → `"1:05.32"`
- `formatSwimTime(3840)` → `"38.40"`
- `formatSwimTime(12000)` → `"2:00.00"`
- `formatSwimTime(5900)` → `"59.00"`

**Route tests (`meetSwims.test.ts`)**

- `POST /coach/swimmers/:id/meet-swims` with valid event, matching course, valid date and time → 201.
- `POST /coach/swimmers/:id/meet-swims` with invalid distance/stroke combination → 422 `invalid_event`.
- `POST /coach/swimmers/:id/meet-swims` with course ≠ meet.course → 422 `course_mismatch`.
- `POST /coach/swimmers/:id/meet-swims` with `swum_on` before `meet_date` → 422 `swum_on_before_meet`.
- `POST /coach/swimmers/:id/meet-swims` with `swum_on` equal to `meet_date` → 201 (boundary allowed).
- `POST /coach/swimmers/:id/meet-swims` with unparseable time string → 422 `invalid_time`.
- `DELETE /coach/meet-swims/:id` removes the swim.
- `DELETE /coach/meet-swims/:id` for a swim belonging to a different swimmer (URL `:id` is a valid swim but its `swimmer_id` ≠ the path swimmer) → 404.
- `GET /coach/swimmers/:id/meet-swims` where `:id` does not exist → 404.
- `POST /coach/swimmers/:id/meet-swims` where `:id` is an archived swimmer → 404.
- `DELETE /coach/meets/:id` with no swims → 200.
- `DELETE /coach/meets/:id` with existing swims → 422 `meet_has_swims`.
- Parent calling any `/coach/` meet or meet-swim route → 403.

---

## LB-1 — Public leaderboard rate limiting

The public leaderboard routes are unauthenticated and indexable. Rate-limit them to prevent scraping or accidental DoS.

### Files

```
apps/api/src/middleware/rateLimiter.ts    new — thin wrapper around express-rate-limit; exports leaderboardLimiter
apps/api/src/app.ts                       apply leaderboardLimiter before leaderboard router
```

### Rules

- `leaderboardLimiter`: 60 requests per IP per minute. Returns 429 with `{ error: "Too many requests" }` on breach.
- Applied to all routes under `/leaderboard` (or whichever router serves the public leaderboard). Does not apply to authenticated routes.
- Store: in-memory (MemoryStore is fine; Railway restarts are acceptable reset points). No Redis dependency.

### Rules

- Leaderboard query must filter `WHERE is_public = true AND archived_at IS NULL`. No swimmer with `is_public = false` or a non-null `archived_at` may appear in any response, including cached or aggregated output.
- Each swimmer entry in the public JSON exposes only: first name, last initial (one character, no full last name), time, event, course, age group, sex, club name, and ISL affiliation. No birth date, `public_consent_at`, `public_consent_by`, `household_id`, contact info, or any other PII.

### Tests

- 61 sequential requests from the same IP → the 61st returns 429.
- A different IP is not affected by the first IP's count.
- Authenticated routes are not affected by this limiter.
- A swimmer with `is_public = false` does not appear in the leaderboard response, even if they have recorded times.
- An archived swimmer (`archived_at` is non-null) does not appear in the leaderboard response.
- Each swimmer entry in the response contains `firstName` and `lastInitial` but no `lastName`, `birthDate`, `householdId`, `publicConsentAt`, or `publicConsentBy` fields.

---

## LB-2 — Leaderboard navigation placement

The Leaderboards link should not appear in the signed-out header. Signed-out users reach it via the footer and the home page's leaderboard section. Parents (authenticated) access it through their account menu.

### Decisions

| Decision | Resolution |
|---|---|
| **Public access.** The leaderboard page and its API routes are accessible without authentication. No login is required to view times. | Inferred; confirm with Jason. |
| **Sex separation.** The leaderboard separates results by sex (female / male). Age groups follow USAS age-group boundaries. | Inferred; confirm with Jason. |
| **Master board display.** The leaderboard shows all-time personal bests: one row per swimmer per event per course showing their fastest recorded time across all meets. Individual heat/final rows are not surfaced on the public board. | Inferred; confirm with Jason. |
| **Club and Irvine Swim League display.** Swimmers' club affiliations (`swimmer_clubs`) and ISL registrations (`league_registrations`) are shown alongside their times. Filtering the board by club or ISL membership is a later enhancement. | Inferred; confirm with Jason. |
| **Coach leaderboard view deferred.** A coach-only view of the leaderboard that includes non-public swimmers is out of scope for this phase. The current public board shows only `is_public = true` swimmers. | Inferred; confirm with Jason. |

### Files

```
apps/web/src/components/Header/Header.tsx (or equivalent nav component)   remove Leaderboards from signed-out nav items
apps/web/src/components/Footer/Footer.tsx                                  add Leaderboards link
apps/web/src/content/HomepageContent/HomepageContent.tsx                   ensure leaderboard section links to /leaderboard
apps/web/src/components/AccountMenu/AccountMenu.tsx (or equivalent)        add Leaderboards to parent account menu
```

### Rules

- Signed-out header: no Leaderboards entry.
- Footer: add a Leaderboards link alongside other public links (About, Lessons, Privacy, Terms).
- Homepage leaderboard section: must include a visible CTA/link to `/leaderboard`. If a section already exists, confirm the link is present; if not, add a minimal link.
- Parent account menu: add a Leaderboards item. Coach account menu: unchanged (coach has a dedicated coach nav).
- No design-system violations: follow existing link and menu patterns; use design token classes only.

### Out of scope

- A viewer-specific account menu entry (viewers follow the parent path for now).
- Per-swimmer leaderboard deep links from the account menu.
- Coach-only leaderboard view including non-public swimmers (deferred, see Decisions above).

---

## Open questions

One item requires Jason's input before MT-1 can be fully implemented:

| Item | Status |
|---|---|
| **Events.** Which distance/stroke combinations do Jason's swimmers actually race — including any events specific to the Irvine Swim League — and are relays needed at launch? The answer determines the `VALID_EVENTS` constant in shared code and the event dropdown in the web form. | Needs Jason's input. |
