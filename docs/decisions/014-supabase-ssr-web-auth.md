# 014 — @supabase/ssr for web authentication

**Date:** 2026-10-09  
**Status:** Accepted

## Context

`apps/web` needed an auth layer: session cookies, server-side token forwarding to the API, and login/signup flows. The API already uses Supabase for auth (`@supabase/supabase-js` via a service client). We needed a complementary approach in the Next.js app that works with the App Router's server components and server actions.

## Decision

Use **`@supabase/ssr`** in `apps/web` to manage session cookies and forward access tokens to the API.

- A **server client** (`lib/supabase/server.ts`) reads and writes cookies via `next/headers`. Used by server components and server actions to get the current session.
- An **`updateSession` middleware** (`lib/supabase/updateSession.ts`) runs on every request via `middleware.ts` to refresh expiring tokens before they reach route handlers.
- The web app **never queries Postgres directly**. All data flows through `apps/api` using the access token as a Bearer header. The API's `requireUser` middleware verifies the token and loads the profile from the DB on every request.
- A `requireAuth` helper (`lib/requireAuth.ts`) wraps the `/me` fetch, handles 401 (redirect to login), 403 (inactive account screen), and 5xx/network failures (throws to the error boundary). It is wrapped in React `cache()` so layouts and pages share one result per request.

## Consequences

- Session state is managed by Supabase's cookie helpers — no custom JWT parsing or session storage.
- The web app does not hold a long-lived Supabase service key; it uses only the publishable anon key.
- Token verification is always server-side (in the API's `requireUser`). The web layer trusts what the API returns, validated against `MeResponseSchema`.
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are required in `apps/web/.env.local`.

## Alternatives considered

- **NextAuth / Auth.js** — provider-agnostic but adds significant complexity and a separate session store. Unnecessary given we already use Supabase everywhere.
- **Handling auth entirely in the API** (cookie-based sessions issued by Express) — avoids the SSR client but requires custom middleware for cookie refresh and loses Supabase's built-in token lifecycle management.
