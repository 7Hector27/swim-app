# Plan: Parent booking emails

**Status:** Planning
**Branch:** `feature/parent-booking-emails`
**ADR:** [028 — Parent booking emails via transactional outbox](../decisions/028-parent-booking-emails.md)

---

## Overview

Every state change on a booking that matters to a parent — request received, confirmed, declined, expired, canceled, rescheduled — produces one transactional email to the household's owners and managers. Delivery is decoupled from the booking write via an outbox table: the same `db.transaction()` that mutates the lesson inserts a `lesson_email_outbox` row. A sender fires right after commit for low-latency delivery, and the existing `POST /internal/cron/tick` drains failed or still-pending rows on every invocation. The outbox is the durability guarantee — nothing is sent inside the booking transaction, and nothing can be lost by a crash between commit and send.

Transport is Resend's API in dev and production, and SMTP to the local Supabase stack's Mailpit in `development`/`test`. A dev-only `EMAIL_ALLOWLIST` env var short-circuits any recipient not on the list so real inboxes stay quiet on the dev deploy. Confirmed and rescheduled emails attach an `.ics` invite (`METHOD:REQUEST`) with a deterministic UID per lesson and a monotonically increasing `SEQUENCE`; canceled, declined-after-approval, and expired-after-approval send `METHOD:CANCEL` with the same UID. Templates are built with React Email and ship as HTML + plain-text alternatives.

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
| `status` | `text` | no | `'pending'` | CHECK: `'pending' \| 'sent' \| 'failed' \| 'skipped'`. `'skipped'` means the sender resolved zero deliverable recipients (e.g. nobody has a verified email, or allowlist stripped the list to empty) — differs from `'failed'` so the cron doesn't retry what it can't deliver. |
| `attempts` | `integer` | no | `0` | Increments on every sender attempt. No cap — the cron keeps trying. |
| `last_error` | `text` | yes | — | Short error summary (API status + reason). Never includes email bodies, names, or addresses — logs stay clean per `docs/accounts.md`. |
| `last_attempt_at` | `timestamptz` | yes | — | Set on every attempt. |
| `next_attempt_at` | `timestamptz` | no | `now()` | Backoff schedule for retries. On failure the sender sets this to `now() + min(2^attempts, 30) minutes`. The cron drains any row where `status IN ('pending','failed')` and `next_attempt_at < now()`. |
| `sent_at` | `timestamptz` | yes | — | Set exactly once on first 2xx. |
| `provider_message_id` | `text` | yes | — | Resend's returned id. Null when SMTP transport (Mailpit) is in use. For audit only — no webhook ingestion in v1. |
| `created_at`, `updated_at` | `timestamptz` | no | `now()` | Standard; `$onUpdateFn`. |

Constraints and indexes:
- `UNIQUE (lesson_id, event, sequence)` — the dedup key.
- CHECK constraint on `event`.
- CHECK constraint on `status`.
- CHECK: `(ics_method IS NULL) = (ics_sequence IS NULL)` — paired nullability.
- Partial index: `WHERE status IN ('pending', 'failed')` on `(next_attempt_at)` — the cron drain's hot path.
- Index on `(lesson_id, created_at desc)` — debugging the full timeline of emails for one lesson.

RLS: `.enableRLS()` with no policies (API-only).

### Lessons table — new columns

Added to `lessons` in the same migration:

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `calendar_sequence` | `integer` | no | `0` | `.ics` `SEQUENCE:` counter per RFC 5545. Starts at 0; incremented by 1 inside every lesson transaction that writes an outbox row with a non-null `ics_method`. Preserved across state transitions so a canceled-after-rescheduled lesson emits `CANCEL` with a higher number than the preceding `REQUEST`, matching the RFC. |
| `calendar_invite_sent_at` | `timestamptz` | yes | — | Set to `now()` the first time an outbox row with `ics_method='REQUEST'` is written. Used by the write logic to decide whether a cancel/decline/expire needs a `CANCEL` `.ics` (invite was previously issued) or nothing (invite never went out). Never cleared. |

