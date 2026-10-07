---
name: add-db-table
description: Adds a new Postgres table or changes an existing one using Drizzle, including the generated migration, shared Zod schemas, and data model docs. Use when the user asks to add, create, or change a database table, column, or relationship, like "add a swims table" or "store skill assessments".
---

# Add or change a database table

## Steps

1. Read `apps/api/drizzle.config.ts` for the schema file and migrations folder, and the Conventions section of `docs/data-model.md`. Match the style of existing tables.
2. Define the table in the schema file with Drizzle: snake_case columns, a `uuid` primary key using `.defaultRandom()`, and `created_at` as `timestamp` with `{ withTimezone: true }`. Give foreign keys an explicit `onDelete`.
3. Run `pnpm db:generate` to create the migration. Never write migration SQL by hand.
4. Show the user the generated SQL and **wait for them to confirm** before applying it.
5. Run `pnpm db:migrate`. Postgres must be running (`pnpm db:up`).
6. If the API will send or receive this data, add Zod schemas in `packages/shared/src/schemas/<feature>.ts` and export them from `packages/shared/src/index.ts`.
7. If a seed script exists, add a few rows of obviously fake data.
8. Update `docs/data-model.md` with the table, its columns, and how it relates to other tables.
9. Run `pnpm typecheck` and `pnpm test`.

## Gotchas

- Never edit or delete a migration that has already been applied. Create a new one instead.
- Store swim times as integer hundredths (62.00s = 6200), never floats.
- Don't store values that can be calculated (age, age group, rank, best time). Store the source data instead (birth date, every swim).
- History tables (swims, skill assessments) are append-only: add rows, never overwrite them.
- Never seed real names or real data about kids.
- Never use serial (auto-increment) IDs. They're guessable in URLs, which matters with kids' data.

## Done when

- The migration applied without errors
- Typecheck and tests pass
- `docs/data-model.md` describes the change
- The user has seen a summary of the SQL that ran
