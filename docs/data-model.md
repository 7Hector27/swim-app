# Data model

> No tables yet. Add an entry here each time a new table is introduced.

## Conventions

- All tables use `id` as a UUID primary key (`gen_random_uuid()`)
- `created_at` and `updated_at` on every table, auto-managed by Drizzle
- Soft deletes via `deleted_at` nullable timestamp (no hard deletes on domain entities)
- Schema is defined in `apps/api/src/db/schema.ts`; types flow through `packages/shared`
