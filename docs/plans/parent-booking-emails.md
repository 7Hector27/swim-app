# Plan: Parent booking emails

**Status:** Planning
**Branch:** `feature/parent-booking-emails`
**ADR:** [028 — Parent booking emails via transactional outbox](../decisions/028-parent-booking-emails.md)

---

## Overview

Every state change on a booking that matters to a parent — request received, confirmed, declined, expired, canceled, rescheduled — produces one transactional email to the household's owners and managers. Delivery is decoupled from the booking write via an outbox table: the same `db.transaction()` that mutates the lesson inserts a `lesson_email_outbox` row. A sender fires right after commit for low-latency delivery, and the existing `POST /internal/cron/tick` drains failed or still-pending rows on every invocation. The outbox is the durability guarantee — nothing is sent inside the booking transaction, and nothing can be lost by a crash between commit and send.

Transport is Resend's API on the dev deploy and in production (sharing the already-verified `send.axiomaquatics.io` domain), and SMTP to the local Supabase stack's Mailpit when running locally. A new `APP_ENV` env var (`local` | `dev` | `prod`) drives environment-gated behavior — on dev and prod the sender resolves recipients from `profiles` where `email_verified_at` is non-null, so a parent needs to have confirmed their email before any booking email can reach them. Confirmed and rescheduled emails attach an `.ics` invite (`METHOD:REQUEST`) with a deterministic UID per lesson and a monotonically increasing `SEQUENCE` starting at 0; canceled, declined-after-approval, and expired-after-approval send `METHOD:CANCEL` with the same UID. Templates are built with React Email and ship as HTML + plain-text alternatives.

This is scope-limited to parent-facing email. Coach alerts, web push, and SMS are explicitly out of scope and will come later.

---

## Scope

**In:** Parent-facing email on booking request received (pending), lesson confirmed (manual or auto), request declined, request expired, lesson canceled (coach- or parent-initiated), lesson rescheduled (coach- or parent-initiated).

**Out:** Coach notifications, parent reminders, SMS, web push, marketing email, in-app notification center, email digests. These may share the outbox later; this plan does not design for them.

**Auto-approve special case:** When `POST /lessons` returns a lesson in `status='approved'` because the household's auto-approval rule fired (ADR 021), the household gets **only** the confirmed email — never a request-received email on top of it. The outbox-write logic branches on `inserted.status` and writes exactly one row.

**Parent-initiated changes to a shared household's lessons:** The email always goes to every owner + manager of the lesson's household, including the actor. "Parent-initiated changes also email the household" is a natural consequence of the recipient rule — not a separate code path.

---

## Data model changes

### New table — `lesson_email_outbox`

The transactional outbox. One row per email event per lesson. Written inside the lesson's `db.transaction()`; drained by a sender that runs after commit and by `POST /internal/cron/tick`. See ADR 028.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | PK |
| `lesson_id` | `uuid` | no | — | FK → `lessons.id` (`ON DELETE RESTRICT`). Lessons are never hard-deleted (see `lessons.status='canceled'` state), so RESTRICT is safe and preserves the audit trail. |
| `event` | `text` | no | — | CHECK: `'booking_requested' \| 'lesson_confirmed' \| 'request_declined' \| 'request_expired' \| 'lesson_canceled' \| 'lesson_rescheduled'`. One value per state transition. |
| `sequence` | `integer` | no | — | Per-`(lesson_id, event)` occurrence counter — 1 for the first `lesson_rescheduled` on this lesson, 2 for the next, etc. Written by selecting `coalesce(max(sequence), 0) + 1` inside the same transaction. The `(lesson_id, event, sequence)` triple is the row's natural key and the only guarantee against double-send on retry. |
| `recipient_profile_ids` | `uuid[]` | no | — | Snapshot of the household's owner + manager profile ids at the moment the row was written. Snapshotting the ids (not the emails) means a parent who changes their verified email between write and send receives the email at the current address, while a profile that is removed from the household between write and send still gets the email about the lesson they used to co-own — this is the behavior we want. Email verification is re-checked at send time (profiles with no verified email at that moment are skipped). |
| `ics_method` | `text` | yes | — | `'REQUEST'`, `'CANCEL'`, or NULL. NULL means "attach no `.ics`" — used for `booking_requested`, `request_declined`-without-prior-invite, `request_expired`-without-prior-invite. Set at write time from the lesson's state so it's frozen alongside the payload. |
| `ics_sequence` | `integer` | yes | — | Value to put in the `.ics` `SEQUENCE:` field. Snapshot of `lessons.calendar_sequence` at write time. Null when `ics_method` is null. |
| `payload` | `jsonb` | no | — | Frozen render inputs: swimmer first names, LA-formatted date + time, location name + address (whole address OK for home pools — the email only goes to that household), deep link to `/dashboard/lessons/:id`, previous `starts_at` for reschedule, decline reason if present, who initiated the change (`'coach'` or `'parent'`). Freezing means a later edit on the lesson row never retroactively repaints a scheduled email. |
| `status` | `text` | no | `'pending'` | CHECK: `'pending' \| 'sending' \| 'sent' \| 'failed' \| 'skipped' \| 'superseded'`. `'sending'` is the claimed-but-not-yet-finished state (see "Claim before sending" below). `'skipped'` means the sender resolved zero deliverable recipients at send time — i.e. no profile in `recipient_profile_ids` had both `email` and `email_verified_at` set. `'superseded'` is a terminal "do not send" state applied by the pre-send guard when a newer outbox row for the same lesson has already shipped or the lesson's start time is in the past. `'sent'`, `'skipped'`, and `'superseded'` are terminal; `'pending'`, `'sending'` (if its claim has expired), and `'failed'` are picked up by the drain. |
| `attempts` | `integer` | no | `0` | Increments on every sender attempt that reaches the transport call. Capped only by patience: the drain keeps trying while backoff allows. |
| `claimed_until` | `timestamptz` | yes | — | Non-null only while the row is `status='sending'`. Set to `now() + interval '2 minutes'` when the sender claims the row; the drain treats any `'sending'` row whose claim has expired as recoverable (another sender crashed mid-send) and re-claims it. Cleared when the row transitions to a terminal state. |
| `last_error` | `text` | yes | — | Short error summary (transport status + reason). Never includes email bodies, names, or addresses so logs stay clean per `docs/accounts.md`. |
| `last_attempt_at` | `timestamptz` | yes | — | Set on every attempt. |
| `next_attempt_at` | `timestamptz` | no | `now()` | Backoff schedule for retries. On failure the sender sets this to `now() + min(2^attempts, 30) minutes`. The cron drains any row where `status IN ('pending','failed')` or (`status='sending'` AND `claimed_until < now()`), and `next_attempt_at < now()`. |
| `sent_at` | `timestamptz` | yes | — | Set exactly once on first 2xx. |
| `provider_message_id` | `text` | yes | — | Resend's returned id. Null when SMTP transport (Mailpit) is in use. For audit only; no webhook ingestion in v1. |
| `created_at`, `updated_at` | `timestamptz` | no | `now()` | Standard; `$onUpdateFn`. |

