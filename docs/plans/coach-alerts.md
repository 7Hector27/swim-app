# Plan: Coach alerts via web push

**Status:** Planning
**Branch:** `feature/coach-alerts`
**ADR:** [031 — Coach alerts via web push](../decisions/031-coach-alerts-web-push.md)

---

## Overview

Every state change that currently calls one of the four `notify*` stubs in `apps/api/src/lib/lessonApproval.ts` produces one durable `coach_notifications` row written inside the same `db.transaction()` as the state change. A sender runs post-commit and fans the row out to every active browser push subscription for the coach via standard Web Push (the `web-push` library + VAPID keys). The row is both the retry anchor and the data behind the coach's in-app notification list, so a stale phone is caught up by opening the app. Failures are retried from the cron. Push failures never affect bookings.

Scope is coach-only. Parent-facing notifications are explicitly out, but the `coach_push_subscriptions` table is keyed by profile id (not coach id) so a later parent-facing push feature slots in without a schema migration.

Transport is `web-push` with VAPID in every environment (local, dev, prod). iPhones require the user to add the site to their home screen; Android Chrome, Edge, Firefox, and desktop Chrome work directly from the enable button. The service worker ships at `/sw.js` from the web app's `public` directory. The existing `/icons/site.webmanifest` already declares `"display": "standalone"` and the full icon set required for iOS install, so the manifest is unchanged.

---

## Scope

**In:**
- `booking_request` — a parent submitted a new request (one notification per single-lesson booking; one per batch write).
- `request_expiring_soon` — a pending request's `expires_at` is 3 to 4 hours from now and the coach has not acted yet.
- `parent_change` — a parent canceled or rescheduled a lesson (one per single-lesson cancel/reschedule; one per batch cancel-remaining).
- `calendar_disconnected` — the coach's Google Calendar integration flipped to `needs_reconnect`.
- `auto_approved_summary` — a lesson at a pool the household is already trusted at was auto-approved. Delivered via the daily summary by default; a per-category toggle can switch it to immediate.
- `daily_summary` — one push at 08:00 LA with today's lesson count, first lesson time + pool, count of pending requests, and the count of held overnight alerts.
- Coach-facing settings on `/account`: per-category on/off, quiet hours, daily summary, email backup, lock-screen detail.
- An in-app notification list on the coach dashboard with read/unread state.

**Out:**
- Parent-facing push. Parents keep their emails. Subscription rows are per profile; the sender filters by `profile.role = 'coach'` at send time.
- SMS. The outbox pattern accepts a new transport later without disturbing anything.
- Marketing or promotional categories.
- Per-swimmer or per-family notification routing (every alert goes to Jason).
- Service worker background sync, offline caching, fetch intercepts.

---

## Data model changes

Three new tables, one new column on `lesson_email_outbox`, one new column on `profiles.notification_prefs`-adjacent — but kept as a dedicated preferences table to match ADR 031 and to keep the signup trigger diff small.

### New table — `coach_notifications`

Transactional outbox for coach alerts. One row per state change event. Written inside the state-change transaction; drained by the post-commit microtask sender and `POST /internal/cron/tick`.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `profile_id` | `uuid` | no | — | FK → `profiles.id` (`ON DELETE RESTRICT`). The coach the notification is for. Keyed by profile, not coach, so future parent-facing alerts fit the same table. |
| `category` | `text` | no | — | CHECK IN (`booking_request`, `request_expiring_soon`, `parent_change`, `calendar_disconnected`, `auto_approved_summary`, `daily_summary`). |
| `urgency` | `text` | no | — | CHECK IN (`standard`, `urgent`). Server-computed: `urgent` when the affected lesson's `starts_at` is before midnight tomorrow in `America/Los_Angeles`. Daily-summary rows are always `standard`. Calendar-disconnected rows are always `urgent`. |
| `lesson_id` | `uuid` | yes | — | FK → `lessons.id` (`ON DELETE RESTRICT`). Set for per-lesson categories. Null for batch, calendar, and summary categories. |
| `batch_id` | `uuid` | yes | — | FK → `booking_batches.id` (`ON DELETE RESTRICT`). Set when the alert describes a batch. Null otherwise. |
| `payload` | `jsonb` | no | — | Frozen render inputs. For `booking_request` single-lesson: `{ swimmerFirstNamesWithInitial, startsAtLocalDisplay, locationName, lessonId }`. For `booking_request` batch: `{ batchId, lessonCount, firstStartsAtLocalDisplay, lastStartsAtLocalDisplay, locationName }`. For `parent_change`: adds `{ changeKind: 'canceled' | 'rescheduled', previousStartsAtLocalDisplay? }`. For `calendar_disconnected`: `{ needsReconnectSinceUtc }`. For `daily_summary`: `{ dateLocal, lessonCount, firstLessonTimeLocal, firstLessonPoolName, pendingRequestCount, heldAlertCount }`. The push body is built at send time from this payload + the coach's lock-screen detail setting; the frozen payload lets the renderer run as a pure function. |
| `click_url` | `text` | no | — | Deep link the service worker opens on tap. Snapshotted at write time (see ADR 031 for the per-category routing). |
| `tag` | `text` | no | — | Notification tag (`lesson:<id>`, `batch:<id>`, `calendar-disconnected:<coachId>`, or `daily-summary:<dateLocal>`). The browser surface collapses successive pushes with the same tag. |
| `read_at` | `timestamptz` | yes | — | Set by `POST /coach/notifications/:id/read` or `POST /coach/notifications/read-all`. The in-app list sorts unread first. |
| `push_status` | `text` | no | `'pending'` | CHECK IN (`pending`, `held`, `sending`, `sent`, `failed`, `skipped`, `superseded`, `abandoned`). `held` is the quiet-hours terminal-until-release state; the drain promotes it to `pending` when the current LA time passes `release_at`. Rules otherwise match ADR 028's email outbox. |
| `release_at` | `timestamptz` | yes | — | Non-null only when `push_status = 'held'`. Set to the next 07:00 LA at write time if the alert fell in quiet hours. The cron's `releaseHeldCoachNotifications` pass promotes rows whose `release_at < now()`. |
| `push_attempts` | `integer` | no | `0` | Incremented on every attempt that reaches the transport layer. |
| `push_claimed_until` | `timestamptz` | yes | — | Non-null only while `push_status='sending'`. Set to `now() + interval '2 minutes'`. Expired claims are recoverable. |
| `push_last_error` | `text` | yes | — | Short transport error summary. No names, no addresses, no email bodies. |
| `push_last_attempt_at` | `timestamptz` | yes | — | |
| `push_next_attempt_at` | `timestamptz` | no | `now()` | Backoff schedule. On failure the sender sets this to `now() + min(2^attempts, 30) minutes`. |
| `push_sent_at` | `timestamptz` | yes | — | Set once when at least one subscription accepted the push with a 2xx. |
| `delivered_subscription_count` | `integer` | no | `0` | Per-row counter of subscriptions that accepted this push. Lets us distinguish "sent to one of two devices" from "sent to all." |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | Auto-updated. |

