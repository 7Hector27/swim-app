# 034 — Parent account deletion

**Date:** 2026-11-04
**Status:** Accepted

## Context

A parent has no way to close their own account today. The schema has been partly ready for this for a while — `profiles.disabled_at` exists, `apps/api/src/services/emails/drain.ts:118` carries a `TODO(account-deletion)` for the outbox scrub, and `docs/accounts.md:103` explicitly defers the flow: *"Profiles are never hard-deleted. … the full account deletion flow is out of scope for now."* This ADR closes that gap.

Three constraints shape the design. First, kids' data lives across a dozen tables (swimmers, evaluationSessions, skillRatings, ratingFaultTags, coachNotes, evaluationDrafts, meetSwims, swimmerClubs, leagueRegistrations, lesson_swimmers), and some of those are append-only by trigger (`skillRatings` per ADR 022 / ADR 032) or reference each other through RESTRICT FKs that force a specific deletion order. Second, lessons tie identity (household, requesters, home-pool addresses, swimmers) to historical work Jason legitimately wants to keep — a lesson row is the only source of "I was teaching on this date," and losing it would lose his income history. Third, the real cleanup extends outside Postgres: future lessons live on Jason's Google Calendar (ADR 027), pending transactional emails live in `lesson_email_outbox` (ADR 028), and the login itself lives in Supabase Auth, none of which are part of the DB transaction.

The planning doc (`docs/plans/account-deletion.md`) has the full step-by-step. This ADR records the architectural decisions it depends on.

## Decision

### Immediate deletion on re-auth + typed confirmation

Clicking "Delete my account" requires both re-authentication (password re-entered, verified server-side via `supabase.auth.signInWithPassword`) and a typed `delete my account` phrase. Once both pass, the API opens a transaction and runs the full deletion in one shot. On commit, post-commit tasks fire for the Supabase Auth hard-delete and per-lesson Google Calendar sync. The HTTP response is `204 No Content` as soon as the transaction commits; external calls may still be in flight, but the app-side data is gone.

No grace period. No scheduled cron run. No self-serve cancel-after-click.

**Stale tokens:** Supabase access tokens stay cryptographically valid until their `exp` claim passes, and the auth user's hard delete runs after commit and can retry. `requireUser` returns **`401 Unauthorized`** (changed from the existing 403) the instant it loads a profile with `disabled_at` set, which the deletion transaction writes in-tx. 401 is the right code for "your identity no longer exists" — distinct from the age-attestation 403 which means "authenticated but not yet authorized." The web app signs the user out immediately after the `204` response from `POST /me/deletion/confirm`; any still-valid token lingering in another tab hits the 401 on next request. Covered by a test in Phase 1 so the behavior exists before the deletion flow ships.

**`disabled_at` becomes the deletion marker.** The column existed before this ADR as unused scaffolding — no code path wrote to it. This flow is its first and only writer. The two existing readers (`requireUser`'s block, and `getActiveCoachProfile`'s active-coach filter) do the right thing for the "account is gone" semantic. If a future admin "ban without delete" feature ships, it needs a separate column so the two states can't collide on `disabled_at`.

Alternatives considered:

- **30-day grace period with a daily deletion cron.** Rejected. The drafted version shipped reversibility at the cost of a scheduling layer, a reactivation path, and an admin console for Jason to unwind a mistaken click. The reversibility value is small for v1 (volume is low, re-signup is cheap) and the extra surface area (`pending_deletion_at`, deletion cron, cancel endpoint, UI banner, admin tool) is real. Removing it keeps the flow honest: the user asked to be deleted.
- **Immediate deletion inside the HTTP handler with external calls inline.** Rejected. The Supabase Admin API and Google Calendar API are both network calls that can take seconds or fail; blocking the HTTP response on them couples commit-success to third-party availability. Post-commit tasks + a retry-only cron for the externals is a cleaner split.

### Scrub profiles. Hard-delete Supabase Auth users. Drop the FK between them.

The profile row survives with `full_name = NULL`, `phone = NULL`, `email = 'deleted-user-<uuid>@invalid.local'`, `disabled_at = now()`, `age_attested_at = NULL`. Every existing FK that points at `profiles` — `household_audit_log.actor_id`, `swimmers.public_consent_by`, lesson actor columns, void/supersede authors in the ratings ledger, invite authors — still resolves after the scrub.

The matching Supabase Auth user is **hard-deleted** via `supabase.auth.admin.deleteUser(id)` in the post-commit task. The `profiles.id → auth.users.id` CASCADE FK is dropped as part of Phase 1 so this deletion no longer wipes the scrubbed profile. The lost invariant ("every profile has a corresponding auth user") is the *point* of the scrub.

