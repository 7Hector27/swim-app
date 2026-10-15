# Architecture

## Monorepo layout

```
swim-app/
├── apps/
│   ├── web/   Next.js 15 App Router — all UI, no DB access
│   └── api/   Express REST API — all data access
├── packages/
│   └── shared/ Zod schemas + inferred TypeScript types
└── supabase/           Supabase local stack config
```

`packages/shared` is the contract layer. Both `web` and `api` import from it, so request/response shapes and their runtime validators are defined once and can never drift.

## How the pieces connect

```
Browser
  └─ HTTP (fetch)  ─►  apps/web  (Next.js, port 3000)
                          │  Server Components call API
                          ▼
                       apps/api  (Express, port 3001)
                          │  Drizzle ORM
                          ▼
                       Postgres 17  (Supabase local, port 54322)
```

`web` is UI-only. It never connects to Postgres directly. All data goes through `api`.

## Request lifecycle (API)

1. **helmet** — sets security headers
2. **cors** — checks `CORS_ORIGINS` allowlist
3. **requestId** — attaches/generates `x-request-id`
4. **pino-http** — logs the request using the request ID
5. **requireUser** *(protected routes only)* — calls `supabase.auth.getUser(token)` to network-verify the token against Supabase's auth server; revoked sessions and banned users are rejected with 401 before any DB work. Loads the profile row from `profiles` and attaches it to `req.profile`.
6. **validate()** — parses input against the route's Zod schema (422 on failure)
7. **Route handler** — business logic
8. **errorHandler** — catches any thrown errors, logs them, returns safe JSON

## Key constraints

- No direct DB access from `web`
- Every API route declares its input schema in `packages/shared`
- Logs are JSON in production, pretty-printed in dev; auth/cookie headers are always redacted

## Route map

All signed-in routes are guarded by `requireAuth()` (`apps/web/src/lib/requireAuth.ts`) in their layout. It redirects to `/login` on no session or a non-403 API error, and returns `null` on 403 (inactive account), which the layout converts to `<AccountInactiveScreen />`.

| Segment | Who can access | Purpose |
|---|---|---|
| `/` `/lessons` `/leaderboard` `/about` `/privacy` `/terms` | Public | Marketing and informational pages |
| `/login` `/signup` | Unauthenticated only | Auth entry points (redirect to `/dashboard` if already signed in) |
| `/dashboard` | Any authenticated, active user | Role-based hub: `CoachDashboardContent` for coaches, `ParentDashboardContent` for parents |
| `/account` | Any authenticated, active user | Settings: email/role display, edit name/phone, log out |
| `/coach/*` | Coach role only | Coach tooling; non-coaches redirect to `/dashboard` |
| `/coach/swimmers` | Coach role only | Roster: all active swimmers, client-side search + league filter |
| `/coach/swimmers/[id]` | Coach role only | Swimmer detail: info, clubs, leagues, guardian tap-to-call, hide-from-public action |

