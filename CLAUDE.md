# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Significant decisions get a record in `docs/decisions/`.

## Commands

All commands run from the repo root unless noted.

```bash
pnpm dev              # start web (:3000) and api (:3001) concurrently
pnpm typecheck        # tsc --noEmit across all packages
pnpm lint             # eslint across the monorepo
pnpm format           # prettier --write across the monorepo
pnpm test             # vitest run across all packages
pnpm test:integration # integration tests — requires local Supabase stack (pnpm db:up)

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
pnpm db:sync-catalog  # upsert skills catalog reference data (idempotent; run after catalog edits)
```

## Workflow rules

Never push with `--no-verify`. The pre-push hook is the CI for `dev`. Run `pnpm test:integration` locally before opening a PR.

Never run any of these without asking first — they can destroy uncommitted work:

- `git reset --hard`
- `git checkout -- .` or `git checkout -- <path>` (anything that discards working-tree changes)
- `git clean -f` / `git clean -fd`
- `git stash` (even nominally reversible — stashes get lost; always just commit instead)
- `git checkout <older-commit>` for any "let me see if the test passed before" bisect. Ask instead; I'll do it.

If an obstacle looks like it needs one of these, stop and ask.

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

**Accounts and permissions**

Roles, permissions, and kids'-data rules are defined in `docs/accounts.md`. Follow it for anything touching auth, swimmer data, notes, or public pages. Before saying that kind of work is done, run the `privacy-reviewer` subagent.

**Migrations**

After adding a migration, always state whether it was applied locally. Production migrations are never automatic.

**Audit log**

Audit log writes (`householdAuditLog` inserts) always go inside the same `db.transaction()` as the change they record. Never write the audit log as a separate call after the update — if the insert fails, the whole transaction rolls back and the data change is not committed.

**Logging**

`apps/api/src/logger.ts` creates the pino singleton. Pretty-printed in dev (`NODE_ENV !== "production"`), JSON in production. `authorization` and `cookie` request headers are always redacted. Route handlers log via `req.log` (the per-request child logger set by pino-http), not the global logger. Never use `console` in apps/api.

**Testing**

Tests import `createApp(logger)` from `src/app.ts` with `pino({ level: "silent" })` so the app is testable without binding a port. `src/__tests__/setup.ts` sets a placeholder `DATABASE_URL` so `db/client.ts` doesn't throw at import time. Tests that need the DB require a real connection string.

**TypeScript strictness**

All packages extend `tsconfig.base.json` which enables `noUncheckedIndexedAccess`, `noImplicitReturns`, and `exactOptionalPropertyTypes` on top of `strict`. The `exactOptionalPropertyTypes` flag means optional properties must be absent, not set to `undefined` — spread conditionally: `...(condition && { key: value })`.

**Styling (apps/web)**

Tailwind v4, configured in `apps/web/src/styles/globals.css` (no tailwind.config.js). Style mobile-first: base classes are mobile (≤768px). Use only the custom `tablet:` (769px) and `desktop:` (1248px) breakpoints, never `sm:`/`md:`/`lg:`.

UI follows the jg-swim-design skill. Never hardcode hex values or Tailwind's default palette colors (e.g. `gray-500`, `red-500`) in components — use design token classes only (e.g. `text-text-secondary`, `bg-background`).

Don't use inline `style` for anything a class, token, or global rule covers. Inline `style` is only for values computed at runtime.

## Design skills

- **jg-swim-design** owns the brand: colors, tokens, fonts, visual motifs, component shapes, section rhythm, and layout rules.
- **emil-design-eng** owns motion, interaction states, and polish: easing curves, animation timing, hover/active/focus transitions, and press feedback.
- On brand conflicts, jg-swim-design wins.

**Naming and file structure**

- React component files: PascalCase, matching the component (`SwimmerCard.tsx`). Other files: camelCase (`formatTime.ts`). Exception: Next.js special files and route folders stay lowercase (`page.tsx`, `layout.tsx`, `route.ts`, `app/coach/swimmers/[id]/`).
- Variables and functions: camelCase.
- Components and types: PascalCase. Zod schemas end in `Schema`. True constants: UPPER_SNAKE_CASE. Database tables and columns: snake_case.
- Never abbreviate or use single-letter names, including callback parameters: `swimmers.map((swimmer) => ...)`, never `swimmers.map((x) => ...)`. Use `index`, not `i`.
- One job per function. Business logic (time formatting, buffers, rankings) lives in pure, tested functions, not inside routes or components.
- Named exports, except where Next.js requires a default export and except for components in `src/components/` and `src/content/`, which use `export default`.

**Three-layer structure (apps/web/src)**

- `app/` — Next.js routes only. Each `page.tsx` renders one Content component. Page-specific metadata, when a page has any, goes in `page.tsx`, never in a Content component. Pages without their own metadata inherit the root layout's. Next.js special files (`page`, `layout`, `loading`, `error`, `not-found`, `route`) live here.
- `content/<PageName>Content/` — Page body components (e.g. `HomepageContent`). Each folder holds `<Name>.tsx`, its CSS module if needed, and `index.ts` with `export { default } from "./<Name>"`. Import as `@/content/HomepageContent`. **Anything used by exactly one page lives here** — sections, local sub-components, helper files — not in `components/`. Server actions for a page live here as `actions.ts`, which begins with `"use server"` and exports only the server actions for that page.
- `components/<ComponentName>/` — Reusable components used by more than one page, including layout components and modals. Same folder shape: `<Name>.tsx`, CSS module, and `index.ts` with `export { default } from "./<Name>"`. Import as `@/components/ThemeLogo`. If a component is only ever used by one page, it belongs in that page's Content folder instead.

**Server/client boundaries**

Server components and server pages never import from `"use client"` files except to render the client component itself. Shared helpers (pre-fill resolvers, formatters, pure logic reused by both the server page and its client orchestrator) live in plain modules with no directive — typically the content folder's `helpers.ts` — and are imported from both sides. Re-exporting a helper from a client module's barrel does not neutralize the boundary; the directive is the file where the helper is declared.

File layout, top to bottom:

1. Imports from libraries
2. Imports from project files (`@swim-app/*` packages count as project imports)
3. Interfaces and types
4. Helper functions used by the file
5. The component (or main export): variables and hooks first, then handler functions, then the returned JSX

## Migrations

Never write a migration file by hand. Always use `pnpm db:generate` (drizzle-kit generate) so a snapshot is created alongside the SQL. For custom SQL that drizzle-kit can't express (triggers, functions, manual backfills), use `drizzle-kit generate --custom --name=<name>` — this creates an empty migration file and a correct snapshot. Edit only the SQL file, never the snapshot. Without a snapshot, subsequent `db:generate` runs see stale state and prompt for spurious renames.

## Adding a new API route

1. Define request/response schemas in `packages/shared/src/schemas/<feature>.ts` using Zod
2. Export them from `packages/shared/src/index.ts`
3. Add the route to `apps/api/src/app.ts` with `validate({ query?, body?, params? })` middleware
4. Import the shared type in route handler via `@swim-app/shared`

Routes with no input still call `validate({})` to make that explicit.

On protected routes, `requireUser` (or other auth middleware) runs before `validate()`.