Why delete and not scrub-and-ban:

- Banning is not deleting. The email, phone, raw metadata, linked identities, sessions, and refresh tokens all still exist on a banned auth user.
- The scrub approach forces us to enumerate every PII-bearing column on `auth.users`, `auth.identities`, and any future table Supabase adds under `auth.*`. That list is not static — Supabase can add fields at any time — and tracking it forever is a weaker guarantee than deletion.
- `auth.admin.deleteUser` cascades inside the `auth.*` schema (`identities`, `sessions`, `refresh_tokens`, `mfa_*`) in one call.

The FK drop is low-risk for prod paths. The Supabase triggers `on_auth_user_created` and `on_auth_user_updated` write to `profiles` by SQL value, not via the FK. RLS policies that use `auth.uid() = profiles.id` compare values, not follow the FK. Signup continues to work. Token verification continues to work. **Tests and scripts that delete auth users to clean up profiles must be audited** — the integration-test helper (`createTestUser` / `createTestUserInHousehold` cleanups) relies on this cascade today. Phase 1 updates those cleanups to delete the profile row explicitly so no orphans linger after a test run.

Alternatives considered:

- **Hard-delete the profile and null the FKs.** Rejected. Nulling consent audit, void-author, and `household_audit_log.actor_id` loses accountability on records that exist specifically to carry it. ADR 017 made the audit log UUID-only precisely so that *keeping* the rows would never leak PII; scrubbing the referent profile honors that intent.
- **Scrub auth.users + delete identities + ban indefinitely.** Rejected as above. Documented as the fallback if dropping the FK ever becomes impossible, but preferred option is deletion.

### Two cases: "solo" and "leave"

The deletion engine branches on household membership. If the deleting profile is the only member of its household, the household and everything under it (swimmers, kids' data, home pools, lessons, batches, invites, audit log) is deleted or anonymized. If other members remain, only this member is removed from `household_members`, their profile is scrubbed, and the household and its other members are untouched. Owners with surviving members are rejected at confirm time with `409 must_transfer_first`, same as `DELETE /households/mine/members/me`. Auto-transfer-on-delete is not supported; picking the next owner is an active choice.

### Past lessons are anonymized, not deleted. Future lessons are cancelled, then anonymized.

A lesson row is Jason's record of when he worked, and that signal survives the account. Before the swimmers are dropped, every lesson for this household is updated in the same transaction: `household_id`, `location_id` (for home pools), the actor columns (`requested_by`, `approved_by`, `declined_by`, `canceled_by`, `no_show_by`), `decline_reason`, `google_calendar_event_id`, `batch_id` all nulled; `anonymized_at = now()`; `location_snapshot` records a coarse text ("Home pool" or the named-pool name) so Jason can still read the row; `swimmer_count` is snapshotted (number isn't identifying).

Columns on the `lessons` table go nullable to support this. Call sites that previously trusted `lesson.householdId` need explicit null guards or an "anonymized" branch; the audit was done in planning.

Future lessons (`starts_at > now()`, status in `('approved', 'pending')`) first go through the normal cancel transition inside the same transaction. No parent-facing `lesson_canceled` email is enqueued — the recipient is being deleted. One `coachNotifications` row with `category = 'account_deleted'` lists the freed-up lesson times (no family name, no swimmer names), instead of N per-lesson cancellation notifications.

### Google Calendar: past events anonymized, future events deleted (Phase 3 revision)

