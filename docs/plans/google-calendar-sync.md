# Plan: Google Calendar sync for coach lessons

**Status:** Planning
**Branch:** `feature/google-calendar-sync`
**ADR:** [027 — Google Calendar sync for coach lessons](../decisions/027-google-calendar-sync.md)

---

## Overview

One-way sync from this app to the coach's Google Calendar. On connect, the API creates a dedicated "Axiom Aquatics Lessons" calendar under scope `calendar.app.created` and writes only to it. Approved lessons create events; reschedules patch them; cancels and declines delete them. Pending lessons do not sync. Sync is a side effect: booking writes never block on, roll back from, or wait for Google.

The lessons table already has four columns anticipating this feature — `google_calendar_event_id`, `calendar_sync_status`, `calendar_sync_error`, `calendar_sync_attempts` — plus a CHECK constraint on the status enum. The plan reuses them.

---

## Data model changes

### New table — `coach_calendar_integrations`

One row per coach while connected. Delete on disconnect.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | `defaultRandom()` |
| `coach_profile_id` | uuid, FK → `profiles.id`, unique, on delete cascade | Unique → at most one integration per coach |
| `provider` | text, NOT NULL, default `'google'` | Forward-looking; app only writes `'google'` |
| `google_calendar_id` | text, NOT NULL | Returned by `calendars.insert` on connect |
| `google_account_email` | text, NOT NULL | For the status card and audit log |
| `scope` | text, NOT NULL | Record what we requested; alarm if it ever drifts |
| `refresh_token_ciphertext` | bytea, NOT NULL | AES-256-GCM output |
| `refresh_token_iv` | bytea, NOT NULL | 12-byte GCM nonce |
| `refresh_token_tag` | bytea, NOT NULL | 16-byte GCM auth tag |
| `refresh_token_key_version` | integer, NOT NULL, default `1` | Enables rotation without migration |
| `connected_at` | timestamptz, NOT NULL, default `now()` | |
| `last_sync_attempted_at` | timestamptz, nullable | Updated on every sync call |
| `last_sync_succeeded_at` | timestamptz, nullable | Updated only on 2xx |
| `created_at`, `updated_at` | timestamptz | Standard; `$onUpdateFn` |

Indexes: unique on `coach_profile_id`.

RLS: `.enableRLS()` with no policies (API-only, same as every other table).

### New table — `coach_integration_audit_log`

Coach-level events don't fit `household_audit_log` (which requires `household_id`). Keep audit history separate rather than loosening the household schema.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `coach_profile_id` | uuid, FK → `profiles.id`, on delete cascade | |
| `provider` | text, NOT NULL | `'google'` for now |
| `action` | text, NOT NULL | `'connect'`, `'disconnect'`, `'retry'`, `'backfill_started'`, `'backfill_finished'` |
| `payload` | jsonb, nullable | e.g. `{"google_account_email": "...", "calendar_id": "...", "failed_count": 3}` — never contains tokens |
| `created_at` | timestamptz, NOT NULL, default `now()` | |

Index on `(coach_profile_id, created_at desc)`.

### Existing columns reused

On `lessons` (schema.ts:491–494):

- `google_calendar_event_id text` — set after `events.insert`, cleared on delete and on coach disconnect.
- `calendar_sync_status text default 'not_synced'` — CHECK allows `'not_synced' | 'synced' | 'sync_failed'`. No change needed.
- `calendar_sync_error text` — human-readable error message (code + reason, no stack).
- `calendar_sync_attempts integer default 0` — increments on every attempt, success or failure.

### Migration

One Drizzle migration (`pnpm db:generate --name=google_calendar_integration`): creates the two tables. Snapshot is auto-generated. No custom SQL needed. `docs/data-model.md` gets two new sections placed after `### household_audit_log`.

---

## Shared Zod schemas

New file: `packages/shared/src/schemas/googleCalendar.ts`. Re-exports added to `packages/shared/src/index.ts`.

