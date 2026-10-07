# 006 — App roles checked in the database on every request, not in the JWT

**Date:** 2026-10-07  
**Status:** Accepted

## Context

The API needs to enforce role-based access (coach vs. swimmer) and respect the `disabled` flag. Both can change at any time by a coach or admin. JWTs are signed and cannot be invalidated without additional infrastructure.

## Decision

On every authenticated request, the API **queries `profiles` for the current user's role and disabled status** rather than reading from JWT claims.

## Why

- Role changes and account disabling take effect on the **next request**, not after the token expires.
- No token-blocklist infrastructure needed.
- The extra query is a single primary-key lookup and negligible in practice.

## Alternatives considered

- **Custom JWT claims (role baked into the token)** — eliminates the per-request lookup but means a demoted coach or disabled account can continue acting on their old role until the token refreshes, which may be up to an hour.