The initial plan called for `syncLessonToGoogle` per cancelled future lesson, removing those events. That left **past** events (completed lessons already on Jason's calendar) carrying the swimmer first name in the title and the family's home-pool address or the named-pool address in the location — identifying data about a deleted family still living in Google's system.

Phase 3 revises this: the post-commit fan-out and the retry drain walk the full `anonymized_lesson_ids` set (past + future combined, captured on the `account_deletion_jobs` row for the drain's benefit) and dispatch by `starts_at`:

- **Future events** (`starts_at > now()`): deleted via `deleteEventIdempotent`. The household is gone; the slot on Jason's calendar should clear.
- **Past events** (`starts_at <= now()`): patched via `patchEventIdempotent`. Title becomes `"Lesson (deleted family)"`, location becomes the stored `location_snapshot` (already coarse — "Home pool" for a home-pool row, the named-pool name otherwise), description becomes a short scrubbed string pointing nowhere. The event stays on the calendar as historical "I worked this slot" signal but no longer identifies the family.

Both operations are 404/410-idempotent so a second drain pass against an already-handled event is a no-op. The retry drain reads `account_deletion_jobs.anonymized_lesson_ids` to know which lessons to reconcile — the anonymization step itself nulled every tie back to the household, so without the explicit list on the job row there would be no way to re-derive the set on a retry.

### Append-only ledger: deletion is the documented exception

`skillRatings` is append-only by trigger (ADR 022 / ADR 032). The trigger enforces UPDATE immutability; DELETE is not blocked and never has been. This ADR is the place where the one-and-only exception to the ledger is written down: **account deletion is allowed to DELETE `skillRatings` rows for the deleted household's swimmers.** No other feature may.

### Audit log payloads are scrubbed defensively

`household_audit_log` and `coach_audit_log` both carry a sparse optional `payload jsonb` added in later migrations. Surveyed usage today is UUIDs and field-name arrays only — no before/after values, no free text. In the solo case `household_audit_log` rows cascade with the household, which is safe. In the leave case the rows stay and this ADR requires the engine to `UPDATE household_audit_log SET payload = NULL WHERE household_id = <this household> AND (actor_id = <deleting profile> OR target_profile_id = <deleting profile>)` before scrubbing the profile. Same defensive null is applied to any `coach_audit_log` row that references the deleting profile (not expected to exist today, but defensive). Structural columns (action, actor_id, target, created_at) stay in both cases.

This rule is the forward-looking guard: if any audit entry ever starts storing values (a renamed-from name, a quoted note snippet), the scrub already catches it.

### Coach notifications tied to the deleted household are hard-deleted

The old approach (null the FK, scrub the payload, keep the row) was rejected. Those alerts are about a household that no longer exists; the "historical push went out" record has no operational value and leaves coach-side rows carrying stale identifiers. The engine hard-deletes them and inserts one `account_deleted` summary row carrying only the freed-up lesson times — no family name, no swimmer names, no household id.

### Email outbox: delete non-terminal, scrub terminal

`lesson_email_outbox` payloads carry PII (swimmer first names, addresses, decline reasons). Non-terminal rows (`status IN ('queued', 'sending')`) are deleted inside the transaction. Terminal rows (`status IN ('sent', 'permanently_failed')`) have `payload = NULL` and `scrubbed_at = now()` written, fast-forwarding the 30-day age-based scrub that `drain.ts:118` currently handles. This retires the `TODO(account-deletion)` marker for this household's rows.

### External cleanup reliability via `account_deletion_jobs`

External side effects (Google Calendar event reconcile, Supabase Auth hard-delete) run in post-commit microtasks and need per-call retry state. A new `account_deletion_jobs` table carries that state:

```
(id, profile_id, auth_user_id, scope, status, attempts,
 anonymized_lesson_ids, next_attempt_at, last_error, completed_at,
 created_at, updated_at)
```

`scope` is `'solo'` or `'leave'`. The deletion transaction inserts one row with `status = 'pending'` and commits. The post-commit callback runs the external calls and flips status to `'completed'` on success. If any external call fails, the row stays `'pending'` with `attempts` / `last_error` / `next_attempt_at` updated. The retry drain (`runAccountDeletionRetryDrain`) runs inside the shared `/internal/cron/tick` handler (not a separate cron service) and re-drives any row whose `next_attempt_at <= now()` until success or `ACCOUNT_DELETION_MAX_ATTEMPTS` is exhausted. **Terminal `'failed'` logs at `error` level with `event = "account_deletion_cleanup_failed"` and the job id — no coach notification.** Jason can't fix a Supabase or Google outage from the alerts page, and surfacing it there adds noise without a usable action; log-based alerting routes it to whoever can intervene (ops or Jason via email).

**Exponential backoff spanning at least a day before terminal.** Review feedback after Phase 4 flagged a real-world concern: a Supabase Auth outage or a delayed Jason-reconnect could blow through a flat retry budget in under an hour. The curve is now 5-minute base doubled per real failure, capped at 6 hours. With `ACCOUNT_DELETION_MAX_ATTEMPTS = 11`, the sum of waits across 10 inter-attempt gaps is `5+10+20+40+80+160+320+360+360+360 = 1715 min ≈ 28.6 h` before the job goes terminal. One extra attempt over the email-outbox budget is cheap and covers the longer-outage profile that two upstream services introduce.

**Paused state when Jason's Google integration is disconnected.** Jason's OAuth is in Testing mode and his refresh token expires weekly. If a family deletes while the integration is in the reconnect window, the calendar step can't run — but that is not a real failure to retry; it's a wait on an external human action. `syncAnonymizedLessonToCalendar` returns `{ status: "integration_paused" }` (not an exception) when the integration row is missing, `needs_reconnect`, `disconnected`, or returns `invalid_grant` on refresh. `runAccountDeletionCleanup` propagates that as `paused: true` when no real error occurred, and the drain writes `next_attempt_at = now() + 5 minutes` (the cron tick cadence) **without incrementing attempts**. The budget is reserved for real failures; Jason's weekly reconnect window does not consume it. A paused calendar step combined with a real auth-delete failure still counts as a real attempt, because the auth step is the one actually broken.

The practical consequence for the review's concern: a disconnected integration during a weekly reconnect window would previously have burned 11 attempts in ~50 minutes and left anonymized events (swimmer first names, home-pool address) on Jason's calendar forever — the reconcile cron already skips anonymized rows (Phase 3.8). Now the deletion-job pauses indefinitely, silently waiting, and reconciles the past events the first tick after Jason reconnects.

Alternatives considered:

- **Run the external calls inside the DB transaction.** Rejected. Network calls inside a long transaction extend the lock window arbitrarily and couple commit-success to third-party availability.
- **Put the auth-admin call on `lesson_email_outbox`.** Rejected. Different scope, different failure modes, different retry semantics; overloading the outbox would need a new event type and a scope-aware sender branch.

### Confirmation UX: re-auth + typed phrase

Re-auth proves liveness, the typed phrase defends against an accidentally-clicked confirm button. The confirm screen shows a preview (counts of swimmers, past lessons, future lessons; the household name; the member count) and plain-language copy ("This is immediate and cannot be undone"). If telemetry later shows the combination is too heavy, we can dial back — but not before launch.

**Wrong password returns `403 invalid_password`, not `401`.** The web client's convention is that any `401` from an API call means "your session is dead, sign the user out and redirect to `/api/signout`" (see `apps/web/src/lib/requireAuth.ts` and every Server Action that forwards to the API). Returning `401` on a wrong confirmation password would sign the authenticated user out of the rest of their account the instant they mistyped. `403 invalid_password` is a distinct signal the Phase 4 UI can show as an inline error without triggering the global sign-out. The upstream Supabase `signInWithPassword` error is unchanged; only the public-facing status + code on this route differ.

**Typed-phrase comparison is trimmed + case-insensitive.** iPhone autocapitalizes the first word of the field even with `autoCapitalize="none"` on older iOS versions, so `"Delete my account"` is a genuinely-intended input that a strict `===` check would reject. The phrase itself stays lowercase in the constant so the UI can show the canonical form. Comparison is centralized in `matchesDeletionConfirmationPhrase(input)` in `packages/shared/src/schemas/accountDeletion.ts` so the client's button-enablement rule, the web Server Action's defense-in-depth check, and the API route's authoritative check all agree on what counts as a match. The phrase input carries `autoCapitalize="none"`, `autoCorrect="off"`, `spellCheck={false}` so iOS hints don't rewrite what the user typed.

### Service-role credential posture

`auth.admin.deleteUser(authUserId)` is the first app-side consumer of the Supabase service-role key. The key lives on the Railway API service only — as `SUPABASE_SERVICE_ROLE_KEY` — and **never** on Vercel and **never** in a `NEXT_PUBLIC_*` variable. The API's env validator (`apps/api/src/lib/env.ts`) refuses to boot when `APP_ENV` is `dev` or `prod` and the key is missing or empty, so a deploy that forgot to copy the credential fails in the Railway deploy log rather than silently serving every other route until a parent clicks delete. Local development keeps the key optional; the admin client throws on first access there if the key isn't set, which matches the "no deletion tested locally without the key" expectation.

Supabase has rolled out a new secret-key format (`sb_secret_…`) that replaces the legacy service-role JWT. The pinned `@supabase/supabase-js@2.117.2` ships `isNewApiKey` and routes the key through the `apikey` header; `auth.admin.deleteUser` works against either format.

## Legal review

Unresolved items the kids'-data legal review owns. Not decisions in this ADR; listed so the review packet is complete:

- **Supabase physical backups** retain deleted rows for Supabase's retention window (7–30 days depending on tier). Out of app's reach.
- **Resend / email transport message logs** retain already-sent payloads (swimmer first names, times, home-pool addresses) in the transport's own system. Retention is a provider setting; confirm it meets the posture.
- **Google Calendar activity history** on Jason's calendar may retain deleted-event metadata. Overlaps the existing items at `docs/accounts.md:89` / `:90`.
- **Supabase Auth internal logs** (admin API, GoTrue server logs) may retain the deleted email for their internal retention window.

## Open questions

- **Teen-account deletion shape.** When teen accounts ship (per `docs/accounts.md:9`), confirm whether deletion of a teen's own account is handled the same way as a parent's or is owner-mediated. **Rule added in Phase 5: teen accounts must not ship without extending this flow to cover them.**