The deterministic `.ics` UID is derived from the lesson id at render time (`${lesson.id}@axiomaquatics.com`) and does not need a column.

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
| 1' | Parent submits booking (auto-approved) | same path, when `needsApproval=false` | `INSERT lessons … status='approved', approvedAt=now()` | `event='lesson_confirmed'`, `ics_method='REQUEST'`, `calendar_sequence 0 → 1`, `calendar_invite_sent_at=now()`. **No `booking_requested` row.** |
| 2 | Coach approves | `coachLessons.ts:541` (`PATCH /coach/lessons/:id/approve`) | `UPDATE lessons SET status='approved', approvedAt=now(), approvedBy=:coachId` | `event='lesson_confirmed'`, `ics_method='REQUEST'`, bumps `calendar_sequence`, sets `calendar_invite_sent_at` if null |
| 3 | Coach declines | `coachLessons.ts:606` (`PATCH /coach/lessons/:id/decline`) | `UPDATE lessons SET status='declined', declinedAt=now(), declinedBy, declineReason` | `event='request_declined'`. `ics_method='CANCEL'` iff `calendar_invite_sent_at IS NOT NULL`, else NULL. If CANCEL, bumps `calendar_sequence`. |
| 4 | Parent or coach reschedule | `lessons.ts:789` (`PATCH /lessons/:id`) | `UPDATE lessons SET starts_at=…, movedAt=now(), previousStartsAt=…` (possibly also `status: approved → pending` under re-approval rules; see note) | `event='lesson_rescheduled'`, `ics_method` set per rules below, `calendar_sequence++` if non-null |
| 5 | Parent or coach cancel | `lessons.ts:789` (`DELETE /lessons/:id`) | `UPDATE lessons SET status='canceled', canceledAt=now(), canceledBy` | `event='lesson_canceled'`. Same CANCEL-iff-prior-invite logic as decline. |
| 6a | Cron tick expiry pass | `internal.ts:57` (`POST /internal/cron/tick`) | `UPDATE lessons SET status='expired' WHERE status='pending' AND expiresAt < now()` RETURNING ids | For each returned id, same transaction inserts `event='request_expired'` with the CANCEL-iff-prior-invite rule |
| 6b | Lazy expiry safety net | `coachLessons.ts:452` (`GET /coach/lessons`) | Same `UPDATE lessons SET status='expired'` idiom | Same outbox row as 6a. Both paths route through the same `expireLessonsAndEnqueueEmails(tx)` helper to keep behavior aligned. |
| 7 | Cron auto-complete | `internal.ts:69` (same tick) | `UPDATE lessons SET status='completed', completedAt=now()` | **No outbox row.** Parents don't receive a "lesson completed" email in v1 (out of scope, per Overview). |

**Reschedule `ics_method` rules (path 4):**
- Lesson was `approved` and stays `approved` (coach reschedule, or parent-under-trust auto-reapprove) → `METHOD:REQUEST`, bump `calendar_sequence`.
- Lesson was `approved` and transitions to `pending` because the parent reschedule moved it to a location without prior trust → emit **two** rows: a `lesson_canceled`-equivalent `METHOD:CANCEL` for the old approved slot (so the invite comes out of their calendar) **and** a `booking_requested` with `ics_method=NULL` for the new pending slot. Wrapping both inserts in the lesson's transaction is cheap. If this double-row behavior is undesirable, the fallback is to emit a single `lesson_rescheduled` with `ics_method=CANCEL` — see open questions.
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

Single entry point used by both the microtask hook and the cron drain. The function reads the outbox row, builds the message, hands it to the configured transport, and updates the row in one UPDATE. It never throws — any error is caught and recorded on the row.

**Flow:**

1. `SELECT … FROM lesson_email_outbox WHERE id = :outboxId FOR UPDATE SKIP LOCKED` inside a short transaction. `SKIP LOCKED` keeps concurrent cron and post-commit sender from double-processing a row. If no row is returned, the function logs and returns (another worker got it or the row was already deleted).
2. If `status IN ('sent', 'skipped')`, log and return — belt-and-suspenders check against the dedup key.
3. Resolve recipients: `SELECT email FROM profiles WHERE id = ANY(recipient_profile_ids) AND email IS NOT NULL AND email_verified_at IS NOT NULL`. If `EMAIL_ALLOWLIST` is set, filter to the intersection. If the resolved list is empty → `status='skipped'`, `last_error='no_deliverable_recipients'`, commit, return. (`skipped` is terminal — it does not retry.)
4. Render the template (React Email → HTML + plain text) and build the `.ics` body from `payload` + `ics_method` + `ics_sequence`.
5. Call the configured transport (`resend` in dev/prod, `smtp` to Mailpit in local). Treat 2xx as success. The transport call is **outside** the FOR-UPDATE transaction so a slow Resend response doesn't hold a row lock — we re-enter the transaction briefly in step 6 to persist the result.
6. On success: `UPDATE lesson_email_outbox SET status='sent', sent_at=now(), attempts=attempts+1, last_attempt_at=now(), provider_message_id=…, last_error=NULL WHERE id=:outboxId`.
7. On failure: `UPDATE … SET status='failed', attempts=attempts+1, last_attempt_at=now(), last_error=:summary, next_attempt_at=now() + interval 'N minutes'` where N = `min(2^attempts, 30)`. The row re-queues itself for the next cron tick.

