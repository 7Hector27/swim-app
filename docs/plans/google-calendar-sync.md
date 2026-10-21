# Plan: Google Calendar sync for coach lessons

**Status:** Planning
**Branch:** `feature/google-calendar-sync`
**ADR:** [027 — Google Calendar sync for coach lessons](../decisions/027-google-calendar-sync.md)

---

## Overview

One-way sync from this app to the coach's Google Calendar. On connect, the API creates a dedicated "Axiom Aquatics Lessons" calendar under scope `calendar.app.created` and writes only to it. The authorize URL also requests `openid` and `email` so Google returns an id_token whose `email` claim we display on the status card — both are non-sensitive OpenID Connect scopes and neither widens calendar access. Approved lessons create events; reschedules patch them; cancels and declines delete them. Pending lessons do not sync. Sync is a side effect: booking writes never block on, roll back from, or wait for Google.

The lessons table already has four columns anticipating this feature — `google_calendar_event_id`, `calendar_sync_status`, `calendar_sync_error`, `calendar_sync_attempts` — plus a CHECK constraint on the status enum. The plan reuses them.

---

## Data model changes

### New table — `coach_calendar_integrations`

One row per coach. The row is created on first connect, updated on reconnect, and transitioned to `status='disconnected'` on explicit coach Disconnect — it is **never** deleted by the API. The row persists through both `needs_reconnect` (token revoked out-of-band) and `disconnected` (coach-initiated) so the dedicated calendar id and account email survive and the next connect reuses the same Google calendar.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | `defaultRandom()` |
| `coach_profile_id` | uuid, FK → `profiles.id`, unique, on delete cascade | Unique → at most one integration per coach |
| `provider` | text, NOT NULL, default `'google'` | Forward-looking; app only writes `'google'` |
| `status` | text, NOT NULL, default `'active'` | CHECK: `'active' \| 'needs_reconnect' \| 'disconnected'`. Non-existence of the row = never connected; a `'disconnected'` row maps to "not_connected" on the status endpoint but internally retains `google_calendar_id` for reuse. |
| `google_calendar_id` | text, NOT NULL | Returned by `calendars.insert` on first connect; reused on reconnect if the calendar still exists in Google |
| `google_account_email` | text, nullable | For the status card. Null when Google omitted the id_token or its email claim. The card still shows "Connected" without an address in that case — a missing email never fails the OAuth flow. |
| `refresh_token_ciphertext` | bytea, nullable | AES-256-GCM output. Non-null when `status` is `'active'` or `'needs_reconnect'`; nulled on disconnect (see below). |
| `refresh_token_iv` | bytea, nullable | 12-byte GCM nonce; same nullability as the ciphertext. |
| `refresh_token_tag` | bytea, nullable | 16-byte GCM auth tag; same nullability as the ciphertext. |
| `refresh_token_key_version` | integer, nullable | Enables rotation without migration; nulled on disconnect. |
| `scope` | text, nullable | Scope the coach granted; nulled on disconnect since no refresh token is held. |
| `connected_at` | timestamptz, NOT NULL, default `now()` | Set on first successful connect; preserved through reconnect |
| `last_sync_attempted_at` | timestamptz, nullable | Updated on every sync call |
| `last_sync_succeeded_at` | timestamptz, nullable | Updated only on 2xx |
| `needs_reconnect_since` | timestamptz, nullable | Set when a refresh returns `invalid_grant`; cleared on successful reconnect |
| `created_at`, `updated_at` | timestamptz | Standard; `$onUpdateFn` |

Indexes: unique on `coach_profile_id`.

RLS: `.enableRLS()` with no policies (API-only, same as every other table).

### New table — `coach_audit_log`