Constraints:
- CHECK: exactly one of `lesson_id` / `batch_id` is non-null **when** `category` ∈ (`booking_request`, `request_expiring_soon`, `parent_change`, `auto_approved_summary`). Both are null for `calendar_disconnected` and `daily_summary`.
- CHECK: `(push_status = 'sending') = (push_claimed_until IS NOT NULL)`.
- CHECK: `(push_status = 'held') = (release_at IS NOT NULL)`.
- CHECK on `category`, `urgency`, `push_status`.
- Partial unique index on `(profile_id, lesson_id, category) WHERE lesson_id IS NOT NULL` — the server idempotently retries the `request_expiring_soon` cron pass, so dedup is necessary. The `booking_request` and `parent_change` paths rely on the state change's transaction preventing a second write naturally (the same transaction cannot run twice), so the partial unique index is defensive for the expiring-reminder path specifically.
- Partial unique index on `(profile_id, batch_id, category) WHERE batch_id IS NOT NULL` — same reason for batch alerts.
- Partial unique index on `(profile_id, (payload->>'dateLocal')) WHERE category = 'daily_summary'` — one daily-summary row per coach per LA date.

Indexes:
- Partial index on `(push_next_attempt_at) WHERE push_status IN ('pending', 'failed', 'sending')` — the drain hot path, same shape as `lesson_email_outbox`.
- Partial index on `(release_at) WHERE push_status = 'held'` — the `releaseHeldCoachNotifications` pass's lookup.
- `(profile_id, read_at NULLS FIRST, created_at DESC)` — the in-app list's primary read.
- `(profile_id, created_at DESC)` — timeline debugging.

RLS: `.enableRLS()` with no policies (API-only).

### New table — `coach_push_subscriptions`

One row per browser push subscription per coach device. Rows are per profile (not coach) so a later parent-facing push feature uses the same table.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `profile_id` | `uuid` | no | — | FK → `profiles.id` (`ON DELETE CASCADE`). |
| `endpoint` | `text` | no | — | The push service endpoint URL. Unique with `profile_id` — if the same browser re-subscribes, it either lands on the same endpoint (idempotent upsert) or a new endpoint (new row). |
| `p256dh` | `text` | no | — | Base64url public key from `PushSubscription.getKey('p256dh')`. |
| `auth` | `text` | no | — | Base64url auth secret from `PushSubscription.getKey('auth')`. |
| `user_agent` | `text` | yes | — | Captured from the request header at register time. Trimmed to 200 chars. Rendered on `/account` as "Chrome on macOS" (derived at display time with a small UA parser, not stored normalized). |
| `is_active` | `boolean` | no | `true` | Flipped to `false` when the push service returns 410 Gone or 404 Not Found. |
| `removed_reason` | `text` | yes | — | CHECK IN (`gone`, `vapid_rejected`, `coach_disabled`). Non-null only when `is_active = false`. |
| `last_delivery_at` | `timestamptz` | yes | — | Updated on every 2xx push delivery. |
| `last_failure_at` | `timestamptz` | yes | — | Updated on every non-retryable failure. |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | Auto-updated. |

Constraints:
- `UNIQUE (profile_id, endpoint)` — a browser's endpoint is unique per profile.
- CHECK: `(is_active = false) OR (removed_reason IS NULL)` — a row cannot be both active and marked removed.

Indexes:
- `(profile_id, is_active)` — the sender's fan-out query.

RLS: `.enableRLS()` with no policies.

### New table — `coach_notification_preferences`

One row per coach profile. Keyed by profile id so the signup trigger's companion insert matches the household creation pattern.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `profile_id` | `uuid` | no | — | PK; FK → `profiles.id` (`ON DELETE CASCADE`). |
| `booking_request_enabled` | `boolean` | no | `true` | |
| `booking_request_email_backup_enabled` | `boolean` | no | `true` | When the coach has zero active subscriptions, the sender writes an email-outbox row with event `coach_booking_request` instead of a push. |
| `request_expiring_soon_enabled` | `boolean` | no | `true` | |
| `parent_change_enabled` | `boolean` | no | `true` | |
| `auto_approved_mode` | `text` | no | `'summary'` | CHECK IN (`off`, `summary`, `immediate`). Default is `summary` — these alerts land in the daily summary count rather than firing immediately. `calendar_disconnected` has no toggle; it cannot be turned off. |
| `daily_summary_enabled` | `boolean` | no | `true` | |
| `daily_summary_time_local` | `time` | no | `'08:00'` | LA-local time for the daily-summary push. |
| `quiet_hours_enabled` | `boolean` | no | `true` | |
| `quiet_hours_start_local` | `time` | no | `'21:00'` | |
| `quiet_hours_end_local` | `time` | no | `'07:00'` | When `end < start`, the window crosses midnight — handled by the sender's time check. |
| `lock_screen_detail` | `text` | no | `'first_initial'` | CHECK IN (`first_initial`, `full_name`). Governs the `body` string the renderer emits. `first_initial` renders `"Alex R."` + `"Tue 4:30 PM at Egret Park"`. `full_name` renders the full swimmer name. |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | Auto-updated. |

