# 002 — Supabase local stack replaces docker-compose Postgres

**Date:** 2026-10-07  
**Status:** Accepted

## Context

The app uses Supabase Auth, which stores users in `auth.users`. The `profiles` table must reference that table with a foreign key, so it has to live in the same database. We previously ran a plain Postgres container via docker-compose.

## Decision

Use the **Supabase local stack** (`supabase start`) for local development. This gives us Auth, Storage, and Postgres in one command, matching both the dev and prod Supabase projects exactly.

## Why

- `profiles` can reference `auth.users` with a proper foreign key — impossible against a standalone Postgres with no auth schema.
- Local, dev, and prod all run the same stack; there are no environment-specific schema differences.
- Studio and Mailpit are included, removing the need for separate tooling.

## Alternatives considered

- **Plain Postgres + a separate auth library (e.g. Lucia)** — avoids vendor lock-in but requires re-implementing session handling, password hashing, and the `auth.users` / `profiles` relationship from scratch.
