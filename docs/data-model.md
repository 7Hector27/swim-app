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
| `email` | `text` | yes | — | Mirror of `auth.users.email`, kept in sync by the `on_auth_user_created` and `on_auth_user_updated` triggers. Read-only from app code; the API uses this for parent-email recipient resolution. See ADR 028. |
| `email_verified_at` | `timestamptz` | yes | — | Mirror of `auth.users.email_confirmed_at`. Non-null means the parent completed email verification. The booking-email sender only sends to profiles where this is non-null. |
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
| `payload` | `jsonb` | yes | — | Opaque JSON payload for events whose detail doesn't fit the shared columns. Used by ADR 029's `lesson_booked_by_coach` to record the server-computed override warnings alongside the lesson id. Mirrors `coach_audit_log.payload`. Keep usage sparse. Migration 0054. |
| `created_at` | `timestamptz` | no | `now()` | |

RLS is enabled. Policies TBD.

---

### `coach_audit_log`

Append-only log of significant coach-level events. Same shape and conventions as `household_audit_log` minus `household_id` plus `coach_id`. Kept general so future coach-level events can share it without a new table. See ADR 027.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | Primary key |
| `coach_id` | `uuid` | no | — | FK → `profiles.id` (restrict on delete). The coach the event is about. |
| `actor_id` | `uuid` | no | — | FK → `profiles.id` (restrict on delete). Profile that performed the action. For integration events, `coach_id = actor_id`. |
| `action` | `text` | no | — | e.g. `calendar_connected`, `calendar_disconnected`, `calendar_reconnected`, `calendar_sync_retried` |
| `target_profile_id` | `uuid` | yes | — | FK → `profiles.id` (restrict on delete). Reserved for future use; unused by integration events. |
| `target_swimmer_id` | `uuid` | yes | — | FK → `swimmers.id` (restrict on delete). Reserved; unused here. |
| `new_role` | `household_role` | yes | — | Reserved; unused here. |
| `created_at` | `timestamptz` | no | `now()` | |

Index: `(coach_id, created_at DESC)`.

RLS is enabled. Policies TBD.

---

### `lesson_email_outbox`