Constraints and indexes:
- `UNIQUE (lesson_id, event, sequence)` — the dedup key.
- CHECK constraint on `event`.
- CHECK constraint on `status`.
- CHECK: `(ics_method IS NULL) = (ics_sequence IS NULL)` — paired nullability.
- CHECK: `(status = 'sending') = (claimed_until IS NOT NULL)` — the claim timestamp is paired with the state.
- Partial index on `(next_attempt_at)` `WHERE status IN ('pending', 'failed', 'sending')` — the drain's hot path (`'sending'` rows with expired claims are candidates too).
- Index on `(lesson_id, created_at desc)` — debugging the full timeline of emails for one lesson.

RLS: `.enableRLS()` with no policies (API-only).

### Lessons table — new columns

Added to `lessons` in the same migration:

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `calendar_sequence` | `integer` | no | `0` | **The next `.ics` `SEQUENCE:` value to issue** for this lesson, per RFC 5545. Starts at 0, so the first `REQUEST` ever issued carries `SEQUENCE:0`. Each outbox row with a non-null `ics_method` snapshots the current value into `ics_sequence` and then increments `calendar_sequence` by 1 — all inside the same lesson transaction. Preserved across state transitions, so a canceled-after-rescheduled lesson emits `CANCEL` with a strictly higher number than the preceding `REQUEST`. |
| `calendar_invite_sent_at` | `timestamptz` | yes | — | Set to `now()` the first time an outbox row with `ics_method='REQUEST'` is written. Used by the write logic to decide whether a cancel/decline/expire needs a `CANCEL` `.ics` (invite was previously issued) or nothing (invite never went out). Never cleared. |

The deterministic `.ics` UID is derived from the lesson id at render time (`${lesson.id}@axiomaquatics.io`) and does not need a column.

### Profiles table — new columns

Mirrors cached from `auth.users` so the API can resolve the household's recipient list without the service-role key. Written by the existing `on_auth_user_created` trigger (updated as part of this migration) and a new `on_auth_user_updated` trigger that fires on `UPDATE OF email, email_confirmed_at` and keeps the mirror in sync.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `email` | `text` | yes | — | Mirror of `auth.users.email`. Nullable because email can be absent on provisional accounts. |
| `email_verified_at` | `timestamptz` | yes | — | Mirror of `auth.users.email_confirmed_at`. The outbox sender resolves `recipient_profile_ids` → `profiles.email` where this is not null; profiles with no verified email are skipped with a log entry and don't flip the row to `failed`. |

Rationale (choice between service-role vs. mirror): added here instead of giving the API runtime a `SUPABASE_SERVICE_ROLE_KEY` because the mirror shrinks the API's privilege surface, lets the recipient lookup be a plain SQL join, and avoids a per-send round-trip to Supabase auth. The two columns are small, the triggers already exist for signup, and `email_change.html` + `confirmation.html` make Supabase emit the auth updates we need. The alternative is noted in open questions in case Jason prefers it.

### Migration

One Drizzle migration pair:

1. `pnpm db:generate --name=parent_booking_emails` — adds the `lesson_email_outbox` table (with CHECKs and the two unique/partial indexes), the two new `lessons` columns, and the two new `profiles` columns.
2. `pnpm db:generate --custom --name=profile_email_mirror_triggers` — custom SQL. Updates the existing `on_auth_user_created` function to populate `profiles.email` + `profiles.email_verified_at` from `NEW.email` and `NEW.email_confirmed_at`. Adds `on_auth_user_updated` trigger on `auth.users` that mirrors both fields on `UPDATE OF email, email_confirmed_at`. Backfills existing rows: `UPDATE profiles SET email = u.email, email_verified_at = u.email_confirmed_at FROM auth.users u WHERE u.id = profiles.id`.

Both migrations target the Drizzle snapshot; only `profile_email_mirror_triggers` has hand-authored SQL in the file. Document whether each was applied locally in the PR description per CLAUDE.md's rule.

`docs/data-model.md` gets a new `### lesson_email_outbox` section (placed after `### coach_audit_log`), an addendum to `### lessons` listing `calendar_sequence` and `calendar_invite_sent_at`, and two new rows in the `### profiles` table.

---

## Shared Zod schemas

Email delivery is server-only — no new HTTP routes are added for this feature. The outbox table is written and drained entirely inside the API. There is **no new shared Zod schema**; the existing lesson schemas already carry everything a parent sees on the web side (the deep link in each email just points at `/dashboard/lessons/:id` on the web app).

Internal API types for the outbox row and the payload shape live under `apps/api/src/services/emails/types.ts` and are **not** exported through `@swim-app/shared`.

---

## Where outbox rows are written

The same set of lesson-change paths that `syncLessonToGoogle` already hooks (ADR 027) is where outbox rows are written. Each listed site writes exactly one `lesson_email_outbox` row **inside** the same `db.transaction()` that performs the state change, following CLAUDE.md's audit-log rule verbatim. No code outside the transaction writes to the outbox.

| # | Trigger | File:line (today) | Transaction effect | Outbox row written |
|---|---|---|---|---|
| 1 | Parent submits booking (pending) | `lessons.ts:569` (`POST /lessons`) | `INSERT lessons … status='pending'` | `event='booking_requested'`, `ics_method=NULL` |
| 1' | Parent submits booking (auto-approved) | same path, when `needsApproval=false` | `INSERT lessons … status='approved', approvedAt=now()` | `event='lesson_confirmed'`, `ics_method='REQUEST'`, `ics_sequence=0` (snapshot of `calendar_sequence`), then `calendar_sequence` bumps `0 → 1`, `calendar_invite_sent_at=now()`. **No `booking_requested` row.** |
| 2 | Coach approves | `coachLessons.ts:541` (`PATCH /coach/lessons/:id/approve`) | `UPDATE lessons SET status='approved', approvedAt=now(), approvedBy=:coachId` | `event='lesson_confirmed'`, `ics_method='REQUEST'`, snapshots `calendar_sequence` into `ics_sequence` then increments the lesson counter, sets `calendar_invite_sent_at` if null |
| 3 | Coach declines | `coachLessons.ts:606` (`PATCH /coach/lessons/:id/decline`) | `UPDATE lessons SET status='declined', declinedAt=now(), declinedBy, declineReason` | `event='request_declined'`. `ics_method='CANCEL'` iff `calendar_invite_sent_at IS NOT NULL`, else NULL. If CANCEL, snapshots then increments `calendar_sequence`. |
| 4 | Parent or coach reschedule | `lessons.ts:789` (`PATCH /lessons/:id`) | `UPDATE lessons SET starts_at=…, movedAt=now(), previousStartsAt=…` (possibly also `status: approved → pending` under re-approval rules; see note) | `event='lesson_rescheduled'`, `ics_method` set per rules below, snapshot-then-increment `calendar_sequence` if the method is non-null |
| 5 | Parent or coach cancel | `lessons.ts:789` (`DELETE /lessons/:id`) | `UPDATE lessons SET status='canceled', canceledAt=now(), canceledBy` | `event='lesson_canceled'`. Same CANCEL-iff-prior-invite logic as decline. |
| 6a | Cron tick expiry pass | `internal.ts:57` (`POST /internal/cron/tick`) | `UPDATE lessons SET status='expired' WHERE status='pending' AND expiresAt < now()` RETURNING ids | For each returned id, same transaction inserts `event='request_expired'` with the CANCEL-iff-prior-invite rule |
| 6b | Lazy expiry safety net | `coachLessons.ts:452` (`GET /coach/lessons`) | Same `UPDATE lessons SET status='expired'` idiom | Same outbox row as 6a. Both paths route through the same `expireLessonsAndEnqueueEmails(tx)` helper to keep behavior aligned. |
| 7 | Cron auto-complete | `internal.ts:69` (same tick) | `UPDATE lessons SET status='completed', completedAt=now()` | **No outbox row.** Parents don't receive a "lesson completed" email in v1 (out of scope, per Overview). |