### Retry classification

The transport layer returns a tagged error. The sender uses it to decide whether to re-queue:

| Error | What happens |
|---|---|
| Resend 4xx `validation_error` on `from` / `to` / body shape | `status='failed'`, re-queued with backoff — but these are config bugs and will fail again until fixed. The cron keeps retrying so a fix auto-recovers in-flight rows. |
| Resend 429 (rate limit) | `status='failed'`, re-queued. Backoff doubles so repeated 429s don't hammer. |
| Resend 5xx | `status='failed'`, re-queued. Same backoff. |
| SMTP connection error (Mailpit down locally) | `status='failed'`, re-queued. Treated as transient. |
| Unexpected exception inside the sender | caught at the top of the function, row updated the same as a transport failure with `last_error='unexpected: …'`. |
| Dry-run / allowlist stripped recipients | `status='skipped'`, terminal. The dev deploy never flips to `failed` just because the coach's allowlist is empty. |

No cap on attempts — the row keeps retrying every tick until it succeeds or the lesson is deleted. The failed-row dashboard query is `WHERE status='failed' AND attempts > 10`; if that count ever grows the on-call runs manual triage.

### Where the cron drains the outbox

Extends `POST /internal/cron/tick` (`apps/api/src/routes/internal.ts`):

```ts
// After the existing expire / auto-complete / Google-sync blocks:
const rows = await db
  .select({ id: lessonEmailOutbox.id })
  .from(lessonEmailOutbox)
  .where(
    and(
      inArray(lessonEmailOutbox.status, ["pending", "failed"]),
      lt(lessonEmailOutbox.nextAttemptAt, now),
    ),
  )
  .orderBy(asc(lessonEmailOutbox.nextAttemptAt))
  .limit(100);
for (const row of rows) {
  queueMicrotask(() => { void sendLessonEmailOutboxRow(row.id); });
}
```

- **Batch cap `100`** per tick, matching the per-tick caps elsewhere in `cron/tick`. If the queue ever exceeds that sustainably, raise the cap before adding workers.
- Microtask scheduling means the cron response returns immediately. Sends happen on the request's event loop.
- The 2^attempts backoff (max 30 min) means a persistently failing transport doesn't retry every tick — the row's `next_attempt_at` holds it back.

No new worker, no queue, no dedicated schedule. Same pattern as the Google sync passes in ADR 027.

---

## `.ics` generation

A small helper in `apps/api/src/services/emails/ics.ts` builds the body. No new dependency — the `.ics` text format is simple enough to template:

```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Axiom Aquatics//Booking//EN
METHOD:REQUEST          ; or CANCEL
BEGIN:VEVENT
UID:{lesson.id}@axiomaquatics.com
SEQUENCE:{ics_sequence}
DTSTAMP:{nowUtc}
DTSTART;TZID=America/Los_Angeles:{startsAtLocalFloating}
DTEND;TZID=America/Los_Angeles:{endsAtLocalFloating}
SUMMARY:Swim lesson — {swimmer first names}
LOCATION:{address line}
DESCRIPTION:{deep link}
STATUS:{CONFIRMED or CANCELLED}
ORGANIZER;CN=Axiom Aquatics:MAILTO:{EMAIL_FROM address}
END:VEVENT
END:VCALENDAR
```

