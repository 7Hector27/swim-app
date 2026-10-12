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

### `households`

One row per household. Created atomically with the owner's profile by the `on_auth_user_created` trigger.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | Primary key |
| `name` | `text` | no | — | Derived from the last word of the owner's full name at signup (e.g. "Smith household"). Falls back to "My household". |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | Updated automatically on any change |

RLS is enabled. Policies TBD.

---

### `household_members`

Links a profile to a household with a role.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `household_id` | `uuid` | no | — | PK component; FK → `households.id` (cascade on delete) |
| `profile_id` | `uuid` | no | — | PK component; FK → `profiles.id` (restrict on delete) |
| `role` | `household_role` | no | — | Enum: `owner`, `manager`, `viewer` |
| `joined_at` | `timestamptz` | no | `now()` | |

Constraints:
- Composite primary key `(household_id, profile_id)` — a profile can only belong to one household (also enforced by `UNIQUE (profile_id)`).
- `UNIQUE (household_id) WHERE role = 'owner'` — exactly one owner per household.

RLS is enabled. Policies TBD.

**Role permissions:**

| Action | viewer | manager | owner |
|---|---|---|---|
| View swimmers | ✓ | ✓ | ✓ |
| Set `is_public: false` on a swimmer | ✓ | ✓ | ✓ |
| Create / edit swimmer fields | — | ✓ | ✓ |
| Set `is_public: true` on a swimmer | — | — | ✓ |
| Archive (delete) a swimmer | — | — | ✓ |

---

### `household_audit_log`

Append-only log of significant household events.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | Primary key |
| `household_id` | `uuid` | no | — | FK → `households.id` (cascade on delete) |
| `actor_id` | `uuid` | no | — | FK → `profiles.id` (restrict on delete). Profile that performed the action. |
| `action` | `text` | no | — | e.g. `household_created`, `swimmer_added` |
| `target_profile_id` | `uuid` | yes | — | FK → `profiles.id` (restrict on delete). Set for member-management events. |
| `target_swimmer_id` | `uuid` | yes | — | FK → `swimmers.id` (restrict on delete). Set for swimmer events. |
| `new_role` | `household_role` | yes | — | Set when a member's role changes. |
| `created_at` | `timestamptz` | no | `now()` | |

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
| `public_consent_by` | `uuid` | yes | — | FK → `profiles.id` (restrict on delete). Profile that gave consent. Must be the household owner. |
| `archived_at` | `timestamptz` | yes | — | Null = active. Set to soft-delete a swimmer. |
| `household_id` | `uuid` | no | — | FK → `households.id` (restrict on delete). The household this swimmer belongs to. |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | Updated automatically on any change |

RLS is enabled. Policies TBD.

Constraints:
- `CHECK (public_consent_required)` — when `is_public` is true, both `public_consent_at` and `public_consent_by` must be non-null.

**Notes:**
- `is_public` controls whether a swimmer appears on public leaderboards. When set to `true`, `public_consent_at` and `public_consent_by` must also be set.
- Birth dates are stored (unlike profile birth dates, which are discarded after the age check). They are needed to determine age groups for competition. See ADR 016.

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

**API behaviour:** When a swimmer's clubs are updated via `PATCH /swimmers/:id`, the full set is replaced atomically — all existing `swimmer_clubs` rows for that swimmer are deleted and the new set is inserted in the same transaction. There is no partial update.

---

### `league_registrations`

Records a swimmer's registration in a league for a given season. Withdrawn registrations are **never hard-deleted** — `withdrawn_at` is set to soft-delete while preserving the original `registered_on` date.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | Primary key |
| `swimmer_id` | `uuid` | no | — | FK → `swimmers.id` (cascade on delete) |
| `league` | `league` | no | — | Enum: `club`, `summer_league` |
| `season_start_year` | `integer` | no | — | Calendar year the season started. See season rules below. |
| `registered_on` | `date` | no | — | Date of first registration. Preserved across withdrawals and re-registrations. |
| `withdrawn_at` | `timestamptz` | yes | — | Null = active. Set to soft-withdraw a registration. |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | Updated automatically on any change |

RLS is enabled. Policies TBD.

Constraints:
- `UNIQUE (swimmer_id, league, season_start_year)` — one row per swimmer per league per season

**Season year rules** (computed by `currentSeasonStartYear()` in `packages/shared`):
- `summer_league`: `season_start_year` is always the calendar year.
- `club`: `season_start_year` is the calendar year the club season started. The season starts in `CLUB_SEASON_START_MONTH` (currently September — Jason needs to confirm). Registrations before that month in a given calendar year use the previous year.

**API behaviour:**
- `PUT /swimmers/:id/registrations/:league` — register for the current season. If a withdrawn row exists for that season, clears `withdrawn_at` and keeps the original `registered_on`. Idempotent if already active.
- `DELETE /swimmers/:id/registrations/:league` — withdraw from the current season (sets `withdrawn_at`). Returns 404 if not registered.
- `GET /swimmers/me` and `GET /swimmers/:id` include `currentLeagues`: an array of leagues with active registrations in the current season.

