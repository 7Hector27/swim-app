# Data model

## Tables

### `profiles`

One row per authenticated user. Created automatically by the `on_auth_user_created` trigger when a new row is inserted into `auth.users`.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | — | Primary key; mirrors `auth.users.id` (FK, on delete cascade) |
| `role` | `user_role` | no | `parent` | Enum: `coach`, `parent` |
| `full_name` | `text` | yes | — | Populated from `raw_user_meta_data` at signup |
| `phone` | `text` | yes | — | |
| `age_attested_at` | `timestamptz` | yes | — | Set when a parent attests they are 18+ |
| `disabled_at` | `timestamptz` | yes | — | Soft-disable; non-null means account is inactive |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | Updated automatically on any change |

RLS is enabled. Policies TBD.

## Conventions

- All tables use `id` as a UUID primary key (`gen_random_uuid()`)
- `created_at` and `updated_at` on every table, auto-managed by Drizzle
- Soft deletes via `deleted_at` nullable timestamp (no hard deletes on domain entities)
- Schema is defined in `apps/api/src/db/schema.ts`; types flow through `packages/shared`