RLS: `.enableRLS()` with no policies.

### `lesson_email_outbox` — new event

Extend the CHECK on `event` to accept a new value: `coach_booking_request`. This email backup is only used when `booking_request_email_backup_enabled = true` and the coach has zero active push subscriptions. The payload is a lightweight `{ lessonId | batchId, firstName, startsAtLocalDisplay, locationName }`; recipient resolution is the coach's profile row (verified email required), not the household's owners/managers. The sender dispatches on `event` as it already does; one new React Email template at `apps/api/src/services/emails/templates/CoachBookingRequest.tsx`.

### Migration

Two Drizzle migration pairs:

1. `pnpm db:generate --name=coach_alerts` — adds the three new tables (with CHECKs, partial unique indexes, hot-path indexes), the new `event` CHECK value on `lesson_email_outbox`.
2. `pnpm db:generate --custom --name=coach_notification_prefs_default` — custom SQL. Extends the existing `on_auth_user_created` trigger function to also insert a `coach_notification_preferences` row with defaults for every new profile (not just coaches; the row is cheap and lets the preferences page work for every profile without a lazy upsert). Backfill: `INSERT INTO coach_notification_preferences (profile_id) SELECT id FROM profiles WHERE id NOT IN (SELECT profile_id FROM coach_notification_preferences)`.

Both go through the standard flow (`pnpm db:generate`, apply locally, PR description states "applied locally"). The custom migration edits only the SQL file; the snapshot is produced by drizzle-kit.

`docs/data-model.md` grows three new `###` sections for the new tables, a one-line note on `lesson_email_outbox.event`, and no changes to `lessons`.

---

## Shared Zod schemas

Added to `packages/shared/src/schemas/coachAlerts.ts`, exported from `packages/shared/src/index.ts`:

- `CoachNotificationCategorySchema` — enum: `booking_request | request_expiring_soon | parent_change | calendar_disconnected | auto_approved_summary | daily_summary`.
- `CoachNotificationUrgencySchema` — enum: `standard | urgent`.
- `CoachNotificationListItemSchema` — the in-app list row shape (id, category, urgency, title, body, click_url, created_at, read_at, lesson_id, batch_id).
- `CoachPushSubscriptionRegisterSchema` — the register endpoint's body: `{ endpoint, keys: { p256dh, auth } }` — matches the browser's `PushSubscription.toJSON()` output verbatim so the client passes the subscription through with no transformation.
- `CoachPushSubscriptionListItemSchema` — the `/account` list row: `{ id, userAgent, createdAt, lastDeliveryAt }`.
- `CoachNotificationPreferencesSchema` — the preferences read/write shape, one field per column.
- `CoachNotificationMarkReadSchema` — `{ notificationId: z.string().uuid() }` for the mark-read endpoint.

Types are `z.infer<>` only — no hand-written interfaces per CLAUDE.md.

---

## Where notification rows are written

The same lesson-change-path list from ADRs 027–030 governs where `coach_notifications` rows are written. Each listed site writes exactly one row inside the state change's `db.transaction()`. The existing `notify*` stubs become thin wrappers around a shared `enqueueCoachNotification(tx, input)` helper that lives at `apps/api/src/services/notifications/outbox.ts`. The current call sites do not move; only the body of the stubs changes.

| # | Trigger | Current call site | Replacement write | Notes |
|---|---|---|---|---|
| 1 | Parent single-lesson booking (pending) | `lessons.ts:702` (`notifyBookingCreated(id, false)`) | `enqueueCoachNotification(tx, { profileId: coach.id, category: 'booking_request', lessonId, urgency: computed, payload: { … } })` | Fires inside the same transaction as `INSERT lessons`. |
| 1' | Parent single-lesson booking (auto-approved) | same, with `notifyBookingCreated(id, true)` | `category: 'auto_approved_summary'`. If `auto_approved_mode = 'immediate'`, the row is written as-is; if `summary`, the row is written and the daily-summary pass folds it in. If `off`, no row is written. The branching lives in `enqueueCoachNotification`, not the route. | |
| 2 | Coach approves | `coachLessons.ts:641` (`notifyLessonApproved(id)`) | **No alert written.** Jason is the actor; he does not need to notify himself. The current stub's semantics are preserved by making the enqueue helper a no-op for this path, but the call site stays (future multi-coach: another coach approves, this coach gets alerted). | |
| 3 | Coach declines | `coachLessons.ts:606` (`notifyLessonDeclined(id)`) | **No alert written** for the same reason. | |
| 4 | Coach reschedule or cancel | `lessons.ts:1938` / `lessons.ts:2218` (coach-side `PATCH` / `DELETE`) | **No alert written** — coach-initiated. | |
| 5 | Parent reschedule or cancel | `lessons.ts:1938` / `lessons.ts:2218` (parent-side) | `category: 'parent_change'`, `payload.changeKind = 'rescheduled' | 'canceled'`, `previousStartsAtLocalDisplay` on reschedules. | The current stub call site is a shared handler that runs for both roles; the enqueue helper checks `actorRole` and skips when the actor is the coach. |
| 6 | Parent batch booking | `lessons.ts:1446` (`notifyBatchBookingCreated(batchId, …)`) | One row per batch with `lesson_id = null`, `batch_id = <batchId>`, category depending on the batch's mix: `booking_request` if any pending, `auto_approved_summary` if all auto-approved. The payload summarizes counts. | |
| 7 | Parent batch cancel-remaining | `lessons.ts:1785` (`notifyCoachOfBatchChange(batchId, 'canceled_remaining', …)`) | One row with `category: 'parent_change'`, `payload.changeKind = 'batch_canceled_remaining'`, `lessonCount`. | |
| 8 | Coach-booked lesson (ADR 029) | `coachLessons.ts:1401` (`notifyBookingCreated(id, true)`) | **No alert written** — coach is the actor. | |
| 9 | Cron tick: pending request about to expire | **New** — `internal.ts` adds `enqueueExpiringRequestReminders` pass | Scans `lessons.status = 'pending'` with `expires_at BETWEEN now() + '3 hours' AND now() + '4 hours'`. For each, inserts `category: 'request_expiring_soon'` with `urgency` computed from `starts_at`. The partial unique index on `(profile_id, lesson_id, category)` makes the pass idempotent — if the previous tick fired already, the second insert is a no-op. | |
| 10 | Google Calendar flips to `needs_reconnect` | `services/googleCalendarSync.ts` — the token refresh handler that sets `status = 'needs_reconnect'` | Inside the same transaction as the status update, insert `category: 'calendar_disconnected'`, `payload: { needsReconnectSinceUtc: new Date().toISOString() }`, `tag: 'calendar-disconnected:<coachId>'`. `urgency = 'urgent'`. | |
| 11 | Cron tick: 08:00 LA daily summary | **New** — `internal.ts` adds `composeDailyCoachSummary` pass | Fires when the current LA time rounds to the coach's `daily_summary_time_local` (default `08:00`). Computes the payload from today's lesson state and inserts one `daily_summary` row per connected coach. The partial unique index on `(profile_id, dateLocal) WHERE category = 'daily_summary'` makes this idempotent across repeated ticks within the same minute. | |

