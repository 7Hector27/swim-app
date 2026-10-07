# 004 — profiles table, signup trigger, role never from signup metadata

**Date:** 2026-10-07  
**Status:** Accepted

## Context

Every Supabase Auth user needs an application-level profile with a role (`coach` or `swimmer`). We needed to decide how profiles are created and how roles are assigned without allowing users to self-escalate.

## Decision

- A **Postgres trigger** on `auth.users` inserts a `profiles` row automatically on signup.
- The `coach` role is set **only via direct SQL** (never through any API endpoint).
- Users may edit only their `name` and `phone` through the API; all other fields are server-controlled.

## Why

- Every auth user is guaranteed a profile row; there is no window where a user exists without one.
- Keeping role assignment out of any API path eliminates the possibility of a privilege-escalation bug in application code.
- Restricting editable fields to `name` and `phone` keeps the attack surface minimal.

## Alternatives considered

- **Setting role from signup metadata** — convenient but lets a crafted signup request claim the `coach` role before any server-side check runs.