**Reschedule `ics_method` rules (path 4):**
- Lesson was `approved` and stays `approved` (coach reschedule, or parent-under-trust auto-reapprove) → `METHOD:REQUEST`, snapshot-then-increment `calendar_sequence`.
- Lesson was `approved` and transitions to `pending` because the parent reschedule moved it to a location without prior trust → emit **two** rows: a `lesson_canceled`-equivalent `METHOD:CANCEL` for the old approved slot (so the invite comes out of their calendar) **and** a `booking_requested` with `ics_method=NULL` for the new pending slot. Wrapping both inserts in the lesson's transaction is cheap. (Decision: this is the behavior we're shipping; the one-row `lesson_rescheduled` with `CANCEL` alternative was considered and rejected because it leaves the parent confused about why their newly-rescheduled booking is pending.)
- Lesson was `pending` and stays `pending` → `ics_method=NULL`, just a plain content email with the new slot.

**Transactional guarantees for every row above:**
- The outbox insert is in the same `tx` as the `UPDATE lessons` or `INSERT lessons`.
- Reading `coalesce(max(sequence), 0) + 1` into `sequence` inside the transaction holds a row lock on prior rows via the `(lesson_id, event)` partial index, so two concurrent writers can't both get sequence `N`.
- Recipient resolution runs in the same transaction: `SELECT profile_id FROM household_members WHERE household_id = :h AND role IN ('owner','manager')`. Snapshotting the ids here means a membership change between the insert and the sender run doesn't retarget the email.
- No HTTP, no email render, no transport call happens inside the transaction. The sender is scheduled with `queueMicrotask` after `res.json()` returns, exactly like the Google sync hook from ADR 027.

### The sender invocation point

Each lesson route, immediately after its final response write, schedules the sender for every outbox id it just inserted:

```ts
res.json(responseBody);
queueMicrotask(() => { void sendLessonEmailOutboxRow(outboxId); });
```

This mirrors the ADR 027 pattern and keeps the booking response fast even on transient Resend latency. The microtask swallows its own rejections; the row stays in `status='pending'` and the next cron tick drains it. No sender call runs inside the request's own lifecycle in a way that could affect the HTTP response.

---

## Sender and retry design

### `sendLessonEmailOutboxRow(outboxId: string): Promise<void>`

Single entry point used by both the post-commit microtask and the cron drain. The function **claims** the row before sending, releases the DB lock during the transport call, and finalizes the row to a terminal state (or back to `'failed'`) in a short second transaction. It never throws — any error is caught and recorded on the row.

**Flow:**

1. **Claim.** Inside a short transaction, run

   ```sql
   SELECT * FROM lesson_email_outbox
   WHERE id = :outboxId
     AND (
       status IN ('pending', 'failed')
       OR (status = 'sending' AND claimed_until < now())
     )
   FOR UPDATE SKIP LOCKED
   ```

   If no row is returned, the function logs and returns — another worker owns a valid claim, or the row has already reached a terminal state (`sent`, `skipped`, `superseded`). Otherwise, `UPDATE lesson_email_outbox SET status='sending', claimed_until = now() + interval '2 minutes', last_attempt_at = now()` and commit. The 2-minute claim covers both p99 Resend latency (~5s) and a crashed sender: an expired claim is a recoverable signal, not an error.

2. **Pre-send guard — supersede check.** After the claim, run a short read-only check and flip to `'superseded'` (terminal) if either is true:

   - **Newer outbox row already sent.** `EXISTS (SELECT 1 FROM lesson_email_outbox WHERE lesson_id = :lessonId AND sent_at IS NOT NULL AND created_at > :thisRow.created_at)`. The follow-up event already told the parent the current state; sending the stale one would be noise or an outright contradiction (e.g. a confirmed email arriving after the lesson was canceled).
   - **Lesson has already started.** `lessons.starts_at < now()`. In-flight emails for lessons that already began are stale. **Exemption:** rows with `ics_method = 'CANCEL'` **are allowed to send past start time** because their job is to clean a stale invite out of the parent's calendar, and a late CANCEL is still correct behavior — this exemption applies only when the pre-send guard would otherwise supersede; CANCEL rows still obey the "newer row already sent" rule.

   If either condition flips the row, `UPDATE … SET status='superseded', claimed_until=NULL, last_error='superseded:<reason>'` and return. Supersede is terminal — no retry.

3. **Resolve recipients.** `SELECT email FROM profiles WHERE id = ANY(:recipient_profile_ids) AND email IS NOT NULL AND email_verified_at IS NOT NULL`. If the resolved list is empty → `status='skipped'`, `claimed_until=NULL`, `last_error='no_deliverable_recipients'`, commit, return. (`'skipped'` is terminal.)

4. **Render.** React Email → `{ subject, html, text }`. Build the `.ics` body from `payload` + `ics_method` + `ics_sequence`.

5. **Send.** Call the configured transport outside any DB transaction so a slow Resend response does not hold the row lock. Pass the outbox id as Resend's idempotency key (`Idempotency-Key: <outboxId>`) — Resend's API honors this header to make a retry of the same send a no-op on their side, so the only duplicate-send window shrinks to "Resend accepted but our result write failed" (handled by the supersede guard on the next attempt).

6. **Finalize.** Open a short second transaction, re-read the row (defensive — the claim might have expired during a long transport call), and:

   - **On 2xx:** `UPDATE lesson_email_outbox SET status='sent', sent_at=now(), attempts=attempts+1, last_error=NULL, provider_message_id=:resendId, claimed_until=NULL WHERE id=:outboxId`.
   - **On failure:** `UPDATE … SET status='failed', attempts=attempts+1, last_error=:summary, next_attempt_at=now() + interval 'N minutes', claimed_until=NULL` where N = `min(2^attempts, 30)`. The row re-queues itself for the next tick.

