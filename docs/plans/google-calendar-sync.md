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

One row per coach. The row is created on first connect, updated on reconnect, and deleted only on explicit coach-initiated Disconnect. It persists through the `needs_reconnect` state so the dedicated calendar id and settings survive a revoked token.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | `defaultRandom()` |
| `coach_profile_id` | uuid, FK → `profiles.id`, unique, on delete cascade | Unique → at most one integration per coach |
| `provider` | text, NOT NULL, default `'google'` | Forward-looking; app only writes `'google'` |
| `status` | text, NOT NULL, default `'active'` | CHECK: `'active' \| 'needs_reconnect'`. Non-existence of the row = not connected. |
| `google_calendar_id` | text, NOT NULL | Returned by `calendars.insert` on first connect; reused on reconnect if the calendar still exists in Google |
| `google_account_email` | text, NOT NULL | For the status card |
| `scope` | text, NOT NULL | Record what we requested; alarm if it ever drifts |
| `refresh_token_ciphertext` | bytea, NOT NULL | AES-256-GCM output |
| `refresh_token_iv` | bytea, NOT NULL | 12-byte GCM nonce |
| `refresh_token_tag` | bytea, NOT NULL | 16-byte GCM auth tag |
| `refresh_token_key_version` | integer, NOT NULL, default `1` | Enables rotation without migration |
| `connected_at` | timestamptz, NOT NULL, default `now()` | Set on first successful connect; preserved through reconnect |
| `last_sync_attempted_at` | timestamptz, nullable | Updated on every sync call |
| `last_sync_succeeded_at` | timestamptz, nullable | Updated only on 2xx |
| `needs_reconnect_since` | timestamptz, nullable | Set when a refresh returns `invalid_grant`; cleared on successful reconnect |
| `created_at`, `updated_at` | timestamptz | Standard; `$onUpdateFn` |

Indexes: unique on `coach_profile_id`.

RLS: `.enableRLS()` with no policies (API-only, same as every other table).

### Why no separate integration audit log

Earlier drafts proposed a `coach_integration_audit_log` table. Dropped. The existing `household_audit_log` can't carry these events — `household_id` is NOT NULL and connect / disconnect / reconnect are coach-level actions with no natural household (a single coach serves many households, and the integration is one-per-coach, not one-per-household). Making `household_id` nullable would misname the table and bleed coach-scoped events into a swimmer/household-centric model that routes already filter on `household_id`. Retry events update a lesson, which does have a household, but splitting one subset of integration events across two tables so the rest can live elsewhere is worse than not writing audit rows at all.

Instead, the integration lifecycle is observable from durable row state, with no new table:

| Event | How it's observable |
|---|---|
| Connect | `coach_calendar_integrations` row exists, `connected_at` set, `status = 'active'` |
| Disconnect | `coach_calendar_integrations` row absent (deleted in the same transaction that clears lesson sync columns) |
| Needs reconnect | `coach_calendar_integrations.status = 'needs_reconnect'`, `needs_reconnect_since` set |
| Reconnect | `status` returned to `'active'`, `needs_reconnect_since` cleared; `updated_at` is the moment |
| Retry | `lessons.calendar_sync_attempts` increments, `calendar_sync_error` and `last_sync_attempted_at` capture the last outcome |
| Backfill in progress | Count of `lessons` with `status='approved'`, `starts_at > now()`, `calendar_sync_status IN ('not_synced', 'sync_failed')` |

If an immutable chronological trail is ever required for compliance, revisit by adding a general `integration_audit_log` then — not now.

### Existing columns reused

On `lessons` (schema.ts:491–494):

- `google_calendar_event_id text` — set after `events.insert`, cleared on delete and on coach disconnect.
- `calendar_sync_status text default 'not_synced'` — CHECK allows `'not_synced' | 'synced' | 'sync_failed'`. No change needed.
- `calendar_sync_error text` — human-readable error message (code + reason, no stack).
- `calendar_sync_attempts integer default 0` — increments on every attempt, success or failure.

### Migration

One Drizzle migration (`pnpm db:generate --name=google_calendar_integration`): creates `coach_calendar_integrations` with its CHECK on `status`. Snapshot is auto-generated. No custom SQL needed. `docs/data-model.md` gets one new section — `### coach_calendar_integrations` placed after `### household_audit_log` — plus an addendum to `### lessons` noting that the four existing `calendar_*` columns are populated by this feature and listing the allowed `calendar_sync_status` values.

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
  // 'not_connected' = no row; 'active' = healthy; 'needs_reconnect' = token revoked.
  status: z.enum(["not_connected", "active", "needs_reconnect"]),
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

Only reaches a currently-pending lesson under the current state machine (`approved → declined` is not a legal transition). Since pending lessons don't sync, there is nothing in Google to delete. Still call `syncLessonDeleted(id)` defensively: it short-circuits when `google_calendar_event_id` is null, so no HTTP call is made in the normal case, and the handler stays safe if the state machine ever gains an `approved → declined` transition.

### Backfill and reconnect resync

The connect/reconnect callback kicks off a single background task after `res.redirect(...)` returns. The task:

1. Selects `lessons` where this coach's integration is active, `status = 'approved'`, `starts_at > now()`, and `calendar_sync_status IN ('not_synced', 'sync_failed')`.
2. Calls `syncLessonCreated(id)` for rows with no `google_calendar_event_id`, `syncLessonUpdated(id)` otherwise.
3. Processes rows sequentially with a 100ms gap between calls.

The status endpoint's counts (`pendingSyncCount`, `syncedCount`, `failedLessonCount`) let the card show "Syncing N of M…" by polling every 3s until `pendingSyncCount` reaches zero. No persistent "in-progress" flag is stored — the counts over the lessons table are the source of truth and already reflect the live state. If the process crashes mid-backfill, the next retry (manual or on next connect) resumes from whatever rows are still `not_synced`.

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