Rules:
- **UID** is deterministic per lesson (`${lesson.id}@axiomaquatics.com`). Preserved across the lesson's whole lifecycle so Apple Mail / Google Calendar / Outlook correctly supersede a prior REQUEST with a later CANCEL.
- **SEQUENCE** monotonically increases per RFC 5545: initial REQUEST is `0`, every subsequent REQUEST (reschedule) or CANCEL bumps it by 1. Stored on `lessons.calendar_sequence`.
- **METHOD:CANCEL** only fires when `calendar_invite_sent_at IS NOT NULL` on the lesson — i.e. a prior REQUEST was issued. Declined- or expired-from-pending (never confirmed) send no `.ics` at all.
- Confirmed emails also include an **"Add to Google Calendar" link** rendered as an `https://calendar.google.com/calendar/u/0/r/eventedit` deep link with `text`, `dates`, `details`, `location` querystring params. Separate from the `.ics` so a parent who skips the attachment still has a one-click option.
- Home-pool addresses go into `LOCATION` in full (street + city + state + zip). The email only goes to that household — the privacy carve-out that keeps ADR 027 from sending home-pool addresses to Google doesn't apply here: nothing crosses a third-party processor boundary other than Resend's transport (which handles the whole email body in transit regardless).

---

## Email content

All times are formatted in `America/Los_Angeles` with `date-fns-tz` (already in the repo). All emails:

- Use the `From: Axiom Aquatics <lessons@axiomaquatics.com>` header configured by `EMAIL_FROM`.
- Set `Reply-To` to the coach's working email via `EMAIL_REPLY_TO` so parents can reply directly.
- Include the `axiom-aquatics-lockup.png` from `apps/web/public/logos/` as the header image, served from `${SITE_URL}/logos/axiom-aquatics-lockup.png` for Gmail/Outlook caching and attached as a `cid:` fallback for Apple Mail dark mode.
- End with a two-line footer: coach name + reply-to prompt, then a plain `View this lesson in the app` link to `${SITE_URL}/dashboard/lessons/:id` (also inlined as a prominent button near the top).
- Carry **no marketing content, no tracking pixels, no third-party click-tracking**. Resend's open- and click-tracking are disabled per-request in the API call. `List-Unsubscribe` is not set — these are transactional messages tied to an actionable change the parent initiated or needs to see, not a mailing list.
- Have a plain-text alternative generated by React Email's `render(..., { plainText: true })`.
- Never include a swimmer's last name, birth date, or notes.

Each email's subject and body outline:

### 1. `booking_requested` — "We got your booking request"

**Subject:** `Request received — {dayAbbrev}, {monthAbbrev} {day}, {time}` (e.g. `Request received — Sat, Nov 1, 10:30 AM`)

**Body outline:**
- Headline: "We got your request."
- One paragraph: Thanks {parentFirstName if available else "there"}. Jason will review and get back to you soon. If this is your household's first time booking at **{locationName}**, approval can take up to 16 hours — if we don't confirm by **{expiresAt in LA, e.g. "Fri 6:30 PM"}**, this request will expire and you'll need to book again.
- Lesson summary card: swimmer first name(s), **{weekday, Month D} at {time}**, location name only (no address until approved).
- Primary button: "View request"
- No `.ics`.

### 2. `lesson_confirmed` — "Your lesson is booked"

**Subject:** `Lesson confirmed — {dayAbbrev}, {monthAbbrev} {day}, {time}`

**Body outline:**
- Headline: "You're on the schedule."
- Paragraph: Confirmed for {swimmer first names} on **{weekday, Month D} at {time}** at **{locationName}**. The invite is attached — tap it to add this lesson to your calendar.
- Lesson summary card with address (full street for home pools; name + city for named pools so the parent can map it).
- Primary button: "View lesson in app"
- Secondary link: "Add to Google Calendar" (deep link).
- Attachment: `invite.ics` with `METHOD:REQUEST`, `SEQUENCE:{calendar_sequence}`.

### 3. `request_declined` — "Your request wasn't booked"

**Subject:** `Request not booked — {dayAbbrev}, {monthAbbrev} {day}, {time}`

**Body outline:**
- Headline: "This request wasn't booked."
- Paragraph: Jason wasn't able to confirm this one{if declineReason: `: {declineReason}`}. You're welcome to try another slot — availability updates in real time in the app.
- Lesson summary card (same slot shown).
- Primary button: "Browse open slots"
- If prior invite existed: attach `cancel.ics` with `METHOD:CANCEL`, same UID, `SEQUENCE:{calendar_sequence}` so the preview invite is removed from Gmail's calendar hints. Not expected under today's state machine (decline only from pending), but the code handles it defensively.