**Why claim first.** The user-facing requirement is "retries never double-send." The dedup key `(lesson_id, event, sequence)` only prevents duplicate rows; it does not prevent two senders from racing to deliver the same row. The claim is what prevents the race. `FOR UPDATE SKIP LOCKED` plus `status='sending'` + `claimed_until` means: at most one worker can be in step 5 for a given outbox id at a time, and a crashed worker's claim becomes recoverable at `claimed_until`. The post-commit microtask and the cron tick can both target the same row with no coordination; whichever claims first does the work, the other no-ops.

### Retry classification

The transport layer returns a tagged error. The finalize step (6) uses it to decide whether to re-queue:

| Outcome | What happens |
|---|---|
| 2xx from transport | `status='sent'`, terminal. |
| Resend 4xx `validation_error` on `from` / `to` / body shape | `status='failed'`, re-queued with backoff. These are config bugs and will fail again until the underlying fix lands; the drain keeps trying so a code or env fix auto-recovers in-flight rows. |
| Resend 429 (rate limit) | `status='failed'`, re-queued. Backoff doubles so repeated 429s don't hammer. |
| Resend 5xx | `status='failed'`, re-queued. Same backoff. |
| SMTP connection error (Mailpit down locally) | `status='failed'`, re-queued. Treated as transient. |
| Unexpected exception inside the sender | caught at the top of the function, row updated the same as a transport failure with `last_error='unexpected: …'`. The claim is released so the row doesn't sit in `'sending'` until the 2-minute timeout. |
| Pre-send guard supersede | `status='superseded'`, terminal (step 2). |
| Zero deliverable recipients (no profile in the household has `email_verified_at` set) | `status='skipped'`, terminal. The row never flips to `'failed'` just because no household member has verified their email yet. |

No cap on attempts; the row keeps retrying every tick until it succeeds, supersedes, or is retention-purged. The failed-row dashboard query is `WHERE status='failed' AND attempts > 10`; if that count ever grows the on-call runs manual triage.

### Where the cron drains the outbox

Extends `POST /internal/cron/tick` (`apps/api/src/routes/internal.ts`):

```ts
// After the existing expire / auto-complete / Google-sync blocks:
const rows = await db
  .select({ id: lessonEmailOutbox.id })
  .from(lessonEmailOutbox)
  .where(
    and(
      or(
        inArray(lessonEmailOutbox.status, ["pending", "failed"]),
        and(
          eq(lessonEmailOutbox.status, "sending"),
          lt(lessonEmailOutbox.claimedUntil, now),
        ),
      ),
      lt(lessonEmailOutbox.nextAttemptAt, now),
    ),
  )
  .orderBy(asc(lessonEmailOutbox.nextAttemptAt))
  .limit(50);
for (const row of rows) {
  await sendLessonEmailOutboxRow(row.id);
}
```

- **Sequential drain.** Each row is awaited before the next. Scheduling 50 microtasks at once would launch 50 concurrent Resend calls, blow through Resend's per-second rate limit on a busy tick, and interleave DB writes in a way that makes log correlation hard. Awaiting keeps throughput deterministic (Resend p50 ≈ 150 ms × 50 rows ≈ 7–10 s per tick in steady state) and preserves backpressure: if one row stalls, the batch slows gracefully instead of piling up concurrent transports.
- **Batch cap `50`** per tick (lowered from `100` because sequential sending caps throughput anyway, and a smaller batch leaves tick-time headroom for the other work already in `cron/tick`). The post-commit microtask handles the common case; the cron is only draining stragglers.
- The 2^attempts backoff (max 30 min) means a persistently failing transport doesn't retry every tick — the row's `next_attempt_at` holds it back.
- Expired-claim recovery falls out of the same WHERE clause: a crashed sender's `'sending'` row with `claimed_until < now()` is picked up on the next tick, re-claimed, and finalized.

No new worker, no queue, no dedicated schedule. Same operational pattern as the Google sync passes in ADR 027.

---

## `.ics` generation

A small helper in `apps/api/src/services/emails/ics.ts` builds the body. No new dependency — the `.ics` text format is simple enough to template:

```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Axiom Aquatics//Booking//EN
METHOD:REQUEST          ; or CANCEL
BEGIN:VEVENT
UID:{lesson.id}@axiomaquatics.io
SEQUENCE:{ics_sequence}
DTSTAMP:{nowUtc}
DTSTART;TZID=America/Los_Angeles:{startsAtLocalFloating}
DTEND;TZID=America/Los_Angeles:{endsAtLocalFloating}
SUMMARY:Swim lesson: {swimmer first names}
LOCATION:{address line}
DESCRIPTION:{deep link}
STATUS:{CONFIRMED or CANCELLED}
ORGANIZER;CN=Axiom Aquatics:MAILTO:lessons@send.axiomaquatics.io
END:VEVENT
END:VCALENDAR
```

Rules:
- **UID** is deterministic per lesson (`${lesson.id}@axiomaquatics.io`). Preserved across the lesson's whole lifecycle so Apple Mail / Google Calendar / Outlook correctly supersede a prior REQUEST with a later CANCEL.
- **SEQUENCE** monotonically increases per RFC 5545. The lesson's `calendar_sequence` column stores **the next value to issue**, defaulting to `0`. Each write snapshots the current value into the outbox row's `ics_sequence` and then increments the lesson counter, so the first REQUEST ships `SEQUENCE:0`, the first follow-up (reschedule or cancel) ships `SEQUENCE:1`, and so on.
- **METHOD:CANCEL** only fires when `calendar_invite_sent_at IS NOT NULL` on the lesson — i.e. a prior REQUEST was issued. Declined-from-pending or expired-from-pending (never confirmed) sends no `.ics` at all.
- **SUMMARY** is `Swim lesson: {first names}` or `Swim lesson: {first} & {first}` — intentionally identical to the coach's Google Calendar event titles (ADR 027) so a parent whose household also has coach-side visibility sees matching entries.
- **No "Add to Google Calendar" link.** The `.ics` attachment is the single calendar path. Google Calendar, Apple Calendar, Outlook, and Fastmail all parse `.ics` attachments natively; adding a parallel deep link would double the surface for templating bugs and leak the lesson's address into a URL that lives in browser history. Removed.
- Home-pool addresses go into `LOCATION` in full (street + city + state + zip). The email only goes to that household — the privacy carve-out that keeps ADR 027 from sending home-pool addresses to Google doesn't apply here: nothing crosses a third-party processor boundary other than Resend's transport (which handles the whole email body in transit regardless).

---

## Email content

All times are formatted in `America/Los_Angeles` with `date-fns-tz` (already in the repo). All emails:

- Use `From: Axiom Aquatics <lessons@send.axiomaquatics.io>` configured by `EMAIL_FROM`. `send.axiomaquatics.io` is already verified in Resend for Supabase auth email, so no new domain setup is required.
- Set `Reply-To: jason@axiomaquatics.io` via `EMAIL_REPLY_TO` so parents reply straight to the coach.
- Include the `axiom-aquatics-lockup.png` from `apps/web/public/logos/` as the header image, served from `${SITE_URL}/logos/axiom-aquatics-lockup.png` for Gmail/Outlook caching and attached as a `cid:` fallback for Apple Mail dark mode.
- End with a two-line footer: coach name + reply-to prompt, then a plain `View this lesson in the app` link to `${SITE_URL}/dashboard/lessons/:id` (also inlined as a prominent button near the top).
- Carry **no marketing content, no tracking pixels, no third-party click-tracking**. Resend's open- and click-tracking are disabled per-request in the API call. `List-Unsubscribe` is **not** set — decision below under Open questions, resolved: these are transactional messages tied to a change the parent initiated or needs to see, not a mailing list, and adding an unsubscribe surface would require an inbox owner for the resulting replies.
- Have a plain-text alternative generated by React Email's `render(..., { plainText: true })`.
- Never include a swimmer's last name, birth date, or notes.
- Subjects, headlines, and body copy do not use em dashes. Use a colon, comma, or period.

Each email's subject and body outline:

### 1. `booking_requested` — "We got your booking request"

**Subject:** `Request received: {dayAbbrev}, {monthAbbrev} {day}, {time}` (e.g. `Request received: Sat, Nov 1, 10:30 AM`)

**Body outline:**
- Headline: "We got your request."
- One paragraph: Thanks {parentFirstName if available else "there"}. Jason will review and get back to you soon. If this is your household's first time booking at **{locationName}**, approval can take up to 16 hours. If we don't confirm by **{expiresAt in LA, e.g. "Fri 6:30 PM"}**, this request will expire and you'll need to book again.
- Lesson summary card: swimmer first name(s), **{weekday, Month D} at {time}**, location name only (no address until approved).
- Primary button: "View request"
- No `.ics`.

### 2. `lesson_confirmed` — "Your lesson is booked"

**Subject:** `Lesson confirmed: {dayAbbrev}, {monthAbbrev} {day}, {time}`

**Body outline:**
- Headline: "You're on the schedule."
- Paragraph: Confirmed for {swimmer first names} on **{weekday, Month D} at {time}** at **{locationName}**. The invite is attached. Tap it to add this lesson to your calendar.
- Lesson summary card with address (full street for home pools; name + city for named pools so the parent can map it).
- Primary button: "View lesson in app"
- Attachment: `invite.ics` with `METHOD:REQUEST`, `SEQUENCE:{ics_sequence}` (snapshot taken at outbox-write time; first invite ships `SEQUENCE:0`).

### 3. `request_declined` — "Your request wasn't booked"

**Subject:** `Request not booked: {dayAbbrev}, {monthAbbrev} {day}, {time}`

**Body outline:**
- Headline: "This request wasn't booked."
- Paragraph: Jason wasn't able to confirm this one{if declineReason: `: {declineReason}`}. You're welcome to try another slot. Availability updates in real time in the app.
- Lesson summary card (same slot shown).
- Primary button: "Browse open slots"
- If a prior invite existed: attach `cancel.ics` with `METHOD:CANCEL`, same UID, `SEQUENCE:{ics_sequence}` so the preview invite is removed from Gmail's calendar hints. Not expected under today's state machine (decline only from pending), but the code handles it defensively.

### 4. `request_expired` — "Your request expired"

**Subject:** `Request expired: {dayAbbrev}, {monthAbbrev} {day}, {time}`

**Body outline:**
- Headline: "This request expired."
- Paragraph: Requests expire 16 hours before the lesson's start time if Jason hasn't gotten to them. The slot is open again. Grab it or pick another in the app.
- Lesson summary card.
- Primary button: "Book another slot"
- `.ics` only if a prior invite was sent (same defensive logic as decline).

### 5. `lesson_canceled` — "Your lesson is canceled"

**Subject:** `Lesson canceled: {dayAbbrev}, {monthAbbrev} {day}, {time}`

**Body outline:**
- Headline: "This lesson was canceled."
- Paragraph:
  - If `canceled_by` is a coach profile: "Jason canceled this lesson. If you'd like to rebook, availability is open in the app."
  - If `canceled_by` is a household member profile: "{actorFirstName if known else 'A household member'} canceled this lesson. If this was a mistake, please book again. The slot may still be open."
- Lesson summary card.
- Primary button: "Book another slot"
- Attachment: `cancel.ics` with `METHOD:CANCEL`, same UID, `SEQUENCE:{ics_sequence}`, only when the lesson had a prior REQUEST. For a never-confirmed pending booking that gets canceled, no `.ics`.

### 6. `lesson_rescheduled` — "Your lesson moved"

**Subject:** `Lesson rescheduled: {dayAbbrev}, {monthAbbrev} {day}, {time}` (reflects **new** time)

**Body outline:**
- Headline: "This lesson moved."
- Paragraph:
  - If coach-initiated: "Jason moved this lesson."
  - If parent-initiated: "{actorFirstName if known else 'A household member'} rescheduled this lesson. Everyone in your household is getting this email so your calendars stay in sync."
- Before/after block: **Was**: {old weekday, Month D at time} → **Now**: {new weekday, Month D at time}. Same location.
- Lesson summary card at the new time.
- Primary button: "View lesson in app"
- Attachment: `invite.ics` with `METHOD:REQUEST`, bumped `SEQUENCE`. Calendars that supported the original invite replace it in place.

### Template library