Every row above is written inside the state change's transaction. The alert insert is **in** the `tx` passed to `enqueueCoachNotification`. No HTTP, no `web-push` call, no body render happens inside the transaction.

### Post-commit microtask

Each route's existing `queueMicrotask(() => void …)` block grows one line:

```ts
res.json(responseBody);
queueMicrotask(() => { void sendCoachNotification(notificationId); });
```

Mirrors the ADR 027 / 028 pattern. The microtask swallows its own rejections; the row stays `'pending'` and the cron drains it on the next tick.

---

## Sender and retry design

### `sendCoachNotification(notificationId: string): Promise<void>`

Single entry point used by both the post-commit microtask and the cron drain. Claim-first, release-the-lock, send, finalize — identical shape to `sendLessonEmailOutboxRow` from ADR 028, with push-specific fan-out.

**Flow:**

1. **Claim.** `UPDATE coach_notifications SET push_status='sending', push_claimed_until = now() + interval '2 minutes', push_last_attempt_at = now() WHERE id = :id AND (push_status IN ('pending', 'failed') OR (push_status = 'sending' AND push_claimed_until < now())) RETURNING *`. If no row returned → another worker owns the claim or the row is terminal; log and return.
2. **Pre-send guard.** Supersede if a newer notification for the same `(profile_id, lesson_id)` or `(profile_id, batch_id)` has already sent, or if the affected lesson has already started (`lesson.starts_at < now()`) — except for `parent_change` cancel rows, which still deliver past start time so Jason knows a lesson is off. `calendar_disconnected` and `daily_summary` rows have no lesson and are not superseded by this rule.
3. **Quiet-hours check.** Look up the coach's `coach_notification_preferences`. If the alert is non-urgent, `quiet_hours_enabled = true`, and the current LA time falls inside the window, flip to `push_status = 'held'`, set `release_at` to the next `quiet_hours_end_local` LA, commit, return.
4. **Lock-screen render.** Build `{ title, body, tag, click_url, urgency }` from the row's payload and the coach's `lock_screen_detail` setting. The server does not send anything beyond these five fields through the push transport.
5. **Fan-out.** Load every active `coach_push_subscriptions` row for `profile_id`. For each subscription, call `webpush.sendNotification(subscription, body, { TTL: urgency === 'urgent' ? 60 : 86400, urgency: urgency === 'urgent' ? 'high' : 'normal', vapidDetails })`. The call is `await`ed per subscription — the per-coach device count is small (1–3 realistically), so sequential sends keep the error attribution clean without hurting latency.
6. **Finalize.** Open a second transaction and update:
   - **For each 2xx:** increment `delivered_subscription_count`, update the subscription's `last_delivery_at`.
   - **For each 410 / 404:** flip the subscription's `is_active = false`, `removed_reason = 'gone'`, `last_failure_at = now()`. Treat as a successful delivery attempt — the subscription is cleaned, the notification is not re-queued because of this.
   - **For each 429 / 5xx:** record on the subscription row (`last_failure_at`) but do not deactivate it.
   - **Row terminal state:**
     - If any subscription returned 2xx **or** the only failures were 410/404: `push_status = 'sent'`, `push_sent_at = now()`.
     - If zero subscriptions existed: see the email-backup branch below.
     - If every subscription returned 429 / 5xx: `push_status = 'failed'`, `push_next_attempt_at = now() + min(2^attempts, 30) minutes`.
7. **Email-backup branch.** If `category = 'booking_request'`, zero active subscriptions existed at step 5, and `booking_request_email_backup_enabled = true`, open a short transaction and enqueue a `lesson_email_outbox` row with `event = 'coach_booking_request'`, `recipient_profile_ids = [coach.id]`. The alert row's own `push_status` becomes `skipped` with `push_last_error = 'no_active_subscriptions:email_backup_queued'`. If the backup is disabled, the row just becomes `skipped`.
8. **Idempotency key.** The `web-push` library honors a `Topic` header. The server passes the notification's `tag` as the `Topic` so the push service collapses successive pushes about the same lesson into one visible notification even before our server-side supersede guard runs.

### Why claim first

Same reason as ADR 028: the dedup key only prevents duplicate rows, not duplicate deliveries of a single row. `FOR UPDATE SKIP LOCKED` + `push_status='sending'` + `push_claimed_until` means at most one worker is in step 5 for a given row at a time, and a crashed worker's claim is recoverable at `push_claimed_until`.

