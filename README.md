# Swim App

Software for managing swim lessons — schedules, enrollments, and progress tracking — built for swim coaches, parents, and swimmers.

- **Coaches** manage lesson schedules, track swimmer progress, and communicate with families
- **Parents** enroll their children, view upcoming lessons, and receive updates
- **Swimmers** see their own schedule and milestone history

## Prerequisites

- [Node.js](https://nodejs.org) ≥ 20
- [pnpm](https://pnpm.io) ≥ 9 (`npm i -g pnpm`)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Supabase CLI](https://supabase.com/docs/guides/cli) (bundled as a dev dependency — no global install needed)

## Setup

```bash
# 1. Clone and install
git clone <repo-url>
cd swim-app
pnpm install

# 2. Copy env files
cp .env.example .env
cp apps/api/.env.example apps/api/.env

# 3. Start the Supabase local stack (Postgres on port 54322, Studio on 54323)
pnpm db:up

# 4. Apply migrations
pnpm db:migrate

# 5. Start everything
pnpm dev
```

- Web: http://localhost:3000
- API: http://localhost:3001

## Environment variables

### `apps/api/.env`

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | — | Postgres connection string. Example: `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| `PORT` | `3001` | API listen port |
| `NODE_ENV` | — | `production` enables JSON logs. Omit or set to `development` for pretty logs |
| `CORS_ORIGINS` | — | Comma-separated allowed origins. Example: `http://localhost:3000` |
| `SUPABASE_URL` | `http://127.0.0.1:54321` | Supabase local stack API URL |
| `SUPABASE_PUBLISHABLE_KEY` | — | Anon/publishable key — copy from `pnpm db:status` |
| `TRUST_PROXY` | `0` | Number of reverse-proxy hops in front of the API. Leave `0` locally. Set to `1` on Railway or any single-proxy host so the rate limiter keys on the real client IP. |

### `apps/web/.env.local`

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | API base URL for browser fetches |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | Canonical site URL. Set to the real domain in every deployed environment (e.g. `https://axiomaquatics.com`). **Must be set before the production build** — Next.js bakes `NEXT_PUBLIC_` values in at build time, so a missing or wrong value cannot be patched after the fact. Used by `layout.tsx` as `metadataBase` for Open Graph and canonical URLs. |
| `NEXT_PUBLIC_SUPABASE_URL` | `http://127.0.0.1:54321` | Supabase project URL — same value as `SUPABASE_URL` in `apps/api/.env`. Copy from `pnpm db:status`. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | — | Anon/publishable key — copy from `pnpm db:status`. Required by `@supabase/ssr` to authenticate web requests. |

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start web (port 3000) and API (port 3001) concurrently |
| `pnpm typecheck` | TypeScript check across all packages |
| `pnpm lint` | ESLint across the monorepo |
| `pnpm format` | Prettier write across the monorepo |
| `pnpm test` | Vitest across all packages |
| `pnpm db:up` | Start Supabase local stack |
| `pnpm db:down` | Stop Supabase local stack |
| `pnpm db:status` | Show running services and connection strings |
| `pnpm db:generate` | Generate Drizzle migration files from schema changes |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:seed` | Seed the local database with development data |

## Running integration tests locally

Integration tests in `apps/api/src/__tests__/integration/` run against a real local Supabase stack. They create actual auth users via the admin API, exchange real JWTs, and hit the database — no mocks.

**Prerequisites**

- Docker Desktop running
- `pnpm db:up` to start the local Supabase stack (Postgres on `127.0.0.1:54322`, Auth API on `127.0.0.1:54321`)
- Migrations applied: `pnpm db:migrate`

**Run**

```bash
pnpm test:integration
```

Each test creates unique users (`<prefix>-<timestamp>-<random>@test.local`) and cleans them up afterwards; auth-user deletion cascades through profiles, guardians, and swimmer_clubs.

**Safety guard**: `src/__tests__/integration/setup.ts` refuses to start if `INTEGRATION_DATABASE_URL` doesn't resolve to a loopback address. This prevents the test suite from ever touching a staging or production database.

**Required environment variables**

The tests read all connection details from `apps/api/.env` — no hardcoded defaults. After starting the stack, run `pnpm db:status` (or `npx supabase status`) and copy the values into `apps/api/.env`:

| Variable | Where to get it |
|---|---|
| `INTEGRATION_DATABASE_URL` | `DB URL` from `pnpm db:status` |
| `SUPABASE_URL` | `API URL` from `pnpm db:status` |
| `SUPABASE_PUBLISHABLE_KEY` | `anon key` from `pnpm db:status` |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role key` from `pnpm db:status` |

If any variable is missing, the test runner will fail immediately with a message naming the missing variable.

## API endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/ping` | Liveness probe — returns `{ "pong": true }` |
| `GET` | `/health` | DB connectivity check — returns `{ status, db, timestamp }` |

Every response includes an `x-request-id` header. Pass your own `x-request-id` request header to propagate a trace ID into server logs.

## Deploying

### API environment variables for hosted deployments

| Variable | Production value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Switches logs to JSON format |
| `TRUST_PROXY` | `1` | Set to the number of proxy hops in front of the API (Railway = 1). Required for the public-leaderboard rate limiter to key on the real client IP rather than the proxy address. |
| `CORS_ORIGINS` | `https://yourdomain.com` | Comma-separate if multiple origins |
| `SITE_URL` | `https://yourdomain.com` | Used to build invite and email-confirm links |
| `CRON_SECRET` | random hex string | `openssl rand -hex 32` |

### Supabase project configuration

Two settings must be updated in every production (and staging) Supabase project before invite links and email confirmation work correctly:

**1. Redirect URL allowlist**

In the Supabase dashboard → Authentication → URL Configuration, add the following to **Redirect URLs**:

```
https://yourdomain.com/auth/confirm?**
```

The `?**` glob is required so Supabase accepts `emailRedirectTo` values that include a `returnTo` query parameter (e.g. `/auth/confirm?returnTo=%2Finvite%2F<token>`). Without it, Supabase rejects those redirect URLs and the post-signup flow breaks.

**2. Email template**

In Authentication → Email Templates → Confirm signup, replace the default confirmation URL with:

```html
{{ if .RedirectTo }}
<a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email">Confirm your email</a>
{{ else }}
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">Confirm your email</a>
{{ end }}
```

This lets the invite `returnTo` flow carry through the email confirmation link back to `/invite/<token>` after the new user verifies their address.

## Docs

- [Architecture](docs/architecture.md) — how web, API, and Postgres connect
- [Data model](docs/data-model.md) — table reference (empty until first feature)
- [Decisions](docs/decisions/) — lightweight ADRs for significant choices
