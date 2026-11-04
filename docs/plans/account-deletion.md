# Account deletion

**Status:** Draft (planning only — no code yet)
**Branch:** `feature/account-deletion`
**Related ADR:** [034 — Parent account deletion](../decisions/034-parent-account-deletion.md)

## Context

Today a parent has no way to close their own account. `profiles.disabled_at` exists as scaffolding and `apps/api/src/services/emails/drain.ts:118` carries a `TODO(account-deletion)` for the outbox, but the actual flow was explicitly deferred (`docs/accounts.md:103`: *"Profiles are never hard-deleted. … the full account deletion flow is out of scope for now."*).

This plan closes that gap. A parent can request deletion from their account page. Their personal data is scrubbed, their household and all swimmer data is removed if they are the last adult, their future lessons are cancelled and pulled from Jason's Google Calendar, pending emails and notifications for the family are cancelled and scrubbed, past lessons survive stripped of identity, and the auth session is banned so logins stop immediately.

Three constraints frame the design:

1. **Everything inside Postgres is all-or-nothing in a single transaction.** The scrubs, the cancels, the cascading deletes, the audit log writes, the outbox purges — one transaction. External side effects (Google Calendar, Supabase Auth admin) run in post-commit fan-out with their own retry state, mirroring ADR 027 and ADR 028.
2. **Kids' data is hard-deleted when the household is removed.** The ratings ledger (ADR 022 / ADR 032) is append-only by trigger, but DELETE is not blocked and this is the documented exception. The posture in `docs/accounts.md` on tracking being always-on applies while an account exists; account deletion is the one legitimate way out.
3. **Profiles are not hard-deleted.** They are scrubbed in place (name/phone cleared, email replaced with a deterministic placeholder, `disabled_at` set). Every existing FK into `profiles` — audit actors, consent recorders, lesson requesters, void authors — keeps pointing at a real row. This matches the rule already written into `docs/accounts.md:103` and leaves the append-only ledgers intact.

## Inventory

Every piece of data tied (directly or transitively) to a parent, a household, or a swimmer, and what deletion does to it.

### Tables owned by the household (cascade away when the household row is deleted)

| Table | Holds | PII | Disposition |
|---|---|---|---|
| `households` | Household row + name | No (name is `"<last word> household"`) | Hard delete when last adult leaves |
| `household_members` | Membership + role | No | Cascade from `households` |
| `household_audit_log` | Append-only audit (UUIDs only, no PII per ADR 017) | No | Cascade from `households` |
| `household_invites` | Pending invite tokens (hashed, one-time) | No | Cascade from `households` |
| `lessonLocations` (home pools) | Pool name, address, city | **Yes** — residential addresses | Cascade from `households` |
| `lessons` | Scheduled lessons for this household | No on the row itself | **Past: anonymize.** **Future: cancel then anonymize.** See "Lessons" below |
| `lesson_swimmers` | Lesson ↔ swimmer join | No | Cascade from `lessons` (CASCADE) or from swimmer deletion |
| `bookingBatches` | Parent-authored batch (weekly or manual) | Yes (JSON payload may carry swimmer ids, dates) | Hard delete after cancelling child lessons; FK on `lessons.batch_id` is RESTRICT so lessons disentangle first |
| `lesson_email_outbox` | Transactional email queue | Yes (payloads carry swimmer first names, times, address, decline reasons) | See "Email outbox" below |

### Tables owned by each swimmer (hard-deleted with the household)

| Table | Holds | PII | Disposition |
|---|---|---|---|
| `swimmers` | Child identity (first/last name, birth date, sex, `is_public`, `public_consent_at`, `public_consent_by`) | **Yes** — minor's name, DOB | Hard delete — **blocked by RESTRICT FK from `lessons`, so lessons must be anonymized first** |
| `evaluationSessions` | Coach observations | No on the row (coaching_priority text is coach-authored) | Hard delete (cascades from the scrubs we issue; FK to swimmer is RESTRICT so delete children-first order) |
| `skillRatings` | Per-skill grades, append-only ledger (ADR 022) | Rating notes may carry context | **Hard delete — documented exception to the append-only rule.** The trigger enforces immutability of UPDATE, not DELETE |
| `ratingFaultTags` | Tags per rating | No | Cascade from `skillRatings` |
| `evaluationDrafts` | In-progress eval JSON payload | Yes (freeform payload) | Hard delete |
| `coachNotes` | Free-form coach text | **Yes** — free text, coach-authored about the child | Hard delete |
| `meetSwims` | Individual meet/practice times | No | Hard delete |
| `swimmerClubs` | Team membership join | No | Cascade from `swimmers` |
| `leagueRegistrations` | Season participation | No | Cascade from `swimmers` |