### Retry classification

| Push service outcome | Row action | Subscription action |
|---|---|---|
| 2xx | `push_status = 'sent'`, terminal (unless every subscription failed) | `last_delivery_at = now()` |
| 410 Gone / 404 Not Found | counts as a successful delivery attempt | `is_active = false`, `removed_reason = 'gone'` |
| 429 Too Many Requests | retry with backoff | `last_failure_at = now()` |
| 5xx | retry with backoff | `last_failure_at = now()` |
| VAPID signature rejected | `push_status = 'failed'`, no retry (bug in config, not transient) | `is_active = false`, `removed_reason = 'vapid_rejected'` |
| Request body too large | `push_status = 'failed'`, no retry — the renderer is at fault, retrying won't help | — |

No cap on `push_attempts`; same abandon rule as ADR 028 (7 days post-create flips a persistently-failed row to `'abandoned'` during the drain).

### Cron tick additions

Extends `POST /internal/cron/tick` with four new passes:

1. **`drainCoachNotifications`** — identical shape to the email outbox drain. Selects up to 50 rows where `push_status IN ('pending', 'failed')` or (`sending` AND `claimed_until < now()`) and `push_next_attempt_at < now()`. Sequential await per row.
2. **`releaseHeldCoachNotifications`** — selects rows where `push_status = 'held'` and `release_at < now()`, flips to `'pending'`, sets `push_next_attempt_at = now()`. The drain picks them up on the same tick. Cap 200.
3. **`enqueueExpiringRequestReminders`** — selects `lessons.status = 'pending'` with `expires_at BETWEEN now() + interval '3 hours' AND now() + interval '4 hours'`. For each, calls `enqueueCoachNotification` in a per-lesson transaction. The partial unique index silently drops duplicates from a previous tick. Cap 200.
4. **`composeDailyCoachSummary`** — fires only when the current UTC minute rounds to one of the connected coaches' `daily_summary_time_local` in LA. Reads today's lessons, pending requests, auto-approved count since the previous summary, and the count of released held alerts in the last 24 hours; inserts one `daily_summary` row per connected coach. Partial unique index drops duplicates if the tick fires twice at `08:00`.

The retention scrub pass is extended to also null `coach_notifications.payload` on terminal rows older than 30 days, same rule as `lesson_email_outbox`.

---

## Service worker + enable flow

### Service worker file

New file `apps/web/public/sw.js`. Written in plain JS (TypeScript sources at `apps/web/src/sw/` are compiled by a one-shot `tsc --outFile` step wired into the build; the simple SW does not need bundling). Responsibilities:

- `push` listener: parses `event.data.json()` for `{ title, body, tag, click_url, urgency }`, calls `self.registration.showNotification(title, { body, tag, data: { click_url }, requireInteraction: urgency === 'high' })`.
- `notificationclick` listener: calls `event.notification.close()`, then `clients.openWindow(event.notification.data.click_url)` — if an existing client window matches the URL, focus it instead.
- `pushsubscriptionchange` listener: calls `self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: ... })` with the public VAPID key (fetched from a cached response) and `POST /coach/push/subscriptions` to re-register with the server.
- No `fetch` handler, no cache storage. V1 is push-only.

### Registration client component

New file `apps/web/src/components/PushSubscriptionManager/PushSubscriptionManager.tsx`. Rendered inside the authenticated layout. It:

1. Checks `'serviceWorker' in navigator && 'PushManager' in window`. If either is false, renders nothing (unsupported browser).
2. Checks `Notification.permission`. If `default`, nothing happens until the user clicks "Enable" on the `/account` card.
3. On mount after permission is `granted`, registers the SW at `/sw.js` and calls `pushManager.getSubscription()`. If no subscription exists, calls `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: NEXT_PUBLIC_VAPID_PUBLIC_KEY })`.
4. POSTs the subscription to `/api/coach/push/subscriptions` with CSRF handling via the existing Supabase SSR cookie. The API route proxies to the Express API.

### Enable flow on `/account`

A new section on the account page (coach only — the account page already gates coach-only UI by `profile.role`):

- "Push notifications" header.
- If the browser is unsupported, show "This browser does not support notifications. Open the app in Chrome, Edge, Firefox, or add it to your home screen on iPhone (iOS 16.4+) and reopen."
- If the browser is iOS Safari and `display` is not `standalone`, show "Install this site to your home screen first. Tap Share, then Add to Home Screen, and reopen from the icon."
- If `Notification.permission === 'default'`, show an "Enable notifications" button that calls `Notification.requestPermission()` and, on grant, triggers the registration flow above.
- If `Notification.permission === 'denied'`, show "Notifications are blocked. Open browser settings to re-enable."
- If `Notification.permission === 'granted'`, show the list of active subscriptions (one card per device with the user-agent summary and a Remove button) and a "Send test notification" button that POSTs to `/coach/push/test` and fires a sanity-check push.
- Below the list, show the full preference form (per-category toggles, quiet hours, daily summary, lock-screen detail). Changes auto-save.
- A persistent banner at the top of the account section when `getSubscriptions()` returns zero active subscriptions AND the coach has `booking_request_enabled = true`: "Notifications are off. You will not get push alerts for new requests. Email backup is on." If the email backup is also off, the banner reads "Notifications are off and email backup is disabled. You will not be alerted."

The persistent banner also appears on `/coach/schedule` as a thin bar above the day view when subscriptions are zero. It links to `/account`.

---

## In-app notification list

### Dashboard surface

A bell icon in the coach dashboard header. Three states: no unread (gray), unread count 1–9 (dot with count), 10+ (dot with "9+"). Tapping opens a dropdown panel listing the 20 most recent notifications. The dropdown is a client component mounted inside the coach layout.

### Data flow

