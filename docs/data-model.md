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

---

### `swimmers`

One row per swimmer. Swimmers are **never hard-deleted** — use `archived_at` to soft-delete.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | Primary key |
| `first_name` | `text` | no | — | |
| `last_name` | `text` | no | — | |
| `birth_date` | `date` | no | — | Stored for age-group calculation. See ADR 016. |
| `sex` | `sex` | no | — | Enum: `female`, `male`. Competition category, not identity. |
| `is_public` | `boolean` | no | — | No server default; the UI must collect explicit parent consent. |
| `public_consent_at` | `timestamptz` | yes | — | Timestamp of public opt-in. Required when `is_public` is true. |
| `public_consent_by` | `uuid` | yes | — | FK → `profiles.id` (restrict on delete). Profile that gave consent. Must be a guardian of this swimmer. |
| `archived_at` | `timestamptz` | yes | — | Null = active. Set to soft-delete a swimmer. |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | Updated automatically on any change |

RLS is enabled. Policies TBD.

**Notes:**
- `is_public` controls whether a swimmer appears on public leaderboards. When set to `true`, `public_consent_at` and `public_consent_by` must also be set.
- Birth dates are stored (unlike profile birth dates, which are discarded after the age check). They are needed to determine age groups for competition. See ADR 016.

---

### `guardians`

Links a parent profile to a swimmer. Composite primary key — no surrogate `id`.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `profile_id` | `uuid` | no | — | PK component; FK → `profiles.id` (restrict on delete) |
| `swimmer_id` | `uuid` | no | — | PK component; FK → `swimmers.id` (cascade on delete) |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | Updated automatically on any change |

RLS is enabled. Policies TBD.

**Notes:**
- The cascade on `swimmer_id` is safe because swimmers are soft-deleted via `archived_at`; the swimmer row stays, so the guardian link only disappears if the swimmer row is physically removed (which should never happen in normal operation).

---

### `clubs`

Known swim clubs. Used for the swimmer registration dropdown.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | Primary key |
| `name` | `text` | no | — | Unique |
| `is_active` | `boolean` | no | `true` | Inactive clubs are hidden from new registrations but kept for historical rows |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | Updated automatically on any change |

RLS is enabled. Policies TBD.

**Seed rows:** `[Club 1]`, `[Club 2]` — placeholder names until the real club list is provided.

---

### `swimmer_clubs`

Associates a swimmer with either a known club (via `club_id`) or a free-text club name (`other_club_name`). Exactly one of the two must be set — enforced by a `CHECK` constraint.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | Primary key |
| `swimmer_id` | `uuid` | no | — | FK → `swimmers.id` (cascade on delete) |
| `club_id` | `uuid` | yes | — | FK → `clubs.id` (restrict on delete). Null when `other_club_name` is set. |
| `other_club_name` | `text` | yes | — | Free-text fallback when the club is not in the list. |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | Updated automatically on any change |

Constraints:
- `CHECK (exactly_one_club)` — `(club_id IS NOT NULL AND other_club_name IS NULL) OR (club_id IS NULL AND other_club_name IS NOT NULL)`
- `UNIQUE (swimmer_id, club_id) WHERE club_id IS NOT NULL` — prevents duplicate known-club assignments per swimmer

RLS is enabled. Policies TBD.

---

## Conventions

- All tables use `id` as a UUID primary key (`gen_random_uuid()`), except `guardians` which has a composite PK
- `created_at` and `updated_at` on every table, auto-managed by Drizzle
- Soft deletes via a nullable timestamp (`archived_at` on swimmers, `disabled_at` on profiles); no hard deletes on domain entities
- Schema is defined in `apps/api/src/db/schema.ts`; types flow through `packages/shared`
