# swim-app

Monorepo for the swim lessons management app.

## Structure

```
apps/web    Next.js 15 App Router — UI only
apps/api    Express + Drizzle ORM — REST API
packages/shared  Shared TypeScript types
```

## Getting started

```bash
# 1. Copy env files
cp .env.example .env
cp apps/api/.env.example apps/api/.env

# 2. Start Postgres
pnpm db:up

# 3. Apply migrations (none yet on first run)
pnpm db:migrate

# 4. Start web + api together
pnpm dev
```

Web runs on http://localhost:3000  
API runs on http://localhost:3001

## Environment variables

### `apps/api/.env`

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string |
| `PORT` | No | API port (default `3001`) |
| `NODE_ENV` | No | `development` for pretty logs, `production` for JSON logs (default: pretty) |
| `CORS_ORIGINS` | Yes in prod | Comma-separated list of allowed CORS origins, e.g. `https://app.example.com,https://www.example.com` |

### `apps/web/.env.local`

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | No | API base URL for browser fetches (default `http://localhost:3001`) |

## Root scripts

| Script | Description |
|---|---|
| `pnpm dev` | Start web and API together |
| `pnpm typecheck` | Type-check all packages |
| `pnpm lint` | ESLint across the monorepo |
| `pnpm format` | Prettier write across the monorepo |
| `pnpm test` | Vitest across all packages |
| `pnpm db:up` | Start Postgres in Docker |
| `pnpm db:down` | Stop Postgres |
| `pnpm db:generate` | Generate Drizzle migration files from schema changes |
| `pnpm db:migrate` | Apply pending migrations |

## API

### `GET /ping`

Lightweight liveness probe. Returns `{ "pong": true }`.

### `GET /health`

Returns DB connectivity status.

```json
{ "status": "ok", "db": true, "timestamp": "2025-01-01T00:00:00.000Z" }
```

Returns `503` if the database is unreachable.

## Request tracing

Every request gets an `x-request-id` response header. Pass an `x-request-id` request header to propagate your own trace ID through to server logs.
