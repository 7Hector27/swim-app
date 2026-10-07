# 003 — API enforces permissions, RLS set to deny-all

**Date:** 2026-10-07  
**Status:** Accepted

## Context

Supabase exposes a public Data API (PostgREST) reachable with the `anon` key, which is shipped to the browser. Without additional protection, any table accessible to that key can be queried directly from the client.

## Decision

The **web app never queries the database**. All data access goes through our Express API. Every table has RLS enabled with **no permissive policies**, so the Data API returns nothing even if someone uses the public key directly.

## Why

- Permission logic lives in one place (the API) and is tested with the rest of the application code.
- RLS as a deny-all backstop means a misconfigured client can never leak data, even if the API has a gap.
- Business rules (coach vs. swimmer, disabled accounts) are easier to reason about in TypeScript than in Postgres policy expressions.

## Alternatives considered

- **Supabase RLS as the main enforcement layer** — allows direct client queries but scatters permission logic across SQL policies, making them harder to test and audit.
