# 034 — Parent account deletion

**Date:** 2026-11-04
**Status:** Draft

## Context

A parent has no way to close their own account today. The schema has been partly ready for this for a while — `profiles.disabled_at` exists, `apps/api/src/services/emails/drain.ts:118` carries a `TODO(account-deletion)` for the outbox scrub, and `docs/accounts.md:103` explicitly defers the flow: *"Profiles are never hard-deleted. … the full account deletion flow is out of scope for now."* This ADR closes that gap.

Three constraints shape the design. First, kids' data lives across a dozen tables (swimmers, evaluationSessions, skillRatings, ratingFaultTags, coachNotes, evaluationDrafts, meetSwims, swimmerClubs, leagueRegistrations, lesson_swimmers), and some of those tables are append-only by trigger (`skillRatings` per ADR 022 / ADR 032) or reference each other through RESTRICT FKs that force a specific deletion order. Second, lessons tie identity (household, requesters, home-pool addresses, swimmers) to historical work Jason legitimately wants to keep — a lesson row is the only source of "I was teaching on this date," and losing it would lose his income history. Third, the real cleanup extends outside Postgres: future lessons live on Jason's Google Calendar (ADR 027), pending transactional emails live in `lesson_email_outbox` (ADR 028), and the login itself lives in Supabase Auth, none of which are part of the DB transaction.

The planning doc (`docs/plans/account-deletion.md`) has the full step-by-step. This ADR records the architectural decisions it depends on.

## Decision

### Grace period, not immediate deletion

Confirming deletion sets `profiles.pending_deletion_at = now() + 30 days` and bans the Supabase Auth user so logins stop. The DB scrubs and deletes do not run yet. A new daily cron (`accountDeletionDrain`) picks up profiles whose `pending_deletion_at` has passed and runs the transaction. The window is reversible via an admin endpoint Jason triggers on the user's request.

Alternatives considered:

- **Immediate deletion.** Rejected as the default. The user's wish to be gone can be achieved by banning logins immediately, which this design does. Hard-delete-at-click leaves no recovery path for an accidental or coerced click, and Supabase physical backups hold the data for 7–30 days regardless, so "immediate" doesn't actually make the data disappear faster from a legal standpoint. Biasing toward reversibility is the safer default given the data involves minors.
- **Self-serve reactivation via a link in the deletion email.** Deferred to a follow-up. The banned auth user can't reactivate themselves in-app, so v1 routes reactivation through Jason. Volume at v1 scale makes this cheap.

### Scrub profiles, don't hard-delete them

The profile row survives with `full_name = NULL`, `phone = NULL`, `email = 'deleted-user-<uuid>@invalid.local'`, `disabled_at = now()`, `age_attested_at = NULL`. Every existing FK that points at `profiles` (`household_audit_log.actor_id`, `swimmers.public_consent_by`, lesson actor columns, void/supersede authors in the ratings ledger) still resolves after the scrub.

The matching Supabase Auth user is **banned indefinitely and email-scrubbed** via the Admin API in the post-commit fan-out, not hard-deleted. `auth.users.id → profiles.id` is CASCADE, so hard-deleting the auth user would wipe the scrubbed profile row and break every surviving FK listed above.

Alternatives considered:

- **Hard-delete the profile and null the FKs.** Rejected. Nulling consent audit, void-author, and `household_audit_log.actor_id` loses accountability on records that exist specifically to carry it. ADR 017 made the audit log UUID-only precisely so that *keeping* the rows would never leak PII; scrubbing the referent profile lets us honor that intent.
- **Replace the FKs with a canonical "deleted user" placeholder profile.** Rejected as more complex than needed. Scrubbing the user's own row achieves the same FK integrity without a sentinel row and without a migration to repoint every FK on every delete.

### Two cases: "solo" and "leave"

