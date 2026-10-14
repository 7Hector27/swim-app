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

## Booking configuration

### `lesson_locations`

Named pools (coach-managed) and household home pools. Named pools have `household_id = NULL`. Home pools belong to a specific household and are visible only to the coach (in per-household context) and that household's members.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | Primary key |
| `name` | `text` | no | — | e.g. "Egret Park" or "Home pool" |
| `address` | `text` | no | — | Street address |
| `city` | `text` | no | — | |
| `state` | `text` | no | `'CA'` | |
| `zip` | `text` | no | — | |
| `household_id` | `uuid` | yes | `NULL` | FK → `households.id` (cascade on delete). `NULL` = named pool; non-null = home pool. |
| `is_active` | `boolean` | no | `true` | Soft-delete. Inactive rows are kept for past-lesson address preservation. |
| `sort_order` | `integer` | no | `0` | Display order for named pools. |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | Auto-updated. |

RLS is enabled. Policies TBD.

**Home pool lifecycle:** `PUT /households/mine/home-pool` inserts a new row and sets `is_active = false` on the prior row (never updates in place). This preserves past lesson addresses when a household changes their pool.

**Seed rows:** Egret Park (45 Ovation, Irvine CA 92620), Swallows Park (60 Lawnwood, Irvine CA 92620), The Commons Park (46 Passage, Irvine CA 92603).

---

### `availability_config`

Single-row table. Jason's lesson schedule parameters.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | Primary key |
| `lesson_days` | `integer[]` | no | `{1,2,3,5}` | ISO weekday numbers (1=Mon … 5=Fri) on which lessons are scheduled. |
| `school_year_start_time` | `time` | no | — | Lesson window start during the school year. |
| `school_year_end_time` | `time` | no | — | Lesson window end during the school year. |
| `summer_morning_start_time` | `time` | no | — | Summer morning window start. |
| `summer_morning_end_time` | `time` | no | — | Summer morning window end. Must be ≤ 15:00. |
| `summer_evening_start_time` | `time` | no | — | Summer evening window start. Must be ≥ 19:00. |
| `summer_evening_end_time` | `time` | no | — | Summer evening window end. |
| `max_daily_lesson_minutes` | `integer` | no | `240` | Total lesson minutes Jason will teach per day. |
| `booking_min_advance_hours` | `integer` | no | `16` | Minimum hours in advance a lesson can be booked. |
| `booking_max_advance_weeks` | `integer` | no | `10` | Maximum weeks in advance a lesson can be booked. |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | Auto-updated. |

RLS is enabled. Policies TBD.

---

### `season_summer_end_dates`

Per-year summer end dates (ISL Championships vary each year).

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `year` | `integer` | no | Primary key. Calendar year (e.g. 2025). |
| `end_date` | `date` | no | Last day of summer for that year. Slot calculator falls back to August 31 if no row exists for a given year. |
| `created_at` | `timestamptz` | no | `now()` |

RLS is enabled. Policies TBD.

---

### `blocked_times`

Time ranges during which Jason is unavailable (holidays, Calendly bookings, etc.).

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | Primary key |
| `starts_at` | `timestamptz` | no | — | |
| `ends_at` | `timestamptz` | no | — | Must be > `starts_at` (CHECK constraint). |
| `note` | `text` | yes | — | Optional label (e.g. "holiday", "Calendly booking"). |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | Auto-updated. |

RLS is enabled. Policies TBD.

---

### `travel_buffer_overrides`

Per-pair overrides for the default 30-minute travel buffer between pools. Same-pool buffer is always 0 (computed, not stored).

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `from_location_id` | `uuid` | no | PK component; FK → `lesson_locations.id` (cascade on delete). Named pools only — home pool IDs are rejected at the API layer. |
| `to_location_id` | `uuid` | no | PK component; FK → `lesson_locations.id` (cascade on delete). Named pools only. |
| `buffer_minutes` | `integer` | no | Override value in minutes. |
| `created_at` | `timestamptz` | no | `now()` |

