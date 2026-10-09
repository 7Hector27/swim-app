# 015 — Use getUser instead of getClaims for token verification

**Date:** 2026-10-09
**Status:** Accepted

## Context

The API's `requireUser` middleware must authenticate every protected request. Two approaches were available via the Supabase client:

- **`getClaims(token)`** — decodes and locally verifies the JWT signature. Fast (no network round-trip), but only catches expired or malformed tokens.
- **`getUser(token)`** — sends the token to Supabase's auth server. Slower (one extra HTTP call), but the auth server checks its revocation state on every request.

## Decision

Use `getUser` on every request.

## Reasons

1. **Revocation works immediately.** If a session is revoked — by the user signing out on another device, by an admin ban, or by `disableUser` — `getUser` returns an error immediately. With `getClaims`, a revoked token stays valid until its `exp` claim expires (up to one hour by default).

2. **Kids' accounts require it.** A parent or coach may need to lock a minor's account. Relying on JWT expiry would leave a banned account active for up to an hour. That is not acceptable for a platform that handles minors' data.

3. **Small user base makes latency acceptable.** This is a single swim school, not a high-throughput SaaS. The extra auth round-trip per request is not a scaling concern at this load.

## Tradeoff

Every protected API request makes one additional HTTP call to Supabase. If the Supabase auth service is down, `getUser` fails and users cannot authenticate. `getClaims` would continue working from the local JWT in that scenario. This risk is accepted given the safety benefits above.
