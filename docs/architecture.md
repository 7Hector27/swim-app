# Architecture

## Monorepo layout

```
swim-app/
├── apps/
│   ├── web/   Next.js 15 App Router — all UI, no DB access
│   └── api/   Express REST API — all data access
├── packages/
│   └── shared/ Zod schemas + inferred TypeScript types
└── supabase/           Supabase local stack config
```

`packages/shared` is the contract layer. Both `web` and `api` import from it, so request/response shapes and their runtime validators are defined once and can never drift.

## How the pieces connect

```
Browser
  └─ HTTP (fetch)  ─►  apps/web  (Next.js, port 3000)
                          │  Server Components call API
                          ▼
                       apps/api  (Express, port 3001)
                          │  Drizzle ORM
                          ▼
                       Postgres 17  (Supabase local, port 54322)
```

`web` is UI-only. It never connects to Postgres directly. All data goes through `api`.

## Request lifecycle (API)

1. **helmet** — sets security headers
2. **cors** — checks `CORS_ORIGINS` allowlist
3. **requestId** — attaches/generates `x-request-id`
4. **pino-http** — logs the request using the request ID
5. **validate()** — parses input against the route's Zod schema (422 on failure)
6. **Route handler** — business logic
7. **errorHandler** — catches any thrown errors, logs them, returns safe JSON

## Key constraints

- No direct DB access from `web`
- Every API route declares its input schema in `packages/shared`
- Logs are JSON in production, pretty-printed in dev; auth/cookie headers are always redacted