Transactional outbox for parent-facing booking emails. One row per state transition — per lesson for `lesson_*`/`booking_*`/`request_*` events, per batch for the three `batch_*` events (added in migration 0055 per ADR 030). Written inside the same `db.transaction()` as the lesson or batch change (CLAUDE.md's audit-log rule). Drained by the post-commit microtask sender and the `POST /internal/cron/tick` drain. See ADR 028 and ADR 030.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | Primary key |
| `lesson_id` | `uuid` | yes | — | FK → `lessons.id` (`ON DELETE RESTRICT`). Non-null for per-lesson events; null for batch events. Became nullable in migration 0055. |
| `batch_id` | `uuid` | yes | — | FK → `booking_batches.id` (`ON DELETE RESTRICT`). Non-null for batch events; null for per-lesson events. Added in migration 0055. The `lesson_email_outbox_scope_exactly_one` CHECK enforces that each row sets exactly one of `lesson_id` / `batch_id`. |
| `event` | `text` | no | — | CHECK IN (`booking_requested`, `lesson_confirmed`, `request_declined`, `request_expired`, `lesson_canceled`, `lesson_rescheduled`, `batch_booked`, `batch_approved`, `batch_canceled`). |
| `sequence` | `integer` | no | — | Per-(`lesson_id`, `event`) counter for per-lesson rows and per-(`batch_id`, `event`) counter for batch rows. Two partial unique indexes enforce the dedup separately in each namespace. |
| `recipient_profile_ids` | `uuid[]` | no | — | Snapshot of household owner + manager profile ids at write time. Email verification re-checked at send time. |
| `ics_method` | `text` | yes | — | `REQUEST`, `CANCEL`, or NULL. NULL means "no `.ics` attached" — used for `booking_requested` and decline/expire from pending. Paired with `ics_sequence` (both or neither). |
| `ics_sequence` | `integer` | yes | — | Snapshot of `lessons.calendar_sequence` at write time. First REQUEST ships 0. |
| `payload` | `jsonb` | no | — | Frozen render inputs (swimmer first names, LA-formatted date/time, location, deep link, etc). Scrubbed to `{_scrubbed_at}` by the cron retention pass once the row is terminal and >30 days old. |
| `status` | `text` | no | `'pending'` | CHECK IN (`pending`, `sending`, `sent`, `failed`, `skipped`, `superseded`, `abandoned`). `sent`, `skipped`, `superseded`, and `abandoned` are terminal. `abandoned` is assigned by the drain to a `failed` row 7 days after `created_at` so retries stop and the payload becomes a 30-day scrub candidate alongside the other terminal states (migration 0053). |
| `attempts` | `integer` | no | `0` | Incremented on every attempt that reaches the transport call. |
| `claimed_until` | `timestamptz` | yes | — | Non-null only while `status='sending'`. Set to `now() + interval '2 minutes'`; expired claims are recoverable by the next cron tick. |
| `last_error` | `text` | yes | — | Short transport error summary. No names, addresses, or email bodies. |
| `last_attempt_at` | `timestamptz` | yes | — | Set on every attempt. |
| `next_attempt_at` | `timestamptz` | no | `now()` | Backoff schedule. On failure the sender sets this to `now() + min(2^attempts, 30) minutes`. |
| `sent_at` | `timestamptz` | yes | — | Set once on first 2xx. |
| `provider_message_id` | `text` | yes | — | Resend returned id. Null when SMTP (Mailpit) is in use. |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | Auto-updated |

Constraints:
- Partial `UNIQUE (lesson_id, event, sequence) WHERE lesson_id IS NOT NULL` — dedup key for per-lesson rows (migration 0055).
- Partial `UNIQUE (batch_id, event, sequence) WHERE batch_id IS NOT NULL` — dedup key for batch rows (migration 0055).
- CHECK `lesson_email_outbox_scope_exactly_one`: exactly one of `lesson_id` / `batch_id` is non-null (migration 0055).
- CHECK: `(ics_method IS NULL) = (ics_sequence IS NULL)`. For batch rows both are NULL; the renderer reads per-lesson sequences from `payload.lessons[]` instead.
- CHECK: `(status = 'sending') = (claimed_until IS NOT NULL)`.

Indexes:
- Partial index on `(next_attempt_at)` `WHERE status IN ('pending','failed','sending')` — the drain hot path.
- `(lesson_id, created_at DESC)` for debugging per-lesson timelines.
- `(batch_id, created_at DESC)` for debugging per-batch timelines (migration 0055).

RLS is enabled. Policies TBD.

---

### `booking_batches`

One row per batch-booked submission (parent-created via `POST /lessons/batch`). The row is immutable after insert; member lessons' lifecycle (reschedule, cancel, individual approval) is independent of the batch. `lessons.batch_id` links each generated lesson back to the batch. See ADR 030 and `docs/plans/batch-booking.md`.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | Primary key |
| `household_id` | `uuid` | no | — | FK → `households.id` (`ON DELETE RESTRICT`). |
| `created_by` | `uuid` | no | — | FK → `profiles.id`. The parent who submitted the batch. |
| `mode` | `text` | no | — | CHECK IN (`manual`, `weekly`). |
| `weekly_pattern` | `jsonb` | yes | — | Non-empty array of `{ weekday, timeOfDay, durationMinutes }`. Non-null only when `mode='weekly'`. Each entry's length is independent so a batch can mix 30, 45, and 60-minute lessons. Validated against `StoredWeeklyPatternSchema` (shared Zod) on write and read. Added in migration 0056; replaces the aligned `weekly_pattern_weekdays` and `weekly_pattern_times` arrays that migration 0055 introduced. |
| `weekly_start_date` | `date` | yes | — | LA calendar date of the first candidate week. Non-null only when `mode='weekly'`. |
| `weekly_weeks` | `integer` | yes | — | Number of weeks the parent requested. Non-null only when `mode='weekly'`. |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | Auto-updated. Reserved; nothing writes to it in v1. |

Constraints:
- CHECK `booking_batches_mode_valid`: `mode IN ('manual', 'weekly')`.
- CHECK `booking_batches_weekly_fields_pair`: when `mode='weekly'`, `weekly_pattern` is non-null, `jsonb_typeof` is `array`, `jsonb_array_length >= 1`, and `weekly_start_date` + `weekly_weeks` are non-null. When `mode='manual'`, all three are null.

Indexes:
- `(household_id, created_at DESC)` for dashboard listing.

RLS is enabled. Policies TBD.

---

### `coach_calendar_integrations`

One row per coach while a Google Calendar integration exists. Created on first connect, updated on reconnect, and preserved through disconnect as `status = 'disconnected'` (token material cleared, calendar id retained for the next connect). Persists through the `needs_reconnect` state too so the dedicated calendar id and settings survive a revoked token. The row is only deleted via a `coach_profile_id` FK cascade when the profile itself is deleted. See ADR 027.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | Primary key |
| `coach_profile_id` | `uuid` | no | — | FK → `profiles.id` (cascade on delete). `UNIQUE` → at most one integration per coach. |
| `provider` | `text` | no | `'google'` | Forward-looking; today only `'google'` is written. |
| `status` | `text` | no | `'active'` | CHECK IN ('active', 'needs_reconnect', 'disconnected'). Non-existence of the row = never connected; a `'disconnected'` row maps to not-connected externally but retains the calendar id. |
| `google_calendar_id` | `text` | no | — | Returned by `calendars.insert` on first connect; reused on reconnect (whether after `needs_reconnect` or `disconnected`) when the calendar still exists in Google. |
| `google_account_email` | `text` | yes | — | For the status card. Null when Google omitted the id_token or its `email` claim (migration 0046). Also nulled on disconnect — only needed while the UI shows "Connected as *email*" (active) or "Reconnect *email*" (needs_reconnect). |
| `scope` | `text` | yes | — | OAuth scope granted. Non-null when `status` is `'active'`/`'needs_reconnect'`; nulled on disconnect (migration 0047). |
| `refresh_token_ciphertext` | `bytea` | yes | — | AES-256-GCM ciphertext. Nulled on disconnect (migration 0047). |
| `refresh_token_iv` | `bytea` | yes | — | 12-byte GCM nonce. Nulled on disconnect. |
| `refresh_token_tag` | `bytea` | yes | — | 16-byte GCM auth tag. Nulled on disconnect. |
| `refresh_token_key_version` | `integer` | yes | — | Enables key rotation. Nulled on disconnect (migration 0047 also drops the default). |
| `connected_at` | `timestamptz` | no | `now()` | Set on first successful connect; preserved through reconnect. |
| `last_sync_attempted_at` | `timestamptz` | yes | — | Updated on every sync call. |
| `last_sync_succeeded_at` | `timestamptz` | yes | — | Updated only on 2xx. |
| `last_full_reconcile_at` | `timestamptz` | yes | — | Set when a full sync pass completes. The cron tick promotes a tick's light pass to a full pass when this is >24h old. Migration 0050. |
| `sync_run_started_at` | `timestamptz` | yes | — | Set when a backfill or retry run starts, cleared in a `finally` block when it ends (crash or normal). The status endpoint reports `syncRunInProgress=false` when this is older than 2 minutes with no fresh `last_sync_attempted_at` progress, OR older than 10 minutes regardless of progress (hard cutoff), so a crashed/stuck run doesn't pin the UI's syncing banner. Migration 0049. |
| `needs_reconnect_since` | `timestamptz` | yes | — | Set when a refresh returns `invalid_grant`; cleared on successful reconnect. |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | Auto-updated. |

Index: `UNIQUE (coach_profile_id)`.

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

### `availability_seasons`

Season windows that override the default availability config for a date range.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | Primary key |
| `name` | `text` | no | — | |
| `start_date` | `date` | no | — | Unique. No two seasons may start on the same day. |
| `end_date` | `date` | no | — | Must be ≥ `start_date` (CHECK constraint). |
| `teaches_days` | `integer[]` | no | — | ISO weekday numbers (1=Mon … 7=Sun). Non-empty subset validated at the API layer. |
| `weekday_start_time` | `time` | yes | `NULL` | Lesson window start for weekday lessons. `NULL` when no weekdays are taught. |
| `weekday_end_time` | `time` | yes | `NULL` | Lesson window end for weekday lessons. Must be > `weekday_start_time` when both are set (CHECK constraint). |
| `weekend_start_time` | `time` | yes | `NULL` | Lesson window start for weekend lessons. `NULL` when no weekends are taught. |
| `weekend_end_time` | `time` | yes | `NULL` | Lesson window end for weekend lessons. Must be > `weekend_start_time` when both are set (CHECK constraint). |
| `starts_at_dst` | `boolean` | no | `false` | When true, "copy to next year" uses the next year's DST start date instead of a naive +1 year. |
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
| `moved_at` | `timestamptz` | yes | — | Set when the coach reschedules the lesson. Null for lessons that have never been moved. |
| `previous_starts_at` | `timestamptz` | yes | — | The original `starts_at` value before the most recent coach-initiated reschedule. Null when `moved_at` is null. |
| `google_calendar_event_id` | `text` | yes | — | Event id in the coach's dedicated calendar. Written on sync success; cleared on cancel/decline/disconnect. Populated by the Google Calendar sync feature (ADR 027). |
| `calendar_sync_status` | `text` | no | `'not_synced'` | CHECK IN ('not_synced', 'synced', 'sync_failed') |
| `calendar_sync_error` | `text` | yes | — | Last sync error message |
| `calendar_sync_attempts` | `integer` | no | `0` | Incremented on every attempt (success or failure). |
| `calendar_sequence` | `integer` | no | `0` | **Next** `.ics` `SEQUENCE:` value to issue for this lesson, per RFC 5545. Snapshot into `lesson_email_outbox.ics_sequence` and then incremented inside the same lesson transaction. First `REQUEST` ships `SEQUENCE:0`. See ADR 028. |
| `calendar_invite_sent_at` | `timestamptz` | yes | — | Set to `now()` the first time an outbox row with `ics_method='REQUEST'` is written. Lets the cancel/decline/expire paths decide whether a `METHOD:CANCEL` `.ics` is required (prior invite went out) or no `.ics` (never confirmed). Never cleared. |
| `batch_id` | `uuid` | yes | — | FK → `booking_batches.id` (`ON DELETE RESTRICT`). Non-null when this lesson was written through `POST /lessons/batch`; null for single-lesson parent bookings and all coach bookings. Immutable after insert in v1. Added in migration 0055. See ADR 030. |
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
| `not_legal_allowed` | `boolean` | no | When `true`, ratings for this skill may have `not_legal = true`. True for start components, turns, breakouts, and stroke kicks. The API rejects `not_legal = true` on any other skill. Default `false`. |
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

## Evaluations

### `evaluation_sessions`

One row per observation sitting. A session groups all ratings a coach makes for one swimmer in one category on one day.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | `uuid` | no | Primary key |
| `swimmer_id` | `uuid` | no | FK → `swimmers.id` (restrict on delete) |
| `coach_id` | `uuid` | no | FK → `profiles.id` (restrict on delete) |
| `category_id` | `uuid` | no | FK → `skill_categories.id` (restrict on delete) |
| `session_date` | `date` | no | Date of observation |
| `context` | `evaluation_context` | no | Enum: `drill`, `practice`, `race` |
| `coaching_priority` | `text` | no | Freeform text — what the coach typed. The dependency-map suggestion is shown as hint text in the UI but the stored value is always what the coach typed. |
| `created_at` | `timestamptz` | no | `now()` |
| `updated_at` | `timestamptz` | no | Auto-updated |

Constraints:
- `CHECK (coaching_priority_not_blank)` — `coaching_priority <> ''`

Session metadata is immutable after creation. See ADR 022.

RLS enabled. Policies TBD.

---

### `evaluation_drafts`

One row per in-progress evaluation. Holds one draft per (coach, swimmer, screen) — upserted on save, deleted when finalized. When a coach finalizes, the draft creates an `evaluation_sessions` row plus `skill_ratings` rows atomically; the draft row is deleted inside the same transaction.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | Primary key |
| `swimmer_id` | `uuid` | no | — | FK → `swimmers.id` (restrict on delete) |
| `coach_id` | `uuid` | no | — | FK → `profiles.id` (restrict on delete) |
| `screen_slug` | `text` | no | — | One of the nine evaluation screen slugs |
| `session_date` | `date` | yes | — | Nullable until the coach fills it in |
| `context` | `evaluation_context` | yes | — | `drill`, `practice`, or `race`; nullable until filled in |
| `coaching_priority` | `text` | yes | — | Freeform text; nullable until filled in |
| `breathing_pattern` | `text` | yes | — | Required for freestyle/butterfly at finalize time |
| `payload` | `jsonb` | no | `'{}'` | `Record<skillId \| "skillId:side", DraftSkillPayload>` — per-skill grades, fault tags, capacity/measurement, and note matching the SkillDraft shape from the web form |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | Auto-updated on upsert |

Constraints:
- `UNIQUE (coach_id, swimmer_id, screen_slug)` — at most one draft per coach/swimmer/screen
- `CHECK (draft_screen_slug_valid)` — screen_slug must be one of the nine valid slugs
- `CHECK (draft_breathing_pattern_valid)` — breathing_pattern must be null or a valid enum value

RLS is enabled with no policies (deny-all by design; the API is the sole access path).

---

### `skill_ratings`

One row per skill observation. Append-only: after insert, only the three void fields (`voided_at`, `void_reason`, `void_by`) may change. See ADR 022.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | Primary key |
| `session_id` | `uuid` | no | — | FK → `evaluation_sessions.id` (restrict on delete) |
| `swimmer_id` | `uuid` | no | — | FK → `swimmers.id` (restrict on delete) |
| `skill_id` | `uuid` | no | — | FK → `skills.id` (restrict on delete) |
| `coach_id` | `uuid` | no | — | FK → `profiles.id` (restrict on delete) |
| `grade` | `integer` | yes | — | 1–5; null when `no_concept = true`. Not legal ratings still carry a phantom grade. |
| `not_legal` | `boolean` | no | `false` | When true, rating counts as 0 in averages and is always treated as low by the dependency map. |
| `no_concept` | `boolean` | no | `false` | When true, `grade` is null; excluded from averages and denominator. Always treated as low by the dependency map. |
| `side` | `rating_side` | yes | — | Enum: `left`, `right`. Set only when `skills.rated_per_side = true` (enforced in E-3). |
| `capacity_value` | `numeric` | yes | — | e.g. distance in yards or number of reps |
| `capacity_unit` | `capacity_unit` | yes | — | Enum: `yards`, `reps`. Present iff `capacity_value` is present. |
| `measurement_value` | `numeric` | yes | — | e.g. tempo in cycles/min, stroke count, time in seconds |
| `measurement_unit` | `measurement_unit` | yes | — | Enum: `stroke_cycles_per_minute`, `stroke_count`, `seconds`, `feet`. Present iff `measurement_value` is present. |
| `note` | `text` | yes | — | Optional coach note |
| `voided_at` | `timestamptz` | yes | — | Set when voided. All three void fields must be set together. |
| `void_reason` | `text` | yes | — | Required when voiding. |
| `void_by` | `uuid` | yes | — | FK → `profiles.id` (restrict on delete). Coach who applied the void. |
| `rated_at` | `timestamptz` | no | — | When the coach observed the skill (may precede row insert time). |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | Reflects the timestamp of a void if applied; no other update path exists at the API layer. |

Constraints:
- `CHECK (grade_xor_no_concept)` — `(no_concept=false AND grade IS NOT NULL AND grade BETWEEN 1 AND 5) OR (no_concept=true AND grade IS NULL)`
- `CHECK (capacity_value_and_unit_consistent)` — both set or both null
- `CHECK (measurement_value_and_unit_consistent)` — both set or both null
- `CHECK (void_fields_consistent)` — all three void fields set together or all null

**Exclusion rules (applied in all calculations):**

| State | Averages & rollups | Dependency map |
|---|---|---|
| Voided | Ignored entirely | Treated as null (not assessed) |
| Not legal | Counts as 0 | Always low |
| No concept | Excluded from denominator | Always low |
| Not assessed (no row) | Excluded | Chain stops there |

RLS enabled. Policies TBD.

---

### `rating_fault_tags`

Fault tags observed during a rating. Each tag must be in `skills.fault_tags` for the rated skill (validated in E-3).

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `rating_id` | `uuid` | no | PK component; FK → `skill_ratings.id` (cascade on delete) |
| `fault_tag` | `text` | no | PK component |
| `created_at` | `timestamptz` | no | `now()` |

Constraints: composite PK `(rating_id, fault_tag)`.

RLS enabled. Policies TBD.

---

## Coach notes

### `coach_notes`

Free-text notes written by a coach about a swimmer. Notes may be standalone or attached to an evaluation session, a lesson, or a skill.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | Primary key |
| `swimmer_id` | `uuid` | no | — | FK → `swimmers.id` (restrict on delete) |
| `session_id` | `uuid` | yes | — | FK → `evaluation_sessions.id` (restrict on delete). Set when the note is tied to an evaluation session. |
| `lesson_id` | `uuid` | yes | — | FK → `lessons.id` (restrict on delete). Set when the note is tied to a lesson. |
| `skill_id` | `uuid` | yes | — | FK → `skills.id` (restrict on delete). Set when the note is tied to a specific skill. |
| `note_type` | `coach_note_type` | no | `'observation'` | Enum: `observation`, `correction`, `drill`, `recommendation` |
| `body` | `text` | no | — | Note text |
| `created_by` | `uuid` | no | — | FK → `profiles.id` (restrict on delete). Coach who wrote the note. |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | Auto-updated |

Constraints:
- `CHECK (coach_notes_body_not_blank)` — `body <> ''`

Enum: `coach_note_type` = `observation` | `correction` | `drill` | `recommendation`

RLS is enabled.

---

## Meet times

### `meets`

One row per swim meet. Coach-created. Meets with at least one associated swim cannot be deleted.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | Primary key |
| `name` | `text` | no | — | e.g. "Summer Champs" |
| `meet_date` | `date` | no | — | Date of the meet (YYYY-MM-DD) |
| `course` | `course` | no | — | Enum: `scy`, `scm`, `lcm` |
| `created_by` | `uuid` | no | — | FK → `profiles.id` (restrict on delete). Coach who created the meet. |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | Auto-updated |

RLS is enabled. Policies TBD.

**API behaviour:**
- `GET /coach/meets` — list all meets ordered by `meet_date`.
- `POST /coach/meets` — create a meet.
- `GET /coach/meets/:id` — meet details including all swims for active swimmers, ordered by `swum_on` then event.
- `DELETE /coach/meets/:id` — delete a meet. Returns 422 `meet_has_swims` if any swims are recorded for it.

---

### `meet_swims`

One row per timed swim. A swim may be a meet swim (`swim_type = 'meet'`, requires `meet_id`) or a practice swim (`swim_type = 'practice'`, `meet_id` is null). Practice swims are excluded from personal bests.

Times are stored as integer hundredths of a second (e.g. 6234 = 1:02.34). The `formatSwimTime` / `parseSwimTime` helpers in `packages/shared` convert between this integer and human-readable strings.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | Primary key |
| `swimmer_id` | `uuid` | no | — | FK → `swimmers.id` (restrict on delete) |
| `meet_id` | `uuid` | yes | — | FK → `meets.id` (restrict on delete). Null for practice swims. |
| `swim_type` | `swim_type` | no | `meet` | Enum: `meet`, `practice` |
| `event_distance` | `integer` | no | — | Distance in yards/meters (e.g. 50, 100, 200, 400) |
| `event_stroke` | `swim_stroke` | no | — | Enum: `free`, `back`, `breast`, `fly`, `im` |
| `course` | `course` | no | — | Enum: `scy`, `scm`, `lcm` |
| `swum_on` | `date` | no | — | Date the swim was performed. Must be ≥ `meets.meet_date` for meet swims. |
| `time_hundredths` | `integer` | no | — | Elapsed time in hundredths of a second |
| `created_by` | `uuid` | no | — | FK → `profiles.id` (restrict on delete). Coach who recorded the swim. |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | Auto-updated |

RLS is enabled. Policies TBD.

**Valid events:** Not all distance/stroke combinations are legal. The `isValidEvent` helper in `packages/shared` enforces the catalog. For example, 50 IM is not a valid event.

**API behaviour:**
- `GET /coach/swimmers/:id/meet-swims` — all swims for a swimmer (meet and practice), plus personal bests (fastest `time_hundredths` per `event_distance` / `event_stroke` / `course` across meet swims only).
- `POST /coach/swimmers/:id/meet-swims` — record a swim. Validates event, time string, and (for meet swims) that `swum_on ≥ meet_date`.
- `PATCH /coach/swimmers/:id/meet-swims/:swimId` — update time, date, or event. At least one field required. Re-validates event and time after merge.
- `DELETE /coach/swimmers/:id/meet-swims/:swimId` — delete a swim. Swim must belong to the given swimmer.

---

### `motivational_standards`

Reference data table for USA Swimming-style motivational time standards. Seeded empty; standards are loaded separately.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | Primary key |
| `standard_name` | `standard_name` | no | — | Enum: `B`, `BB`, `A`, `AA`, `AAA`, `AAAA` (ascending speed) |
| `event_distance` | `integer` | no | — | Distance in yards/meters |
| `event_stroke` | `swim_stroke` | no | — | Enum: `free`, `back`, `breast`, `fly`, `im` |
| `course` | `course` | no | — | Enum: `scy`, `scm`, `lcm` |
| `sex` | `sex` | no | — | Enum: `female`, `male` |
| `age_group` | `text` | no | — | One of: `6-under`, `7-8`, `9-10`, `11-12`, `13-14`, `15-18` |
| `cut_time_hundredths` | `integer` | no | — | Maximum qualifying time in hundredths of a second (≤ this value passes) |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | Auto-updated |

Constraints: `UNIQUE (standard_name, event_distance, event_stroke, course, sex, age_group)`.

RLS is enabled. Policies TBD.

---

## Conventions

- All tables use `id` as a UUID primary key (`gen_random_uuid()`), except `household_members` (composite PK `(household_id, profile_id)`), `skill_level_descriptors` (composite PK `(skill_id, level)`), `skill_dependencies` (composite PK `(skill_id, depends_on_skill_id)`), and `rating_scale_levels` (integer PK `level`)
- `created_at` and `updated_at` on every table, auto-managed by Drizzle
- Soft deletes via a nullable timestamp (`archived_at` on swimmers and skills, `disabled_at` on profiles); no hard deletes on domain entities
- Schema is defined in `apps/api/src/db/schema.ts`; types flow through `packages/shared`