The deletion engine branches on household membership. If the deleting profile is the only member of its household, the household and everything under it (swimmers, kids' data, home pools, lessons, batches, invites, audit log) is deleted or anonymized. If other members remain, only this member is removed from `household_members`, their profile is scrubbed, and the household and its other members are untouched. Owners with surviving members are rejected at confirm time with `409 must_transfer_first`, the same error `DELETE /households/mine/members/me` already returns — the UI surfaces the transfer-ownership flow. Auto-transfer-on-delete was rejected; picking the next owner is an active choice.

### Past lessons are anonymized, not deleted. Future lessons are cancelled, then anonymized.

A lesson row is Jason's record of when he worked, and that signal survives the account. Before the swimmers are dropped, every lesson for this household is updated in the same transaction: `household_id`, `location_id` (for home pools), the actor columns (`requested_by`, `approved_by`, `declined_by`, `canceled_by`, `no_show_by`), `decline_reason`, `google_calendar_event_id`, and `batch_id` are all nulled; `anonymized_at = now()`; `location_snapshot` records a coarse text ("Home pool" or the named-pool name) so Jason can still read the row; `swimmer_count` is snapshotted.

Columns on the `lessons` table go nullable to support this (`household_id`, `location_id`, the five actor columns, `batch_id`). This is the one schema change that affects an existing hot path; call sites that previously trusted `lesson.householdId` need an explicit null guard or an "anonymized" branch. The audit was done in planning.

Future lessons (`starts_at > now()`, status in `('approved', 'pending')`) first go through the normal cancel transition (`status = 'canceled'`, timestamps, `calendar_sequence += 1`) inside the same transaction. No parent-facing `lesson_canceled` email is enqueued — the recipient is being deleted. One `coachNotifications` row with `category = 'account_deleted'` carries the summary count to Jason, instead of N per-lesson cancellation notifications. Post-commit fan-out invokes `syncLessonToGoogle(lessonId)` per cancelled lesson, which removes the event from Jason's calendar via the existing ADR 027 one-way sync.

Alternatives considered:

- **Hard-delete lessons along with the household.** Rejected. Jason's teaching history goes away with the family, which is the opposite of what he asked for. Per-lesson anonymization keeps the work record and loses the identity.
- **Keep lesson rows with their original `household_id` pointing at a soft-deleted household.** Rejected. "Soft-deleted household" is a new concept the codebase doesn't have, and `households` has no `archived_at` column today. Nulling the FK is a smaller change and matches the shape used elsewhere for anonymized references.
- **One `lesson_canceled` email per cancelled future lesson instead of a single coach notification.** Rejected. Jason's push buzzes once per family withdrawal, not once per lesson.

### Append-only ledger: deletion is the documented exception

`skillRatings` is append-only by trigger (ADR 022 / ADR 032). The trigger enforces UPDATE immutability; DELETE is not blocked and never has been. This ADR is the place where the one-and-only exception to the ledger is written down: **account deletion is allowed to DELETE `skillRatings` rows for the deleted household's swimmers, in order to honor the deletion request.** No other feature may.

`household_audit_log` is UUIDs only (ADR 017), so deleting it alongside its household in the solo case leaks no PII. In the leave case it stays and the scrubbed profile remains a valid FK target.

`lesson_email_outbox` payloads carry PII (swimmer first names, addresses, decline reasons). Non-terminal rows (status in `('queued', 'sending')`) are deleted inside the transaction. Terminal rows (status in `('sent', 'permanently_failed')`) have `payload = NULL` and `scrubbed_at = now()` written, fast-forwarding the 30-day age-based scrub that `drain.ts:118` currently handles. This retires the `TODO(account-deletion)` marker.

`coachNotifications` payloads also carry PII. The FKs (`lesson_id`, `batch_id`) are nulled and the payload is scrubbed in-place; the row survives so Jason's alerts list still reflects historical notifications.

### Reliable external cleanup via a new deletion job table

External side effects (Google Calendar event deletion, Supabase Auth ban) run in post-commit microtasks and need per-call retry state. A new `account_deletion_jobs` table carries that state:

```
(id, profile_id, scope, scheduled_for, status, attempts, last_error, completed_at, created_at)
```

`scope` is `'solo'` or `'leave'`. The cron picks jobs where `scheduled_for <= now()` and status is `pending` or `failed` (bounded retries). The row moves to `running` at transaction start, `completed` once all post-commit microtasks succeed, or stays `pending` with incremented `attempts` if any external call failed. After N retries (propose 10, matching the email sender) it terminates at `failed`, and the residual effect (a stale calendar event, or an un-banned auth user) is operator-visible on the coach alerts page and the Supabase dashboard respectively.

Google Calendar failures ride the existing `lessons.calendar_sync_status` state machine; this job table does not duplicate that per-lesson retry. It only owns the auth-admin call and the "did every fan-out eventually succeed" aggregate.

Alternatives considered:

- **Run the external calls inside the DB transaction.** Rejected. The transaction is already large; wrapping a network call inside it extends the lock window arbitrarily and couples commit-success to third-party availability.
- **Put the auth-admin call on `lesson_email_outbox`.** Rejected. Different scope, different failure modes, different retry semantics; overloading the outbox would need a new event type and a scope-aware sender branch.

### Confirmation UX: re-auth + typed phrase

The confirm screen shows a preview (counts of swimmers, past lessons, future lessons; the household name; the member count) and a 30-day grace notice. To proceed, the user re-authenticates (password re-entry via Supabase `signInWithPassword` under the hood) **and** types `delete my account` into a confirmation field. Both guards are intentional: re-auth proves liveness, the typed phrase defends against an accidentally-clicked confirm button. If telemetry later shows the combination is too heavy, we can dial back.

## Alternatives considered

Called out inline above where each decision was made.

## Open questions

Not decided here; owned by the planning doc's "Open questions" section and the legal review. The ones that could change the ADR shape:

- Grace period length. 30 days is the recommendation; legal or Jason may force a different floor or ceiling.
- Whether logins remain active during the grace period for self-serve reactivation.
- Whether the swimmer-count snapshot on anonymized lessons is actually useful to Jason.
- Supabase physical backup retention for deleted kids' data — legal review.