```ts
export const GoogleOAuthStartQuerySchema = z.object({
  // Where to send the browser after the callback finishes. Must be a path on SITE_URL.
  returnTo: z.string().startsWith("/").max(200).optional(),
});

export const GoogleOAuthCallbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string(),
  error: z.string().optional(),            // Google sends this when the user denies consent
  error_description: z.string().optional(),
});

export const GoogleCalendarStatusResponseSchema = z.object({
  connected: z.boolean(),
  connectedAccountEmail: z.string().email().nullable(),
  connectedAt: z.string().datetime().nullable(),
  googleCalendarId: z.string().nullable(),
  lastSyncAttemptedAt: z.string().datetime().nullable(),
  lastSyncSucceededAt: z.string().datetime().nullable(),
  failedLessonCount: z.number().int().nonnegative(),
});

export const RetryLessonSyncParamsSchema = z.object({
  id: z.string().uuid(),
});

export const RetryAllFailedResponseSchema = z.object({
  attempted: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});
```

Types are inferred via `z.infer<>` per CLAUDE.md.

---

## API endpoints

All protected routes use `requireUser` + `requireCoach`. The two OAuth endpoints are a special case: they must be reachable from a browser redirect, so they ride on `requireUser` only (the state param binds them to the coach).

| Method | Path | Middleware | Purpose |
|---|---|---|---|
| `GET` | `/integrations/google/start` | `requireUser`, `requireCoach`, `validate({ query: GoogleOAuthStartQuerySchema })` | Build Google authorize URL (scope `calendar.app.created`, `access_type=offline`, `prompt=consent`, HMAC-signed `state`), 302 to Google. |
| `GET` | `/integrations/google/callback` | `validate({ query: GoogleOAuthCallbackQuerySchema })` | Verify state (signature + TTL + coach binding), exchange code, call `calendars.insert`, encrypt refresh token, upsert `coach_calendar_integrations`, insert `connect` audit log, kick off backfill, 302 to `${SITE_URL}${returnTo ?? '/account'}?google=connected`. |
| `GET` | `/coach/calendar/status` | `requireUser`, `requireCoach`, `validate({})` | Returns `GoogleCalendarStatusResponse`. `failedLessonCount` = `count(*) from lessons where calendar_sync_status='sync_failed'`. |
| `DELETE` | `/coach/calendar` | `requireUser`, `requireCoach`, `validate({})` | Revoke token at Google, delete the integration row, clear `google_calendar_event_id` and reset `calendar_sync_status` on this coach's future lessons, insert `disconnect` audit log — all in one transaction (except the Google revoke call, which runs before the transaction and is logged if it fails but doesn't block the local delete). |
| `POST` | `/coach/calendar/lessons/:id/retry` | `requireUser`, `requireCoach`, `validate({ params: RetryLessonSyncParamsSchema })` | Re-run the correct sync op for this lesson's current status. Returns updated lesson status. Logs `retry` audit entry. |
| `POST` | `/coach/calendar/retry-failed` | `requireUser`, `requireCoach`, `validate({})` | Finds all `sync_failed` lessons and retries each. Returns `RetryAllFailedResponse`. One `retry` audit log row for the batch. |

**Callback mount.** `app.use("/integrations", integrationsRouter)` mounts in `apps/api/src/app.ts` alongside the other `app.use(...)` lines (schema.ts has no global prefix — confirmed in app.ts). The exact path `/integrations/google/callback` matches the Google Cloud entries.

---

## Where sync hooks into existing paths

The service module lives at `apps/api/src/services/googleCalendarSync.ts` and exports:

```ts
syncLessonCreated(lessonId: string): Promise<void>   // approve
syncLessonUpdated(lessonId: string): Promise<void>   // reschedule
syncLessonDeleted(lessonId: string): Promise<void>   // cancel + decline
```

Each loads the lesson + swimmers + location, finds the coach's integration row (bails silently if the coach is not connected), refreshes the access token, calls the Google API, and updates `lessons.calendar_sync_status`, `calendar_sync_error`, `calendar_sync_attempts`, `google_calendar_event_id`.

The three functions are called **after** the lesson DB write commits and **after** `res.json()` returns — fire-and-forget via `queueMicrotask` or `setImmediate`. Errors are caught inside the service; they never surface to the response.