Hard-delete order inside the transaction: `ratingFaultTags` → `skillRatings` (lift the trigger's UPDATE guard is irrelevant since we DELETE) → `coachNotes` → `evaluationDrafts` → `evaluationSessions` → `meetSwims` → `swimmerClubs` / `leagueRegistrations` → `lesson_swimmers` rows pointing at each swimmer → `swimmers`.

### The parent's own profile and references

| Table | Holds | PII | Disposition |
|---|---|---|---|
| `profiles` | email, full_name, phone, age_attested_at, disabled_at | **Yes** — name, phone, email | **Scrub in place.** `full_name = NULL`, `phone = NULL`, `email = "deleted-user-<uuid>@invalid.local"`, `disabled_at = now()`, `age_attested_at = NULL`. Row stays so every FK pointing at it still resolves |
| `authUsers` (Supabase Auth) | email, password_hash, session JWTs | **Yes** | **Ban indefinitely + scrub email via Supabase Admin API in post-commit fan-out.** Do not hard-delete the auth user — the `auth.users.id → profiles.id` FK is CASCADE, so hard-delete would wipe the profile row and break the rule above |

Keeping the profile row means the following FKs that point at the deleted parent continue to resolve:

- `household_audit_log.actor_id`, `.target_profile_id`
- `householdInvites.created_by`, `.accepted_by`
- `lessons.requested_by`, `.approved_by`, `.declined_by`, `.canceled_by`, `.no_show_by` (these get anonymized on past lessons regardless; see below)
- `skillRatings.void_by`, `.superseded_by` (for void/correction history authored by a parent-coach — N/A since only Jason is a coach today, but the shape is the same)
- `coachNotes.created_by` (N/A for parents, same note)
- `swimmers.public_consent_by` (consent audit trail)

### Coach-side tables (only touched when the deleted parent *is also* a coach — not applicable in v1, since only Jason is a coach, but the plan still names the disposition for completeness)

| Table | Disposition |
|---|---|
| `coachCalendarIntegrations` | Cascade from profile — but we don't hard-delete the profile, so instead: on deletion of a coach profile, revoke the stored refresh token with Google (if present) and clear `refresh_token_ciphertext` + related fields before the scrub |
| `coachNotifications`, `coachPushSubscriptions`, `coachNotificationPreferences` | Delete all rows for that profile. These are `profile_id` CASCADE but since the profile row stays, do the deletes explicitly in the transaction |
| `coachAuditLog` | Append-only. Rows stay; actor FK still resolves because the profile is scrubbed in place |
| `bulkCancellations.coachProfileId` | Row stays; scrubbed profile is still a valid FK target |

V1 only supports parent deletion. Coach deletion is a separate ADR when/if it's needed.

### Email outbox and coach notifications

| Table / row class | Action |
|---|---|
| `lesson_email_outbox` rows with `status IN ('queued', 'sending')` scoped to this household | **Hard delete** inside the transaction. `household_id` is populated on bulk-cancel rows (ADR 033); for lesson-scoped and batch-scoped rows, derive the household via `lesson_id → lessons.household_id` or `batch_id → bookingBatches.household_id` and delete them before the parent `lessons` / `bookingBatches` rows go |
| `lesson_email_outbox` rows with `status IN ('sent', 'permanently_failed')` scoped to this household | **Scrub payload** — `payload = NULL`, `scrubbed_at = now()`. Row stays as an audit of "we sent an email about this family at this time," matching the 30-day scrub shape ADR 028 already defines. Fast-forwards the scrub for this household without waiting for the age-based cron |
| `coachNotifications` rows referencing this household's lessons/batches | **Null the FK + scrub the payload.** Set `lesson_id = NULL`, `batch_id = NULL`, `payload = {}`, `scrubbed_at = now()`. Keep the row so the coach's historical alerts list still reflects that something happened, but with no personally identifying payload |
| `coachNotifications` for the deletion itself | **Insert one row** with `category = 'account_deleted'` and a payload summary `{ cancelledFutureLessonCount, pastLessonCount, deletedAt }` — no names, no addresses. Jason sees "A family's account was deleted. 4 future lessons cancelled" |

### Lessons — past vs future

**Past lessons** (lessons whose `starts_at <= now()` at the deletion instant, regardless of status) are kept for Jason's historical record of when he worked. They are anonymized rather than deleted.

Before the swimmers are dropped, each past lesson is updated in the same transaction:

- `household_id` → `NULL` (requires migration: drop NOT NULL, keep the FK as `ON DELETE SET NULL`)
- `location_id` → `NULL` for home pools (cascade would have wiped the home pool row). For named public pools the FK stays (public pools aren't tied to this household). Requires making `location_id` nullable
- `requested_by`, `approved_by`, `declined_by`, `canceled_by`, `no_show_by` → `NULL` for every column pointing at a now-scrubbed profile in this household
- `decline_reason` → `NULL`
- `google_calendar_event_id` → `NULL` (the event is deleted from the coach's calendar in the post-commit fan-out anyway)
- `batch_id` → `NULL` (the batch row is about to be deleted)
- New column `anonymized_at = now()`
- New column `location_snapshot text` → `"Home pool"` or `"<pool name>"` so Jason can read the row after the fact. No street address, no city

Remaining on the row after anonymization: `id`, `starts_at`, `duration_minutes`, `type`, terminal `status`, timestamp columns for approval/cancel/no-show/completion, `calendar_sequence`, `anonymized_at`, `location_snapshot`. That is enough to answer "when was I teaching, for how long, how did the lesson end" without any family or swimmer identity on the row.

`lesson_swimmers` rows for the anonymized lesson are deleted when their swimmers are deleted (CASCADE on `swimmer_id` is the only path; the FK on `lesson_id` is also CASCADE but we're keeping the lesson row). So the lesson ends up with zero `lesson_swimmers` rows. Optional: snapshot a `swimmer_count` integer onto the lesson so Jason can tell a 1-on-1 from a sibling lesson. **Proposed: yes, add `swimmer_count` snapshot** — one integer, no PII, preserves useful signal.

**Future lessons** (`starts_at > now()`, status in `('approved', 'pending')`) follow the normal cancel path inside the same transaction:

- `status = 'canceled'`, `canceled_at = now()`, `canceled_by = <the deleting profile id, captured before the scrub>`, `calendar_sequence += 1`
- Post-commit microtask per lesson: `syncLessonToGoogle(lessonId)` — removes the event from the coach's calendar using the existing ADR 027 one-way sync; failures retry per the existing `calendar_sync_status` state machine
- **No parent email.** The recipient is being deleted. Suppress the enqueue by writing no `lesson_email_outbox` row for the cancel event
- **One coach notification** (the `account_deleted` row described above) rather than N `lesson_canceled` rows. Jason sees a single summary; he doesn't want his push buzzing 20 times for one family's withdrawal
- After the cancel transitions, the future lessons are anonymized the same way past lessons are — the row survives for Jason's history, the identity does not

**In-progress lessons** (`starts_at <= now() < starts_at + duration_minutes`): treat as past. They either completed or they didn't, but they definitely happened; the row survives as history.

### External systems

| System | What goes | How it's cleaned | Retry |
|---|---|---|---|
| Google Calendar | Future-lesson events on the coach's calendar | Post-commit fan-out: `syncLessonToGoogle(lessonId)` per cancelled lesson (status is now `canceled`, so the sync deletes the event) | Existing `calendar_sync_status` state machine (ADR 027) handles retries and terminal failure |
| Supabase Auth | The parent's auth user row | Post-commit task: `supabase.auth.admin.updateUserById(id, { email: "<placeholder>", ban_duration: "100y" })`. We do not hard-delete the auth user, because `auth.users.id → profiles.id` is CASCADE and we must keep the profile row | New `account_deletion_jobs` table carries the retry state (see Phase 3) |
| Email transport (Resend / Postmark / SMTP) | Nothing new — pending outbox rows are deleted before they would send | Not applicable | Not applicable |
| Supabase physical backups | Point-in-time copies hold deleted rows for Supabase's retention period | **Cannot be reached.** Documented here for the kids'-data legal review | Not applicable |

## Decisions (proposed defaults)

Every decision below is *my* default. Flag disagreements in the review and we'll adjust before writing any code.

### 1. Last adult in the household → delete everything

If the deleting member is the **only** profile in `household_members`, the household row goes, and with it the audit log, invites, home pools, swimmers, swimmer-owned data (ratings, sessions, notes, meet swims, drafts), batches, and the deleting member's own profile is scrubbed. Teen accounts (future feature) are treated as household members and go with the household the same way.

### 2. Other adults remain → only this person is removed

The deleting member is removed from `household_members`. The household, its swimmers, its lessons, and the other adults are untouched. The deleting member's profile is scrubbed and their auth user is banned, same as case 1.

**If the deleting member is the owner**, the API returns `409 must_transfer_first` — the same error the Leave flow (`DELETE /households/mine/members/me`) already returns per `docs/accounts.md:41`. The UI then surfaces the transfer-ownership flow (`POST /households/mine/transfer-ownership`) and the delete button is only clickable once the member is no longer `owner`. We do not auto-transfer on their behalf; picking the next owner is an active choice the current owner makes.

A `household_audit_log` row is written for the removal (`action = 'member_deleted_account'`), scoped to the household that survives, with `actor_id = target_profile_id = <scrubbed profile>`.

### 3. Kids' data (evaluations, ratings, swims, PBs, leaderboard entries, coach notes) is hard-deleted

Follows from case 1. The append-only trigger on `skillRatings` (ADR 022 / ADR 032) does not block DELETE — only UPDATE. **Deletion here is the one documented exception** to the ledger's immutability, and this plan is the place it lives.

**Leaderboards** have no dedicated table today. They are computed at read time from `meetSwims` and `skillRatings`; deleting those rows removes the swimmer from every leaderboard at the source.

### 4. Past lessons are kept, family and swimmer identity stripped

See "Lessons — past vs future" above. After anonymization a past lesson row has: `id`, `starts_at`, `duration_minutes`, `type`, terminal `status`, timestamp columns, `calendar_sequence`, `anonymized_at`, `location_snapshot` (coarse text like `"Home pool"` or the named-pool name), and the proposed `swimmer_count` integer. Nothing else.

### 5. Future lessons are cancelled, Jason's Google Calendar is cleaned, Jason is notified, no parent email

See "Lessons — past vs future." Google Calendar cleanup rides the existing `calendar_sync_status` retry; Jason sees one `account_deleted` coach notification with a count, not one notification per lesson.

### 6. Pending emails and notifications are cancelled, payloads scrubbed

See "Email outbox and coach notifications." Non-terminal rows are deleted; terminal rows have payloads nulled so the "we sent an email" fact survives without the contents.

### 7. Audit logs and append-only ledgers — the documented exceptions

- `household_audit_log`: rows contain only UUIDs. In case 1 they cascade with the household. In case 2 they stay; the scrubbed profile is still a valid FK target.
- `coachAuditLog`: rows stay; not tied to the deleting member's identity beyond the FK.
- `skillRatings`: hard-deleted in case 1. This plan is the documented exception.
- `lesson_email_outbox`: payload-scrubbed per above. This matches the existing 30-day scrub posture.

If any audit row ever starts carrying PII in a future feature, the decision above must be revisited. Today the only PII-bearing audit surface is the outbox payload, and we scrub it.

### 8. Grace period of 30 days, cancellable

**Recommended: 30-day grace.** On confirm, the API sets `profiles.pending_deletion_at = now() + interval '30 days'` and bans the auth user immediately so logins stop. The scrubs and deletes do not run yet. A cron job (`accountDeletionDrain`, same shape as the existing email drain and calendar sync cron) wakes once a day, picks up `profiles` where `pending_deletion_at <= now()` with `disabled_at IS NULL`, and runs the transaction.

Cancellation during the window: the user emails Jason — since logins are banned they can't do it in-app. On request, Jason calls an admin endpoint that clears `pending_deletion_at` and unbans the auth user. This is low-cost because v1 has one coach (Jason) and the volume of cancellations will be tiny.

An in-app "undo deletion" button is a nice v2. Not blocking.

**Tradeoff:** a grace period delays the user's wish to be gone. Mitigated by (a) banning logins immediately, (b) scrubbing emails they haven't opened yet immediately, (c) advertising the 30-day window clearly on the confirm screen. An alternative — immediate deletion — ships sooner but leaves no recovery path for an accidental or coerced click, and Supabase backups are going to hold the data for the retention window regardless. Given the data involved is largely about minors, biasing toward reversibility is the safer default.

### 9. Confirmation UX

The parent navigates to **Account → Delete account**. The screen shows a preview ("Here is what will be deleted") computed by a `POST /me/deletion/preview` call:

- Household name + member count
- Swimmer names (first name + last initial) and count
- Count of past lessons that will be anonymized
- Count of future lessons that will be cancelled
- "The following people will be notified: your coach"
- The 30-day grace window, phrased plainly ("your account is deactivated immediately; data is permanently deleted 30 days from now")

To proceed, the parent:

1. Re-enters their password (re-authentication) — Supabase `signInWithPassword` under the hood, scoped to confirm liveness
2. Types the phrase `delete my account` into a confirmation field
3. Clicks "Delete my account"

If they are an owner with other members, the confirm button is disabled and a block screen explains the transfer-first requirement with a link to the household settings page.

### 10. External cleanup completes reliably via the existing outbox pattern

A new table `account_deletion_jobs` tracks the state across the transaction and the external calls:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `profile_id` | uuid not null | FK → profiles.id on delete restrict (profile still exists, scrubbed) |
| `scope` | text not null | `'solo'` or `'leave'` — matches the two cases above |
| `scheduled_for` | timestamptz not null | now + 30 days on initial enqueue |
| `status` | text not null | `'pending' \| 'running' \| 'completed' \| 'failed'` |
| `attempts` | integer not null default 0 | |
| `last_error` | text | |
| `completed_at` | timestamptz | |
| `created_at` | timestamptz not null default now | |

A cron job picks jobs with `scheduled_for <= now()` and status in `('pending', 'failed')` (bounded retry count), opens the deletion transaction, and on commit runs two post-commit microtasks:

1. Per cancelled future lesson: `syncLessonToGoogle(lessonId)` — retries via the existing `calendar_sync_status` state machine
2. Once: `supabase.auth.admin.updateUserById` to scrub email and set `ban_duration`. On failure, bump `attempts` and `last_error`, leave status `'pending'` for the next cron tick

Terminal `'completed'` after all external calls return success. Terminal `'failed'` after N retries (propose 10, same as the email sender) — and in that terminal state the DB side has already succeeded, so the only lingering effect is a Google Calendar event that didn't delete or an auth user that didn't ban. Both are visible on the coach's alerts page and the Supabase dashboard respectively, so operator cleanup is viable.

### 11. Supabase backups

Supabase retains physical backups for their SLA window (7 days on the free tier, 7–30 days on paid). This plan does not reach into backups. **Flagged for the kids'-data legal review** — whether a 30-day grace plus a backup retention window meets whatever obligations apply to kids' data is not for this plan to answer.

## Transaction shape (per cron tick, per account)

1. Open `db.transaction(async (tx) => { ... })`
2. Advisory lock on `hashtext('account-deletion:' + profileId)` to prevent two concurrent runs of the same job (cron overlap)
3. Reload the profile and assert `pending_deletion_at <= now()` and `disabled_at IS NULL` (idempotency guard — if another worker got here first, bail without mutations)
4. Load `household_members` for this profile, determine `scope` (`solo` if the only member, `leave` otherwise)
5. If `scope = 'leave'` and this profile is still `owner`, throw `OwnerNotTransferredError` and move the job to `'failed'` — this should have been caught at confirm time, but belt-and-braces
6. Capture `deletingProfileId = profile.id` — we need it as the `canceled_by` value for future-lesson cancellations before the profile is scrubbed
7. **If `scope = 'leave'`:** delete this profile's `household_members` row, write a `member_deleted_account` audit row, scrub the profile (see step 11), skip to step 13
8. **If `scope = 'solo'`:** cancel future lessons (`status = 'canceled'`, timestamps, `calendar_sequence += 1`) — snapshot their ids into `cancelledFutureLessonIds`
9. Anonymize all lessons for this household — past *and* now-cancelled future — writing the nulls and the `anonymized_at` / `location_snapshot` / `swimmer_count` columns
10. Delete swimmer-owned data in order: `ratingFaultTags` → `skillRatings` → `coachNotes` → `evaluationDrafts` → `evaluationSessions` → `meetSwims` → `swimmerClubs` → `leagueRegistrations` → `lesson_swimmers` rows for this household's swimmers → `swimmers`
11. Delete `lesson_email_outbox` rows for this household with non-terminal status; scrub payload on terminal rows
12. Null FKs + scrub payload on `coachNotifications` rows referencing this household's lessons/batches; insert one `account_deleted` coach notification
13. Delete `bookingBatches` for this household (now that lessons point at `NULL` via step 9)
14. Delete `lessonLocations` (home pools) for this household — note: lessons' `location_id` has already been nulled in step 9, so RESTRICT passes
15. Delete `household_invites`, `household_members` (all rows), `household_audit_log`, and finally the `households` row (cascades confirm the earlier manual deletes were belt-and-braces)
16. Scrub the deleting profile: `full_name = NULL`, `phone = NULL`, `email = 'deleted-user-' || id || '@invalid.local'`, `disabled_at = now()`, `age_attested_at = NULL`
17. Update `account_deletion_jobs` row to `status = 'running'` (committed so cron sees progress)
18. Commit

**Post-commit fan-out:**

- One `syncLessonToGoogle(lessonId)` microtask per `cancelledFutureLessonIds`
- One `supabase.auth.admin.updateUserById(profileId, { email: '<placeholder>', ban_duration: '100y' })` microtask
- On all-success, flip `account_deletion_jobs.status = 'completed'`. On any failure, cron picks it up next tick.

## Phases

Each phase is its own PR off `feature/account-deletion`, with its own tests and reviews.

### Phase 1 — Schema + migrations

**What ships:**
- `profiles.pending_deletion_at timestamptz nullable`
- `lessons`: make `household_id`, `location_id`, `requested_by`, `approved_by`, `declined_by`, `canceled_by`, `no_show_by`, `batch_id` nullable (drop `NOT NULL`, keep FK). Add `anonymized_at timestamptz nullable`, `location_snapshot text nullable`, `swimmer_count integer nullable`
- New `account_deletion_jobs` table per Decision 10
- Update `docs/data-model.md` and `docs/accounts.md` (strike the "out of scope for now" paragraph on line 103)

**Tests:**
- Migration applies cleanly on a fresh db (`pnpm db:up && pnpm db:migrate`)
- Drizzle snapshot diff clean
- Existing routes that write these lesson columns still type-check (the TS types widen to `| null`, so call sites need `?? value` or explicit guards — audit at compile time)

### Phase 2 — Deletion engine (backend)

**What ships:**
- `apps/api/src/services/accountDeletion/` module with pure functions per step: `scrubProfile`, `anonymizeLessons`, `cancelFutureLessons`, `hardDeleteSwimmerData`, `scrubEmailOutbox`, `scrubCoachNotifications`, `deleteHousehold`
- Routes under `requireUser`: `POST /me/deletion/preview` → returns the confirmation screen summary; `POST /me/deletion/confirm` → re-auth check, writes `pending_deletion_at` + `account_deletion_jobs` row + bans the auth user; `DELETE /me/deletion` → owner-cancel during the grace window (via admin endpoint for v1; or self-serve if we decide the user can cancel without emailing Jason)
- Shared Zod schemas in `packages/shared/src/schemas/accountDeletion.ts`
- Audit log entries at every step

**Tests:**
- Integration: solo household path — one tx, all rows deleted or scrubbed, grace scheduled
- Integration: leave household path — only this member removed, household survives
- Integration: owner-not-transferred returns 409
- Unit: each scrubber function in isolation
- Fault injection: transaction rolls back cleanly on mid-step throw (reuse existing fault-injection harness from `docs/local-fault-injection.md`)

### Phase 3 — Cron job + external cleanup

**What ships:**
- `accountDeletionDrain` cron handler (follows ADR 027 / ADR 028 cron patterns — advisory lock via `cron_leases`, bounded batch size, logged per profile_id without names)
- External call retries: Google Calendar sync fan-out already exists; the Supabase Auth admin call is new and gets `attempts` / `last_error` tracking on `account_deletion_jobs`
- Terminal `'failed'` state after N retries, surfaced on the coach alerts page as an operational notification

**Tests:**
- Integration: cron picks up a job with `scheduled_for < now()` and runs it to completion
- Integration: cron skips a job whose profile was reactivated (admin cleared `pending_deletion_at`)
- Integration: Google Calendar failure leaves the job retriable; Supabase Auth failure same
- Integration: idempotency — running the cron twice on the same job is a no-op after the first

### Phase 4 — UI (apps/web)

**What ships:**
- `/account/delete` page (parent dashboard)
- Preview section populated from `POST /me/deletion/preview`
- Re-auth step + typed-phrase confirmation
- Block screen for owners with members, linking to transfer flow
- Grace-period banner on the account page: "Your account is scheduled for deletion on <date>. Contact your coach to cancel."
- Design per `jg-swim-design` / `emil-design-eng` skills

**Tests:**
- Playwright: full happy path on solo and leave cases
- Playwright: owner-with-members shows the block screen and the transfer CTA
- Visual: banner renders on `/account` while `pending_deletion_at` is set
- Server/client boundary compliance per `CLAUDE.md`

### Phase 5 — Privacy review + docs

**What ships:**
- Run the `privacy-reviewer` subagent on the full branch
- Legal-review handoff doc covering: kids' data deletion posture, Supabase backup retention, Google Calendar residual, Supabase Auth residual
- `docs/accounts.md` updated to reference this ADR instead of the "out of scope" line
- `drain.ts:118` TODO removed and the ADR referenced instead

## Open questions

These need Jason or the legal review before they're decisions. Kept separate from the defaults above.

1. **Grace period length.** 30 days is my recommendation. Jason may want shorter (14 days) or longer (90 days). The legal review may force a floor or ceiling depending on COPPA-adjacent obligations around kids' data.
2. **Who can cancel the deletion during the grace window.** My default is "email Jason, Jason clicks an admin button." The alternative is a self-serve "undo" link in the deletion-confirmation email. Self-serve is more user-friendly but means a revocation path the banned auth user can trigger — doable, but worth Jason's call.
3. **Whether `pending_deletion_at` should block logins immediately or let the user log in during the grace period to cancel.** Default here is **ban immediately**, because the user has just said they want out. The reactivate flow goes through Jason. The alternative is a softer "you've scheduled deletion; log in and cancel it yourself."
4. **Past-lesson swimmer count snapshot.** I proposed adding `swimmer_count integer`. Confirm Jason actually wants it. If his history use case is just "how many hours did I teach," the count isn't needed.
5. **Anonymizing coach notifications vs deleting them.** I propose null-FK + scrub-payload for coach notifications tied to the deleted household, keeping the row. Jason may prefer we just hard-delete them so his alerts list stays clean — the tradeoff is losing the historical "a push was sent to me at time T" record.
6. **Kids' data destruction and Supabase physical backups — legal review.** The 7–30 day backup retention means deleted kids' data is not actually gone until backups age out. Whether that is acceptable under COPPA, CCPA-for-minors, or Jason's business posture is for the legal reviewer; this plan does not decide it.
7. **Home-pool address disclosure window.** The same legal review already has `docs/accounts.md:89` and `:90` pending (home-pool addresses and swimmer first names in Google Calendar). Account deletion deletes home-pool rows but Google still has the event history (titled with first names, located at a non-redacted address for named-pool events) until the sync-delete lands. Adds no new disclosure, but worth naming in the review packet.
8. **Should deletion also revoke the Google OAuth grant on Jason's side?** No — Jason is the coach, not the deleting user. This bullet is here to rule it out explicitly.
9. **Teen accounts (future).** When teen accounts ship (per `docs/accounts.md:9`), confirm that deletion of a teen's own account is handled the same way as a parent's account deletion, or whether it rolls up to the owner. Out of scope for this build but the answer shapes how `scope` is enum'd on `account_deletion_jobs` later.