## API route map

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/coach/swimmers` | requireCoach | All active swimmers sorted by last name |
| `GET` | `/coach/swimmers/:id` | requireCoach | Swimmer detail with guardians (fullName + phone) |
| `PATCH` | `/coach/swimmers/:id/visibility` | requireCoach | Set `isPublic` to `false`; idempotent |
| `GET` | `/lessons/available-slots` | requireUser | Compute open slots for a given date, duration, and location |
| `POST` | `/lessons` | requireUser + requireParent + requireHouseholdMember + requireHouseholdRole("manager") | Submit a lesson booking request |
| `GET` | `/lessons` | requireUser + requireParent + requireHouseholdMember | List upcoming (pending + approved) lessons for the caller's household |
| `GET` | `/lessons/:id` | requireUser + requireParent + requireHouseholdMember | Lesson detail with swimmers for the caller's household |
| `DELETE` | `/lessons/:id` | requireUser + requireParentOrCoach | Cancel a lesson; parent must be manager or owner; coach may cancel any |
| `PATCH` | `/lessons/:id` | requireUser + requireParentOrCoach | Reschedule or adjust duration/location; advisory lock + slot re-check; parent must be manager or owner |
| `GET` | `/coach/lessons` | requireCoach | List lessons; query: `status?`, `date?`, `householdId?` |
| `PATCH` | `/coach/lessons/:id/approve` | requireCoach | Approve a pending lesson |
| `PATCH` | `/coach/lessons/:id/decline` | requireCoach | Decline a pending lesson; body: `{ reason? }` |
| `POST` | `/internal/cron/tick` | CRON_SECRET header | Expire overdue pending lessons; auto-complete finished approved lessons |
| `POST` | `/coach/swimmers/:id/sessions` | requireCoach | Create an evaluation session + all ratings in one transaction |
| `DELETE` | `/coach/ratings/:id` | requireCoach | Undo a rating within 10 minutes of creation; 409 after window |
| `PATCH` | `/coach/ratings/:id/void` | requireCoach | Void a rating with a required reason; 409 if already voided |
| `GET` | `/coach/swimmers/:id/skills` | requireCoach | Current grade map, start grades, head-position overall, and coaching priorities |
| `GET` | `/coach/swimmers/:id/skills/:skillId/ratings` | requireCoach | Full rating history for one skill (newest first, includes voided). Rating history is returned for archived skills (the coach is permitted to see all historical data). |
| `GET` | `/coach/swimmers/:id/sessions/dependency-map` | requireCoach | Deepest low-foundation suggestion for a category (`?categoryId=`) |
| `GET` | `/coach/swimmers/:id/progress` | requireCoach | Per-skill current levels, history (last 12), start grades, head-position overall, and coaching priorities with names resolved |
| `GET` | `/leaderboard/club` | public (rate-limited) | Club board: fastest meet PB per swimmer per event, club-registered swimmers only, public (`is_public = true`) |
| `GET` | `/leaderboard/isl` | public (rate-limited) | Irvine Swim League board: ISL-registered swimmers, age computed from `registered_on` date |
| `GET` | `/leaderboard/master` | public (rate-limited) | Master board: highest motivational standard reached per swimmer per event; returns `standardsAvailable: false` when standards table is empty |
| `GET` | `/coach/leaderboard/club` | requireCoach | Club board for all active swimmers (no `is_public` filter), full names |
| `GET` | `/coach/leaderboard/isl` | requireCoach | ISL board for all active swimmers, full names |
| `GET` | `/coach/leaderboard/master` | requireCoach | Master board for all active swimmers, full names |

**Leaderboard notes (inferred — confirm with Jason):** Board eligibility (club = active club registration; ISL = active summer_league registration; master = all active swimmers). Sex split and age-group partitioning applied on all three boards. Rate limit: 60 req/min per IP (in-memory, resets on restart).

## Progress endpoint data loading

`GET /coach/swimmers/:id/progress` uses two DB queries to separate computation from display:

**Query A** (`allRatingRows`) — fetches all ratings including voided ones. Voided rows are needed by `latestEffectiveRatings` (which handles voids internally) to compute the correct current grade map, start grades, head-position overall, and coaching priorities.

**Query B** (`displayRatingRows`) — fetches only non-voided ratings, joined to `evaluation_sessions` for context and session date. This is the source for `history` arrays and start-component current levels returned to the client. Voided ratings never appear in the response payload.

**Coaching priority ordering** — after `findDeepestLowFoundation` runs for each rated skill, the resulting priorities are sorted deterministically before the response is sent:
1. Chains whose deepest skill is `not_legal` come first (score −1).
2. Then `no_concept` (score 0).
3. Then grades 1–5 ascending (lower grade = more urgent).
4. Not-assessed deepest skills sort last (score 999).
5. Tie-broken by the target skill's catalog `sort_order`.