Constraints: composite PK `(from_location_id, to_location_id)`, CHECK `from_location_id <> to_location_id`.

RLS is enabled. Policies TBD.

---

### `lessons`

One row per lesson booking request.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | Primary key |
| `household_id` | `uuid` | no | — | FK → `households.id` (restrict on delete) |
| `location_id` | `uuid` | no | — | FK → `lesson_locations.id` (restrict on delete) |
| `starts_at` | `timestamptz` | no | — | Stored in UTC; displayed in America/Los_Angeles |
| `duration_minutes` | `integer` | no | — | CHECK IN (30, 45, 60) |
| `type` | `lesson_type` | no | — | Enum: `private` (1 swimmer), `family` (2–4 swimmers) |
| `status` | `lesson_status` | no | `'pending'` | Enum: `pending`, `approved`, `declined`, `expired`, `canceled`, `no_show`, `completed` |
| `requested_by` | `uuid` | no | — | FK → `profiles.id`. Profile that submitted the booking. |
| `approved_at` | `timestamptz` | yes | — | Set on approval. Null for pending/declined/etc. |
| `approved_by` | `uuid` | yes | — | FK → `profiles.id`. Null = system auto-approval. |
| `declined_at` | `timestamptz` | yes | — | |
| `declined_by` | `uuid` | yes | — | FK → `profiles.id` |
| `decline_reason` | `text` | yes | — | Optional coach note on decline |
| `canceled_at` | `timestamptz` | yes | — | |
| `canceled_by` | `uuid` | yes | — | FK → `profiles.id` |
| `no_show_at` | `timestamptz` | yes | — | |
| `no_show_by` | `uuid` | yes | — | FK → `profiles.id` |
| `completed_at` | `timestamptz` | yes | — | Set by cron auto-complete or coach manual action |
| `expires_at` | `timestamptz` | yes | — | `starts_at − 16 h`; null for auto-approved lessons |
| `google_calendar_event_id` | `text` | yes | — | Populated in PR 6 |
| `calendar_sync_status` | `text` | no | `'not_synced'` | CHECK IN ('not_synced', 'synced', 'sync_failed') |
| `calendar_sync_error` | `text` | yes | — | Last sync error message |
| `calendar_sync_attempts` | `integer` | no | `0` | |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | Auto-updated |

RLS is enabled. Policies TBD.

**Status transitions:**
- `pending` → `approved` (coach approves or system auto-approves)
- `pending` → `declined` (coach declines)
- `pending` → `expired` (cron tick fires after `expires_at`; lazy expiry on read)
- `approved` → `completed` (cron tick fires after lesson end time)
- `approved` or `pending` → `canceled`
- `approved` → `no_show`

**Slot-blocking:** Only `pending` and `approved` lessons block slots in `computeAvailableSlots`. All other statuses are excluded.

**Approval gate:** See ADR 021. A household auto-approves at a given location once they have at least one prior `approved` or `completed` lesson there.

---

### `lesson_swimmers`

Junction table linking a lesson to the swimmers participating in it. One row per (lesson, swimmer) pair.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `lesson_id` | `uuid` | no | PK component; FK → `lessons.id` (cascade on delete) |
| `swimmer_id` | `uuid` | no | PK component; FK → `swimmers.id` (restrict on delete) |

Constraints: composite PK `(lesson_id, swimmer_id)`.

RLS is enabled. Policies TBD.

**Notes:** Swimmers are restricted (not cascaded) on delete so that archiving a swimmer does not silently erase lesson history. A swimmer with past lessons cannot be hard-deleted.

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
| `fault_tags` | `text[]` | yes | Common coaching faults for this skill; empty at initial migration, filled in a follow-up |
| `rated_per_side` | `boolean` | no | `true` when ratings for this skill record left/right side (e.g. freestyle bilateral breathing). Default `false`. |
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