- `GET /coach/notifications?limit=20&unreadOnly=false` returns a page of `CoachNotificationListItem` rows. Sorted by `read_at NULLS FIRST, created_at DESC`.
- `GET /coach/notifications/unread-count` returns `{ count: number }`. Called on dashboard mount and polled every 60 seconds (adequate because urgent events already fire a push; the poll is a fallback for a tab the coach has open in the background).
- `POST /coach/notifications/:id/read` sets `read_at = now()`.
- `POST /coach/notifications/read-all` sets `read_at = now()` on every unread row for the coach.

### List rendering

- Each row shows the category label (small all-caps), the body text (same string the push used), the LA-formatted "time ago" (`{xa}go` using `date-fns-tz`), and a right-arrow link to the `click_url`.
- Unread rows have a left-edge accent (`bg-brand-accent` per the design system) and are rendered in `font-medium`; read rows are `font-regular` with no accent.
- Urgent rows use the `text-status-urgent` token; non-urgent use `text-text-primary`.
- Rows render even when the row's `payload` has been scrubbed to `_scrubbed_at`: in that case the body falls back to `"{Category label} · {date}"` and the deep link is disabled with a subtle "No longer available" caption.
- An "Open all" link at the bottom opens `/coach/notifications` — a full-page list with the same rows, pagination, and a "Mark all read" button. The partial page is also useful on a phone where the dropdown would be cramped.

### Mobile vs desktop

