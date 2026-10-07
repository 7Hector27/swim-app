# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands run from the repo root unless noted.

```bash
pnpm dev              # start web (:3000) and api (:3001) concurrently
pnpm typecheck        # tsc --noEmit across all packages
pnpm lint             # eslint across the monorepo
pnpm format           # prettier --write across the monorepo
pnpm test             # vitest run across all packages

# Run tests for one package only
pnpm --filter api test
pnpm --filter web test

# Run a single test file
pnpm --filter api exec vitest run src/__tests__/health.test.ts

# Database (requires Docker Desktop + Supabase CLI)
pnpm db:up            # start Supabase local stack (DB 54322, Studio 54323, Mailpit 54324)
pnpm db:down          # stop Supabase local stack
pnpm db:status        # show running services and connection strings
pnpm db:generate      # generate Drizzle migration files from schema changes
pnpm db:migrate       # apply pending migrations
```

## Architecture

**Packages**

- `apps/web` — Next.js 15 App Router, UI only, never touches Postgres directly
- `apps/api` — Express REST API, all DB access lives here
- `packages/shared` — Zod schemas + `z.infer<>` TypeScript types shared by both apps

`packages/shared` is the contract layer. Schemas defined there are imported by `api` for request validation and can be imported by `web` for client-side form validation. Types are never declared manually — they are always inferred from their Zod schema.

**API request lifecycle**

Every request in `apps/api/src/app.ts` flows through this middleware stack in order:

1. `helmet` — security headers
2. `cors` — checks `CORS_ORIGINS` env var allowlist
3. `requestId` — reads `x-request-id` header or generates a UUID; echoes it back in the response header
4. `pino-http` — structured request logging using the request ID from step 3
5. `validate()` — parses input against the route's Zod schema; returns 422 with `{ error, issues }` on failure
6. Route handler
7. `errorHandler` — catches thrown errors, logs via `req.log`, returns `{ error: "Internal server error" }` with no stack

**Logging**

`apps/api/src/logger.ts` creates the pino singleton. Pretty-printed in dev (`NODE_ENV !== "production"`), JSON in production. `authorization` and `cookie` request headers are always redacted. Route handlers log via `req.log` (the per-request child logger set by pino-http), not the global logger. Never use `console` in apps/api.

**Testing**

Tests import `createApp(logger)` from `src/app.ts` with `pino({ level: "silent" })` so the app is testable without binding a port. `src/__tests__/setup.ts` sets a placeholder `DATABASE_URL` so `db/client.ts` doesn't throw at import time. Tests that need the DB require a real connection string.

**TypeScript strictness**

All packages extend `tsconfig.base.json` which enables `noUncheckedIndexedAccess`, `noImplicitReturns`, and `exactOptionalPropertyTypes` on top of `strict`. The `exactOptionalPropertyTypes` flag means optional properties must be absent, not set to `undefined` — spread conditionally: `...(condition && { key: value })`.

**Styling (apps/web)**

Tailwind v4, configured in `apps/web/src/styles/globals.css` (no tailwind.config.js). Style mobile-first: base classes are mobile (≤768px). Use only the custom `tablet:` (769px) and `desktop:` (1248px) breakpoints, never `sm:`/`md:`/`lg:`.

**Naming and file structure**

- React component files: PascalCase, matching the component (`SwimmerCard.tsx`). Other files: camelCase (`formatTime.ts`). Exception: Next.js special files and route folders stay lowercase (`page.tsx`, `layout.tsx`, `route.ts`, `app/coach/swimmers/[id]/`).
- Variables and functions: camelCase.
- Components and types: PascalCase. Zod schemas end in `Schema`. True constants: UPPER_SNAKE_CASE. Database tables and columns: snake_case.
- Never abbreviate or use single-letter names, including callback parameters: `swimmers.map((swimmer) => ...)`, never `swimmers.map((x) => ...)`. Use `index`, not `i`.
- One job per function. Business logic (time formatting, buffers, rankings) lives in pure, tested functions, not inside routes or components.
- Named exports, except where Next.js requires a default export.

File layout, top to bottom:

1. Imports from libraries
2. Imports from project files (`@swim-app/*` packages count as project imports)
3. Interfaces and types
4. Helper functions used by the file
5. The component (or main export): variables and hooks first, then handler functions, then the returned JSX

## Adding a new API route

1. Define request/response schemas in `packages/shared/src/schemas/<feature>.ts` using Zod
2. Export them from `packages/shared/src/index.ts`
3. Add the route to `apps/api/src/app.ts` with `validate({ query?, body?, params? })` middleware
4. Import the shared type in route handler via `@swim-app/shared`

Routes with no input still call `validate({})` to make that explicit.

On protected routes, `requireUser` (or other auth middleware) runs before `validate()`.