**React Email**, picked over hand-rolled HTML tables because:
- Typed components make it hard to accidentally break Outlook with a stray CSS property. Every template is `.tsx` with props inferred from the outbox `payload` shape.
- `render()` produces both HTML and plain-text in one call, no second template to drift.
- The library ships with a preview server (`react-email dev`) that renders every template in a browser frame with Gmail / Outlook / Apple Mail profiles. Covers the "must render well in" requirement with no manual QA.
- Supports Tailwind-flavored classes via `@react-email/tailwind`, with the brand tokens from `axiom-aquatics-design` ported into a minimal email-side theme (we don't share CSS modules — emails have no runtime).
- Vendor lock-in is low: templates compile to vanilla inline-styled HTML that any transport can send, so swapping Resend for Postmark later is a transport-layer change only.

File layout: `apps/api/src/services/emails/templates/<Event>.tsx` — one component per event — plus a `shared/` directory for the layout wrapper, header, lesson card, and button components. One `renderEmail(payload)` entry point in `apps/api/src/services/emails/render.ts` dispatches on `event` and returns `{ subject, html, text, icalBody? }`.

---

## Environment variables

Added to `apps/api/src/lib/env.ts` `RawEnvSchema` and `ApiEnv`. The plan does not modify `.env` — the team updates `.env` and the Railway variable set during implementation using the keys below.

### `APP_ENV` — explicit environment, not derived from `NODE_ENV`

`apps/api/src/lib/env.ts` today gates its stricter prod-only validations on `NODE_ENV === "production"`. That worked when "production" meant "live prod only," but the Railway dev service also runs `NODE_ENV=production` by convention — Railway sets it that way to get the production flavor of the Node runtime and of library builds, not as a signal about which deployment this is. We need the sender to know whether the deployment is dev or prod (for future per-env policy) separately from the Node build mode.

Introduce an explicit **`APP_ENV`** var with values `local` | `dev` | `prod`. Every piece of email behavior is keyed on `APP_ENV`, not `NODE_ENV`. `NODE_ENV` continues to drive the Node/library build flavor and nothing else. The migration plan for `env.ts`:

- Add `APP_ENV: z.enum(["local", "dev", "prod"]).default("local")` to `RawEnvSchema`.
- Replace every `parsed.NODE_ENV === "production"` branch in `env.ts` with the appropriate `parsed.APP_ENV === "prod"` or `APP_ENV !== "local"` check, carrying the same validations (`CORS_ORIGINS`, `SITE_URL` localhost check, `CRON_SECRET` ≥ 32 chars, Google OAuth required) across. This is purely a semantic rename — the existing prod-only checks still fire for `APP_ENV=prod`, and we extend them to `APP_ENV=dev` where the dev deploy should enforce them too.
- Set `APP_ENV=dev` in Railway's dev service, `APP_ENV=prod` in Railway's prod service, and leave it unset locally (defaults to `local`).

### Email vars

| Var | Required in… | Example | Notes |
|---|---|---|---|
| `APP_ENV` | always | `local` \| `dev` \| `prod` | See above. Drives every environment-sensitive branch in `env.ts`. |
| `EMAIL_TRANSPORT` | always | `resend` \| `smtp` | Picks the transport. Default when `APP_ENV=local`: `smtp`. Default when `APP_ENV` ∈ {`dev`, `prod`}: `resend`. |
| `EMAIL_FROM` | always | `Axiom Aquatics <lessons@send.axiomaquatics.io>` | RFC 5322 address. `send.axiomaquatics.io` is already verified in Resend for Supabase auth email, so dev and prod share this sending domain for now (resolves the former "Resend domain + DKIM/SPF" open question). Validated at parse time. |
| `EMAIL_REPLY_TO` | optional | `jason@axiomaquatics.io` | Omitted → no Reply-To header. |
| `RESEND_API_KEY` | `APP_ENV` ∈ {`dev`, `prod`} | `re_…` | Required when `EMAIL_TRANSPORT=resend`. |
| `EMAIL_SMTP_HOST` | `APP_ENV=local`, `test` | `127.0.0.1` | Required when `EMAIL_TRANSPORT=smtp`. |
| `EMAIL_SMTP_PORT` | `APP_ENV=local`, `test` | `54325` | Required when `EMAIL_TRANSPORT=smtp`. Supabase Mailpit's SMTP listener is disabled by default; we uncomment `smtp_port = 54325` in `supabase/config.toml` as part of the implementation PR. |

The sender does **not** carry a recipient allowlist. On dev and prod the only gate between an outbox row and a send is `profiles.email_verified_at` being non-null — a parent has to have confirmed their email with Supabase before any booking email reaches them. Local goes to Mailpit regardless.

### Validation rules in `env.ts`

- Always: `EMAIL_FROM` must parse as an RFC 5322 address.
- `APP_ENV=prod`:
  - `EMAIL_TRANSPORT=resend` required.
  - `RESEND_API_KEY` present and starts with `re_`.
  - `EMAIL_FROM` must use the `send.axiomaquatics.io` domain (or any explicitly verified prod domain, enforced via a simple suffix check).
- `APP_ENV=dev`:
  - `EMAIL_TRANSPORT=resend` required.
  - `RESEND_API_KEY` present and starts with `re_`.
- `APP_ENV=local` and `test`: all three transport vars may be absent — the API still boots; sender logs a one-time warning and marks every row `status='skipped'` so writes don't accumulate.

---

## Logging

Per `docs/accounts.md`: "Never log names, birth dates, emails, or notes." Every sender log line uses:

- `lesson_id`, `outbox_id`, `event`, `attempts`, `transport`, `provider_message_id`, `last_error` (short, no PII).
- Recipient counts (`resolved_count`, `delivered_count`, `skipped_count`), not addresses.
- The .ics UID is derived from `lesson_id` and is already loggable.

The template render step runs through a `redactForLogs(payload)` helper if ever logged, which strips `swimmerFirstNames`, `locationAddress`, and `declineReason` before serialization. Tests assert the helper's output.

---

## Audit log

Email events are **not** written to `coach_audit_log` or `household_audit_log` in v1. The outbox row's `status`, `attempts`, `last_error`, and `sent_at` are the audit trail — they capture the full lifecycle inline. Rationale: an audit row and an outbox row would carry the same information and would need to stay in lockstep, which doubles the write surface for no new signal. If we later surface delivery history to parents in-app, we can either read the outbox directly (same shape as `household_audit_log` queries) or add an audit row at that point.

---

## Retention

The outbox grows indefinitely without a cleanup pass. Payloads contain swimmer first names and (for home-pool lessons) full residential addresses, which should not sit in Postgres forever once the delivery is done. Two mechanisms, both bounded.

### 1. Payload scrub, cron-driven, 30 days post-terminal

Extend `POST /internal/cron/tick` with a scrub pass that runs at the end of each tick (after the email drain). Target rows:

```sql
UPDATE lesson_email_outbox
SET payload = jsonb_build_object('_scrubbed_at', now())
WHERE status IN ('sent', 'skipped', 'superseded')
  AND coalesce(sent_at, last_attempt_at, updated_at) < now() - interval '30 days'
  AND payload ? 'swimmerFirstNames'   -- idempotent guard: do not re-scrub
LIMIT 500;
```

- The row's `status`, `attempts`, `provider_message_id`, `sent_at`, and timestamps are preserved as the auditable trail. Only `payload` is scrubbed — the PII-bearing bit.
- 30 days was chosen to give a reasonable debugging window (parent reports "I never got the email about my Nov lesson" is still answerable from the row's structured fields and the Resend dashboard id), while keeping the retention tight enough that an unreviewed data-request complaint doesn't surface 6-month-old addresses.
- `'failed'` rows and `'pending'`/`'sending'` rows are **not** scrubbed — they need their payload to retry.
- Idempotent via the `payload ? 'swimmerFirstNames'` guard. A scrubbed row's payload is just the scrub timestamp.
- Capped at 500 rows per tick to avoid long transactions during normal operation. A one-time backfill after launch is a trivial loop over the same statement.

### 2. Account deletion must clear household outbox rows

Parent account deletion (the full flow is out of scope today per `docs/accounts.md` — profiles are `disabled_at`-scrubbed in v1, not hard-deleted) must, when it lands, delete outbox rows for every lesson whose household the deleted profile owned. The implementation plan:

- If the account's household is being deleted entirely (owner closes account with no transfer): `DELETE FROM lesson_email_outbox WHERE lesson_id IN (SELECT id FROM lessons WHERE household_id = :h)` inside the deletion transaction. Lessons are hard-deleted / archived through the same transaction regardless, so there's no residual FK pressure.
- If the profile is being scrubbed but the household persists (owner transfers, then leaves): no outbox cleanup is needed — the outbox is keyed by lesson, not by profile. `recipient_profile_ids` may still reference the leaving profile's id, but step 3 of the sender (recipient resolution via join on `profiles.email`) will filter them out once `profiles.email` is cleared by the scrub.

Document this requirement in `docs/accounts.md` once the full account-deletion flow is designed, so a future PR doesn't ship account deletion without also wiring the outbox cleanup. Tracking: open question flagged in the launch checklist.

---

## Test plan

### Unit (`pnpm test`)

Vitest, pure logic, no DB. All email dispatch mocked at the transport boundary (`vi.mock("resend")` for Resend; a stub SMTP client for SMTP). New files under `apps/api/src/services/emails/__tests__/`:

- `ics.test.ts`
  - REQUEST body round-trips through `ical-parser` and matches expected fields.
  - **First REQUEST ships `SEQUENCE:0`.** Second (reschedule) ships `SEQUENCE:1`. CANCEL on the same lesson ships `SEQUENCE:2`.
  - CANCEL body preserves UID, sets `STATUS:CANCELLED`.
  - LA timezone encoded with `TZID=America/Los_Angeles`, not a numeric offset (fixes the Outlook render edge case).
  - SUMMARY matches `Swim lesson: <first names>` exactly — no em dash, matches ADR 027's title format.
- `render.test.ts`
  - Snapshot per template. Each snapshot asserts: subject format with no em dash, deep-link URL, lesson card contents, plain-text alternative length > 0, no `<script>` or `<style>` tag containing a selector (inline styles only), header image URL = `${SITE_URL}/logos/axiom-aquatics-lockup.png`, no `calendar.google.com` deep link anywhere in the HTML (regression guard for the removed "Add to Google Calendar" link).
  - Reschedule template renders both the before and after times when both are present.
  - Decline template with and without `declineReason`.
- `recipientResolution.test.ts`
  - Seeded profiles with mixed email verification states → only verified emails come back.
  - A household with no verified-email owners/managers → zero recipients → `status='skipped'`.
- `sender.test.ts`
  - Happy path: row goes `pending → sending → sent`, `provider_message_id` populated, `claimed_until` cleared.
  - 429 → `failed`, `next_attempt_at` set to backoff, `attempts++`, `claimed_until` cleared.
  - Repeated failures: backoff doubles up to 30 min cap.
  - Empty recipient list → `skipped`, terminal, `claimed_until` cleared.
  - **Supersede: lesson's `starts_at < now()`** on a `REQUEST` row → `superseded`, terminal, no transport call. Same guard on a `CANCEL` row still **sends** (the start-time exemption).
  - **Supersede: newer sent row** for same `lesson_id` → `superseded`, no transport call, regardless of `ics_method`.
  - Unexpected throw inside render → caught, row flipped to `failed` with `last_error='unexpected: …'`, `claimed_until` cleared, never bubbles.
  - **Expired-claim recovery:** seed a `'sending'` row with `claimed_until < now()`, run the drain, assert the row is re-claimed and finalized.
  - **Idempotency key to Resend:** assert the mocked `resend.emails.send` call received an `Idempotency-Key` header equal to the outbox id.
- `concurrencyParallelSend.test.ts` — a dedicated test file for the "retries never double-send" guarantee:
  - Seed one `'pending'` outbox row. Call `sendLessonEmailOutboxRow(id)` and the cron drain's row loop **in parallel** via `Promise.all` with the real Postgres backing (uses the test DB, not a mock). Mock the Resend transport. Assert the transport was called **exactly once**, the row ends `'sent'`, and the second parallel call observed either the `FOR UPDATE SKIP LOCKED` miss or the terminal-status short-circuit. Running the test under `--repeat 20` surfaces race-condition regressions.
- `outboxInsert.test.ts` (coverage for the helper that each lesson route calls)
  - `event + sequence` uniqueness: inserting the same event twice for one lesson produces sequence 1 and 2.
  - `ics_method` logic: `calendar_invite_sent_at=NULL` + cancel → NULL. `calendar_invite_sent_at != NULL` + cancel → CANCEL + snapshot-then-increment.
  - **First confirmed email writes `ics_sequence=0` and leaves `lessons.calendar_sequence=1`**. Second confirmed/rescheduled writes `ics_sequence=1`, leaves `calendar_sequence=2`. Explicitly asserts the "start at 0" semantics.
  - Confirmed email sets `calendar_invite_sent_at` only on the first REQUEST.
- `retention.test.ts`
  - Scrub pass: a `'sent'` row older than 30 days has its `payload` replaced with `{_scrubbed_at}`; status, timestamps, and `provider_message_id` untouched.
  - Scrub pass skips rows younger than 30 days.
  - Scrub pass skips `'failed'`/`'pending'`/`'sending'` rows regardless of age.
  - Scrub pass is idempotent (second run does not re-scrub or clobber `_scrubbed_at`).
- Env parsing (`env.test.ts`, extend existing)
  - `APP_ENV=prod` + `EMAIL_TRANSPORT=resend` + missing `RESEND_API_KEY` → parse error.
  - `APP_ENV=dev` + missing `RESEND_API_KEY` → parse error.
  - `APP_ENV=local` with no email vars → parse succeeds, sender uses `skipped` fallback.
  - `APP_ENV=prod` + `EMAIL_FROM` not using `send.axiomaquatics.io` → parse error.

### Integration (`pnpm test:integration`)

Vitest integration config, live local Supabase, transport mocked at the module boundary. Shared `mockEmailTransport()` helper under `apps/api/src/__tests__/integration/helpers/`.

New file `parentBookingEmails.integration.test.ts`:
- Booking request (first lesson at a pool) → outbox row with `event='booking_requested'`, `ics_method=NULL`, status flips to `sent` after the cron tick drain.
- Auto-approved booking (second lesson at same pool) → exactly one outbox row with `event='lesson_confirmed'`, `ics_method='REQUEST'`, `ics_sequence=0`, `lessons.calendar_sequence=1`, zero `booking_requested` rows.
- Coach approves pending → single `lesson_confirmed` row; `calendar_invite_sent_at` set; `ics_sequence=0`; `lessons.calendar_sequence=1`.
- Coach declines pending → `request_declined`, no `.ics`.
- Coach reschedules approved → `lesson_rescheduled` with `REQUEST`, `ics_sequence=1`, `lessons.calendar_sequence=2`.
- Parent cancels approved → `lesson_canceled` with `CANCEL`, `ics_sequence` is one greater than the last REQUEST.
- Parent reschedules pending → `lesson_rescheduled` with `ics_method=NULL`, no sequence bump.
- Cron expiry: seed a `pending` lesson with `expiresAt=yesterday`, run `POST /internal/cron/tick`, assert one `request_expired` row written in the same transaction (visible atomically — row exists iff status flipped).
- Lazy expiry safety net: trigger `GET /coach/lessons` with a stale pending lesson; same single `request_expired` row written. Not duplicated by a subsequent cron tick (the lesson is no longer `pending`).
- Recipient snapshot: write an outbox row, then remove a manager from the household, then run the sender — the removed manager still appears in `recipient_profile_ids`, is filtered out of the final send list by the verified-email join only if they still have a verified email, and the row delivers to the remainder.
- Membership snapshot the other way: add a new manager between write and send — the new manager is **not** emailed (snapshot was frozen at write).
- Dedup under retry: fail the first send, re-run the cron tick 3 times with the mock still failing, assert exactly 3 rows in the transport mock history for the same `outbox_id` and that each attempt carried the same `Idempotency-Key`.
- **Supersede by newer sent row:** approve a lesson (row A), stub a Resend 5xx so row A stays `pending`. Reschedule the same lesson (row B); let row B send successfully. Then drain the queue and assert row A flips to `superseded` instead of sending, and no `invite.ics` for the old slot ever leaves the transport.
- **Supersede by past start time:** seed an approved lesson with `starts_at = now() - 1 hour` and an outbox row with `ics_method='REQUEST'`. Drain → row is `superseded`, no transport call. Repeat with `ics_method='CANCEL'` → row **sends** (start-time exemption).
- Zero deliverable recipients: clear `profiles.email_verified_at` on the household's only member, write an outbox row, run the sender, assert `status='skipped'` and the transport was not called.
- Transaction atomicity: wrap `POST /coach/lessons/:id/approve` in a seam that forces the outbox INSERT to raise, assert the lesson row stayed `pending` (both the status update and the outbox insert rolled back together). This is the critical correctness test for the ADR.
- `.ics` UID / SEQUENCE across a full lifecycle: approve → reschedule → cancel. Assert exactly three outbox rows, the UID is identical and matches `<lesson id>@axiomaquatics.io`, `ics_sequence` values are `0, 1, 2`, methods are `REQUEST, REQUEST, CANCEL`, `lessons.calendar_sequence` ends at `3`.
- **Sequential drain cadence:** seed 10 pending rows, run `POST /internal/cron/tick` with a transport mock that records call-start timestamps. Assert that the drain's transport calls do not overlap (each start is after the previous end). Confirms the "await each" discipline over `Promise.all`.
- **Parallel sender + cron (real DB):** seed one pending row, invoke the post-commit sender and the drain's row loop in parallel. Assert the transport was called exactly once and the row ends `'sent'`.
- Retention scrub (integration): insert sent + skipped + superseded + failed rows at various ages, run the scrub pass, assert only `sent/skipped/superseded` + `>30 days` rows are scrubbed.
- No PII in logs: capture the pino log stream during a full send, assert no swimmer name, no address, no email address, no decline reason appears in any log line.

### Manual test — local Mailpit

Documented in `docs/plans/parent-booking-emails.md` (this file) and the PR description:

1. `pnpm db:up` → confirm Mailpit is reachable at `http://127.0.0.1:54324`. Uncomment `smtp_port = 54325` in `supabase/config.toml` and restart if not already done.
2. Set `.env.local` for the API: `APP_ENV=local`, `EMAIL_TRANSPORT=smtp`, `EMAIL_SMTP_HOST=127.0.0.1`, `EMAIL_SMTP_PORT=54325`, `EMAIL_FROM=Axiom Aquatics <lessons@send.axiomaquatics.io>`.
3. `pnpm dev`. Sign in as a seeded parent with `email_verified_at` set in `profiles`.
4. Submit a booking at a new location → confirm the `booking_requested` email appears in the Mailpit UI with the right subject and no `.ics`.
5. Approve as the coach → confirm the `lesson_confirmed` email arrives with `invite.ics` attached. Open the attachment in Apple Mail (macOS) or paste the body into an Outlook-compatible preview to confirm the invite installs.
6. Reschedule → the invite in the inbox client should update in place (same UID), not duplicate.
7. Cancel → `cancel.ics` arrives and removes the invite from the calendar app.
8. Decline from pending → no `.ics`.
9. Expire a pending lesson by setting `expires_at` to the past and hitting the cron with `curl -H "cron-secret: $CRON_SECRET" -XPOST http://localhost:3001/internal/cron/tick` → `request_expired` email appears.
10. Reschedule a parent-trusted booking → both household members receive the email (verify with a second seeded manager).

### Load / quota (manual, pre-launch)

Spot-check at the dev deploy: enqueue 50 outbox rows against a Resend sandbox API key and confirm all deliver without triggering the 100-row cron cap backlog. Expected total time < 30s given Resend's p95 latency. If it fails, raise the per-tick cap before adding workers.

---

## Open questions

- **Viewers as recipients?** The spec says owners + managers. Should viewer-role household members also receive booking emails for lessons on their household? Argument for: a viewer who's a secondary parent still needs to know the schedule. Argument against: viewers are read-only by design and may be grandparents / nannies who shouldn't get notification spam. The code is one line different either way (change the `role IN ('owner','manager')` filter). **Default in this plan: owners + managers only; expand on Jason's call.**
- **Mailpit SMTP port.** Supabase's `config.toml` leaves `smtp_port` commented out by default. We uncomment it to `54325` during implementation; the local port is otherwise unused. If a developer has that port taken by another service, we'd need an override, but no one on the team has reported a conflict, so no override is planned.

## Resolved decisions

- **Parent reschedule that falls out of trust (approved → pending).** Keep the two-row behavior: a `lesson_canceled`-style `CANCEL` for the old slot and a `booking_requested` for the new slot. The single-row alternative was rejected because a parent whose newly-rescheduled lesson shows up as pending without a cleanly removed prior invite is a worse UX than two emails that each tell a clear story.
- **Profiles email mirror vs. service-role lookup.** Keep the mirror. The service-role alternative expands the API runtime's privilege surface permanently for a transient need; the mirror is a one-time migration plus two trigger lines and keeps the recipient lookup a plain SQL join.
- **`List-Unsubscribe` header.** Not set. These are transactional messages tied to a change the parent initiated or needs to see, which exempts them from CAN-SPAM's unsubscribe requirement. Adding the header would also require a monitored inbox for replies to the unsubscribe mailto, which we don't have an owner for.
- **Resend sending domain.** Dev and prod share `send.axiomaquatics.io` (already verified in Resend for Supabase auth email). No separate dev subdomain for now. Revisit if the dev deploy's email volume ever threatens the shared domain's reputation.

---

## Non-goals (deliberately not wired)

- No in-app notification center. The outbox is the storage; parents see state in the app directly.
- No analytics hook on `sent_at`. Resend's dashboard is the delivery observability surface.
- No per-household per-event opt-outs. Transactional means transactional; the only way not to receive a booking email is to be removed from the household or lose email verification.
- No email templates in `apps/web`. Templates live in `apps/api` because that's where they're rendered. The web app has no runtime involvement in email delivery.