A general coach-level audit log, not integration-specific — same shape and conventions as `household_audit_log` minus `household_id` plus `coach_id`. Connect, disconnect, reconnect, and retry all write a row here inside the same `db.transaction()` as the state change they record, per CLAUDE.md's audit rule. Future coach-level events (e.g. a coach impersonating a parent, bulk roster edits) land in this table too.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK, `defaultRandom()` | |
| `coach_id` | uuid, NOT NULL, FK → `profiles.id` (restrict on delete) | The coach the event is about. |
| `actor_id` | uuid, NOT NULL, FK → `profiles.id` (restrict on delete) | Profile that performed the action. For integration events the coach acts on themselves, so `coach_id = actor_id`. Kept distinct for future coach-on-coach or admin actions. |
| `action` | text, NOT NULL | For this plan: `'calendar_connected'`, `'calendar_disconnected'`, `'calendar_reconnected'`, `'calendar_sync_retried'`. |
| `target_profile_id` | uuid, nullable, FK → `profiles.id` (restrict) | Kept for parity with `household_audit_log`; unused by integration events. |
| `target_swimmer_id` | uuid, nullable, FK → `swimmers.id` (restrict) | Same. Unused here. |
| `new_role` | `household_role`, nullable | Same. Unused here. |
| `created_at` | timestamptz, NOT NULL, default `now()` | |

Index on `(coach_id, created_at desc)` to make the "when did this coach do X?" query cheap.

RLS: `.enableRLS()` with no policies (API-only).

**No `payload` column.** `household_audit_log` has none; we match its conventions. The lesson a retry targeted is recoverable from the lesson row's `calendar_sync_attempts`, `last_sync_attempted_at`, and `calendar_sync_error`. If a future event ever needs a payload, add the column with a migration.

### Integration lifecycle beyond the audit log

The audit log is the chronological record. The *current* state is still observable from live rows, which the API and UI read directly:

| State | Live source |
|---|---|
| Connected | `coach_calendar_integrations` row with `status='active'` |
| Needs reconnect | `coach_calendar_integrations.status='needs_reconnect'`, `needs_reconnect_since` set |
| Not connected | No `coach_calendar_integrations` row |
| Last retry outcome per lesson | `lessons.calendar_sync_attempts`, `calendar_sync_error`, `last_sync_attempted_at` |
| Backfill in progress | Count of `lessons` with `status='approved'`, `starts_at > now()`, `calendar_sync_status IN ('not_synced', 'sync_failed')` |

### Existing columns reused

On `lessons` (schema.ts:491–494):

- `google_calendar_event_id text` — set after `events.insert`, cleared on delete and on coach disconnect.
- `calendar_sync_status text default 'not_synced'` — CHECK allows `'not_synced' | 'synced' | 'sync_failed'`. No change needed.
- `calendar_sync_error text` — human-readable error message (code + reason, no stack).
- `calendar_sync_attempts integer default 0` — increments on every attempt, success or failure.

### Migration

One Drizzle migration (`pnpm db:generate --name=google_calendar_integration`): creates `coach_calendar_integrations` (with its CHECK on `status`) and `coach_audit_log`. Snapshot is auto-generated. No custom SQL needed. `docs/data-model.md` gets two new sections — `### coach_calendar_integrations` and `### coach_audit_log` placed after `### household_audit_log` — plus an addendum to `### lessons` noting that the four existing `calendar_*` columns are populated by this feature and listing the allowed `calendar_sync_status` values.

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
  // 'not_configured' = env vars missing; 'not_connected' = no row (or disconnected);
  // 'active' = healthy; 'needs_reconnect' = token revoked out-of-band.
  status: z.enum(["not_configured", "not_connected", "active", "needs_reconnect"]),
  connectedAccountEmail: z.string().email().nullable(),
  connectedAt: z.string().datetime().nullable(),
  googleCalendarId: z.string().nullable(),
  lastSyncAttemptedAt: z.string().datetime().nullable(),
  lastSyncSucceededAt: z.string().datetime().nullable(),
  needsReconnectSince: z.string().datetime().nullable(),
  // Counts over the coach's upcoming approved lessons so the card can show "Syncing 3 of 12…".
  upcomingLessonCount: z.number().int().nonnegative(),
  syncedCount: z.number().int().nonnegative(),
  pendingSyncCount: z.number().int().nonnegative(),  // not_synced
  failedLessonCount: z.number().int().nonnegative(), // sync_failed
});