### Approve — `apps/api/src/routes/coachLessons.ts:526–584`

Already has a stub call `syncCalendarApproved(updated.id)` on line 550. Replace with `queueMicrotask(() => syncLessonCreated(updated.id))` after `res.json(body)`. Status transition: `not_synced` → `synced` (sets `google_calendar_event_id`) or `sync_failed`.

### Reschedule — `apps/api/src/routes/lessons.ts:786–1000+`

The `PATCH /lessons/:id` handler already wraps the slot-check and update in `db.transaction()` (line 898). After the transaction commits and the response is sent, call `syncLessonUpdated(id)` — but only if the updated lesson is in status `approved` (reschedules of pending lessons don't sync; reschedules that happen to change status handle themselves). If `google_calendar_event_id` is null (e.g., sync was failing), fall back to `syncLessonCreated`.

### Cancel — `apps/api/src/routes/lessons.ts:729–784`

`DELETE /lessons/:id` sets status to `canceled`. After the response, call `syncLessonDeleted(id)`. The service calls `events.delete` on the stored event id, then clears `google_calendar_event_id` and sets status to `synced` (meaning Google matches our state — the event is gone from both). If delete returns 404 or 410, treat as success.

### Decline — `apps/api/src/routes/coachLessons.ts:586–650`

Only reaches a currently-pending lesson. Since pending lessons don't sync, there is nothing in Google to delete *unless* the lesson was once approved and then force-declined (not possible with current state machine — see open question 3). For v1, call `syncLessonDeleted(id)` defensively: if `google_calendar_event_id` is null, no-op.

### What's deliberately not wired

- Backfill is a one-shot from the connect callback, not a middleware.
- There is no scheduled resync job in v1. Retries are user-driven.

---

## Retries

Three layers:

1. **In-call retry (automatic).** Each API call to Google retries up to 2 times on 429 (rate limited) and 5xx, with exponential backoff of 500ms, 2000ms. 4xx other than 429 don't retry. Timeouts (6s) count as a retriable failure.
2. **Status-visible retry (manual).** `POST /coach/calendar/lessons/:id/retry` re-runs the right sync op. The coach UI exposes this per failed row.
3. **Bulk retry (manual).** `POST /coach/calendar/retry-failed` iterates all `sync_failed` lessons. Sequential, not parallel, with a 100ms gap between calls to stay under Google quotas (~500 req/100s per project).

`calendar_sync_attempts` increments on every attempt, including internal retries, so the coach UI can show "attempted N times." No cap in v1 — the coach decides when to stop retrying.

**Token refresh.** The service calls `oauth2Client.refreshAccessToken()` at the start of every sync. Access tokens are not persisted. If the refresh fails with `invalid_grant`, the service writes `calendar_sync_error = "token_revoked"` on the lesson and *also* marks the integration row as needing reconnection (set `last_sync_attempted_at`, log a `retry` audit with payload `{reason: "token_revoked"}`). The UI then shows "Reconnect required" instead of a retry button. Open question 2 covers whether we auto-delete the integration row in that case.

---

## Coach UI

New card at `/account`. Content folder: `apps/web/src/content/AccountContent/GoogleCalendarCard/` (`GoogleCalendarCard.tsx`, module CSS, `index.ts`). `AccountContent.tsx` renders it below `EditProfileForm`.

**Disconnected state** — Fraunces heading "Google Calendar", Figtree body "Automatically add approved lessons to your Google Calendar", primary button "Connect Google Calendar" that `GET`s `/integrations/google/start?returnTo=/account`.

**Connected state** — same heading, then:

- Connected account email
- "Connected on {date}"
- Last sync: "{relative time}" or "Never"
- If `failedLessonCount > 0`: red chip "N lessons failed to sync" with "Retry all" button
- Collapsed list of failed lessons with per-row retry — fetched lazily when the chip is expanded; endpoint TBD (open question 4)
- Secondary "Disconnect" button that opens a confirmation modal (the Axiom Aquatics calendar in Google stays)

Styling follows `axiom-aquatics-design` (tokens only, Fraunces/Figtree). Button press feedback follows `emil-design-eng`.

`actions.ts` in `AccountContent/` gets `connectGoogleCalendar()`, `disconnectGoogleCalendar()`, `retryLessonSync(id)`, `retryAllFailed()` server actions that call the API and `revalidatePath('/account')`.

---

## Audit log

Entries written via `db.transaction()` as the row changes:

| Action | Row changing | Payload |
|---|---|---|
| `connect` | `coach_calendar_integrations` INSERT | `{google_account_email, calendar_id}` |
| `disconnect` | `coach_calendar_integrations` DELETE + lessons UPDATE | `{google_account_email, lessons_cleared: N}` |
| `retry` | `lessons` UPDATE (status transition) | `{lesson_id, outcome: 'succeeded'|'failed', error?}` |
| `backfill_started` | — | `{lesson_count}` (written in connect transaction, before kicking off the async loop) |
| `backfill_finished` | — | `{succeeded, failed}` (written after the async loop) |

Every write that mutates the integration row or clears lesson sync state is wrapped in `db.transaction(async (tx) => { ... })` with the audit insert inside the same tx, following the CLAUDE.md rule. The *Google-side* API calls happen *before or after* the tx, never inside — see the ADR.

---

## Test plan

### Unit tests

Vitest with native `vi.mock()` for the `googleapis` client. New file layout under `apps/api/src/__tests__/`:

- `googleCalendarSync.test.ts` — `syncLessonCreated/Updated/Deleted`:
  - happy path: event body shape matches "Swim lesson: Alex" / "Swim lesson: Alex & Mia", location set, time zone `America/Los_Angeles`, description links to `${SITE_URL}/coach/lessons/[id]`, no parent info in the payload.
  - no integration row → no-op, no error, no DB write.
  - Google 429 twice → retried, then success. Attempts counter = 3.
  - Google 500 permanent → `sync_failed`, error message captured, attempts incremented.
  - `invalid_grant` → `token_revoked` error, status `sync_failed`, retry audit written.
  - `events.delete` returns 404 → treated as success (idempotent delete).
- `googleCalendarAuth.test.ts` — state param:
  - sign + verify round trip with HMAC key.
  - expired state (>10 min) rejected.
  - tampered state rejected.
  - state bound to a different coach rejected.
- `tokenEncryption.test.ts` — new helper `apps/api/src/lib/tokenEncryption.ts`:
  - encrypt → decrypt returns input.
  - wrong key fails to decrypt.
  - key_version=1 output has IV length 12 and tag length 16.
- `coachCalendarRoutes.test.ts` — endpoint behavior with the service mocked:
  - `GET /coach/calendar/status` disconnected vs connected.
  - `DELETE /coach/calendar` writes audit + clears lessons + revokes.
  - retry endpoints call the right sync function.
- `coachLessons.approve.test.ts` (extend existing) — assert `syncLessonCreated` was called *after* `res.json`, booking still succeeds when the service throws.

### Integration tests

Vitest integration config, live local Supabase, Google API mocked at the `googleapis` module boundary (no network). Shared `mockGoogleCalendar()` helper under `apps/api/src/__tests__/integration/helpers/`.

- `coachGoogleCalendar.integration.test.ts`:
  - full connect flow: start → callback → row written → audit log row present.
  - connect with pending approved lessons → backfill creates events, `backfill_finished` audit written.
  - approve → event body sent, lesson row has `event_id` and `synced` status.
  - reschedule → `events.patch` called with new time, status still `synced`.
  - cancel → `events.delete` called, `event_id` cleared.
  - disconnect → Google revoke called, row deleted, audit written, future-lesson sync columns cleared, Google calendar untouched (no `calendars.delete`).
  - retry failed lesson → status flips from `sync_failed` to `synced`.
  - approve while disconnected → booking succeeds, no Google call made.
  - approve with Google 500 → booking succeeds, lesson `sync_failed`, error visible on status endpoint.

### Load / quota (manual, pre-launch)

Spot-check: connect, backfill 50 approved lessons, confirm no 429s and total time < 15s on dev. If this fails, add a per-call delay to the backfill loop.

---

## Open questions

1. **Dev API port.** Google Cloud has `http://localhost:4000/integrations/google/callback` registered, but `apps/api/src/lib/env.ts` defaults `PORT` to 3001. Either (a) change the dev default to 4000, (b) update the Google Cloud entry to 3001, or (c) require `PORT=4000` in the dev-env setup doc. Preferred: (c), smallest blast radius.
2. **Auto-disconnect on `invalid_grant`?** If the refresh token is revoked out-of-band (coach revokes from Google account page), every sync will fail with `invalid_grant`. Do we auto-delete the integration row and show "Reconnect required," or wait for the coach to click Disconnect? Preferred: auto-delete on first `invalid_grant`, write a `disconnect` audit with `payload.reason = 'token_revoked'`.
3. **Decline-after-approve path.** Current state machine (schema.ts `lessonStatusEnum`) allows pending → declined and approved → canceled, but not approved → declined. If that's ever added, decline needs to delete the Google event. Confirm the state machine stays as-is, or extend `syncLessonDeleted` to cover decline from any prior status (safe either way).
4. **How to list failed lessons for the UI.** The status endpoint returns just a count. Do we add `GET /coach/calendar/failed-lessons` returning a short list, or reuse `/coach/lessons` with a `?calendarSyncStatus=sync_failed` filter? Preferred: query param on the existing endpoint — fewer new routes.
5. **Backfill blocking vs background.** On connect, the callback currently kicks off backfill in `setImmediate` so the redirect is instant. If a coach has 100+ future lessons, the UI will show "connected, 0 synced" for several seconds. Confirm this UX is acceptable; alternative is to block the callback for small N (<10) and background for larger N.
6. **Event description content.** Spec says "swimmer first names" and "link to /coach/lessons/[id]" with "no parent contact info." Should the description also include duration and location name, or is the Google event's native time + location field enough? Preferred: title + native time + native location field only, so the description is just the deep link.
7. **Timezone.** Hardcoded `America/Los_Angeles` per spec. If we ever get a coach outside LA, this needs to come from a config column. Not blocking.
8. **Audit log rename.** `coach_integration_audit_log` is accurate but long. Alternative: `integration_audit_log` (drop `coach_`, since only coaches have integrations today). Preferred: keep `coach_integration_audit_log` — the extra specificity costs nothing and future-proofs if parents ever get integrations (e.g., personal calendar export).

---

## Environment variables

Added to `apps/api/src/lib/env.ts` `RawEnvSchema` and `ApiEnv`:

| Var | Required | Example | Notes |
|---|---|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | Yes (prod & dev) | `123...apps.googleusercontent.com` | From Google Cloud OAuth client |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Yes (prod & dev) | `GOCSPX-...` | Secret for the same client |
| `GOOGLE_OAUTH_REDIRECT_URI` | Yes | `http://localhost:4000/integrations/google/callback` (dev) / `https://api-dev-9f6d.up.railway.app/integrations/google/callback` (deployed) | Must match a Google Cloud entry exactly |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | Yes | base64, decodes to 32 bytes | AES-256-GCM key. Generate with `openssl rand -base64 32` or `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. **Losing this key bricks every coach's integration — rotate by adding a `_V2` var, bumping `refresh_token_key_version`, and re-encrypting on next successful token refresh.** |
| `GOOGLE_OAUTH_STATE_SECRET` | Yes | 32+ random bytes, any encoding | HMAC key for signing the OAuth `state` param. Generate the same way as the encryption key. Distinct from the encryption key so leaking one does not compromise the other. |

Validation (prod only, matching the existing `CRON_SECRET` pattern): `GOOGLE_TOKEN_ENCRYPTION_KEY` must decode to exactly 32 bytes; `GOOGLE_OAUTH_STATE_SECRET` must be ≥ 32 chars; `GOOGLE_OAUTH_REDIRECT_URI` must be `https://` and must not point to localhost. Dev/test allow all three to be absent — the integration simply reports "not configured" on the status endpoint and the connect button hides.

No `.env` file is modified by this plan. The team updates `.env` and the Railway variable set during implementation, following the keys above.