---

---

## Skills catalog

Reference data for the swimmer skills rubric. Loaded via `pnpm db:sync-catalog` (idempotent upsert, never auto-runs). See `docs/reference/skill-rubric.md` for the source rubric and `apps/api/src/db/reference/skillsCatalog.ts` for the typed catalog.

### `skill_categories`

One row per rubric section (e.g. "Freestyle", "Backstroke"). Eight categories in the initial catalog.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | `uuid` | no | Primary key |
| `slug` | `text` | no | Unique; permanent identifier |
| `name` | `text` | no | Display name |
| `sort_order` | `integer` | no | Category display order |
| `created_at` | `timestamptz` | no | `now()` |
| `updated_at` | `timestamptz` | no | Auto-updated |

RLS enabled. Policies TBD.

---

### `skills`

One row per skill. Slugs are permanent — never change a slug once it ships to production. Removed skills are soft-deleted via `archived_at`.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | `uuid` | no | Primary key |
| `slug` | `text` | no | Unique; permanent identifier |
| `category_id` | `uuid` | no | FK → `skill_categories.id` (restrict on delete) |
| `name` | `text` | no | Display name |
| `type` | `skill_type` | no | Enum: `rubric`, `measured`, `score`, `composite`, `rollup` |
| `unit` | `text` | yes | e.g. `kicks/min`, `strokes/25`, `s`, `ft` |
| `stroke` | `stroke` | yes | Enum: `free`, `back`, `breast`, `fly`. Set on per-stroke skills |
| `applies_to` | `text[]` | yes | List of strokes when a skill covers a fixed set (e.g. body rotation = `{free,back}`) |
| `parent_skill_id` | `uuid` | yes | FK → `skills.id` (restrict). Set on start components whose parent is a `composite` skill |
| `sort_order` | `integer` | no | Display order within category |
| `archived_at` | `timestamptz` | yes | Null = active. Set when a skill is removed from the catalog |
| `created_at` | `timestamptz` | no | `now()` |
| `updated_at` | `timestamptz` | no | Auto-updated |

**`stroke` vs `applies_to`:** use `stroke` for a skill that exists once per stroke (e.g. freestyle catch). Use `applies_to` for a skill that applies to a fixed named list of strokes as a single entry (e.g. body rotation, push-off).

RLS enabled. Policies TBD.

---

### `skill_level_descriptors`

Up to five rows per skill, one per rating level (1–5). Missing rows mean the descriptor hasn't been written yet; the generic `rating_scale_levels` fallback applies.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `skill_id` | `uuid` | no | PK component; FK → `skills.id` (cascade on delete) |
| `level` | `integer` | no | PK component; 1–5 (enforced by CHECK constraint) |
| `text` | `text` | no | Descriptor text for that level |
| `created_at` | `timestamptz` | no | `now()` |
| `updated_at` | `timestamptz` | no | Auto-updated |

RLS enabled. Policies TBD.

---

### `skill_dependencies`

Directed edges from a skill to the skills it builds on (the "Builds on" columns in the rubric). The dependency graph must be acyclic; `pnpm db:sync-catalog` validates this before writing.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `skill_id` | `uuid` | no | PK component; FK → `skills.id` (cascade on delete) |
| `depends_on_skill_id` | `uuid` | no | PK component; FK → `skills.id` (cascade on delete) |
| `created_at` | `timestamptz` | no | `now()` |

Constraints: composite PK `(skill_id, depends_on_skill_id)`, CHECK `skill_id <> depends_on_skill_id`.

RLS enabled. Policies TBD.

---

### `rating_scale_levels`

The generic 1–5 rating scale that applies to any skill without its own level descriptors.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `level` | `integer` | no | Primary key; 1–5 |
| `label` | `text` | no | e.g. `Emerging`, `Mastery` |
| `meaning` | `text` | no | Generic description for that level |
| `created_at` | `timestamptz` | no | `now()` |
| `updated_at` | `timestamptz` | no | Auto-updated |

RLS enabled. Policies TBD.

---

## Conventions

- All tables use `id` as a UUID primary key (`gen_random_uuid()`), except `household_members` (composite PK `(household_id, profile_id)`), `skill_level_descriptors` (composite PK `(skill_id, level)`), `skill_dependencies` (composite PK `(skill_id, depends_on_skill_id)`), and `rating_scale_levels` (integer PK `level`)
- `created_at` and `updated_at` on every table, auto-managed by Drizzle
- Soft deletes via a nullable timestamp (`archived_at` on swimmers and skills, `disabled_at` on profiles); no hard deletes on domain entities
- Schema is defined in `apps/api/src/db/schema.ts`; types flow through `packages/shared`