// Query filter added to the existing GET /coach/lessons endpoint so the card can
// list failed-sync lessons without a new endpoint (resolves former open question 4).
export const CoachLessonsCalendarSyncQuerySchema = z.object({
  calendarSyncStatus: z.enum(["not_synced", "synced", "sync_failed"]).optional(),
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
| `GET` | `/integrations/google/start` | `requireUser`, `requireCoach`, `validate({ query: GoogleOAuthStartQuerySchema })` | Build Google authorize URL (scope `calendar.app.created`, `access_type=offline`, `prompt=consent`, HMAC-signed `state`), 302 to Google. Used for both initial connect and reconnect — the handler is identical. |
| `GET` | `/integrations/google/callback` | `validate({ query: GoogleOAuthCallbackQuerySchema })` | Verify state (signature + TTL + coach binding), exchange code. If the coach has an existing integration row (reconnect path), call `calendars.get(googleCalendarId)` — reuse on 2xx, call `calendars.insert` only on 404/410. Upsert the row (set `status='active'`, clear `needs_reconnect_since`, update tokens). Kick off backfill/resync as a non-blocking background task and redirect immediately to `${SITE_URL}${returnTo ?? '/account'}?google=connected`. |
| `GET` | `/coach/calendar/status` | `requireUser`, `requireCoach`, `validate({})` | Returns `GoogleCalendarStatusResponse` (status enum + counts derived from `lessons`). |
| `GET` | `/coach/lessons` (existing route, extended) | `requireUser`, `requireCoach`, `validate({ query: CoachLessonsCalendarSyncQuerySchema })` | Add `calendarSyncStatus` filter so the card can list `sync_failed` lessons without a new endpoint. |
| `DELETE` | `/coach/calendar` | `requireUser`, `requireCoach`, `validate({})` | Revoke token at Google (before the transaction; failure logged but doesn't block). Then in one `db.transaction()`: delete the integration row, clear `google_calendar_event_id`, reset `calendar_sync_status` to `'not_synced'` and zero `calendar_sync_attempts` for this coach's future lessons. The dedicated Google calendar is left intact. |
| `POST` | `/coach/calendar/lessons/:id/retry` | `requireUser`, `requireCoach`, `validate({ params: RetryLessonSyncParamsSchema })` | Re-run the correct sync op for this lesson's current status. Returns updated lesson status. |
| `POST` | `/coach/calendar/retry-failed` | `requireUser`, `requireCoach`, `validate({})` | Finds all `sync_failed` lessons and retries each sequentially with a 100ms gap. Returns `RetryAllFailedResponse`. |

**Callback mount.** `app.use("/integrations", integrationsRouter)` mounts in `apps/api/src/app.ts` alongside the other `app.use(...)` lines (schema.ts has no global prefix — confirmed in app.ts). The exact path `/integrations/google/callback` matches the Google Cloud entries.

---

## Reconcile design

The service module `apps/api/src/services/googleCalendarSync.ts` exports exactly one function:

```ts
syncLessonToGoogle(lessonId: string): Promise<void>
```

It reads the lesson's current state and makes Google match it — no verb-per-caller split. Approve, reschedule, cancel, decline, retry, and backfill all call the same function. This eliminates "created vs updated vs deleted" branching at the call site and prevents the race where two overlapping events on the same lesson (e.g. coach cancels mid-retry) produce inconsistent calendar state.

**Desired state is computed from the lesson row:**
- `status = 'approved'` AND `starts_at > now()` → event should exist with current title/time/location.
- Everything else (`pending`, `declined`, `canceled`, `expired`, `no_show`, `completed`, or lesson row missing) → event should NOT exist.

**Deterministic event id.** The Google event id is the lesson UUID with dashes stripped (32 hex chars, inside Google's accepted id charset). This makes every operation idempotent:

- Insert attempt sees a 409 "exists" → the service does a `patch` with the current state instead.
- Delete of an id that was never created → 404/410, treated as success.
- Backfill or retry can run twice in a row with no risk of duplicate events.

**Flow inside `syncLessonToGoogle(lessonId)`:**

1. Load lesson + swimmers (ordered by first_name) + location + the single coach's integration row.
2. If no integration row, or `status IN ('needs_reconnect', 'disconnected')` → no-op, no DB write (short-circuit stops the invalid_grant storm when a token is revoked out-of-band).
3. Compute desired state (see above). Determine the event id = `lesson.id.replace(/-/g, '')`.
4. Refresh the access token.
   - If the refresh throws `invalid_grant`, in **one** `db.transaction()`: set the integration row's `status='needs_reconnect'` + `needs_reconnect_since=now()`, and set the lesson row's `calendar_sync_status='sync_failed'` + `calendar_sync_error='token_revoked'` + increment `calendar_sync_attempts`. Return.
5. If desired state is "event should exist":
   - Try `events.insert(calendarId, { id, …body })`.
   - On 409: `events.patch(calendarId, id, { …body })`. Treat as success.
   - On 2xx: proceed.
   - On other failure: write `sync_failed` + error, return.
6. If desired state is "event should not exist":
   - If `google_calendar_event_id` is null AND there was no prior sync → no-op (the row was never pushed).
   - Else `events.delete(calendarId, id)`. 404/410 treated as success.
7. On overall success, in one UPDATE on the lesson row: `calendar_sync_status='synced'`, `calendar_sync_error=null`, `calendar_sync_attempts++`, `last_sync_*` set, and `google_calendar_event_id` set to `id` (or null if we deleted).

Errors inside the service are caught and translated to row updates — they never bubble back to the HTTP handler that scheduled the call.

## Where the reconcile hooks into existing paths

Each lesson-mutating route handler, after `res.json()` returns, schedules `queueMicrotask(() => syncLessonToGoogle(lessonId))`. The booking write is already committed, so the microtask runs on a clean state. If the service throws (it shouldn't; it catches internally), the microtask's rejection is swallowed by Node and does not affect the response.

| Route | File | What triggers the reconcile |
|---|---|---|
| Approve | `coachLessons.ts` `PATCH /coach/lessons/:id/approve` | After `res.json(body)` |
| Decline | `coachLessons.ts` `PATCH /coach/lessons/:id/decline` | After `res.json(responseBody)` — safe no-op in practice because the lesson is still pending |
| Reschedule | `lessons.ts` `PATCH /lessons/:id` (parent and coach) | After `res.json(body)` |
| Cancel | `lessons.ts` `DELETE /lessons/:id` (parent and coach) | After `res.json(body)` |
| Backfill / reconnect | `integrationsGoogle.ts` callback | After `res.redirect(...)` — iterates lessons and calls reconcile with a 100ms gap |
| Manual retry | `coachCalendar.ts` `POST /coach/calendar/retry-failed` | Called synchronously per lesson, same 100ms gap |

Approve already has a stub `syncCalendarApproved(updated.id)` call in the current source — the phase-2 commit replaces it with the microtask call to the reconcile function.

### Backfill and reconnect resync

The connect/reconnect callback kicks off one background task after `res.redirect(...)` returns:

1. Select `lessons` where this coach's integration is active, `status = 'approved'`, `starts_at > now()`, and `calendar_sync_status IN ('not_synced', 'sync_failed')`.
2. Call `syncLessonToGoogle(id)` on each row.
3. Sequential, 100ms gap between calls (Google quota ≈ 500 req/100s per project).

The status endpoint's counts (`upcomingLessonCount`, `syncedCount`, `pendingSyncCount`, `failedLessonCount`) let the card show "Syncing N of M…" by polling every 3s until `pendingSyncCount` reaches zero. No persistent "in-progress" flag — the lesson table's counts are the source of truth. If the process crashes mid-backfill, the next retry (manual or on next connect) resumes from whatever rows are still `not_synced`.

### What's deliberately not wired

- No scheduled resync, cron, or background worker. Sync is triggered by lesson events, by the connect callback (backfill + reconnect resync), or by coach-initiated retry.
- No queue or message bus. Fire-and-forget via `queueMicrotask` for per-event sync, a simple `async` function for the connect-time loop. This matches the existing codebase (no queues present).

---

## Retries

Three layers:

1. **In-call retry (automatic).** Each API call to Google retries up to 2 times on 429 (rate limited) and 5xx, with exponential backoff of 500ms, 2000ms. 4xx other than 429 don't retry. Timeouts (6s) count as a retriable failure.
2. **Status-visible retry (manual).** `POST /coach/calendar/lessons/:id/retry` re-runs the right sync op. The coach UI exposes this per failed row.
3. **Bulk retry (manual).** `POST /coach/calendar/retry-failed` iterates all `sync_failed` lessons. Sequential, not parallel, with a 100ms gap between calls to stay under Google quotas (~500 req/100s per project).

`calendar_sync_attempts` increments on every attempt, including internal retries, so the coach UI can show "attempted N times." No cap in v1 — the coach decides when to stop retrying.

**Token refresh.** The service calls `oauth2Client.refreshAccessToken()` at the start of every sync. Access tokens are not persisted. If the refresh fails with `invalid_grant` (coach revoked access out-of-band in their Google account), the service does **not** delete the integration row. In one transaction it:

- Sets `coach_calendar_integrations.status = 'needs_reconnect'` and `needs_reconnect_since = now()` on the integration row.
- Writes `calendar_sync_error = 'token_revoked'` and `calendar_sync_status = 'sync_failed'` on the lesson being synced.

While `status = 'needs_reconnect'`, every sync hook short-circuits before the Google call — no further `invalid_grant`s pile up, no error spam. The retry endpoints also no-op (they return a 409 `{ error: "Reconnection required" }`). The card shows a Reconnect button. Clicking it reuses `/integrations/google/start`; the callback detects the existing row, verifies the calendar still exists (`calendars.get`), and either reuses the existing `google_calendar_id` or calls `calendars.insert` to create a new one if the coach deleted it in Google. On successful reconnect, the row's `status` returns to `'active'`, `needs_reconnect_since` is cleared, and the backfill/resync task sweeps every `sync_failed` and `not_synced` upcoming approved lesson.

---

## Coach UI

New card at `/account`. Content folder: `apps/web/src/content/AccountContent/GoogleCalendarCard/` (`GoogleCalendarCard.tsx`, module CSS, `index.ts`). `AccountContent.tsx` renders it below `EditProfileForm`.

The card renders one of three states, keyed on `status` from the status endpoint.

**`not_connected`** — Fraunces heading "Google Calendar", Figtree body "Automatically add approved lessons to your Google Calendar", primary button "Connect Google Calendar" that `GET`s `/integrations/google/start?returnTo=/account`.

**`active`** — same heading, then:

- Connected account email, `Connected on {date}`, `Last sync: {relative time}` or `Never`.
- **Syncing banner (transient).** When `pendingSyncCount > 0`, show "Syncing {syncedSinceConnect} of {upcomingLessonCount}…". The card polls `/coach/calendar/status` every 3s while the banner is visible and stops once `pendingSyncCount` reaches zero.
- **Failed chip.** If `failedLessonCount > 0`, red chip "N lessons failed to sync" with "Retry all" button. Expanding the chip fetches `GET /coach/lessons?calendarSyncStatus=sync_failed` (reuses the existing endpoint — resolved from former open question 4) and renders a short list with per-row retry.
- Secondary "Disconnect" button opens a confirmation modal. Modal copy: "The 'Axiom Aquatics Lessons' calendar and its events will stay in your Google account. You can delete them yourself if you want."

**`needs_reconnect`** — same heading, amber alert row: "Google Calendar needs to be reconnected. New lessons won't show up on your calendar until you reconnect." Primary button "Reconnect" calls the same `/integrations/google/start` URL (the callback handles both paths). Also shows failed/pending counts so the coach knows what will resync.

Styling follows `axiom-aquatics-design` (tokens only, Fraunces/Figtree). Button press feedback and the syncing banner's enter/exit follow `emil-design-eng`.

`actions.ts` in `AccountContent/` gets `connectGoogleCalendar()`, `disconnectGoogleCalendar()`, `retryLessonSync(id)`, `retryAllFailed()` server actions that call the API and `revalidatePath('/account')`. Status polling is a client component (`"use client"`) that hits a thin API route on the Next app — not a server action — because polling via server actions is expensive and not what they're for.

---

## Audit log

Writes to `coach_audit_log` happen in the same `db.transaction()` as the state change they record, matching the rule in CLAUDE.md.

| Event | Inside the transaction | Audit row |
|---|---|---|
| Connect | INSERT into `coach_calendar_integrations` (first time) | `action='calendar_connected'`, `actor_id = coach_id` |
| Reconnect | UPDATE on `coach_calendar_integrations` (status back to `'active'`, tokens refreshed, `needs_reconnect_since` cleared) | `action='calendar_reconnected'`, `actor_id = coach_id` |
| Needs reconnect (token revoked) | UPDATE `coach_calendar_integrations SET status='needs_reconnect', needs_reconnect_since=now()` + the lesson row that triggered it | No audit row — this is a system-detected failure, not a coach action. The lifecycle is captured by `needs_reconnect_since` on the row. |
| Disconnect | DELETE from `coach_calendar_integrations` + bulk UPDATE on `lessons` clearing sync columns | `action='calendar_disconnected'`, `actor_id = coach_id`. Written **before** the DELETE so the FK on `coach_id` still points at a live profile row (and `coach_id` is intentionally NOT a FK to the integration row). |
| Retry (per lesson, single or bulk) | UPDATE on `lessons` sync columns | One `action='calendar_sync_retried'` row per retry invocation. |

Google-side API calls (token exchange, `calendars.insert`, `events.*`, revoke) happen *outside* the transaction — before for calls whose output we commit (connect/reconnect), after for calls that only mirror a committed decision (disconnect's revoke). This keeps every DB transaction short and never blocks a lock on an HTTP round-trip.

---

## Test plan

### Unit tests

Vitest with native `vi.mock()` for the `googleapis` client. New file layout under `apps/api/src/__tests__/`:

- `googleCalendarSync.test.ts` — `syncLessonToGoogle`:
  - Happy path (approved + upcoming, first sync): `events.insert` called with id = lesson UUID without dashes, event body matches "Swim lesson: Alex" / "Swim lesson: Alex & Mia", location field set, time zone `America/Los_Angeles`, description is the deep link `${SITE_URL}/coach/lessons/[id]` (no duration, location name, or parent contact).
  - 409 on insert → `events.patch` called with same id; final `calendar_sync_status='synced'`, no duplicate event.
  - Reschedule (lesson row changes starts_at, already has event id): insert returns 409 → patch; new time in the patch body.
  - Cancel (status = canceled, has event id): `events.delete` called; `google_calendar_event_id` cleared.
  - Approve → cancel in rapid succession (both scheduled): both reconcile calls succeed; final Google state = no event.
  - Pending lesson: no Google call. Past approved lesson: no Google call.
  - No integration row → no-op, no error, no DB write.
  - `status='needs_reconnect'` or `status='disconnected'` → no-op, no Google call.
  - `events.delete` returns 404/410 → treated as success.
  - `invalid_grant` on refresh → integration row flipped to `needs_reconnect`, lesson `sync_failed` with `calendar_sync_error='token_revoked'`, both writes in one transaction.
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
  - `GET /coach/calendar/status` returns `not_connected`, `active`, and `needs_reconnect` depending on row state; counts derived from seeded lessons.
  - `DELETE /coach/calendar` deletes the row + clears lesson sync columns + calls Google revoke.
  - Retry endpoints return 409 when `status='needs_reconnect'`.
  - Retry endpoints call the right sync function in the happy path.
- `coachLessons.approve.test.ts` (extend existing) — assert `syncLessonCreated` was called *after* `res.json`; booking still succeeds when the service throws.

### Integration tests

Vitest integration config, live local Supabase, Google API mocked at the `googleapis` module boundary (no network). Shared `mockGoogleCalendar()` helper under `apps/api/src/__tests__/integration/helpers/`.

- `coachGoogleCalendar.integration.test.ts` (phase 1 cases already covered: connect, callback with bad state, disconnect, needs_reconnect, audit rows). Phase 2 adds a lesson-sync test file:
- `coachGoogleCalendarSync.integration.test.ts` — all cases call the real reconcile service against a vi.mocked Google client:
  - Approve → `events.insert` called with id = lesson UUID without dashes; lesson row has `google_calendar_event_id` and `synced` status.
  - Reschedule → `events.insert` called again with same id → 409 → `events.patch` with new time. Lesson row still `synced`.
  - Cancel → `events.delete` called with the deterministic id; `google_calendar_event_id` cleared.
  - Decline (pending → declined) → no Google call.
  - Approve then cancel → final Google state has no event, lesson row `synced` with `google_calendar_event_id=null`.
  - Retry after transient 500: first attempt fails, retry endpoint re-runs reconcile and succeeds. Only one event id exists in Google (no duplicate).
  - `invalid_grant` → integration flipped to `needs_reconnect`, retry endpoint returns 409 with `error: "Reconnection required"`.
  - Backfill on connect: seed 3 approved+upcoming, 1 pending, 1 past approved → backfill reconciles 3 events, skips the pending and past rows.
  - Disconnect → Google revoke called, row deleted, future-lesson sync columns cleared, Google `calendars.delete` **not** called; `coach_audit_log` row with `action='calendar_disconnected'` written in the same transaction as the DELETE.
  - Retry failed lesson → status flips from `sync_failed` to `synced`.
  - `invalid_grant` on next sync → integration row flipped to `needs_reconnect`, status endpoint reflects it, subsequent retries return 409.
  - Reconnect with calendar still existing in Google → `calendars.get` returns 2xx, no `calendars.insert` called, same `google_calendar_id` preserved, `status` back to `'active'`, resync re-attempts all `sync_failed`/`not_synced` upcoming approved lessons; `coach_audit_log` row with `action='calendar_reconnected'` written in the same transaction.
  - Reconnect with calendar deleted in Google (`calendars.get` → 404) → `calendars.insert` called, `google_calendar_id` updated, resync proceeds.
  - Approve while disconnected → booking succeeds, no Google call made.
  - Approve with Google 500 → booking succeeds, lesson `sync_failed`, error visible on status endpoint.

### Load / quota (manual, pre-launch)

Spot-check: connect, backfill 50 approved lessons, confirm no 429s and total time < 15s on dev. If this fails, add a per-call delay to the backfill loop.

---

## Resolved decisions (previously open)

- **Dev API port.** Google Cloud updated to `http://localhost:3001/integrations/google/callback`, matching `apps/api/src/lib/env.ts`'s `PORT` default. No dev-env override needed.
- **`invalid_grant` handling.** No auto-disconnect. Flip `coach_calendar_integrations.status` to `'needs_reconnect'`, keep `google_calendar_id` and all settings, stop attempting sync, surface a Reconnect action on the card. Reason: preserves the dedicated calendar id and user intent across a token revoke.
- **Decline-after-approve.** Current state machine stays as-is (`approved → declined` is not legal). `syncLessonDeleted` is called defensively from decline and short-circuits when `google_calendar_event_id` is null. Reason: smallest change; no state-machine churn and still safe if the transition is ever added.
- **Listing failed lessons.** Add `calendarSyncStatus` query param to the existing `GET /coach/lessons` instead of a new endpoint. Reason: follows the existing pattern (query filter on an existing list route) and avoids a parallel endpoint.
- **Backfill blocking vs background.** Always background. Redirect fires immediately; the card shows "Syncing N of M…" by polling the status endpoint. Reason: user decision; also avoids a slow redirect for coaches with lots of upcoming lessons.
- **Event description content.** Title "Swim lesson: {first names}" + Google's native `start`, `end`, and `location` fields. Description is just the deep link to `/coach/lessons/[id]`. Reason: no parent contact info by rule; everything else is already in the event's structured fields.
- **Timezone.** Hardcoded `America/Los_Angeles` with a `// TODO: per-coach timezone if we ever expand beyond LA` comment at the one site in `googleCalendarSync.ts` that uses it. Reason: smallest change; no schema column added for a case that doesn't exist today.
- **Audit log table.** Added `coach_audit_log` — general coach-level audit log following `household_audit_log` conventions (minus `household_id`, plus `coach_id`). Connect, disconnect, reconnect, and retry each write a row inside the same transaction as the state change. Reason: user decision; preserves an immutable chronological trail without stretching `household_audit_log`'s shape to cover a coach-level domain.
- **Reconnect calendar reuse.** On reconnect, call `calendars.get(googleCalendarId)`. Reuse on 2xx; call `calendars.insert` only on 404/410. Reason: honors the user rule that we reuse the existing calendar when it still exists.

## Still open

- **Syncing banner poll cadence.** Decided: poll `/coach/calendar/status` every 3s, only while the card shows the syncing state, and stop as soon as `pendingSyncCount` reaches zero. The card doesn't poll in the `active`-steady or `not_connected` or `needs_reconnect` states.
- **Reconnect copy.** Decided: "Google Calendar needs to be reconnected. New lessons won't show up on your calendar until you reconnect."

Nothing remaining that needs Jason or me to decide.

---

## Environment variables

Added to `apps/api/src/lib/env.ts` `RawEnvSchema` and `ApiEnv`:

| Var | Required | Example | Notes |
|---|---|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | Yes (prod & dev) | `123...apps.googleusercontent.com` | From Google Cloud OAuth client |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Yes (prod & dev) | `GOCSPX-...` | Secret for the same client |
| `GOOGLE_OAUTH_REDIRECT_URI` | Yes | `http://localhost:3001/integrations/google/callback` (dev) / `https://api-dev-9f6d.up.railway.app/integrations/google/callback` (deployed) | Must match a Google Cloud entry exactly. The dev URI matches `PORT`'s default of 3001; no override needed. |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | Yes | base64, decodes to 32 bytes | AES-256-GCM key. Generate with `openssl rand -base64 32` or `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. **Losing this key bricks every coach's integration — rotate by adding a `_V2` var, bumping `refresh_token_key_version`, and re-encrypting on next successful token refresh.** |
| `GOOGLE_OAUTH_STATE_SECRET` | Yes | 32+ random bytes, any encoding | HMAC key for signing the OAuth `state` param. Generate the same way as the encryption key. Distinct from the encryption key so leaking one does not compromise the other. |

Validation (prod only, matching the existing `CRON_SECRET` pattern): `GOOGLE_TOKEN_ENCRYPTION_KEY` must decode to exactly 32 bytes; `GOOGLE_OAUTH_STATE_SECRET` must be ≥ 32 chars; `GOOGLE_OAUTH_REDIRECT_URI` must be `https://` and must not point to localhost. Dev/test allow all three to be absent — the integration simply reports "not configured" on the status endpoint and the connect button hides.

No `.env` file is modified by this plan. The team updates `.env` and the Railway variable set during implementation, following the keys above.
