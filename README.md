# Swim App

Software for managing swim lessons — schedules, enrollments, and progress tracking — built for swim coaches, parents, and swimmers.

- **Coaches** manage lesson schedules, track swimmer progress, and communicate with families
- **Parents** enroll their children, view upcoming lessons, and receive updates
- **Swimmers** see their own schedule and milestone history

## Prerequisites

- [Node.js](https://nodejs.org) ≥ 20
- [pnpm](https://pnpm.io) ≥ 9 (`npm i -g pnpm`)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (for Postgres)

## Setup

```bash
# 1. Clone and install
git clone <repo-url>
cd swim-app
pnpm install

# 2. Copy env files
cp .env.example .env
cp apps/api/.env.example apps/api/.env

# 3. Start Postgres (port 5435)
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
| `DATABASE_URL` | — | Postgres connection string. Example: `postgres://swim:swim@localhost:5435/swim` |
| `PORT` | `3001` | API listen port |
| `NODE_ENV` | — | `production` enables JSON logs. Omit or set to `development` for pretty logs |
| `CORS_ORIGINS` | — | Comma-separated allowed origins. Example: `http://localhost:3000` |

### `apps/web/.env.local`

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | API base URL for browser fetches |

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start web (port 3000) and API (port 3001) concurrently |
| `pnpm typecheck` | TypeScript check across all packages |
| `pnpm lint` | ESLint across the monorepo |
| `pnpm format` | Prettier write across the monorepo |
| `pnpm test` | Vitest across all packages |
| `pnpm db:up` | Start Postgres in Docker |
| `pnpm db:down` | Stop Postgres |
| `pnpm db:generate` | Generate Drizzle migration files from schema changes |
| `pnpm db:migrate` | Apply pending migrations |

## API endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/ping` | Liveness probe — returns `{ "pong": true }` |
| `GET` | `/health` | DB connectivity check — returns `{ status, db, timestamp }` |

Every response includes an `x-request-id` header. Pass your own `x-request-id` request header to propagate a trace ID into server logs.

## Docs

- [Architecture](docs/architecture.md) — how web, API, and Postgres connect
- [Data model](docs/data-model.md) — table reference (empty until first feature)
- [Decisions](docs/decisions/) — lightweight ADRs for significant choices