### 4. `request_expired` — "Your request expired"

**Subject:** `Request expired — {dayAbbrev}, {monthAbbrev} {day}, {time}`

**Body outline:**
- Headline: "This request expired."
- Paragraph: Requests expire 16 hours before the lesson's start time if Jason hasn't gotten to them. The slot is open again — grab it or pick another in the app.
- Lesson summary card.
- Primary button: "Book another slot"
- `.ics` only if a prior invite was sent (same defensive logic as decline).

### 5. `lesson_canceled` — "Your lesson is canceled"

**Subject:** `Lesson canceled — {dayAbbrev}, {monthAbbrev} {day}, {time}`

**Body outline:**
- Headline: "This lesson was canceled."
- Paragraph:
  - If `canceled_by` is a coach profile: "Jason canceled this lesson. If you'd like to rebook, availability is open in the app."
  - If `canceled_by` is a household member profile: "{actorFirstName if known else "A household member"} canceled this lesson. If this was a mistake, please book again — the slot may still be open."
- Lesson summary card.
- Primary button: "Book another slot"
- Attachment: `cancel.ics` with `METHOD:CANCEL`, same UID, `SEQUENCE:{calendar_sequence}` — only when the lesson had a prior REQUEST. For a never-confirmed pending booking that gets canceled, no `.ics`.

### 6. `lesson_rescheduled` — "Your lesson moved"

**Subject:** `Lesson rescheduled — {dayAbbrev}, {monthAbbrev} {day}, {time}` (reflects **new** time)

**Body outline:**
- Headline: "This lesson moved."
- Paragraph:
  - If coach-initiated: "Jason moved this lesson."
  - If parent-initiated: "{actorFirstName if known else "A household member"} rescheduled this lesson. Everyone in your household is getting this email so your calendars stay in sync."
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

| Var | Required in… | Example | Notes |
|---|---|---|---|
| `EMAIL_TRANSPORT` | always | `resend` \| `smtp` | Picks the transport. Default in `development`/`test`: `smtp`. Default in `production`: `resend`. |
| `EMAIL_FROM` | always | `Axiom Aquatics <lessons@axiomaquatics.com>` | RFC 5322 address. Validated at parse time. |
| `EMAIL_REPLY_TO` | optional | `jason@axiomaquatics.com` | Omitted → no Reply-To header. |
| `RESEND_API_KEY` | prod, dev | `re_…` | Required when `EMAIL_TRANSPORT=resend`. |
| `EMAIL_SMTP_HOST` | local, test | `127.0.0.1` | Required when `EMAIL_TRANSPORT=smtp`. |
| `EMAIL_SMTP_PORT` | local, test | `54325` | Required when `EMAIL_TRANSPORT=smtp`. Supabase Mailpit's SMTP listener is disabled by default — we uncomment `smtp_port = 54325` in `supabase/config.toml` as part of the implementation PR. |
| `EMAIL_ALLOWLIST` | dev only | `me@example.com,coach@example.com` | Comma-separated. When set, the sender filters each row's recipient list to the intersection; empty intersection → `status='skipped'` and a log line. Local still goes to Mailpit regardless, so this gate is active on the deployed dev app only. Must be **unset in production**. The env parser rejects a non-empty `EMAIL_ALLOWLIST` when `NODE_ENV=production`. |

Production-only validation (matching the `CRON_SECRET` and `GOOGLE_*` patterns already in `env.ts`):
- `EMAIL_FROM` must be present and parse as an RFC 5322 address.
- If `EMAIL_TRANSPORT=resend`, `RESEND_API_KEY` must be present and start with `re_`.
- `EMAIL_ALLOWLIST` must be empty / absent.

Dev/test: all three transport vars may be absent — the API still boots; sender logs a one-time warning and marks every row `status='skipped'` so writes don't accumulate.

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

## Test plan

### Unit (`pnpm test`)

Vitest, pure logic, no DB. All email dispatch mocked at the transport boundary (`vi.mock("resend")` for Resend; a stub SMTP client for SMTP). New files under `apps/api/src/services/emails/__tests__/`:

- `ics.test.ts`
  - REQUEST body round-trips through `ical-parser` and matches expected fields.
  - CANCEL body preserves UID, bumps SEQUENCE, sets `STATUS:CANCELLED`.
  - Multiple consecutive reschedules produce monotonic SEQUENCE values.
  - LA timezone encoded with `TZID=America/Los_Angeles`, not a numeric offset (fixes the Outlook render edge case).
- `render.test.ts`
  - Snapshot per template. Each snapshot asserts: subject format, deep-link URL, lesson card contents, plain-text alternative length > 0, no `<script>` or `<style>` tag containing a selector (inline styles only), header image URL = `${SITE_URL}/logos/axiom-aquatics-lockup.png`.
  - Reschedule template renders both the before and after times when both are present.
  - Decline template with and without `declineReason`.
- `recipientResolution.test.ts`
  - Seeded profiles with mixed email verification states → only verified emails come back.
  - `EMAIL_ALLOWLIST` filters correctly; empty intersection → zero recipients.
  - A household with no verified-email owners/managers → zero recipients.
- `sender.test.ts`
  - Happy path: row goes `pending → sent`, `provider_message_id` populated, no re-queue.
  - 429 → `failed`, `next_attempt_at` set to backoff, `attempts++`.
  - Repeated failures: backoff doubles up to 30 min cap.
  - Empty recipient list → `skipped`, terminal.
  - Idempotency: calling the sender twice on the same id in parallel results in exactly one 2xx transport call (the second takes `FOR UPDATE SKIP LOCKED` miss path).
  - Unexpected throw inside render → caught, row flipped to `failed` with `last_error='unexpected: …'`, never bubbles.
- `outboxInsert.test.ts` (coverage for the helper that each lesson route calls)
  - `event + sequence` uniqueness: inserting the same event twice for one lesson produces sequence 1 and 2.
  - `ics_method` logic: `calendar_invite_sent_at=NULL` + cancel → NULL. `calendar_invite_sent_at != NULL` + cancel → CANCEL + bump.
  - Confirmed email bumps `calendar_sequence` and sets `calendar_invite_sent_at` only on the first REQUEST.
- Env parsing (`env.test.ts`, extend existing)
  - `EMAIL_ALLOWLIST` set with `NODE_ENV=production` → parse error.
  - `EMAIL_TRANSPORT=resend` without `RESEND_API_KEY` in production → parse error.
  - Dev with no email vars → parse succeeds, sender uses `skipped` fallback.

### Integration (`pnpm test:integration`)

Vitest integration config, live local Supabase, transport mocked at the module boundary. Shared `mockEmailTransport()` helper under `apps/api/src/__tests__/integration/helpers/`.

New file `parentBookingEmails.integration.test.ts`:
- Booking request (first lesson at a pool) → outbox row with `event='booking_requested'`, `ics_method=NULL`, status flips to `sent` after the cron tick drain.
- Auto-approved booking (second lesson at same pool) → exactly one outbox row with `event='lesson_confirmed'`, `ics_method='REQUEST'`, `calendar_sequence=1`, zero `booking_requested` rows.
- Coach approves pending → single `lesson_confirmed` row; `calendar_invite_sent_at` set; `calendar_sequence=1`.
- Coach declines pending → `request_declined`, no `.ics`.
- Coach reschedules approved → `lesson_rescheduled` with `REQUEST`, `calendar_sequence=2`.
- Parent cancels approved → `lesson_canceled` with `CANCEL`, `calendar_sequence` bumped once beyond the last REQUEST.
- Parent reschedules pending → `lesson_rescheduled` with `ics_method=NULL`, no sequence bump.
- Cron expiry: seed a `pending` lesson with `expiresAt=yesterday`, run `POST /internal/cron/tick`, assert one `request_expired` row written in the same transaction (visible atomically — row exists iff status flipped).
- Lazy expiry safety net: trigger `GET /coach/lessons` with a stale pending lesson; same single `request_expired` row written. Not duplicated by a subsequent cron tick (the lesson is no longer `pending`).
- Recipient snapshot: write an outbox row, then remove a manager from the household, then run the sender — the removed manager still appears in `recipient_profile_ids`, is filtered out of the final send list by the verified-email join only if they still have a verified email, and the row delivers to the remainder.
- Membership snapshot the other way: add a new manager between write and send — the new manager is **not** emailed (snapshot was frozen at write).
- Dedup under retry: fail the first send, re-run the cron tick 3 times with the mock still failing, assert exactly 3 rows in the transport mock history for the same `outbox_id` and that nothing was double-processed.
- Allowlist on dev: set `EMAIL_ALLOWLIST=stub@example.com`, write an outbox row whose recipients don't match, run sender, assert `status='skipped'` and the transport was not called.
- Transaction atomicity: wrap `POST /coach/lessons/:id/approve` in a seam that forces the outbox INSERT to raise, assert the lesson row stayed `pending` (both the status update and the outbox insert rolled back together). This is the critical correctness test for the ADR.
- `.ics` UID / SEQUENCE across a full lifecycle: approve → reschedule → cancel. Assert exactly three outbox rows, the UID is identical, SEQUENCE is `0,1,2`, methods are `REQUEST, REQUEST, CANCEL`.
- No PII in logs: capture the pino log stream during a full send, assert no swimmer name, no address, no email address, no decline reason appears in any log line.

