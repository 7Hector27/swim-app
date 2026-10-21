# 027 — Google Calendar sync for coach lessons

**Date:** 2026-10-21
**Status:** Accepted

## Context

The coach keeps lesson appointments in Google Calendar today and copies them in by hand after approving each booking. With more families on the app this doesn't scale, and double-entry creates drift between the lessons table and the coach's working calendar. We want approved lessons to appear automatically in Google Calendar, follow reschedules, and disappear on cancel.

Several constraints shape the design:

- Only the coach connects a calendar — parents never do, and the app is single-coach for the foreseeable future.
- The coach's existing Google Calendar must not be read, scanned, or modified. Only lessons the app itself creates should ever be touched.
- A booking must succeed even when Google is down or the integration is broken. Sync is a side effect, never a gate.
- The refresh token is a long-lived credential to a third-party account and must be protected at rest.

## Decision

**Scope: `calendar.app.created` only.** On connect, the API creates a dedicated secondary calendar titled "Axiom Aquatics Lessons" and stores only its id. This scope grants access *only* to calendars created by this OAuth client in this session, so there is no way for the app to see or edit the coach's other calendars even if a bug tried. Full `calendar` or `calendar.events` would give access to everything the coach can see on their account; we reject that.

**One-way sync, app → Google.** Approved lessons create events, reschedules patch them, cancels and declines delete them. Pending lessons do not sync (they may never happen). Nothing in Google ever flows back into the app — if the coach edits an event in Google Calendar, the next app-side change overwrites it. This is intentional: the lessons table is the source of truth.

**OAuth flow lives on the API, not the web app.** The authorize redirect goes to Google, Google calls back to `/integrations/google/callback` on the API, the API exchanges the code for tokens, encrypts the refresh token, and redirects the browser to `/account` on the web app. The callback is pre-registered in Google Cloud as `http://localhost:4000/integrations/google/callback` (dev) and `https://api-dev-9f6d.up.railway.app/integrations/google/callback` (deployed). Since `apps/api/src/app.ts` has no global route prefix, the router mounts directly at `/integrations`. The `state` parameter is an HMAC-signed, 10-minute-TTL token bound to the coach's profile id to prevent CSRF and cross-coach account hijack.

**Refresh token encrypted at rest with AES-256-GCM.** Access tokens live only in memory. The refresh token is encrypted with a 32-byte key supplied via `GOOGLE_TOKEN_ENCRYPTION_KEY` and stored alongside its IV, auth tag, and a `key_version` integer so we can rotate later without a schema change. The web app never sees the token: the connection card calls API endpoints that return status metadata (email, last sync, failed count), nothing cryptographic.

**Sync failures are isolated from booking writes.** The approve/reschedule/cancel/decline route handlers commit their database change in a transaction, then enqueue the sync as a fire-and-forget call after `res.json()` returns. If the Google call fails, the lesson row's `calendar_sync_status` is updated to `sync_failed` and `calendar_sync_error` captures the message, but the booking is already committed. The coach retries from the UI. No sync code runs inside a lesson transaction.

**Disconnect revokes and forgets, but doesn't clean up Google.** Clicking Disconnect calls Google's token revocation endpoint, deletes the local `coach_calendar_integrations` row, and clears `google_calendar_event_id` and `calendar_sync_status` on all future lessons. The dedicated Axiom calendar and its events stay in the coach's Google account — the coach can delete them manually if they want. Reasoning: we don't own that data once revoked, and silently wiping a coach's calendar on disconnect would be surprising.

## Alternatives considered

- **Full `calendar` scope with explicit calendar id.** Rejected: a bug or compromised token could expose every event the coach can see. `calendar.app.created` is strictly weaker and sufficient.
- **OAuth flow on the web app with API as a token broker.** Rejected: the web app would hold the authorization code briefly, and Supabase SSR cookies plus Google state would need to agree on a round-trip. API-only is simpler and the browser never touches the token.
- **Two-way sync.** Rejected: resolving conflicts between a lesson row and a Google event is a lot of code to serve a case we don't have (the coach doesn't edit lesson times in Google). We may revisit if that changes.
- **Encrypt with libsodium / `secretbox`.** Rejected: AES-256-GCM via Node's built-in `crypto` is standard, FIPS-friendly, and requires no new dependency. We already use `node:crypto` elsewhere (`randomBytes`, `timingSafeEqual`).
- **Store the token with Supabase Vault.** Rejected for v1 — Vault's local-dev story is thin and we'd couple a feature to a Supabase upgrade. Env-key AES is enough; migration to Vault later is a straight re-encrypt.
- **Delete the dedicated Google calendar on disconnect.** Rejected: that calendar may contain context the coach wants, and the scope technically permits it, but silent destructive cleanup is worse UX than leaving a disconnected calendar sitting there.

## Consequences

- A new `coach_calendar_integrations` table and a new `coach_integration_audit_log` table (connect, disconnect, retry are coach-level events and don't fit `household_audit_log`'s FK shape).
- A new `GOOGLE_TOKEN_ENCRYPTION_KEY` env var is a hard dependency — losing it bricks the integration for every connected coach. Document rotation in `docs/plans/google-calendar-sync.md`.
- The deployed API callback is now security-critical. Any change to its path or host requires an update to Google Cloud OAuth settings before deploy.
- Lesson routes gain a hook call, but no transactional dependency on Google — fully reversible if we ever remove the integration.
- Dev callback requires API on port 4000 (currently defaults to 3001). Either set `PORT=4000` in dev or update the Google Cloud entry; chosen in the plan.