The dropdown is a modal sheet on screens below the `tablet:` breakpoint (per the project's custom breakpoint rules in CLAUDE.md), a dropdown on `tablet:` and up. The full page is identical on both.

---

## Environment variables

Added to `apps/api/src/lib/env.ts` `RawEnvSchema` and `ApiEnv`:

| Var | Required in… | Example | Notes |
|---|---|---|---|
| `VAPID_PUBLIC_KEY` | always | `BL1z8…` | Base64url, from `web-push generate-vapid-keys`. Public — also exposed to the web app as `NEXT_PUBLIC_VAPID_PUBLIC_KEY`. |
| `VAPID_PRIVATE_KEY` | always | `t3…` | Base64url. Secret. Lives only in the API runtime. |
| `VAPID_SUBJECT` | always | `mailto:jason@axiomaquatics.io` | Required by the Web Push spec; identifies the sender for push service abuse response. The mailto owner receives any abuse mail from push services. |

Added to `apps/web`'s build-time environment (via `next.config.js` env block and Railway variable set):

| Var | Required in… | Example | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | always | identical to API's `VAPID_PUBLIC_KEY` | Consumed by the service worker registration client component. |

### Generating the keys

Local:

```bash
pnpm --filter api dlx web-push generate-vapid-keys
```

Produces one public key and one private key as base64url strings. Paste into `apps/api/.env` and `apps/web/.env.local`:

```
VAPID_PUBLIC_KEY=<public>
VAPID_PRIVATE_KEY=<private>
VAPID_SUBJECT=mailto:jason@axiomaquatics.io
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<public>
```

**This plan does not modify `.env` files.** The developer sets these during implementation.

Railway dev + prod: run the same command locally, then paste into Railway's variable set for each service. The web and API services for a given environment must agree on `VAPID_PUBLIC_KEY` / `NEXT_PUBLIC_VAPID_PUBLIC_KEY`. Rotating the keys invalidates every existing subscription — the account page's banner will reappear and the coach will re-enable from each device.

### Validation rules in `env.ts`

- Always: `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` present, base64url shape (regex `^[A-Za-z0-9_-]+$`), `VAPID_PUBLIC_KEY` length is 65 bytes decoded, `VAPID_PRIVATE_KEY` length is 32 bytes decoded.
- Always: `VAPID_SUBJECT` matches `/^mailto:.+@.+$/` or `/^https:\/\/.+$/` (both are valid per spec).

---

## Logging

Per `docs/accounts.md`: no names, no addresses, no emails, no notes in logs. The sender logs:

- `notification_id`, `category`, `urgency`, `profile_id`, `subscription_count`, `delivered_count`, `attempts`, `push_last_error` (short, no PII).
- The subscription row logs `subscription_id`, `profile_id`, UA class ("chrome-mac", "chrome-android", "ios-pwa") derived from the stored UA at log time, no raw UA, no endpoint URL (endpoints are tenant-specific URLs with opaque identifiers — not strictly PII but the privacy posture matches "we do not log auth-equivalent credentials").
- The payload is not logged under any error path. A new `redactForLogs(payload)` helper mirrors the one in `apps/api/src/services/emails/sender.ts` and strips `swimmerFirstNamesWithInitial`, `locationName`, and `previousStartsAtLocalDisplay` before serialization.

---

## Audit log

Not written. Same reasoning as ADR 028: the alert row's `push_status`, `push_attempts`, `push_last_error`, `push_sent_at`, `delivered_subscription_count`, and `read_at` capture the full lifecycle inline. The in-app list query doubles as the audit view.

---

## Retention

Payload scrub pass is extended to cover `coach_notifications`:

```sql
UPDATE coach_notifications
SET payload = jsonb_build_object('_scrubbed_at', now()),
    click_url = ''
WHERE push_status IN ('sent', 'skipped', 'superseded', 'abandoned')
  AND coalesce(push_sent_at, push_last_attempt_at, updated_at) < now() - interval '30 days'
  AND payload ? 'lessonId'
LIMIT 500;
```

Same cap, same idempotency guard. `click_url` is scrubbed too — a 30-day-old deep link to a lesson detail may itself have moved on; keeping the URL is a weak privacy signal we would rather drop.

`coach_push_subscriptions` rows with `is_active = false` and `last_failure_at < now() - interval '90 days'` are hard-deleted by a dedicated pass. 90 days is enough to debug a "my notifications stopped" complaint; past that, the dead endpoint is noise.

---

## Test plan

### Unit (`pnpm test`)

Vitest, pure logic. New files under `apps/api/src/services/notifications/__tests__/`:

- `renderPushBody.test.ts` — the body renderer given a payload and `lock_screen_detail`.
  - `first_initial` renders `"Alex R., Tue 4:30 PM at Egret Park"`.
  - `full_name` renders `"Alex Rodriguez, Tue 4:30 PM at Egret Park"`.
  - Batch payload renders `"3 lessons at Egret Park, first Tue 4:30 PM"`.
  - Daily summary renders `"4 lessons today, first at 7:30 at Egret Park. 2 requests waiting."`.
  - Calendar disconnected renders `"Google Calendar lost its connection. Tap to reconnect."`.
  - No swimmer last name reaches the body under `first_initial`.
- `urgency.test.ts` — `computeUrgency(startsAt, nowLa)` returns `'urgent'` for anything before midnight tomorrow and `'standard'` otherwise. Edge cases at midnight boundary. DST transition days.
- `quietHours.test.ts` — `isInsideQuietHours(now, start, end)` with wraparound (21:00–07:00), without wraparound (10:00–14:00), and `enabled: false`.
- `sender.test.ts`
  - Happy path with one subscription → `push_status='sent'`, `delivered_subscription_count=1`.
  - Two subscriptions, one 2xx + one 410 → `push_status='sent'`, counter=1, 410'd row flipped `is_active=false`.
  - Every subscription 429 → `push_status='failed'`, backoff computed.
  - Zero subscriptions + email backup enabled → `push_status='skipped'`, email outbox row inserted with `coach_booking_request`.
  - Zero subscriptions + email backup disabled → `push_status='skipped'`, no email outbox row.
  - Quiet hours + non-urgent → `push_status='held'`, `release_at` set to next 07:00 LA.
  - Quiet hours + urgent → delivers immediately.
  - Supersede by newer sent row for same lesson → `push_status='superseded'`.
  - VAPID rejection on one subscription → that subscription flipped `is_active=false`, `removed_reason='vapid_rejected'`.
  - Idempotency: run sender twice for same row in parallel (real DB, mocked transport) → transport called at most once per subscription per row.

### Integration (`pnpm test:integration`)

Live local Supabase, `web-push` mocked at the module boundary. New file `apps/api/src/__tests__/integration/coachAlerts.integration.test.ts`:

- Each behavior tested once. Explicit list (one per bullet):
  - Parent single-lesson booking writes exactly one `booking_request` row inside the lesson's transaction.
  - Parent batch booking writes exactly one `booking_request` row (batch, counts set) regardless of batch size.
  - Parent single-lesson cancel writes one `parent_change` row with `changeKind='canceled'`.
  - Parent single-lesson reschedule writes one `parent_change` row with `changeKind='rescheduled'` and `previousStartsAtLocalDisplay` populated.
  - Parent batch cancel-remaining writes one `parent_change` row with `changeKind='batch_canceled_remaining'`.
  - Coach approve, decline, reschedule, cancel each write **zero** rows.
  - Coach-booked lesson writes zero rows.
  - Cron tick's `enqueueExpiringRequestReminders` writes exactly one `request_expiring_soon` row for a lesson in the 3-to-4-hour window, and running the same tick twice yields exactly one row (partial unique index backstops the pass).
  - Google Calendar flip to `needs_reconnect` writes exactly one `calendar_disconnected` row inside the same transaction as the status update.
  - Cron tick at 08:00 LA writes exactly one `daily_summary` row per connected coach for today's date; a repeat tick within the minute is a no-op.
  - Transaction atomicity: inject a seam that forces the notification insert to raise during `POST /lessons`; the lesson row is not committed and no partial state remains.
  - Email backup: register zero subscriptions, submit a parent booking, assert the push row ends `skipped` and one `lesson_email_outbox` row with `event='coach_booking_request'` is written for the coach.
  - Dead subscription cleanup: mock a 410 from the push service, assert the subscription row flips `is_active=false, removed_reason='gone'` and the notification row still ends `sent` on another subscription.
  - Supersede: enqueue a `parent_change` reschedule, let it enter `held` under quiet hours, then enqueue a second `parent_change` (final reschedule). The newer row should supersede the older on release; only one push leaves the sender.
  - Retention scrub: insert a `sent` row 31 days ago, run the scrub, assert `payload` becomes `{_scrubbed_at}` and `click_url=''`; `read_at`, `delivered_subscription_count`, timestamps untouched.
  - In-app list: `GET /coach/notifications` returns the 20 most recent sorted unread-first; `POST /coach/notifications/:id/read` flips the row; the unread-count endpoint returns 0 afterward.
  - Lock-screen detail: write a `booking_request` with `first_initial`, assert the body contains the swimmer initial not the full last name; change the preference and the next notification carries the full name.
  - No PII in logs: capture pino output during a full send, assert no swimmer last name, no email, no address, no endpoint URL appears.

Each behavior is one test. Shared helpers (seed a coach + a subscription row + a household + a pending lesson) live under `apps/api/src/__tests__/integration/helpers/`.

### Manual test — desktop Chrome on localhost

1. `pnpm db:up` (Supabase local).
2. `pnpm --filter api dlx web-push generate-vapid-keys`, paste the keys into `apps/api/.env` and `apps/web/.env.local`.
3. `pnpm dev`.
4. In Chrome, sign in as a seeded coach. Open `/account`.
5. Click "Enable notifications." Grant permission in the Chrome prompt. Confirm the subscription card appears with the user-agent summary.
6. Click "Send test notification" — a system notification appears. Click it; the browser focuses the coach dashboard.
7. In a second incognito window, sign in as a seeded parent. Submit a new booking request. Confirm the coach's Chrome shows a notification within a few seconds with the subject matching the lock-screen format.
8. Click the notification; the browser navigates to `/coach/lessons/<id>`.
9. In the first window, open the bell icon in the coach dashboard header — the notification is listed as read.
10. Set the parent's booking to a time outside quiet hours, change the coach's quiet-hours window to cover `now()`, submit another request. Confirm no push fires; the row sits in `held`.
11. Advance the clock past `release_at` (or set `release_at` manually in Postgres via Supabase Studio) and run `curl -H "cron-secret: $CRON_SECRET" -XPOST http://localhost:3001/internal/cron/tick`. Confirm the push now fires.

### Manual test — iPhone via dev deployment

1. Deploy the API and web to Railway dev with VAPID keys set.
2. On the iPhone (iOS 16.4 or later), open Safari and navigate to the dev deploy's URL.
3. Sign in as the seeded coach.
4. Tap Share → Add to Home Screen. Confirm the icon appears on the home screen.
5. Open the app from the home-screen icon (not from Safari) — the display mode is now `standalone` and the enable flow proceeds.
6. In `/account`, tap "Enable notifications." Grant permission.
7. From a second device (laptop, second phone), submit a parent booking against the dev deploy.
8. Confirm the iPhone's lock screen shows the notification with the right text. Tap it to open the PWA at the lesson detail.
9. Repeat step 7 while the PWA is open — the notification appears as a banner.
10. Close the PWA, wait for a quiet-hours window if the current time doesn't naturally fall in one; submit a parent change; confirm the push is held and arrives at the configured release time.

### Load / quota (manual, pre-launch)

Spot-check at the dev deploy: enqueue 50 `booking_request` rows against a seeded coach with 2 active subscriptions, confirm every one lands within the 50-per-tick cron drain budget. Expected total time < 30s given FCM/APNs typical push latency.

---

## Rollout

One PR, two phases on this branch. Both phases land on `feature/coach-alerts`.

### Phase 1 — schema, server, VAPID, email backup

Three commits:

- `coach alerts: schema + preferences` — the Drizzle migration pair, the three new tables, the preferences trigger insertion, the new `lesson_email_outbox.event` CHECK value.
- `coach alerts: enqueue + sender` — `enqueueCoachNotification`, `sendCoachNotification`, the four new cron passes, the stub replacements, the email backup, the Zod schemas in `packages/shared`. Integration tests.
- `coach alerts: email backup template` — the React Email template at `apps/api/src/services/emails/templates/CoachBookingRequest.tsx`, the renderer dispatch for the new event, the template snapshot test.

**No UI, no web changes.** The feature is server-complete and testable with `curl + supabase studio` at the end of this phase.

### Phase 2 — web (service worker, enable flow, settings, in-app list)

Three commits:

- `coach alerts: service worker + register endpoint` — `apps/web/public/sw.js`, the TS source for it, the `PushSubscriptionManager` client component, `POST /coach/push/subscriptions`, `DELETE /coach/push/subscriptions/:id`, `GET /coach/push/subscriptions`, `POST /coach/push/test`.
- `coach alerts: account UI` — the push section on `/account` (enable button, device list, iOS install hint, zero-subscription banner), the preference form, the save-on-change handler.
- `coach alerts: in-app list` — the bell icon in the coach dashboard header, the dropdown component, the full `/coach/notifications` page, the three list endpoints (`GET /coach/notifications`, `GET /coach/notifications/unread-count`, `POST /coach/notifications/:id/read`, `POST /coach/notifications/read-all`).

Each commit set is independently reviewable: Phase 1 is pure backend plus one new email template; Phase 2 is pure frontend plus three thin HTTP endpoints that just read / mark rows. No migration is required for Phase 2.

Neither phase requires a backfill or a destructive migration.

---

## Open questions

- **Should `calendar_disconnected` fire email backup when there is no push subscription?** The ADR says no (operational, surfaced in the dashboard banner), but if Jason adds a dev-side email watcher there is a weak argument for it. **Default in this plan: no email backup for `calendar_disconnected`.** Flagged for Jason's call.
- **Do we want a per-category "sound" setting on iOS?** Web Push on iOS only honors a limited set of notification options (no custom sounds), so the setting would be a no-op on iPhone and merely cosmetic on desktop. **Default: no setting.** Revisit if Jason wants it.
- **Should the daily summary include yesterday's completed lesson count?** The ADR as written counts today's upcoming lessons and overnight alerts. A "yesterday: 4 lessons taught, 0 no-shows" line is a one-field extension that could help Jason trend his week. **Default: not in v1.** Easy additive change later.
- **Should the sender treat a user-level 403 from the push service (occasionally returned by Firefox when the browser has silently revoked notifications) as `is_active = false`?** The behavior is spec-adjacent and inconsistent across push services. **Default in this plan: yes, treat 403 the same as 410 (deactivate subscription).** Revisit if we see legitimate 403s.
- **Rotation story for VAPID keys.** The current plan says "rotation invalidates every subscription; the coach re-enables." If Jason runs more than one device and needs seamless rotation, we would need per-key subscription records and a rolling-replace sender. **Default: single-key, stop-the-world rotation.** We never expect to need to rotate unless the private key leaks.

## Resolved decisions

- **Alert row vs. per-delivery join table.** Alert row only; per-subscription counter + per-subscription timestamps are sufficient. Join table was rejected on YAGNI grounds in ADR 031.
- **One service worker file at `/sw.js`.** No bundler, no cache versioning in v1. If we ever add offline caching the SW grows a `fetch` handler and a cache-naming scheme.
- **No audit log table.** The alert row's status/attempts/sent timestamps are the audit trail.
- **Coach actions do not fire a self-alert.** The actor-is-coach check lives inside `enqueueCoachNotification`.

---

## Non-goals

- No parent-facing push. Parents keep their emails. The `coach_push_subscriptions` table is keyed by profile id to not block a future parent push feature; nothing in this plan builds it.
- No SMS fallback. The outbox pattern leaves the door open; this plan does not walk through it.
- No read-receipts beyond `read_at`. "Mark unread" is not a feature.
- No background sync, no offline cache, no push for leaderboard events, no coach-to-coach messaging. Everything the SW does is covered by the three listeners above.
- No in-app notification center for parents. Parent surface stays email-only.
- No per-household per-event preferences. Preferences are per coach, per category.