### Manual test — local Mailpit

Documented in `docs/plans/parent-booking-emails.md` (this file) and the PR description:

1. `pnpm db:up` → confirm Mailpit is reachable at `http://127.0.0.1:54324`. Uncomment `smtp_port = 54325` in `supabase/config.toml` and restart if not already done.
2. Set `.env.local` for the API: `EMAIL_TRANSPORT=smtp`, `EMAIL_SMTP_HOST=127.0.0.1`, `EMAIL_SMTP_PORT=54325`, `EMAIL_FROM=Axiom Aquatics <lessons@axiomaquatics.local>`, `EMAIL_ALLOWLIST=` (unset).
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
- **Parent reschedule that falls out of trust (approved → pending).** The plan proposes two outbox rows: a `lesson_canceled`-style `CANCEL` for the old slot and a `booking_requested` for the new slot, so the parent's calendar app actually removes the stale invite. A single `lesson_rescheduled` row with `METHOD:CANCEL` would be simpler but leaves the parent confused about why the new booking is pending. **Default: two rows. Flag for Jason to confirm.**
- **Profiles email mirror vs. service-role lookup.** This plan proposes mirroring `auth.users.email` + `email_confirmed_at` onto `profiles` so the API runtime doesn't need the service-role key. The alternative is to grant the API `SUPABASE_SERVICE_ROLE_KEY` and call `supabase.auth.admin.getUserById` at send time. Mirror is less code at send time, more code at migration time; service-role is the inverse. **Default: mirror.**
- **Resend domain + DKIM/SPF.** Who owns the SPF record for `axiomaquatics.com`, and will the dev deploy use a sandbox subdomain (`lessons-dev.axiomaquatics.com`) to keep its reputation isolated from prod? Blocks the first production deploy, not the merge.
- **"Add to Google Calendar" link privacy.** The `calendar.google.com/eventedit` deep link includes the lesson's address in its querystring. For home-pool lessons, the address is a specific family's residence, placed in a URL that gets stored in Chrome history, Gmail's clipboard, etc. The `.ics` attachment covers 95% of the use case; dropping the Google deep link for home pools (and keeping it only for named pools) would mirror the ADR 027 home-pool carve-out exactly. **Default: include for all. Flag for Jason.**
- **Unsubscribe compliance.** Transactional emails tied to a user-initiated action are exempt from CAN-SPAM's unsubscribe requirement, but a `List-Unsubscribe: <mailto:lessons@axiomaquatics.com?subject=unsubscribe>` header is a cheap goodwill signal. Including it would mean we have to triage any replies that arrive at that address. **Default: don't include until we have an inbox owner.**
- **Mailpit SMTP port.** Supabase's `config.toml` leaves `smtp_port` commented out by default. We uncomment it to `54325` during implementation; the local port is otherwise unused. If a developer has that port taken by another service, we'd need an override — but no one on the team has reported a conflict, so no override is planned.

---

## Non-goals (deliberately not wired)

- No in-app notification center. The outbox is the storage; parents see state in the app directly.
- No analytics hook on `sent_at`. Resend's dashboard is the delivery observability surface.
- No per-household per-event opt-outs. Transactional means transactional; the only way not to receive a booking email is to be removed from the household or lose email verification.
- No email templates in `apps/web`. Templates live in `apps/api` because that's where they're rendered. The web app has no runtime involvement in email delivery.