**`needs_reconnect`** — same heading, amber alert row: "Google disconnected us — your calendar won't update until you reconnect." Primary button "Reconnect" calls the same `/integrations/google/start` URL (the callback handles both paths). Also shows failed/pending counts so the coach knows what will resync.

Styling follows `axiom-aquatics-design` (tokens only, Fraunces/Figtree). Button press feedback and the syncing banner's enter/exit follow `emil-design-eng`.

`actions.ts` in `AccountContent/` gets `connectGoogleCalendar()`, `disconnectGoogleCalendar()`, `retryLessonSync(id)`, `retryAllFailed()` server actions that call the API and `revalidatePath('/account')`. Status polling is a client component (`"use client"`) that hits a thin API route on the Next app — not a server action — because polling via server actions is expensive and not what they're for.

---

## Audit log

No new audit table is added — see **Why no separate integration audit log** above. The existing `household_audit_log` cannot represent connect/disconnect/reconnect (its `household_id` is NOT NULL and these are coach-level events), and splitting integration events across two tables so only `retry` lives in `household_audit_log` would be worse than observing state from the live rows.

The CLAUDE.md rule that an audit insert must share a transaction with the change it records is still honored for every write touching sync state — there just isn't a separate audit row to insert. Each lifecycle event is still transactionally coherent:

| Event | What runs inside `db.transaction()` | Durable record |
|---|---|---|
| Connect / reconnect | Upsert `coach_calendar_integrations` (status, token fields, timestamps) | Row exists, `status='active'`, `connected_at` + `updated_at` |
| Needs reconnect | UPDATE `coach_calendar_integrations SET status='needs_reconnect', needs_reconnect_since=now()` and the lesson row that triggered it | Integration row's `status` + `needs_reconnect_since`; lesson's `calendar_sync_error='token_revoked'` |
| Disconnect | DELETE from `coach_calendar_integrations` + bulk UPDATE on `lessons` clearing sync columns | Row absent, lesson columns reset |
| Retry (single or bulk) | UPDATE on `lessons` sync columns | `calendar_sync_attempts`, `last_sync_*`, `calendar_sync_status`, `calendar_sync_error` all tell the full retry story |

The *Google-side* API calls happen before or after the transaction, never inside — see the ADR.

---

## Test plan

### Unit tests

Vitest with native `vi.mock()` for the `googleapis` client. New file layout under `apps/api/src/__tests__/`:

- `googleCalendarSync.test.ts` — `syncLessonCreated/Updated/Deleted`:
  - Happy path: event body shape matches "Swim lesson: Alex" / "Swim lesson: Alex & Mia", location field set, time zone `America/Los_Angeles`, description is just the deep link `${SITE_URL}/coach/lessons/[id]` (no duration, location name, or parent contact — resolved from former open question 6).
  - No integration row → no-op, no error, no DB write.
  - Integration row with `status='needs_reconnect'` → no-op, no Google call made.
  - Google 429 twice → retried, then success. Attempts counter = 3.
  - Google 500 permanent → `sync_failed`, error message captured, attempts incremented.
  - `invalid_grant` → integration row flipped to `needs_reconnect`, lesson `sync_failed` with `calendar_sync_error='token_revoked'`, both writes in one transaction.
  - `events.delete` returns 404/410 → treated as success (idempotent delete).
  - `syncLessonDeleted` with null `google_calendar_event_id` → short-circuits, no HTTP call (covers decline path).
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

- `coachGoogleCalendar.integration.test.ts`:
  - Full connect flow: start → callback → row written with `status='active'`.
  - Connect with pending approved lessons → backfill creates events, all lesson rows reach `calendar_sync_status='synced'`.
  - Backfill is background: callback redirects within 100ms even when 50 lessons are queued; status counts converge over time.
  - Approve → event body sent, lesson row has `event_id` and `synced` status.
  - Reschedule → `events.patch` called with new time, status still `synced`.
  - Cancel → `events.delete` called, `event_id` cleared.
  - Decline (pending → declined) → no Google call (defensive no-op in `syncLessonDeleted`).
  - Disconnect → Google revoke called, row deleted, future-lesson sync columns cleared, Google `calendars.delete` **not** called.
  - Retry failed lesson → status flips from `sync_failed` to `synced`.
  - `invalid_grant` on next sync → integration row flipped to `needs_reconnect`, status endpoint reflects it, subsequent retries return 409.
  - Reconnect with calendar still existing in Google → `calendars.get` returns 2xx, no `calendars.insert` called, same `google_calendar_id` preserved, `status` back to `'active'`, resync re-attempts all `sync_failed`/`not_synced` upcoming approved lessons.
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
- **Audit log table.** Dropped entirely. See **Why no separate integration audit log** above. Reason: the existing `household_audit_log` can't carry coach-level events (NOT NULL `household_id`), and the integration lifecycle is already observable from durable row state.
- **Reconnect calendar reuse.** On reconnect, call `calendars.get(googleCalendarId)`. Reuse on 2xx; call `calendars.insert` only on 404/410. Reason: honors the user rule that we reuse the existing calendar when it still exists.

## Still open

Nothing I can resolve without you or Jason. Flagging two UX details to confirm before implementation starts; neither blocks writing code against this plan:

1. **Syncing banner poll cadence.** 3s is a guess. If it feels too chatty on an idle page or too slow after a connect, we tune it. Confirm 3s is a reasonable starting point.
2. **Reconnect copy.** The amber alert reads "Google disconnected us — your calendar won't update until you reconnect." Jason may want friendlier wording.

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
