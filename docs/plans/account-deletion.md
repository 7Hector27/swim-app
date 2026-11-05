# Account deletion

**Status:** Draft (planning only — no code yet)
**Branch:** `feature/account-deletion`
**Related ADR:** [034 — Parent account deletion](../decisions/034-parent-account-deletion.md)

## Context

Today a parent has no way to close their own account. `profiles.disabled_at` exists as scaffolding and `apps/api/src/services/emails/drain.ts:118` carries a `TODO(account-deletion)` for the outbox, but the actual flow was explicitly deferred (`docs/accounts.md:103`: *"Profiles are never hard-deleted. … the full account deletion flow is out of scope for now."*).

This plan closes that gap. A parent clicks delete on their account page, re-authenticates, types `delete my account`, and the deletion runs immediately. All database work happens inside one transaction; external cleanup (Jason's Google Calendar, the Supabase Auth user) runs in post-commit tasks with their own retry state.

Three constraints frame the design:

1. **Everything inside Postgres is all-or-nothing in a single transaction.** The scrubs, the cancels, the cascading deletes, the audit log writes, the outbox purges — one transaction. External side effects run in post-commit tasks whose retry state lives in a new `account_deletion_jobs` table.
2. **Kids' data is hard-deleted when the household is removed.** The ratings ledger (ADR 022 / ADR 032) is append-only by trigger, but DELETE is not blocked and this is the documented exception. The posture in `docs/accounts.md` on tracking being always-on applies while an account exists; account deletion is the one legitimate way out.
3. **The scrubbed profile stays; the Supabase Auth user does not.** Every existing FK into `profiles` — audit actors, consent recorders, lesson requesters, void authors — keeps pointing at a real row, with name/phone cleared and a placeholder email. The matching Supabase Auth row is **deleted** (the `profiles.id → auth.users.id` CASCADE FK is dropped as part of this build so deletion of the auth user no longer wipes the scrubbed profile).

## Inventory

Every piece of data tied (directly or transitively) to a parent, a household, or a swimmer, and what deletion does to it.

### Tables owned by the household (cascade away when the household row is deleted)

| Table | Holds | PII | Disposition |
|---|---|---|---|
| `households` | Household row + name | No (name is `"<last word> household"`) | Hard delete when last adult leaves |
| `household_members` | Membership + role | No | Cascade from `households` |
| `household_audit_log` | Append-only audit (UUIDs, action strings; optional sparse `payload` jsonb — see Audit logs below) | No in current usage; see below | Cascade from `households` in the solo case; scrub `payload` in the leave case |
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
| `evaluationSessions` | Coach observations | Possibly (coaching_priority text is coach-authored) | Hard delete (FK to swimmer is RESTRICT so delete children-first order) |
| `skillRatings` | Per-skill grades, append-only ledger (ADR 022) | Rating notes may carry context | **Hard delete — documented exception to the append-only rule.** The trigger enforces immutability of UPDATE, not DELETE |
| `ratingFaultTags` | Tags per rating | No | Cascade from `skillRatings` |
| `evaluationDrafts` | In-progress eval JSON payload | Yes (freeform payload) | Hard delete |
| `coachNotes` | Free-form coach text | **Yes** — free text, coach-authored about the child | Hard delete |
| `meetSwims` | Individual meet/practice times | No | Hard delete |
| `swimmerClubs` | Team membership join | No | Cascade from `swimmers` |
| `leagueRegistrations` | Season participation | No | Cascade from `swimmers` |

Hard-delete order inside the transaction: `ratingFaultTags` → `skillRatings` → `coachNotes` → `evaluationDrafts` → `evaluationSessions` → `meetSwims` → `swimmerClubs` / `leagueRegistrations` → `lesson_swimmers` rows pointing at each swimmer → `swimmers`.

### The parent's own profile and the Supabase Auth user

| Table | Holds | PII | Disposition |
|---|---|---|---|
| `profiles` | email, full_name, phone, age_attested_at, disabled_at | **Yes** — name, phone, email | **Scrub in place.** `full_name = NULL`, `phone = NULL`, `email = "deleted-user-<uuid>@invalid.local"`, `disabled_at = now()`, `age_attested_at = NULL`. Row stays so every FK pointing at it still resolves |
| `authUsers` (Supabase Auth) | email, phone, password hash, raw_user_meta_data, raw_app_meta_data, linked identities, sessions, refresh tokens | **Yes — the full set** | **Hard delete via `supabase.auth.admin.deleteUser(id)` in the post-commit task.** This requires dropping the `profiles.id → auth.users.id` CASCADE FK as part of this build; see "Supabase Auth" below |

Keeping the profile row means these FKs resolve after the scrub:

- `household_audit_log.actor_id`, `.target_profile_id`
- `householdInvites.created_by`, `.accepted_by`
- `lessons.requested_by`, `.approved_by`, `.declined_by`, `.canceled_by`, `.no_show_by` (these get nulled on past lessons regardless; see below)
- `skillRatings.void_by`, `.superseded_by`
- `coachNotes.created_by`
- `swimmers.public_consent_by` (consent audit trail)

### Audit logs

**`household_audit_log`** (ADR 017). Fixed columns are `household_id`, `actor_id`, `action`, `target_profile_id`, `target_swimmer_id`, `new_role`, `created_at` — all UUIDs, enum, and category strings. The sparse `payload jsonb` added later (ADR 028 era) is currently used in two places and both carry only UUIDs and field-name arrays:

- `coachBulkCancel.ts:513` — `{ bulkCancellationId, canceledLessonIds, declinedLessonIds, invitedLessonIds }` (UUIDs only).
- `evaluations.ts:1548` — `{ sessionId, sessionFieldsChanged, ratingsChanged }` where `sessionFieldsChanged` is a list of field names and `ratingsChanged` is a list of `{ ratingId, newRatingId, fieldsChanged }` — **no before/after values**.

Even so, the plan **scrubs the `payload` column defensively** so a future audit entry that starts storing values can't leak after a deletion. In the solo case this is academic — the whole log cascades with the household. In the leave case, we `UPDATE household_audit_log SET payload = NULL WHERE household_id = <this household> AND (actor_id = <deleting profile> OR target_profile_id = <deleting profile>)` before scrubbing the profile. The structural columns (action, actor_id, target_profile_id, created_at) stay.

**`coach_audit_log`**. Fixed columns are `coach_id`, `actor_id`, `action`, `target_profile_id`, `target_swimmer_id`, `new_role`, `created_at`. Surveyed payload usage:

- `coachAvailability.ts:255` — `{ previousValue, newValue }` for `bookingMinAdvanceHours` (integer only).
- `coachCalendar.ts:188` — `result` of a bulk retry (attempted / succeeded / failed counts).
- `integrationsGoogle.ts:208` — no payload.

None of these touch the deleting parent. In the parent-deletion flow, `coach_audit_log` rows are left alone **unless** a row happens to reference the deleting profile as `actor_id` or `target_profile_id` (none today, but defensive); in that case we also null `payload` on those rows and leave the structural columns.

### Email outbox and coach notifications

| Row class | Action |
|---|---|
| `lesson_email_outbox` with `status IN ('queued', 'sending')` scoped to this household | **Hard delete** inside the transaction. Derive the household via `household_id` (bulk-cancel rows), `lesson_id → lessons.household_id` (lesson scope), or `batch_id → bookingBatches.household_id` (batch scope); delete before the parent `lessons` / `bookingBatches` rows go |
| `lesson_email_outbox` with `status IN ('sent', 'permanently_failed')` scoped to this household | **Scrub payload** — `payload = NULL`, `scrubbed_at = now()`. Row stays as an audit of "we sent an email about this family at this time." Retires `drain.ts:118` TODO for this household |
| `coachNotifications` rows referencing this household's lessons/batches | **Hard delete.** These are coach-visible alerts for a household that no longer exists; there's no reason to keep them. (Decision 5 confirmed with Jason.) |
| `coachNotifications` summary row for the deletion | **Insert one row** with `category = 'account_deleted'` and payload `{ cancelledLessonTimes: [ISO strings], deletedAt }` — no family name, no swimmer names, no household id. Jason sees "A family deleted their account. The following lesson times have been freed up: …" |

### Lessons — past vs future

**Past lessons** (lessons whose `starts_at <= now()` at the deletion instant, regardless of status) are kept for Jason's historical record of when he worked. They are anonymized rather than deleted.

Before the swimmers are dropped, each past lesson is updated in the same transaction:

- `household_id` → `NULL` (requires migration: drop NOT NULL, keep the FK as `ON DELETE SET NULL`)
- `location_id` → `NULL` for home pools (cascade would have wiped the home pool row). For named public pools the FK stays. Requires making `location_id` nullable
- `requested_by`, `approved_by`, `declined_by`, `canceled_by`, `no_show_by` → `NULL` for every column pointing at a now-scrubbed profile in this household
- `decline_reason` → `NULL`
- `google_calendar_event_id` → `NULL`
- `batch_id` → `NULL`
- New column `anonymized_at = now()`
- New column `location_snapshot text` → `"Home pool"` or `"<pool name>"`
- New column `swimmer_count integer` → count of swimmers on the lesson at anonymization time (kept per Jason's call — the number isn't identifying)

Remaining on the row after anonymization: `id`, `starts_at`, `duration_minutes`, `type`, terminal `status`, timestamp columns for approval/cancel/no-show/completion, `calendar_sequence`, `anonymized_at`, `location_snapshot`, `swimmer_count`. Enough to answer "when was I teaching, for how long, how did the lesson end, with how many kids" without any family or swimmer identity.

**Future lessons** (`starts_at > now()`, status in `('approved', 'pending')`) follow the normal cancel path inside the same transaction:

- `status = 'canceled'`, `canceled_at = now()`, `canceled_by = <the deleting profile id, captured before the scrub>`, `calendar_sequence += 1`
- Post-commit task per lesson: `syncLessonToGoogle(lessonId)` — removes the event from Jason's calendar via the existing ADR 027 one-way sync; failures retry per the existing `calendar_sync_status` state machine
- **No parent email.** Suppress the enqueue by writing no `lesson_email_outbox` row for the cancel event
- **One coach notification** (the `account_deleted` row above) listing the freed-up times, not one notification per lesson
- After the cancel transitions, the future lessons are anonymized the same way past lessons are

**In-progress lessons** (`starts_at <= now() < starts_at + duration_minutes`): treat as past. They either completed or they didn't, but they definitely happened; the row survives as history.

### Supabase Auth

The Supabase Auth user is **hard-deleted** via `supabase.auth.admin.deleteUser(id)` in the post-commit task. This is a dependent change to the schema: `profiles.id → auth.users.id` is `ON DELETE CASCADE` today, so hard-deleting the auth user would wipe the scrubbed profile row and break every surviving FK listed above. Phase 1 drops that constraint.

Why delete instead of scrub+ban:

- The scrub approach forces us to enumerate every PII-bearing column on `auth.users` *and* `auth.identities` *and* any future table Supabase adds under `auth.*`. That list isn't static — Supabase can add fields, and we would be responsible for tracking them forever. "Email must not survive" is the user's requirement, and "we remembered to scrub every field Supabase has today" is a weak guarantee next time Supabase ships a new column.
- Deletion is Supabase's designed primitive (`auth.admin.deleteUser`). It cascades inside the `auth.*` schema to `identities`, `sessions`, `refresh_tokens`, `mfa_*`, etc., so one call does the whole thing.
- Dropping the `profiles.id → auth.users.id` CASCADE is a one-time migration with a small blast radius: the Supabase triggers `on_auth_user_created` and `on_auth_user_updated` write to `profiles` by SQL value, not via the FK, and RLS policies that reference `auth.uid() = profiles.id` compare values rather than following the FK. Signup continues to work, token verification continues to work, nothing downstream breaks.
- Once the FK is dropped, the invariant we lose is "every profile has a corresponding auth user." For this flow that's the *point* — a scrubbed profile is a profile without an auth user. The scrubbed-profile email is a sentinel (`deleted-user-<uuid>@invalid.local`) so the unique index on `profiles.email` still holds. No feature today reads `auth.users` through the FK; everything goes through `getUser(token)`.

The alternative — keep the FK, call `auth.admin.updateUserById` to scrub `email`, `phone`, `user_metadata`, `app_metadata`, delete every row in `auth.identities` for this user, then `ban_duration: '100y'` — is listed as the fallback in the ADR but not recommended.

### External systems

| System | What goes | How it's cleaned | Retry |
|---|---|---|---|
| Google Calendar | Future-lesson events on the coach's calendar | Post-commit task per cancelled lesson: `syncLessonToGoogle(lessonId)` | Existing `calendar_sync_status` state machine (ADR 027) |
| Supabase Auth | The parent's auth user row and its identities / sessions / refresh tokens | Post-commit task: `supabase.auth.admin.deleteUser(id)` | New `account_deletion_jobs` row tracks `attempts` / `last_error` for this call; cron re-drives on failure |
| Email transport (Resend / Postmark / SMTP) | Pending outbox rows are deleted before they would send; nothing new leaves the app for this household | Not applicable | Not applicable |
| Supabase physical backups | Point-in-time copies hold deleted rows for Supabase's retention period | **Cannot be reached.** Legal review item — see below | Not applicable |
| Resend / email transport message logs | Copies of already-sent emails and their payloads live in the transport's own system | **Cannot be reached.** Legal review item — see below | Not applicable |

## Decisions (proposed defaults)

### 1. Immediate deletion on re-auth + typed confirmation

Clicking "Delete my account" on the account page requires:

1. **Re-authentication** — the parent re-enters their password; the API calls `supabase.auth.signInWithPassword` server-side to verify liveness. Must succeed within ~2 minutes of the delete confirm POST (nonce in a short-lived cookie).
2. **Typed phrase** — the parent types `delete my account` into a confirmation field.

Both guards are intentional: re-auth proves this is the account owner, the phrase defends against an accidentally-clicked confirm button. Once both pass, the API opens a transaction and runs the full deletion in one shot. On commit, post-commit tasks fire for the Supabase Auth hard-delete and the per-lesson Google Calendar sync.

**No grace period, no scheduled run, no self-serve cancel-after-click.** The user chose to delete; the system delivers. If a user comes back and wants their data, that's a new signup.

### 1a. Stale sessions must fail closed the moment the transaction commits

Supabase access tokens stay cryptographically valid until their `exp` claim passes. The auth user's hard delete runs after commit as a post-commit task, and can retry on transient failure — so there is a window where `supabase.auth.getUser(token)` can still succeed for a token belonging to a just-deleted account. The scrubbed profile is the only authoritative "this account is gone" signal in that window.

Rule: `requireUser` returns **`401 Unauthorized`** (not 403) the instant it loads a profile with `disabled_at` set. Scrubbing sets `disabled_at` inside the transaction, so the next request from a still-valid token hits the 401 path immediately on commit. 401 (rather than the existing 403 for `disabled_at`) is the right code for "your identity no longer exists" — clients that distinguish the two will clear their session and redirect to signup. Age-attestation misses stay 403 because a user with no `age_attested_at` is authenticated but not yet authorized to use the app, which is the 403 semantic.

The web app signs the user out immediately after the `204 No Content` response from `POST /me/deletion/confirm` (clears the Supabase SSR cookie, redirects to a "your account has been deleted" page). A still-valid token lingering in another tab or device hits the 401 on next request.

Test: a request with a still-valid access token for a profile whose `disabled_at` has just been set returns 401. Covered in the auth middleware test suite in Phase 1 so the behavior exists before the deletion flow ships.

### 2. Last adult in the household → delete everything

If the deleting member is the **only** profile in `household_members`, the household row goes, and with it the audit log, invites, home pools, swimmers, swimmer-owned data (ratings, sessions, notes, meet swims, drafts), batches, the deleting member's own profile is scrubbed, and their auth user is hard-deleted. Teen accounts (future feature) are treated as household members and go with the household the same way.

### 3. Other adults remain → only this person is removed

The deleting member is removed from `household_members`. The household and its other members are untouched. The deleting member's profile is scrubbed and their auth user is hard-deleted. `household_audit_log` rows for this household have `payload` nulled where the deleting member is `actor_id` or `target_profile_id`; structural columns stay.

**If the deleting member is the owner AND another owner/manager remains**, the API returns `409 must_transfer_first` — same as `DELETE /households/mine/members/me`. The UI surfaces the transfer-ownership flow. The delete button is only clickable once another owner or manager isn't blocking the path. Auto-transfer-on-delete is not supported; picking the next owner is an active choice.

**If the deleting member is the owner AND the only other members are viewers**, the delete is treated as the **solo case**. Rationale: viewers are read-only by design; they neither manage swimmers nor own household state. Leaving them behind as an ownerless household serves nobody — they could not promote themselves (owner transfer is owner-only) and the household would have no one who can administer it. The solo path deletes the household, its swimmers, and all kids' data; the viewers lose their `household_members` rows (cascade from the household delete) but **their profiles are not touched**. They can be re-invited to another household later. A side effect is that these ex-viewers temporarily have a profile with no household membership — the one-household-per-profile invariant becomes "every active profile usually belongs to exactly one household"; the orphan state is bounded and documented here.

A `household_audit_log` row records the removal (`action = 'member_deleted_account'`, scoped to the surviving household, `actor_id = target_profile_id = <scrubbed profile>`).

### 4. Kids' data is hard-deleted

Follows from decision 2. The append-only trigger on `skillRatings` (ADR 022 / ADR 032) does not block DELETE — only UPDATE. **Deletion here is the one documented exception** to the ledger's immutability, and this plan is the place it lives. Leaderboards have no dedicated table; they are computed from `meetSwims` and `skillRatings` at read time, so deleting those rows removes the swimmer from every leaderboard at the source.

### 5. Past lessons kept + anonymized, future lessons cancelled + anonymized

See "Lessons — past vs future." After anonymization, a lesson row has `id`, `starts_at`, `duration_minutes`, `type`, terminal `status`, timestamp columns, `calendar_sequence`, `anonymized_at`, `location_snapshot`, `swimmer_count`. Nothing identifying.

### 6. Future lessons on Google Calendar

Post-commit task per cancelled lesson. Rides the existing `calendar_sync_status` retry. Jason sees one `account_deleted` coach notification listing the freed-up times (no family name, no swimmer names), not N per-lesson cancellation notifications.

### 7. Pending emails and coach notifications

See "Email outbox and coach notifications." Non-terminal outbox rows are deleted; terminal outbox rows have payload nulled. Coach notifications tied to the deleted household's lessons/batches are hard-deleted; one new `account_deleted` summary row is inserted carrying only times.

### 8. Audit logs and append-only ledgers — documented exceptions

- `household_audit_log`: solo case cascades with the household (UUIDs only, no PII leak). Leave case keeps the rows and nulls `payload` where the deleting profile is involved.
- `coach_audit_log`: not touched unless the deleting profile appears in `actor_id` or `target_profile_id` (defensive null of `payload` if so).
- `skillRatings`: hard-deleted in the solo case. Documented exception.
- `lesson_email_outbox`: payload-scrubbed per above.

If any audit row ever starts carrying PII values (full names, note text, before/after text) in a future feature, this plan must be revisited.

### 9. External cleanup via `account_deletion_jobs`

External tasks run in post-commit microtasks. A new table carries their retry state:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `profile_id` | uuid | **Nullable**, no FK — the auth user it names will be deleted. Kept as an identifier for logging/correlation only |
| `scope` | text not null | `'solo'` or `'leave'` |
| `auth_user_id` | uuid not null | The auth user to delete |
| `status` | text not null | `'pending' \| 'running' \| 'completed' \| 'failed'` |
| `attempts` | integer not null default 0 | |
| `anonymized_lesson_ids` | uuid[] not null default '{}' | **Phase 3 addition.** Captures the set of lessons the deletion anonymized so the retry drain can walk them (past → patch Google event; future → delete). Anonymization nulls every household-side tie, so without this column the drain would have no way to re-derive the set on retry. |
| `last_error` | text | Short structural summary string (first failure wins, no PII). |
| `completed_at` | timestamptz | |
| `created_at` | timestamptz not null default now | |

Flow:

1. The deletion transaction inserts one `account_deletion_jobs` row with `status = 'pending'` and commits.
2. The route's post-commit callback invokes the Supabase Auth delete + per-lesson calendar syncs. On success, updates the job to `completed`.
3. If any post-commit call fails, the job stays `pending` and a small cron (every ~5 minutes, bounded batch size) retries up to N times (propose 10, same as the email sender).
4. After N retries, the job terminates at `failed` — the DB side has succeeded (that happened at step 1); what's lingering is a Google Calendar event that didn't delete or an auth user that didn't delete. Both are visible for operator cleanup: the calendar event on Jason's own calendar, the auth user on the Supabase dashboard filtered by `id`. **Terminal failure logs at `error` level with `event = "account_deletion_cleanup_failed"`, the `account_deletion_jobs.id`, the scope, and the attempts counter — no PII.** No coach notification is written; Jason can't fix a Supabase or Google outage from the alerts page, and surfacing it there adds noise without an action. See "Production setup" below for the alerting hookup.

**This cron is retry-only.** It does not schedule deletions. There is no "pick up pending deletions" path — the deletion itself ran at the moment the user clicked confirm. The cron exists so a Google 500 or a Supabase rate limit doesn't leave the external world inconsistent.

### 10. Confirmation UX

The parent navigates to **Account → Delete account**. The screen shows a preview populated from `POST /me/deletion/preview`:

- Household name + member count
- Swimmer names (first name + last initial) and count
- Count of past lessons that will be anonymized
- Count of future lessons that will be cancelled
- "The following person will be notified: your coach"
- A plain-language explanation: "This is immediate and cannot be undone. Your login will stop working the moment you click delete."

To proceed: re-auth → type `delete my account` → click confirm. If the parent is an owner with other members, the confirm button is disabled and a block screen explains the transfer-first requirement with a link to household settings.

## Transaction shape

1. Open `db.transaction(async (tx) => { ... })`
2. Advisory lock on `hashtext('account-deletion:' + profileId)` to prevent two concurrent deletions of the same account
3. Reload the profile and assert `disabled_at IS NULL` — idempotency guard if a retry gets here
4. Load `household_members` for this profile, determine `scope` (`solo` if only member, `leave` otherwise)
5. If `scope = 'leave'` and this profile is still `owner`, throw `OwnerNotTransferredError` (should be caught at confirm time; belt-and-braces)
6. Capture `deletingProfileId = profile.id` — needed as `canceled_by` on future-lesson cancellations before the scrub
7. **If `scope = 'leave'`:** null `payload` on relevant `household_audit_log` and `coach_audit_log` rows; insert `member_deleted_account` audit row; delete this profile's `household_members` row; scrub the profile (step 11); skip to step 13
8. **If `scope = 'solo'`:** cancel future lessons (`status = 'canceled'`, timestamps, `calendar_sequence += 1`) — snapshot their ids into `cancelledFutureLessonIds`
9. Anonymize all lessons for this household — past and now-cancelled future — writing nulls and `anonymized_at` / `location_snapshot` / `swimmer_count`
10. Delete swimmer-owned data in order: `ratingFaultTags` → `skillRatings` → `coachNotes` → `evaluationDrafts` → `evaluationSessions` → `meetSwims` → `swimmerClubs` → `leagueRegistrations` → `lesson_swimmers` rows for this household's swimmers → `swimmers`
11. Delete `lesson_email_outbox` rows for this household with non-terminal status; null `payload` and set `scrubbed_at` on terminal rows
12. Hard-delete `coachNotifications` rows referencing this household's lessons/batches; insert one `account_deleted` coach notification (times only, no names)
13. Delete `bookingBatches` for this household (lessons now point to `NULL` via step 9)
14. Delete `lessonLocations` (home pools) for this household — RESTRICT passes since step 9 nulled `lessons.location_id`
15. Delete `household_invites`, `household_members`, `household_audit_log`, and finally the `households` row
16. Scrub the deleting profile: `full_name = NULL`, `phone = NULL`, `email = 'deleted-user-' || id || '@invalid.local'`, `disabled_at = now()`, `age_attested_at = NULL`
17. Insert one `account_deletion_jobs` row with `status = 'pending'`, `auth_user_id = <auth user>`, `scope = <'solo' | 'leave'>`
18. Commit

**Post-commit callback (fires before the HTTP response):**

- One `syncLessonToGoogle(lessonId)` microtask per `cancelledFutureLessonIds`
- One `supabase.auth.admin.deleteUser(authUserId)` microtask
- On all-success, update `account_deletion_jobs.status = 'completed'`. On any failure, leave the job `pending` with `attempts` / `last_error` updated so the retry cron picks it up

The HTTP response returns `204 No Content` once the transaction commits — the external calls may still be in flight, but the parent's data is gone from the app the instant the response goes out.

## Production setup

Non-code items that must be in place before this flow runs in prod. Tracked here so the launch checklist picks them up.

- **Alerting for deletion job failures.** The `error`-level log line `event = "account_deletion_cleanup_failed"` needs an alert route so Jason sees a terminal retry failure. Wire it into whatever log-based alerting the project is using (Supabase log drains → provider, or the per-service log alert). Pager expectation: low-urgency — the DB side already succeeded; the lingering effect is one undeleted Google event or one un-deleted auth user that Jason (or an operator) can clean up manually.
- **Supabase service-role key available to the API** (already in place for other admin calls; confirm it's present in the prod env and that the `account_deletion_retry` cron process reads the same env).
- **Launch checklist entry** linking to this plan so the privacy-reviewer and the kids'-data legal review both run before merging to `dev`.

## Legal review

Items that cannot be resolved inside this plan and need the kids'-data legal review:

1. **Supabase physical backups.** Point-in-time backups retain deleted data for Supabase's retention window (typically 7–30 days depending on tier). This plan cannot reach into backups. Whether that is acceptable under COPPA, CCPA-for-minors, or the operator's contractual posture is a legal question.
2. **Email transport (Resend) logs.** Already-sent emails sit in the transport's system with their original payloads (swimmer first names, times, home-pool address). Resend's retention is set in their account controls; app-side scrubbing cannot reach it. Confirm the retention setting and whether it satisfies the legal posture.
3. **Google Calendar history on Jason's calendar.** The sync-delete removes the future-lesson events, but Google may retain its own history/activity log. First names and (for named-pool events) full addresses have already been disclosed to Google at creation time. Overlaps with the open items in `docs/accounts.md:89` and `:90` — add to that review packet.
4. **Supabase Auth residual elsewhere.** `auth.admin.deleteUser` cascades inside the `auth.*` schema, but Supabase's own server-side logs (admin API, GoTrue) may retain the deleted email for their internal retention window. Confirm with Supabase or treat as unresolved risk.

## Phases

Each phase is its own PR off `feature/account-deletion`, with its own tests.

### Phase 1 — Additive schema + stale-session guard

**What ships (additive only — no existing column changes shape):**
- Add three new nullable columns to `lessons`: `anonymized_at timestamptz`, `location_snapshot text`, `swimmer_count integer`. All start null and stay null for every live lesson. Phase 2 is the only writer.
- New `account_deletion_jobs` table per decision 9.
- **Drop the `profiles.id → auth.users.id` FK constraint.** Profile primary key stays as `uuid`; signup triggers continue to write with the auth.users.id value.
- **Audit tests and scripts that rely on the FK cascade** and update them to explicitly delete the profile row. The integration-test helper `apps/api/src/__tests__/integration/helpers.ts` calls `deleteSupabaseUser` in cleanup for `createTestUser` and `createTestUserInHousehold`; today that cascades to the profile row. After the FK drop, those cleanups delete the profile row explicitly before (or after) deleting the auth user, so tests never leave orphan profiles behind.
- **`requireUser` returns `401` when `profile.disabled_at` is set** (changed from the existing 403). Add a test that a request with a still-valid access token for a disabled profile returns 401.
- Update `docs/data-model.md` and `docs/accounts.md` (strike the "out of scope for now" paragraph on line 103; update the "blocks accounts with ... disabled_at set" sentence to specify the 401 response).

**Deferred to Phase 2 (nullable-ization lands with the code that writes nulls):**
- Dropping `NOT NULL` on `lessons.household_id`, `location_id`, `requested_by`, `approved_by`, `declined_by`, `canceled_by`, `no_show_by`, `batch_id`. These only legitimately become null when the deletion engine anonymizes a row, which is Phase 2 code.
- Changing `ON DELETE RESTRICT` to `ON DELETE SET NULL` on the `household_id` / `location_id` FKs.
- Auditing the ~30 call sites that currently treat these columns as non-null and adding explicit null guards at query boundaries. Coupling the audit to the PR that introduces nullable rows at runtime keeps the review focused.

**Tests:**
- Migration applies cleanly on a fresh db (`pnpm db:up && pnpm db:migrate`)
- Drizzle snapshot diff clean
- Supabase trigger smoke test: create an auth user → profile row is created with the same id; update auth user email → profile email syncs; delete auth user → profile row **is not touched** (new behavior)
- Auth middleware: stale-token-on-disabled-profile returns 401; age-not-attested still returns 403
- Integration test cleanup: after a test run, no orphan profile rows remain (asserted by an integration suite teardown check)

### Phase 2 — Deletion engine (backend)

**What ships:**
- Migration: drop `NOT NULL` on `lessons.household_id`, `location_id`, `requested_by`, `approved_by`, `declined_by`, `canceled_by`, `no_show_by`, `batch_id`. Change the `household_id` and `location_id` FKs from `ON DELETE RESTRICT` to `ON DELETE SET NULL`. Audit the ~30 call sites that currently treat these as non-null — introduce a `requireLiveLessonFields` helper and apply it at query boundaries so anonymized rows loudly fail if they ever leak into a live-lesson code path.
- `apps/api/src/services/accountDeletion/` module with pure functions per step: `scrubProfile`, `anonymizeLessons`, `cancelFutureLessons`, `hardDeleteSwimmerData`, `scrubEmailOutbox`, `scrubAuditPayloads`, `deleteHousehold`, `enqueueDeletionJob`
- Routes under `requireUser`:
  - `POST /me/deletion/preview` → returns the confirmation screen summary
  - `POST /me/deletion/confirm` → re-auth check, runs the transaction, triggers the post-commit tasks, returns 204
- Shared Zod schemas in `packages/shared/src/schemas/accountDeletion.ts`
- Audit log entries at every step

**Tests:**
- Integration: solo household path — one tx, all rows deleted or scrubbed, job row inserted
- Integration: leave household path — only this member removed, household survives, audit payload nulled where applicable
- Integration: owner-not-transferred returns 409
- Integration: re-auth failure returns 401
- Unit: each scrubber function in isolation
- Fault injection: transaction rolls back cleanly on mid-step throw (reuse existing harness per `docs/local-fault-injection.md`)

### Phase 3 — External cleanup retry drain + past-event anonymization

**What ships:**
- `runAccountDeletionRetryDrain` runs **inside the existing `/internal/cron/tick` handler**, under the shared cron lease. No new cron process. Picks `account_deletion_jobs` with `status = 'pending'` AND `attempts < ACCOUNT_DELETION_MAX_ATTEMPTS` (10, matching the email outbox budget) AND `updated_at` older than a 60-second retry wait floor, in `updated_at` ascending order, bounded batch (20 per tick), `FOR UPDATE SKIP LOCKED` so an overlapping tick (lease-expired takeover) can't double-process a job.
- Migration 0070 adds `account_deletion_jobs.anonymized_lesson_ids uuid[] NOT NULL DEFAULT '{}'` so both the route's post-commit fan-out and the retry drain walk the same authoritative set of lesson ids. Anonymization nulls every household-side tie, so without this column the drain would have no way to re-derive which Google events to reconcile on a retry.
- Shared `runAccountDeletionCleanup` helper (`services/accountDeletion/cleanup.ts`) is the single external-cleanup entry point. Route and retry drain both call it so the two paths cannot drift. Dependencies (Supabase admin client, `syncAnonymizedLessonToCalendar`) are injected via an optional `deps` argument so tests can mock without `vi.mock` on the import site.
- **Past Google Calendar events are now anonymized** instead of left in place (ADR 034 revision). The cleanup helper dispatches per anonymized lesson by `starts_at`:
  - Future → `deleteEventIdempotent` (unchanged behavior)
  - Past → `patchEventIdempotent` with title `"Lesson (deleted family)"`, location = stored `location_snapshot`, description = short scrubbed string. The event stays on Jason's calendar as "I worked this slot" signal but identifies nothing.
  - Both ops treat 404/410 as success — a second drain pass against an already-handled event is a no-op.
- **Idempotent Supabase auth delete.** A `deleteUser` response of `{ error: { code: 'user_not_found' } }` or an HTTP-404-shaped thrown error is treated as success — a prior partial run's auth delete that landed before the retry sees it as "already done."
- Terminal `'failed'` state after `ACCOUNT_DELETION_MAX_ATTEMPTS` retries. Logs at error level with `event = "account_deletion_cleanup_failed"`, job id, scope, attempts — **no coach notification** per ADR 034 (Jason can't act on a Supabase/Google outage from the alerts page; log-based alerting is the deliberate choice).
- Metrics: `accountDeletionRetryAttempted` / `accountDeletionRetrySucceeded` / `accountDeletionRetryFailedTerminal` are rolled into the cron/tick info log and the response body alongside the other drains' counts.

**Tests:**
- Integration: cron re-drives a `pending` job after a mocked Supabase Auth failure, succeeds on the next tick.
- Integration: terminal failure after `ACCOUNT_DELETION_MAX_ATTEMPTS` logs the error and flips the row to `'failed'`; a subsequent tick does not pick it up.
- Integration: `user_not_found` from the Supabase admin API collapses to success on the first retry.
- Integration: past events get patched to the "deleted family" shape and future events get deleted (both verified against a mocked google client that captures the calls).
- Integration: an overlapping tick (second request firing while the first's lease is still held) returns `{ skipped: true }` without re-processing the same job — the cron lease already serializes this, the test asserts the effect.

### Phase 4 — UI (apps/web)

**What ships:**
- `/account/delete` page in the parent dashboard
- Preview populated from `POST /me/deletion/preview`
- Re-auth step + typed-phrase confirmation
- Block screen for owners with members, linking to transfer flow
- Post-confirm success screen (user is now logged out) and session cleanup
- Design per `jg-swim-design` / `emil-design-eng` skills

**Tests:**
- Playwright: full happy path on solo and leave cases
- Playwright: owner-with-members shows the block screen and the transfer CTA
- Playwright: re-auth failure shows error and keeps the user on the page
- Server/client boundary compliance per `CLAUDE.md`

### Phase 5 — Privacy review + docs

**What ships:**
- Run the `privacy-reviewer` subagent on the full branch
- Legal-review handoff doc covering the four items in "Legal review" above
- `docs/accounts.md` updated to reference this ADR and strike the "out of scope" line
- `drain.ts:118` TODO removed and the ADR referenced instead
- Rule added to `docs/accounts.md`: **teen accounts must not ship without extending this flow to cover them** (see open questions)

## Open questions

Everything else has been folded into decisions above. Remaining:

1. **Teen accounts — deletion shape.** When teen accounts ship (per `docs/accounts.md:9`), confirm whether deletion of a teen's own account is handled the same way as a parent's deletion, or whether it is owner-mediated. Phase 5 adds the rule that **no teen-account build may land without extending this flow**, but the shape is TBD when the feature arrives.
