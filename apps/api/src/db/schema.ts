import { sql } from "drizzle-orm";
import {
  AnyPgColumn,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Raw bytes for encrypted token material. Drizzle has no first-class bytea
// column, so we define it once here and reuse it. Column-level `.notNull()`
// / nullability controls the inferred type — don't pin `notNull: true` here
// or every bytea column is forced non-null regardless of its definition.
const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

// ── Skills catalog ────────────────────────────────────────────────────────────

export const skillTypeEnum = pgEnum("skill_type", [
  "rubric",
  "measured",
  "score",
  "composite",
  "rollup",
]);

export const strokeEnum = pgEnum("stroke", ["free", "back", "breast", "fly"]);

// Separate enum for swim event strokes — includes IM which is not a catalog skill stroke.
export const swimStrokeEnum = pgEnum("swim_stroke", ["free", "back", "breast", "fly", "im"]);

export const skillCategories = pgTable("skill_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date()),
}).enableRLS();

export const skills = pgTable("skills", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  categoryId: uuid("category_id").notNull().references(() => skillCategories.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  type: skillTypeEnum("type").notNull(),
  unit: text("unit"),
  stroke: strokeEnum("stroke"),
  appliesTo: text("applies_to").array(),
  parentSkillId: uuid("parent_skill_id").references((): AnyPgColumn => skills.id, { onDelete: "restrict" }),
  sortOrder: integer("sort_order").notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  faultTags: text("fault_tags").array(),
  ratedPerSide: boolean("rated_per_side").notNull().default(false),
  notLegalAllowed: boolean("not_legal_allowed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date()),
}).enableRLS();

export const skillLevelDescriptors = pgTable(
  "skill_level_descriptors",
  {
    skillId: uuid("skill_id").notNull().references(() => skills.id, { onDelete: "cascade" }),
    level: integer("level").notNull(),
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.skillId, table.level] }),
    check("skill_level_1_to_5", sql`${table.level} >= 1 AND ${table.level} <= 5`),
  ],
).enableRLS();

export const skillDependencies = pgTable(
  "skill_dependencies",
  {
    skillId: uuid("skill_id").notNull().references(() => skills.id, { onDelete: "cascade" }),
    dependsOnSkillId: uuid("depends_on_skill_id").notNull().references(() => skills.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.skillId, table.dependsOnSkillId] }),
    check("no_self_reference", sql`${table.skillId} <> ${table.dependsOnSkillId}`),
  ],
).enableRLS();

export const ratingScaleLevels = pgTable(
  "rating_scale_levels",
  {
    level: integer("level").primaryKey(),
    label: text("label").notNull(),
    meaning: text("meaning").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date()),
  },
  (table) => [
    check("rating_level_1_to_5", sql`${table.level} >= 1 AND ${table.level} <= 5`),
  ],
).enableRLS();

export const userRoleEnum = pgEnum("user_role", ["coach", "parent"]);
export const leagueEnum = pgEnum("league", ["club", "summer_league"]);
export const householdRoleEnum = pgEnum("household_role", ["owner", "manager", "viewer"]);

export const profiles = pgTable(
  "profiles",
  {
    // No default — this id mirrors auth.users.id and is set by the
    // on_auth_user_created trigger. The FK to auth.users was intentionally
    // dropped per ADR 034: account deletion hard-deletes the auth user via
    // the Admin API but keeps the scrubbed profile row for FK integrity
    // across household_audit_log, swimmers.public_consent_by, etc.
    id: uuid("id").primaryKey(),
    role: userRoleEnum("role").notNull().default("parent"),
    fullName: text("full_name"),
    phone: text("phone"),
    ageAttestedAt: timestamp("age_attested_at", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    // Mirrors of auth.users.email and auth.users.email_confirmed_at kept in
    // sync by the on_auth_user_created and on_auth_user_updated triggers so
    // the API runtime can resolve recipients without the service-role key.
    // See ADR 028. Treat as derived state — don't write from app code.
    email: text("email"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
).enableRLS();

// ── Households ────────────────────────────────────────────────────────────────

export const households = pgTable("households", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date()),
}).enableRLS();

// ── Swimmers ──────────────────────────────────────────────────────────────────

export const sexEnum = pgEnum("sex", ["female", "male"]);

export const swimmers = pgTable(
  "swimmers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    birthDate: date("birth_date").notNull(),
    sex: sexEnum("sex").notNull(),
    // No server default — the UI must collect an explicit answer from the parent.
    isPublic: boolean("is_public").notNull(),
    publicConsentAt: timestamp("public_consent_at", { withTimezone: true }),
    publicConsentBy: uuid("public_consent_by").references(() => profiles.id, {
      onDelete: "restrict",
    }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    recommendedBreathingPattern: text("recommended_breathing_pattern"),
    householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (table) => [
    // When is_public is true, both consent fields must be present.
    check(
      "public_consent_required",
      sql`NOT ${table.isPublic} OR (${table.publicConsentAt} IS NOT NULL AND ${table.publicConsentBy} IS NOT NULL)`,
    ),
    check("recommended_breathing_pattern_valid", sql`${table.recommendedBreathingPattern} IS NULL OR ${table.recommendedBreathingPattern} IN ('every_1','every_2','every_3','every_4','every_5','other')`),
  ],
).enableRLS();


// ── Clubs ─────────────────────────────────────────────────────────────────────

export const clubs = pgTable("clubs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => new Date()),
}).enableRLS();

// ── Swimmer clubs ─────────────────────────────────────────────────────────────

export const swimmerClubs = pgTable(
  "swimmer_clubs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    swimmerId: uuid("swimmer_id")
      .notNull()
      .references(() => swimmers.id, { onDelete: "cascade" }),
    clubId: uuid("club_id").references(() => clubs.id, {
      onDelete: "restrict",
    }),
    otherClubName: text("other_club_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (table) => [
    // Exactly one of club_id or other_club_name must be set.
    check(
      "exactly_one_club",
      sql`(${table.clubId} IS NOT NULL AND ${table.otherClubName} IS NULL) OR (${table.clubId} IS NULL AND ${table.otherClubName} IS NOT NULL)`,
    ),
    // Prevent the same swimmer from being linked to the same known club twice.
    uniqueIndex("swimmer_clubs_swimmer_club_uniq")
      .on(table.swimmerId, table.clubId)
      .where(sql`${table.clubId} IS NOT NULL`),
  ],
).enableRLS();

// ── Household members and audit log ──────────────────────────────────────────

export const householdMembers = pgTable(
  "household_members",
  {
    householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id").notNull().references(() => profiles.id, { onDelete: "restrict" }),
    role: householdRoleEnum("role").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.householdId, table.profileId] }),
    uniqueIndex("household_members_profile_uniq").on(table.profileId),
    uniqueIndex("household_members_one_owner_uniq").on(table.householdId).where(sql`${table.role} = 'owner'`),
  ],
).enableRLS();

export const householdAuditLog = pgTable("household_audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
  actorId: uuid("actor_id").notNull().references(() => profiles.id, { onDelete: "restrict" }),
  action: text("action").notNull(),
  targetProfileId: uuid("target_profile_id").references(() => profiles.id, { onDelete: "restrict" }),
  targetSwimmerId: uuid("target_swimmer_id").references(() => swimmers.id, { onDelete: "restrict" }),
  newRole: householdRoleEnum("new_role"),
  // Opaque JSON payload for events whose detail doesn't fit the shared
  // target_*/new_role columns. Added for ADR 029 (lesson_booked_by_coach
  // records the server-computed override warnings alongside the lesson id).
  // Mirrors coach_audit_log.payload from migration 0048 — keep usage sparse.
  payload: jsonb("payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

// ── Household invites ─────────────────────────────────────────────────────────

export const householdInvites = pgTable(
  "household_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    createdBy: uuid("created_by").notNull().references(() => profiles.id, { onDelete: "restrict" }),
    // Default is set by the DB: now() + interval '72 hours'. Cannot reference
    // created_at here because column defaults cannot reference sibling columns.
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull().default(sql`now() + interval '72 hours'`),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedBy: uuid("accepted_by").references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "invites_not_both_revoked_and_accepted",
      sql`NOT (${table.revokedAt} IS NOT NULL AND ${table.acceptedAt} IS NOT NULL)`,
    ),
  ],
).enableRLS();

// ── League registrations ───────────────────────────────────────────────────────

export const leagueRegistrations = pgTable(
  "league_registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    swimmerId: uuid("swimmer_id")
      .notNull()
      .references(() => swimmers.id, { onDelete: "cascade" }),
    league: leagueEnum("league").notNull(),
    seasonStartYear: integer("season_start_year").notNull(),
    registeredOn: date("registered_on").notNull(),
    // Null means active. Set to soft-delete (withdraw) a registration while
    // preserving the original registered_on date.
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("league_registrations_swimmer_league_season_uniq").on(
      table.swimmerId,
      table.league,
      table.seasonStartYear,
    ),
  ],
).enableRLS();

// ── Lesson locations ──────────────────────────────────────────────────────────

export const lessonLocations = pgTable("lesson_locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  city: text("city").notNull(),
  state: text("state").notNull().default("CA"),
  zip: text("zip").notNull(),
  // null = named pool (visible to all authenticated users)
  // non-null = home pool (visible only to coach and that household)
  householdId: uuid("household_id").references(() => households.id, { onDelete: "cascade" }),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date()),
}).enableRLS();

// ── Availability config (single row) ─────────────────────────────────────────

export const availabilityConfig = pgTable(
  "availability_config",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    maxDailyLessonMinutes: integer("max_daily_lesson_minutes").notNull().default(240),
    bookingMinAdvanceHours: integer("booking_min_advance_hours").notNull().default(16),
    bookingMaxAdvanceWeeks: integer("booking_max_advance_weeks").notNull().default(10),
    // Default teaching hours used for dates with no active season and no override.
    // ISO day numbers: 1=Mon … 7=Sun. Non-empty subset of {1..7} — validated at the API layer.
    defaultTeachesDays: integer("default_teaches_days").array().notNull().default([2, 3, 4, 5]),
    defaultStartTime: time("default_start_time").notNull().default("16:00"),
    defaultEndTime: time("default_end_time").notNull().default("20:00"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date()),
  },
  (table) => [
    check(
      "availability_config_default_start_before_end",
      sql`${table.defaultStartTime} < ${table.defaultEndTime}`,
    ),
  ],
).enableRLS();

// ── Availability seasons ──────────────────────────────────────────────────────

export const availabilitySeasons = pgTable(
  "availability_seasons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    startDate: date("start_date").notNull().unique(),
    endDate: date("end_date").notNull(),
    // ISO day numbers: 1=Mon … 7=Sun. Non-empty subset of {1..7} — validated at the API layer.
    teachesDays: integer("teaches_days").array().notNull(),
    weekdayStartTime: time("weekday_start_time"),
    weekdayEndTime: time("weekday_end_time"),
    weekendStartTime: time("weekend_start_time"),
    weekendEndTime: time("weekend_end_time"),
    // When true, this season starts on that year's daylight saving start date.
    // "Copy to next year" uses the next year's DST date for it instead of a naive +1 year.
    startsAtDst: boolean("starts_at_dst").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date()),
  },
  (table) => [
    check(
      "availability_seasons_end_after_start",
      sql`${table.endDate} >= ${table.startDate}`,
    ),
    check(
      "availability_seasons_weekday_before_end",
      sql`${table.weekdayStartTime} IS NULL OR ${table.weekdayEndTime} IS NULL OR ${table.weekdayStartTime} < ${table.weekdayEndTime}`,
    ),
    check(
      "availability_seasons_weekend_before_end",
      sql`${table.weekendStartTime} IS NULL OR ${table.weekendEndTime} IS NULL OR ${table.weekendStartTime} < ${table.weekendEndTime}`,
    ),
  ],
).enableRLS();

// ── Availability overrides ────────────────────────────────────────────────────

export const availabilityOverrideKindEnum = pgEnum("availability_override_kind", [
  "day_off",
  "custom_hours",
]);

export const availabilityOverrides = pgTable(
  "availability_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: availabilityOverrideKindEnum("kind").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    startTime: time("start_time"),
    endTime: time("end_time"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date()),
  },
  (table) => [
    check(
      "availability_overrides_end_on_or_after_start",
      sql`${table.endDate} >= ${table.startDate}`,
    ),
    // day_off: both times must be null. custom_hours: both times must be set, same day, start < end.
    check(
      "availability_overrides_kind_shape",
      sql`(${table.kind} = 'day_off'
            AND ${table.startTime} IS NULL
            AND ${table.endTime} IS NULL)
          OR (${table.kind} = 'custom_hours'
            AND ${table.startTime} IS NOT NULL
            AND ${table.endTime} IS NOT NULL
            AND ${table.startDate} = ${table.endDate}
            AND ${table.startTime} < ${table.endTime})`,
    ),
    check(
      "availability_overrides_note_length",
      sql`${table.note} IS NULL OR char_length(${table.note}) <= 500`,
    ),
  ],
).enableRLS();

// ── Blocked times ─────────────────────────────────────────────────────────────

export const blockedTimes = pgTable(
  "blocked_times",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    // Null means the block covers every pool (Jason is unavailable, period).
    // Non-null scopes the block to a single pool so other pools stay bookable
    // in the same time range. Added in ADR 033 for the pool-scoped bulk cancel
    // flow; existing rows default to NULL which preserves the pre-033 behavior.
    locationId: uuid("location_id").references(() => lessonLocations.id, { onDelete: "cascade" }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date()),
  },
  (table) => [
    check("blocked_times_ends_after_starts", sql`${table.endsAt} > ${table.startsAt}`),
  ],
).enableRLS();

// ── Coach bulk cancellations (ADR 033) ────────────────────────────────────────

// One row per coach invocation of the bulk-cancel flow. Owns the per-household
// outbox rows and per-household audit rows written by the same transaction;
// nothing on `lessons` references this row because a cancelled lesson's end
// state already lives in its own columns. The row answers "why this cluster
// of cancellations" without borrowing a lesson id or a booking batch id.
export const bulkCancellations = pgTable(
  "bulk_cancellations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    coachProfileId: uuid("coach_profile_id").notNull().references(() => profiles.id, { onDelete: "restrict" }),
    // LA calendar dates. end_date >= start_date (checked below).
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    // Null means the operation targeted every pool.
    locationId: uuid("location_id").references(() => lessonLocations.id, { onDelete: "set null" }),
    // Optional LA wall-clock time window applied to each LA calendar date in
    // the range. Both set together or both null (CHECK below). Null means the
    // operation covered the whole day. Added for the ADR 033 time-window
    // extension; pre-extension rows carry NULL.
    startTime: time("start_time"),
    endTime: time("end_time"),
    // Optional coach message included in each family's email and used as the
    // decline_reason for pending lessons declined by the operation. Capped at
    // 500 chars to match DECLINE_REASON_MAX_LENGTH; the API also validates.
    message: text("message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("bulk_cancellations_end_on_or_after_start", sql`${table.endDate} >= ${table.startDate}`),
    check("bulk_cancellations_message_length", sql`${table.message} IS NULL OR char_length(${table.message}) <= 500`),
    check(
      "bulk_cancellations_time_window_pair",
      sql`(${table.startTime} IS NULL) = (${table.endTime} IS NULL)`,
    ),
    check(
      "bulk_cancellations_end_after_start_time",
      sql`${table.startTime} IS NULL OR ${table.endTime} > ${table.startTime}`,
    ),
    index("bulk_cancellations_coach_created_idx").on(table.coachProfileId, table.createdAt.desc()),
  ],
).enableRLS();

// ── Lessons ───────────────────────────────────────────────────────────────────

export const lessonStatusEnum = pgEnum("lesson_status", [
  "pending",
  "approved",
  "declined",
  "expired",
  "canceled",
  "no_show",
  "completed",
]);

export const lessonTypeEnum = pgEnum("lesson_type", ["private", "family"]);

export const lessons = pgTable("lessons", {
  id: uuid("id").primaryKey().defaultRandom(),
  // ADR 034: household_id, location_id, and the actor columns are nullable
  // for anonymized past-lesson rows that survive their household's deletion.
  // Every live-lesson code path filters `anonymized_at IS NULL` (or the FK
  // is populated because the row was loaded before any anonymization ran),
  // so for those paths the nulls can never appear at runtime — enforce that
  // invariant at query boundaries with `requireLiveLessonFields`.
  householdId: uuid("household_id").references(() => households.id, { onDelete: "set null" }),
  locationId: uuid("location_id").references(() => lessonLocations.id, { onDelete: "set null" }),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  type: lessonTypeEnum("type").notNull(),
  status: lessonStatusEnum("status").notNull().default("pending"),
  requestedBy: uuid("requested_by").references(() => profiles.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedBy: uuid("approved_by").references(() => profiles.id),
  declinedAt: timestamp("declined_at", { withTimezone: true }),
  declinedBy: uuid("declined_by").references(() => profiles.id),
  declineReason: text("decline_reason"),
  canceledAt: timestamp("canceled_at", { withTimezone: true }),
  canceledBy: uuid("canceled_by").references(() => profiles.id),
  noShowAt: timestamp("no_show_at", { withTimezone: true }),
  noShowBy: uuid("no_show_by").references(() => profiles.id),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  googleCalendarEventId: text("google_calendar_event_id"),
  calendarSyncStatus: text("calendar_sync_status").notNull().default("not_synced"),
  calendarSyncError: text("calendar_sync_error"),
  calendarSyncAttempts: integer("calendar_sync_attempts").notNull().default(0),
  // The next .ics SEQUENCE value to issue for this lesson, per RFC 5545.
  // Outbox writes snapshot the current value into lesson_email_outbox.ics_sequence
  // and then increment this counter by 1 in the same transaction. First
  // REQUEST ships SEQUENCE:0. See ADR 028.
  calendarSequence: integer("calendar_sequence").notNull().default(0),
  // Set to now() the first time an outbox row with ics_method='REQUEST' is
  // written. Lets the cancel/decline/expire paths decide whether to emit a
  // METHOD:CANCEL (prior invite went out) or no .ics (never confirmed).
  calendarInviteSentAt: timestamp("calendar_invite_sent_at", { withTimezone: true }),
  movedAt: timestamp("moved_at", { withTimezone: true }),
  previousStartsAt: timestamp("previous_starts_at", { withTimezone: true }),
  // When this lesson is one of several submitted together through
  // POST /lessons/batch, this points to the batch row. Null for every
  // other lesson (single-lesson parent bookings, coach bookings).
  // Immutable after insert in v1. See ADR 030.
  batchId: uuid("batch_id").references((): AnyPgColumn => bookingBatches.id, { onDelete: "restrict" }),
  // ADR 034 reserves these three columns for anonymized past-lesson rows
  // that survive their household's deletion. Phase 1 adds the columns only;
  // the migration that drops NOT NULL on household_id / location_id / the
  // actor columns and starts writing anonymized rows lands in Phase 2
  // alongside the deletion engine, so the ~30 call sites that currently
  // treat the identity columns as non-null are audited in the same PR
  // that needs the capability.
  anonymizedAt: timestamp("anonymized_at", { withTimezone: true }),
  locationSnapshot: text("location_snapshot"),
  swimmerCount: integer("swimmer_count"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date()),
}, (table) => [
  check(
    "lessons_duration_valid",
    sql`${table.durationMinutes} IN (30, 45, 60)`,
  ),
  check(
    "lessons_calendar_sync_status_valid",
    sql`${table.calendarSyncStatus} IN ('not_synced', 'synced', 'sync_failed')`,
  ),
]).enableRLS();

export const lessonSwimmers = pgTable(
  "lesson_swimmers",
  {
    lessonId: uuid("lesson_id").notNull().references(() => lessons.id, { onDelete: "cascade" }),
    swimmerId: uuid("swimmer_id").notNull().references(() => swimmers.id, { onDelete: "restrict" }),
  },
  (table) => [
    primaryKey({ columns: [table.lessonId, table.swimmerId] }),
  ],
).enableRLS();

// ── Travel buffer overrides ───────────────────────────────────────────────────

export const travelBufferOverrides = pgTable(
  "travel_buffer_overrides",
  {
    fromLocationId: uuid("from_location_id").notNull().references(() => lessonLocations.id, { onDelete: "cascade" }),
    toLocationId: uuid("to_location_id").notNull().references(() => lessonLocations.id, { onDelete: "cascade" }),
    bufferMinutes: integer("buffer_minutes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.fromLocationId, table.toLocationId] }),
    check("travel_buffer_no_self_loop", sql`${table.fromLocationId} <> ${table.toLocationId}`),
  ],
).enableRLS();

// ── Evaluations ───────────────────────────────────────────────────────────────

export const evaluationContextEnum = pgEnum("evaluation_context", [
  "drill",
  "practice",
  "race",
]);

export const ratingSideEnum = pgEnum("rating_side", ["left", "right"]);

export const capacityUnitEnum = pgEnum("capacity_unit", ["yards", "reps"]);

export const measurementUnitEnum = pgEnum("measurement_unit", [
  "stroke_cycles_per_minute",
  "stroke_count",
  "seconds",
  "feet",
]);

// One session = one coach observing one swimmer in one sitting.
// coaching_priority is what Jason typed — the dependency-map suggestion
// is shown as a hint in the UI but the stored value is always freeform text.
export const evaluationSessions = pgTable(
  "evaluation_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    swimmerId: uuid("swimmer_id").notNull().references(() => swimmers.id, { onDelete: "restrict" }),
    coachId: uuid("coach_id").notNull().references(() => profiles.id, { onDelete: "restrict" }),
    categoryId: uuid("category_id").references(() => skillCategories.id, { onDelete: "restrict" }),
    screenSlug: text("screen_slug").notNull(),
    breathingPattern: text("breathing_pattern"),
    sessionDate: date("session_date").notNull(),
    context: evaluationContextEnum("context").notNull(),
    // Nullable: a coach can skip the priority when there is nothing new to say.
    // The parent UI falls back to the most recent non-null priority from any
    // session with at least one non-voided rating.
    coachingPriority: text("coaching_priority"),
    // Set to now() by the PATCH endpoint whenever any editable session field
    // actually changes, OR whenever a rating correction is written against
    // this session. Drives the "Edited" badge in the coach UI. ADR 032.
    editedAt: timestamp("edited_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date()),
  },
  (table) => [
    // When set, the priority can't be an empty string. Null is the "no priority"
    // state; empty string was never meant to be meaningful.
    check("coaching_priority_not_blank", sql`${table.coachingPriority} IS NULL OR ${table.coachingPriority} <> ''`),
    check("screen_slug_valid", sql`${table.screenSlug} IN ('fundamentals','water-confidence','freestyle','backstroke','breaststroke','butterfly','starts','im-turns','racing')`),
    check("breathing_pattern_valid", sql`${table.breathingPattern} IS NULL OR ${table.breathingPattern} IN ('every_1','every_2','every_3','every_4','every_5','other')`),
  ],
).enableRLS();

// Ratings are append-only: after insert the only columns that change are the
// three void fields (voided_at, void_reason, void_by) OR the three supersede
// fields (superseded_at, superseded_by, superseded_by_rating_id). All other
// mutations are forbidden by the skill_ratings_append_only trigger
// (migration 0020, relaxed in 0062). Corrections live as new rows that point
// back to the predecessor via supersedes_rating_id; see ADR 032.
export const skillRatings = pgTable(
  "skill_ratings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id").notNull().references(() => evaluationSessions.id, { onDelete: "restrict" }),
    swimmerId: uuid("swimmer_id").notNull().references(() => swimmers.id, { onDelete: "restrict" }),
    skillId: uuid("skill_id").notNull().references(() => skills.id, { onDelete: "restrict" }),
    coachId: uuid("coach_id").notNull().references(() => profiles.id, { onDelete: "restrict" }),
    // Nullable because no_concept ratings have no grade. Not legal ratings keep
    // a phantom 1-5 grade alongside not_legal=true (see grade_xor_no_concept).
    grade: integer("grade"),
    notLegal: boolean("not_legal").notNull().default(false),
    noConcept: boolean("no_concept").notNull().default(false),
    // Set only when the skill is rated_per_side (enforced in E-3).
    side: ratingSideEnum("side"),
    capacityValue: numeric("capacity_value"),
    capacityUnit: capacityUnitEnum("capacity_unit"),
    measurementValue: numeric("measurement_value"),
    measurementUnit: measurementUnitEnum("measurement_unit"),
    golfScoreCategory: text("golf_score_category"),
    note: text("note"),
    // Void fields: all three are set atomically or all are null.
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
    voidBy: uuid("void_by").references(() => profiles.id, { onDelete: "restrict" }),
    // Supersede fields: set together on the predecessor when a correction row
    // is written. Mirror of the void triplet.
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    supersededBy: uuid("superseded_by").references(() => profiles.id, { onDelete: "restrict" }),
    supersededByRatingId: uuid("superseded_by_rating_id").references((): AnyPgColumn => skillRatings.id, { onDelete: "restrict" }),
    // Backward link on the correction row only. Null on the original.
    supersedesRatingId: uuid("supersedes_rating_id").references((): AnyPgColumn => skillRatings.id, { onDelete: "restrict" }),
    // When the coach observed the skill (may differ from row insert time).
    // A correction row inherits its predecessor's rated_at — observation time
    // is preserved, correction time lives on created_at and in the audit log.
    ratedAt: timestamp("rated_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date()),
  },
  (table) => [
    // A rating has a 1-5 grade (no_concept=false) OR no_concept=true with no grade.
    // not_legal is orthogonal: it accompanies a 1-5 phantom grade.
    check(
      "grade_xor_no_concept",
      sql`(${table.noConcept} = false AND ${table.grade} IS NOT NULL AND ${table.grade} >= 1 AND ${table.grade} <= 5)
          OR (${table.noConcept} = true AND ${table.grade} IS NULL)`,
    ),
    // not_legal requires a phantom grade: not_legal=true and no_concept=true can't coexist.
    check(
      "not_legal_requires_grade",
      sql`${table.notLegal} = false OR ${table.grade} IS NOT NULL`,
    ),
    // Capacity value and unit are both present or both absent.
    check(
      "capacity_value_and_unit_consistent",
      sql`(${table.capacityValue} IS NULL) = (${table.capacityUnit} IS NULL)`,
    ),
    // Measurement value and unit are both present or both absent.
    check(
      "measurement_value_and_unit_consistent",
      sql`(${table.measurementValue} IS NULL) = (${table.measurementUnit} IS NULL)`,
    ),
    // All three void fields are set together or all are null.
    check(
      "void_fields_consistent",
      sql`(${table.voidedAt} IS NULL AND ${table.voidReason} IS NULL AND ${table.voidBy} IS NULL)
          OR (${table.voidedAt} IS NOT NULL AND ${table.voidReason} IS NOT NULL AND ${table.voidBy} IS NOT NULL)`,
    ),
    // All three supersede fields are set together or all are null.
    check(
      "supersede_fields_consistent",
      sql`(${table.supersededAt} IS NULL AND ${table.supersededBy} IS NULL AND ${table.supersededByRatingId} IS NULL)
          OR (${table.supersededAt} IS NOT NULL AND ${table.supersededBy} IS NOT NULL AND ${table.supersededByRatingId} IS NOT NULL)`,
    ),
  ],
).enableRLS();

// Server-side draft for an in-progress evaluation. One draft per
// (coachId, swimmerId, screenSlug) — upserted on save, deleted on finalize.
export const evaluationDrafts = pgTable(
  "evaluation_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    swimmerId: uuid("swimmer_id").notNull().references(() => swimmers.id, { onDelete: "restrict" }),
    coachId: uuid("coach_id").notNull().references(() => profiles.id, { onDelete: "restrict" }),
    screenSlug: text("screen_slug").notNull(),
    sessionDate: date("session_date"),
    context: evaluationContextEnum("context"),
    coachingPriority: text("coaching_priority"),
    breathingPattern: text("breathing_pattern"),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date()),
  },
  (table) => [
    unique("drafts_coach_swimmer_screen_unique").on(table.coachId, table.swimmerId, table.screenSlug),
    check("draft_screen_slug_valid", sql`${table.screenSlug} IN ('fundamentals','water-confidence','freestyle','backstroke','breaststroke','butterfly','starts','im-turns','racing')`),
    check("draft_breathing_pattern_valid", sql`${table.breathingPattern} IS NULL OR ${table.breathingPattern} IN ('every_1','every_2','every_3','every_4','every_5','other')`),
  ],
).enableRLS();

// Fault tags observed during a rating. Each tag must be in the skill's
// fault_tags list — validated at the API layer in E-3.
export const ratingFaultTags = pgTable(
  "rating_fault_tags",
  {
    ratingId: uuid("rating_id").notNull().references(() => skillRatings.id, { onDelete: "cascade" }),
    faultTag: text("fault_tag").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.ratingId, table.faultTag] }),
    check("fault_tag_not_blank", sql`${table.faultTag} <> ''`),
  ],
).enableRLS();

// ── Meets and meet swims ──────────────────────────────────────────────────────

export const courseEnum = pgEnum("course", ["scy", "scm", "lcm"]);

export const swimTypeEnum = pgEnum("swim_type", ["meet", "practice"]);

export const meets = pgTable("meets", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  meetDate: date("meet_date").notNull(),
  course: courseEnum("course").notNull(),
  createdBy: uuid("created_by").notNull().references(() => profiles.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date()),
}).enableRLS();

export const meetSwims = pgTable("meet_swims", {
  id: uuid("id").primaryKey().defaultRandom(),
  swimmerId: uuid("swimmer_id").notNull().references(() => swimmers.id, { onDelete: "restrict" }),
  // meetId is null for practice swims
  meetId: uuid("meet_id").references(() => meets.id, { onDelete: "restrict" }),
  swimType: swimTypeEnum("swim_type").notNull().default("meet"),
  eventDistance: integer("event_distance").notNull(),
  eventStroke: swimStrokeEnum("event_stroke").notNull(),
  course: courseEnum("course").notNull(),
  swumOn: date("swum_on").notNull(),
  timeHundredths: integer("time_hundredths").notNull(),
  createdBy: uuid("created_by").notNull().references(() => profiles.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date()),
}).enableRLS();

// ── Motivational standards ────────────────────────────────────────────────────

export const standardNameEnum = pgEnum("standard_name", ["B", "BB", "A", "AA", "AAA", "AAAA"]);

export const motivationalStandards = pgTable(
  "motivational_standards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    standardName: standardNameEnum("standard_name").notNull(),
    eventDistance: integer("event_distance").notNull(),
    eventStroke: swimStrokeEnum("event_stroke").notNull(),
    course: courseEnum("course").notNull(),
    sex: sexEnum("sex").notNull(),
    // One of: "6-under", "7-8", "9-10", "11-12", "13-14", "15-18"
    ageGroup: text("age_group").notNull(),
    cutTimeHundredths: integer("cut_time_hundredths").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("motivational_standards_uniq").on(
      table.standardName,
      table.eventDistance,
      table.eventStroke,
      table.course,
      table.sex,
      table.ageGroup,
    ),
    check("cut_time_positive", sql`${table.cutTimeHundredths} > 0`),
    check(
      "age_group_valid",
      sql`${table.ageGroup} IN ('6-under', '7-8', '9-10', '11-12', '13-14', '15-18')`,
    ),
  ],
).enableRLS();

// ── Coach notes ───────────────────────────────────────────────────────────────

export const coachNoteTypeEnum = pgEnum("coach_note_type", [
  "observation",
  "correction",
  "drill",
  "recommendation",
]);

export const coachNotes = pgTable(
  "coach_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    swimmerId: uuid("swimmer_id").notNull().references(() => swimmers.id, { onDelete: "restrict" }),
    sessionId: uuid("session_id").references(() => evaluationSessions.id, { onDelete: "restrict" }),
    lessonId: uuid("lesson_id").references(() => lessons.id, { onDelete: "restrict" }),
    skillId: uuid("skill_id").references(() => skills.id, { onDelete: "restrict" }),
    noteType: coachNoteTypeEnum("note_type").notNull().default("observation"),
    body: text("body").notNull(),
    createdBy: uuid("created_by").notNull().references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date()),
  },
  (table) => [
    check("coach_notes_body_not_blank", sql`${table.body} <> ''`),
  ],
).enableRLS();

// ── Coach Google Calendar integration + coach audit log ───────────────────────

export const coachCalendarIntegrations = pgTable(
  "coach_calendar_integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    coachProfileId: uuid("coach_profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("google"),
    status: text("status").notNull().default("active"),
    googleCalendarId: text("google_calendar_id").notNull(),
    googleAccountEmail: text("google_account_email"),
    // Nullable when status='disconnected': disconnect revokes the token at
    // Google and clears these fields so no stale ciphertext sits around.
    // The calendar id and status row persist so reconnect can reuse the id
    // (see ADR 027). On status='active' or 'needs_reconnect' they are set.
    scope: text("scope"),
    refreshTokenCiphertext: bytea("refresh_token_ciphertext"),
    refreshTokenIv: bytea("refresh_token_iv"),
    refreshTokenTag: bytea("refresh_token_tag"),
    refreshTokenKeyVersion: integer("refresh_token_key_version"),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
    lastSyncAttemptedAt: timestamp("last_sync_attempted_at", { withTimezone: true }),
    lastSyncSucceededAt: timestamp("last_sync_succeeded_at", { withTimezone: true }),
    // Set when a full sync pass finishes successfully. The cron tick reads
    // this to decide whether to promote its light pass to a full pass
    // (when > 24 hours old). See ADR 027.
    lastFullReconcileAt: timestamp("last_full_reconcile_at", { withTimezone: true }),
    needsReconnectSince: timestamp("needs_reconnect_since", { withTimezone: true }),
    // Set when a backfill or retry run starts, cleared in a finally block
    // when it ends (crash or normal). The status endpoint treats a value
    // older than 2 minutes with no fresh last_sync_attempted_at progress
    // as a crashed run and reports the run as not in progress so the UI
    // stops polling and shows the Retry button again. See ADR 027.
    syncRunStartedAt: timestamp("sync_run_started_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("coach_calendar_integrations_coach_profile_uniq").on(table.coachProfileId),
    check(
      "coach_calendar_integrations_status_valid",
      sql`${table.status} IN ('active', 'needs_reconnect', 'disconnected')`,
    ),
  ],
).enableRLS();

export const coachAuditLog = pgTable(
  "coach_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    coachId: uuid("coach_id").notNull().references(() => profiles.id, { onDelete: "restrict" }),
    actorId: uuid("actor_id").notNull().references(() => profiles.id, { onDelete: "restrict" }),
    action: text("action").notNull(),
    targetProfileId: uuid("target_profile_id").references(() => profiles.id, { onDelete: "restrict" }),
    targetSwimmerId: uuid("target_swimmer_id").references(() => swimmers.id, { onDelete: "restrict" }),
    newRole: householdRoleEnum("new_role"),
    // Opaque JSON payload for events whose shape doesn't fit the shared
    // target_*/new_role columns. Added in migration 0048 for the bulk-retry
    // audit row's attempted/succeeded/failed counts. Keep usage sparse —
    // this column is a convenience, not a durable schema contract.
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("coach_audit_log_coach_created_idx").on(table.coachId, table.createdAt.desc()),
  ],
).enableRLS();

// ── Batch booking (ADR 030) ─────────────────────────────────────────────────

// One row per batch submission. Immutable after insert; the member
// lessons' lifecycle (reschedule, cancel, approval) is independent of
// this row. For weekly mode the three weekly_* columns record the
// parent's original request: a jsonb array of
// `{ weekday, time, durationMinutes }` entries, a start date, and a week
// count. Manual mode leaves all three NULL; the picks live only on the
// generated `lessons` rows. See docs/plans/batch-booking.md.
export const bookingBatches = pgTable(
  "booking_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "restrict" }),
    createdBy: uuid("created_by").notNull().references(() => profiles.id),
    // 'manual' | 'weekly'. The CHECK below pairs it with the weekly_* fields.
    mode: text("mode").notNull(),
    // JSONB array of `{ weekday: 1..7, timeOfDay: "HH:MM",
    // durationMinutes: 30 | 45 | 60, swimmerIds?: string[] }`. Non-null only
    // when mode='weekly'. The CHECK below asserts the shape at the column
    // level; the API validates it against the shared BatchPatternPairSchema
    // on write.
    //
    // History only — nothing re-expands this column. Concrete lessons
    // (including per-lesson swimmer sets) are materialized in `lessons`
    // and `lesson_swimmers` at submit time. Cancel-remaining reads from
    // `lessons`, not from the pattern. The email outbox payload embeds the
    // pattern as an archival snapshot but no renderer currently reads it.
    //
    // swimmerIds was added in ADR 030 phase 2 and is optional on the type
    // because rows written before that upgrade don't carry it. Readers that
    // actually consume the pattern (none today) should use
    // StoredWeeklyPatternReadSchema and treat `swimmerIds` as unknown.
    weeklyPattern: jsonb("weekly_pattern").$type<
      {
        weekday: number;
        timeOfDay: string;
        durationMinutes: 30 | 45 | 60;
        swimmerIds?: string[];
      }[]
    >(),
    // LA calendar date of the first candidate week. Non-null only when mode='weekly'.
    weeklyStartDate: date("weekly_start_date"),
    // Number of weeks the parent requested. Non-null only when mode='weekly'.
    weeklyWeeks: integer("weekly_weeks"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date()),
  },
  (table) => [
    check(
      "booking_batches_mode_valid",
      sql`${table.mode} IN ('manual', 'weekly')`,
    ),
    // All weekly_* columns are set together or none of them. mode='weekly'
    // requires all three set and the pattern to be a non-empty jsonb array;
    // mode='manual' forbids all three. Keeps the batch row self-consistent
    // so later readers can trust the mode flag.
    check(
      "booking_batches_weekly_fields_pair",
      sql`(
        (${table.mode} = 'weekly'
         AND ${table.weeklyPattern} IS NOT NULL
         AND jsonb_typeof(${table.weeklyPattern}) = 'array'
         AND jsonb_array_length(${table.weeklyPattern}) >= 1
         AND ${table.weeklyStartDate} IS NOT NULL
         AND ${table.weeklyWeeks} IS NOT NULL)
        OR
        (${table.mode} = 'manual'
         AND ${table.weeklyPattern} IS NULL
         AND ${table.weeklyStartDate} IS NULL
         AND ${table.weeklyWeeks} IS NULL)
      )`,
    ),
    index("booking_batches_household_created_idx").on(table.householdId, table.createdAt.desc()),
  ],
).enableRLS();

// ── Parent booking emails outbox (ADR 028) ──────────────────────────────────

// Transactional outbox for parent-facing booking emails. One row per state
// transition per lesson. Written inside the same db.transaction() as the
// lesson change it records (CLAUDE.md's audit-log rule), drained by the
// post-commit microtask sender and the POST /internal/cron/tick drain. The
// (lesson_id, event, sequence) unique key prevents duplicate rows; the
// claim-before-send protocol (claimed_until + status='sending') prevents
// duplicate sends. See docs/plans/parent-booking-emails.md.

// Single source of truth for lesson_email_outbox.status values. The CHECK
// constraint below references these literally — any status added here
// MUST be reflected there and vice versa. Downstream code (e.g. the
// account-deletion engine's outbox scrub) derives its filter lists from
// these constants so a new status can't be silently missed.
export const LESSON_EMAIL_OUTBOX_TERMINAL_STATUSES = [
  "sent",
  "skipped",
  "superseded",
  "abandoned",
] as const;
export type LessonEmailOutboxTerminalStatus =
  (typeof LESSON_EMAIL_OUTBOX_TERMINAL_STATUSES)[number];

export const LESSON_EMAIL_OUTBOX_NON_TERMINAL_STATUSES = [
  "pending",
  "sending",
  "failed",
] as const;
export type LessonEmailOutboxNonTerminalStatus =
  (typeof LESSON_EMAIL_OUTBOX_NON_TERMINAL_STATUSES)[number];

export const LESSON_EMAIL_OUTBOX_STATUSES = [
  ...LESSON_EMAIL_OUTBOX_NON_TERMINAL_STATUSES,
  ...LESSON_EMAIL_OUTBOX_TERMINAL_STATUSES,
] as const;
export type LessonEmailOutboxStatus = (typeof LESSON_EMAIL_OUTBOX_STATUSES)[number];

export const lessonEmailOutbox = pgTable(
  "lesson_email_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable because batch-scoped rows reference booking_batches via
    // batch_id instead. The exactly-one CHECK below enforces that each row
    // populates exactly one of lesson_id / batch_id / bulk_cancellation_id.
    // See ADR 030 and ADR 033.
    lessonId: uuid("lesson_id").references(() => lessons.id, { onDelete: "restrict" }),
    // Non-null for batch-scoped rows (events: batch_booked, batch_approved,
    // batch_canceled). NULL for per-lesson rows. See ADR 030.
    batchId: uuid("batch_id").references(() => bookingBatches.id, { onDelete: "restrict" }),
    // Non-null for coach-bulk-cancel rows (event: coach_bulk_cancel). One row
    // per family per bulk cancellation; see ADR 033.
    bulkCancellationId: uuid("bulk_cancellation_id").references(() => bulkCancellations.id, { onDelete: "restrict" }),
    // Non-null only for coach-bulk-cancel rows, which key by (bulk_cancellation_id,
    // household_id). Lesson- and batch-scoped rows derive their household
    // from the parent row and leave this null. See ADR 033.
    householdId: uuid("household_id").references(() => households.id, { onDelete: "restrict" }),
    // One of: 'booking_requested', 'lesson_confirmed', 'request_declined',
    // 'request_expired', 'lesson_canceled', 'lesson_rescheduled', or (for
    // batch rows) 'batch_booked', 'batch_approved', 'batch_canceled', or (for
    // bulk-cancel rows) 'coach_bulk_cancel'.
    event: text("event").notNull(),
    // Per-(lesson_id, event) occurrence counter. First lesson_rescheduled
    // for a given lesson is 1, next is 2, etc. The (lesson_id, event,
    // sequence) triple is the row's natural dedup key.
    sequence: integer("sequence").notNull(),
    // Snapshot of the household's owner + manager profile ids at write
    // time. Email verification is re-checked at send time via the join on
    // profiles.email + profiles.email_verified_at.
    recipientProfileIds: uuid("recipient_profile_ids").array().notNull(),
    // 'REQUEST' | 'CANCEL' | NULL. NULL means "no .ics attached" (used for
    // booking_requested, decline-from-pending, expire-from-pending). Set
    // at write time; frozen alongside the payload.
    icsMethod: text("ics_method"),
    // Snapshot of lessons.calendar_sequence at write time. Null iff
    // ics_method is null.
    icsSequence: integer("ics_sequence"),
    // Frozen render inputs: swimmer first names, LA-formatted date+time,
    // location, deep link, previous starts_at for reschedule, decline
    // reason, actor type ('coach'|'parent'). Freezing means a later edit
    // on the lesson row never retroactively repaints a scheduled email.
    payload: jsonb("payload").notNull(),
    // 'pending' | 'sending' | 'sent' | 'failed' | 'skipped' | 'superseded' |
    // 'abandoned'. 'sent'/'skipped'/'superseded'/'abandoned' are terminal.
    // 'abandoned' is the terminal state the drain assigns to a 'failed' row
    // that has aged out (7 days since created_at) — the drain stops retrying
    // and the payload becomes a scrub candidate alongside sent/skipped/
    // superseded. See docs/plans/parent-booking-emails.md.
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    // Non-null only while status='sending'. Set to now() + 2 minutes by the
    // sender's claim transaction; expired claims are recoverable by the
    // drain on the next cron tick.
    claimedUntil: timestamp("claimed_until", { withTimezone: true }),
    // Short error summary (transport status + reason). Never includes names,
    // addresses, or email bodies — see docs/accounts.md logging rules.
    lastError: text("last_error"),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    // Backoff schedule for retries. On failure the sender sets this to
    // now() + min(2^attempts, 30) minutes. The drain picks rows where
    // next_attempt_at < now().
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    // Resend's returned id. Null when SMTP (Mailpit) is in use. For audit
    // only; no webhook ingestion in v1.
    providerMessageId: text("provider_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date()),
  },
  (table) => [
    // Three partial unique indexes, one per scope. Per-lesson, per-batch, and
    // per-(bulk-cancellation, household) dedup are independent namespaces —
    // a bulk_cancellation's coach_bulk_cancel row with sequence=0 does not
    // collide with any per-lesson lesson_confirmed row with sequence=0.
    uniqueIndex("lesson_email_outbox_lesson_event_seq_uq")
      .on(table.lessonId, table.event, table.sequence)
      .where(sql`lesson_id IS NOT NULL`),
    uniqueIndex("lesson_email_outbox_batch_event_seq_uq")
      .on(table.batchId, table.event, table.sequence)
      .where(sql`batch_id IS NOT NULL`),
    uniqueIndex("lesson_email_outbox_bulk_household_event_seq_uq")
      .on(table.bulkCancellationId, table.householdId, table.event, table.sequence)
      .where(sql`bulk_cancellation_id IS NOT NULL`),
    check(
      "lesson_email_outbox_event_valid",
      sql`${table.event} IN ('booking_requested', 'lesson_confirmed', 'request_declined', 'request_expired', 'lesson_canceled', 'lesson_rescheduled', 'batch_booked', 'batch_approved', 'batch_canceled', 'coach_booking_request', 'coach_bulk_cancel', 'coach_account_deleted')`,
    ),
    check(
      "lesson_email_outbox_status_valid",
      sql`${table.status} IN ('pending', 'sending', 'sent', 'failed', 'skipped', 'superseded', 'abandoned')`,
    ),
    check(
      "lesson_email_outbox_ics_pair",
      sql`(${table.icsMethod} IS NULL) = (${table.icsSequence} IS NULL)`,
    ),
    check(
      "lesson_email_outbox_claim_pair",
      sql`(${table.status} = 'sending') = (${table.claimedUntil} IS NOT NULL)`,
    ),
    // Every live row is scoped to exactly one of a lesson, a batch, or a
    // bulk cancellation — never two, never none. See ADR 030 and ADR 033.
    // The `payload ? '_scrubbed_at'` escape clause is the ADR 034 account-
    // deletion revision: a scrubbed-terminal row whose parent batch or
    // household has been hard-deleted holds null batch_id / household_id
    // (scrubEmailOutboxForHousehold nulls them so the parent DELETE's
    // RESTRICT doesn't fire). lesson_id survives because lessons are
    // anonymized, not deleted, so lesson-scoped scrubbed rows still have
    // exactly-one and don't need the escape — but the clause covers them
    // uniformly to keep the shape simple.
    // coach_account_deleted rows (ADR 034) have no lesson/batch/bulk_
    // cancellation scope — the family is gone, there's nothing to tie
    // them to. The row is a coach-only email that carries freed-slot
    // info in its payload, and it's enqueued inside the deletion
    // transaction. Exempt that event from the "exactly one scope"
    // rule alongside the already-existing scrubbed-row escape.
    check(
      "lesson_email_outbox_scope_exactly_one",
      sql`(${table.payload} ? '_scrubbed_at')
        OR (${table.event} = 'coach_account_deleted')
        OR ((CASE WHEN ${table.lessonId} IS NOT NULL THEN 1 ELSE 0 END)
          + (CASE WHEN ${table.batchId} IS NOT NULL THEN 1 ELSE 0 END)
          + (CASE WHEN ${table.bulkCancellationId} IS NOT NULL THEN 1 ELSE 0 END) = 1)`,
    ),
    // household_id is set iff the row is bulk-cancel-scoped. For lesson- and
    // batch-scoped rows the household is derived from the parent row. Same
    // `payload ? '_scrubbed_at'` escape as the scope CHECK above: ADR 034
    // nulls household_id on bulk-cancel-scoped scrubbed rows after the
    // household is hard-deleted, decoupling it from bulk_cancellation_id
    // (which survives because bulk_cancellations is coach-side and kept).
    check(
      "lesson_email_outbox_bulk_household_pair",
      sql`(${table.payload} ? '_scrubbed_at')
        OR (${table.event} = 'coach_account_deleted')
        OR ((${table.bulkCancellationId} IS NULL) = (${table.householdId} IS NULL))`,
    ),
    // Partial index on (next_attempt_at) for the drain's hot path. Includes
    // 'sending' because an expired-claim row is a drain candidate.
    index("lesson_email_outbox_drain_idx")
      .on(table.nextAttemptAt)
      .where(sql`status IN ('pending', 'failed', 'sending')`),
    // Debugging: the full timeline of emails for one lesson.
    index("lesson_email_outbox_lesson_created_idx").on(table.lessonId, table.createdAt.desc()),
    // Same debug use for batch rows.
    index("lesson_email_outbox_batch_created_idx").on(table.batchId, table.createdAt.desc()),
    // Same debug use for bulk-cancel rows.
    index("lesson_email_outbox_bulk_created_idx").on(table.bulkCancellationId, table.createdAt.desc()),
  ],
).enableRLS();

// ── Cron leases ─────────────────────────────────────────────────────────────

// Advisory-style single-writer gate for cron passes. One row per lease
// name (e.g. "cron/tick") carrying the expiry of the current holder.
//
// We deliberately do NOT use pg_advisory_lock. postgres-js reuses
// connections from a pool: the session that acquires a session-scoped
// advisory lock is not guaranteed to be the one that releases it, so a
// held lock can leak forever. A lease row with an expiry is self-healing
// (next tick after the expiry takes over) and is the same pattern the
// outbox uses for sender claims (`claimed_until`). See ADR 028.
export const cronLeases = pgTable(
  "cron_leases",
  {
    // Lease name — one row per pass name (e.g. "cron/tick").
    name: text("name").primaryKey(),
    // Non-null only while the lease is held. The row stays after the lease
    // releases so the next hold is an UPDATE, not an INSERT, which keeps
    // the "only one row per name" invariant trivially.
    heldUntil: timestamp("held_until", { withTimezone: true }),
    // Short identifier of the current/last holder (e.g. a request id) —
    // useful for log-side correlation. No PII.
    heldBy: text("held_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date()),
  },
).enableRLS();

// ── Coach alerts (ADR 031) ──────────────────────────────────────────────────

// Transactional outbox for coach push notifications. One row per state change
// event. Written inside the same db.transaction() as the state change it
// records (CLAUDE.md's audit-log rule), drained by the post-commit microtask
// sender and the POST /internal/cron/tick drain. The row powers both push
// delivery and the coach's in-app notification list. See ADR 031.
export const coachNotifications = pgTable(
  "coach_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Keyed by profile, not coach, so a future parent-facing push feature
    // fits the same table without a migration. The sender filters by
    // profile.role='coach' when the current scope is coach-only. CASCADE
    // is the product-correct choice for the (future) account deletion
    // flow in docs/accounts.md: when a profile is hard-deleted, their
    // notifications go with them (payload scrubs after 30 days anyway, so
    // there is no audit value in dangling notifications). Matches
    // coach_push_subscriptions.profile_id and
    // coach_notification_preferences.profile_id which are both CASCADE.
    profileId: uuid("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    // One of: 'booking_request', 'request_expiring_soon', 'parent_change',
    // 'calendar_disconnected', 'auto_approved_summary', 'daily_summary'.
    category: text("category").notNull(),
    // 'standard' | 'urgent'. Server-computed: urgent when the affected
    // lesson's starts_at is before midnight tomorrow in LA (today or
    // tomorrow). Drives the UI accent and the Web Push urgency header.
    // Quiet-hours bypass is a SEPARATE gate (starts_at < now()+12h) that
    // the sender computes at send time.
    urgency: text("urgency").notNull(),
    // Set for per-lesson categories. RESTRICT because lessons are never
    // hard-deleted in production — they soft-delete via status='canceled'.
    // A dangling notification can't occur in the live app. Tests delete
    // coach_notifications before deleting lessons (see parentBatchBooking's
    // cleanup helper and coachAlerts.integration.test.ts).
    lessonId: uuid("lesson_id").references(() => lessons.id, { onDelete: "restrict" }),
    // Set when the alert describes a batch. RESTRICT for the same reason:
    // booking_batches rows are immutable after insert (ADR 030) and never
    // hard-deleted in production.
    batchId: uuid("batch_id").references(() => bookingBatches.id, { onDelete: "restrict" }),
    // Frozen render inputs — the push body is composed at send time from
    // this payload plus the coach's lock_screen_detail setting so a later
    // preference change does not retroactively repaint a scheduled push.
    payload: jsonb("payload").notNull(),
    // Deep link the service worker opens on tap. Per-category routing is
    // documented in ADR 031.
    clickUrl: text("click_url").notNull(),
    // Notification tag — the browser surface collapses successive pushes
    // sharing a tag. 'lesson:<id>', 'batch:<id>',
    // 'calendar-disconnected:<coachId>', 'daily-summary:<dateLocal>'.
    tag: text("tag").notNull(),
    // Set by POST /coach/notifications/:id/read.
    readAt: timestamp("read_at", { withTimezone: true }),
    // 'pending' | 'held' | 'summarized' | 'sending' | 'sent' | 'failed' |
    // 'skipped' | 'superseded' | 'abandoned'. 'held' is the quiet-hours
    // terminal-until-release state. When release_at passes AND the coach's
    // daily summary is ON, the row flips to 'summarized' (lock-screen push
    // stays silent, in-app list keeps the row, daily summary counts it).
    // When daily summary is OFF, the row flips back to 'pending'.
    pushStatus: text("push_status").notNull().default("pending"),
    // Non-null only when push_status='held'. Set to the end of the coach's
    // quiet-hours window in LA, resolved to UTC at write/hold time.
    releaseAt: timestamp("release_at", { withTimezone: true }),
    pushAttempts: integer("push_attempts").notNull().default(0),
    // Non-null only while push_status='sending'. Set to now() + 2 minutes.
    pushClaimedUntil: timestamp("push_claimed_until", { withTimezone: true }),
    // Short error summary. Never contains names, addresses, or endpoint URLs
    // — see docs/accounts.md logging rules.
    pushLastError: text("push_last_error"),
    pushLastAttemptAt: timestamp("push_last_attempt_at", { withTimezone: true }),
    // Backoff schedule. On failure the sender sets this to now() + min(2^
    // attempts, 30) minutes.
    pushNextAttemptAt: timestamp("push_next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    // Set once when at least one subscription accepted the push with 2xx.
    pushSentAt: timestamp("push_sent_at", { withTimezone: true }),
    // Per-row counter of subscriptions that accepted this push.
    deliveredSubscriptionCount: integer("delivered_subscription_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date()),
  },
  (table) => [
    check(
      "coach_notifications_category_valid",
      // 'account_deleted' added for ADR 034 — the summary row Jason sees
      // when a family deletes their account, listing the freed-up lesson
      // times with no family or swimmer identity.
      sql`${table.category} IN ('booking_request', 'request_expiring_soon', 'parent_change', 'calendar_disconnected', 'auto_approved_summary', 'daily_summary', 'account_deleted')`,
    ),
    check(
      "coach_notifications_urgency_valid",
      sql`${table.urgency} IN ('standard', 'urgent')`,
    ),
    check(
      "coach_notifications_push_status_valid",
      sql`${table.pushStatus} IN ('pending', 'held', 'summarized', 'sending', 'sent', 'failed', 'skipped', 'superseded', 'abandoned')`,
    ),
    // Claim pair invariant: sending iff claimed_until is set.
    check(
      "coach_notifications_claim_pair",
      sql`(${table.pushStatus} = 'sending') = (${table.pushClaimedUntil} IS NOT NULL)`,
    ),
    // Held pair invariant: held iff release_at is set.
    check(
      "coach_notifications_held_pair",
      sql`(${table.pushStatus} = 'held') = (${table.releaseAt} IS NOT NULL)`,
    ),
    // Scope rules: per-lesson categories carry lesson_id xor batch_id;
    // calendar_disconnected and daily_summary carry neither.
    check(
      "coach_notifications_scope_valid",
      sql`(
        (${table.category} IN ('booking_request', 'request_expiring_soon', 'parent_change', 'auto_approved_summary')
         AND ((CASE WHEN ${table.lessonId} IS NOT NULL THEN 1 ELSE 0 END)
            + (CASE WHEN ${table.batchId} IS NOT NULL THEN 1 ELSE 0 END) = 1))
        OR (${table.category} IN ('calendar_disconnected', 'daily_summary', 'account_deleted')
            AND ${table.lessonId} IS NULL AND ${table.batchId} IS NULL)
      )`,
    ),
    // At most one request_expiring_soon reminder per lesson, across
    // repeated cron ticks. Also covers the (future) auto_approved_summary
    // 'immediate' mode so a lesson can't double-up.
    uniqueIndex("coach_notifications_lesson_category_uq")
      .on(table.profileId, table.lessonId, table.category)
      .where(sql`lesson_id IS NOT NULL`),
    // Same rule for batch-scoped alerts.
    uniqueIndex("coach_notifications_batch_category_uq")
      .on(table.profileId, table.batchId, table.category)
      .where(sql`batch_id IS NOT NULL`),
    // Durable idempotency for the daily summary: one row per coach per LA
    // date. The compose pass inserts speculatively on every tick after the
    // threshold; this index drops every attempt after the first.
    uniqueIndex("coach_notifications_daily_summary_uq")
      .on(table.profileId, sql`(payload->>'dateLocal')`)
      .where(sql`category = 'daily_summary'`),
    // Drain hot path — matches lesson_email_outbox's drain index.
    index("coach_notifications_drain_idx")
      .on(table.pushNextAttemptAt)
      .where(sql`push_status IN ('pending', 'failed', 'sending')`),
    // releaseHeldCoachNotifications lookup.
    index("coach_notifications_release_idx")
      .on(table.releaseAt)
      .where(sql`push_status = 'held'`),
    // In-app list primary read: unread first, newest first.
    index("coach_notifications_list_idx").on(
      table.profileId,
      sql`read_at NULLS FIRST`,
      table.createdAt.desc(),
    ),
    // Timeline debug.
    index("coach_notifications_profile_created_idx").on(table.profileId, table.createdAt.desc()),
  ],
).enableRLS();

// One row per browser push subscription per device. Rows are per profile, not
// coach-only, so a future parent-facing push feature uses the same table.
// Only 404 Gone / 410 Not Found from the push service deactivate a row —
// VAPID or other signature errors leave every row intact and fail the send
// with backoff (see ADR 031).
export const coachPushSubscriptions = pgTable(
  "coach_push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    // Push service endpoint URL — unique per profile. If the same browser
    // re-subscribes to the same endpoint, the register upsert is a no-op;
    // a new endpoint creates a new row.
    endpoint: text("endpoint").notNull(),
    // Base64url public key from PushSubscription.getKey('p256dh').
    p256dh: text("p256dh").notNull(),
    // Base64url auth secret from PushSubscription.getKey('auth').
    auth: text("auth").notNull(),
    // Captured from the request's user-agent header at register time.
    // Trimmed to 200 chars. Rendered on /account as a short label derived
    // at display time ("Chrome on macOS", "Safari on iOS PWA", etc.) — the
    // raw UA is retained for debugging but never logged.
    userAgent: text("user_agent"),
    // Flipped to false only on 404/410 from the push service. VAPID /
    // signature errors do NOT deactivate (would mass-wipe every device on
    // a misconfiguration); they fail the send with backoff instead.
    isActive: boolean("is_active").notNull().default(true),
    // 'gone' (push service returned 404/410) or 'coach_disabled' (coach
    // removed from /account). Non-null only when is_active=false.
    removedReason: text("removed_reason"),
    lastDeliveryAt: timestamp("last_delivery_at", { withTimezone: true }),
    lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date()),
  },
  (table) => [
    unique("coach_push_subscriptions_profile_endpoint_uq").on(table.profileId, table.endpoint),
    check(
      "coach_push_subscriptions_removed_reason_valid",
      sql`${table.removedReason} IS NULL OR ${table.removedReason} IN ('gone', 'coach_disabled')`,
    ),
    check(
      "coach_push_subscriptions_removed_reason_pair",
      sql`(${table.isActive} = true AND ${table.removedReason} IS NULL)
        OR (${table.isActive} = false)`,
    ),
    index("coach_push_subscriptions_profile_active_idx").on(table.profileId, table.isActive),
  ],
).enableRLS();

// One row per profile. Rows are created lazily on first read via
// `getOrCreateCoachNotificationPreferences(profileId)` — INSERT ... ON
// CONFLICT DO NOTHING — not by the signup trigger. See ADR 031.
export const coachNotificationPreferences = pgTable(
  "coach_notification_preferences",
  {
    profileId: uuid("profile_id").primaryKey().references(() => profiles.id, { onDelete: "cascade" }),
    bookingRequestEnabled: boolean("booking_request_enabled").notNull().default(true),
    // When true AND the coach has zero active push subscriptions, the
    // sender writes a lesson_email_outbox row with event='coach_booking_
    // request' instead of a push.
    bookingRequestEmailBackupEnabled: boolean("booking_request_email_backup_enabled").notNull().default(true),
    requestExpiringSoonEnabled: boolean("request_expiring_soon_enabled").notNull().default(true),
    parentChangeEnabled: boolean("parent_change_enabled").notNull().default(true),
    // 'off' | 'summary' | 'immediate'. 'summary' is the default — auto-
    // approved rows roll into the daily summary count rather than firing
    // immediately. calendar_disconnected has no toggle; it is always on.
    autoApprovedMode: text("auto_approved_mode").notNull().default("summary"),
    dailySummaryEnabled: boolean("daily_summary_enabled").notNull().default(true),
    // LA-local time; the compose pass fires when now()@LA >= this value
    // AND no row for the coach + today's LA date exists.
    dailySummaryTimeLocal: time("daily_summary_time_local").notNull().default("08:00"),
    quietHoursEnabled: boolean("quiet_hours_enabled").notNull().default(true),
    quietHoursStartLocal: time("quiet_hours_start_local").notNull().default("21:00"),
    // When end < start, the window crosses midnight — the sender's time
    // check handles both forms.
    quietHoursEndLocal: time("quiet_hours_end_local").notNull().default("07:00"),
    // 'first_initial' | 'full_name'. Default follows the "minimum useful
    // signal on the lock screen" rule from docs/accounts.md.
    lockScreenDetail: text("lock_screen_detail").notNull().default("first_initial"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date()),
  },
  (table) => [
    check(
      "coach_notification_preferences_auto_approved_mode_valid",
      sql`${table.autoApprovedMode} IN ('off', 'summary', 'immediate')`,
    ),
    check(
      "coach_notification_preferences_lock_screen_detail_valid",
      sql`${table.lockScreenDetail} IN ('first_initial', 'full_name')`,
    ),
  ],
).enableRLS();

// ── Account deletion jobs (ADR 034) ───────────────────────────────────────────
// Retry state for post-commit external cleanup after a parent account is
// deleted. The DB-side deletion runs inside the request transaction; this
// table only tracks the Supabase Auth hard-delete and the per-lesson Google
// Calendar sync, which run as post-commit tasks and may fail transiently.
//
// profile_id is nullable with no FK — the scrubbed profile row survives, but
// the id is kept here purely for log correlation and may be cleared by a
// future retention policy. auth_user_id names the Supabase auth user to
// delete and does not reference auth.users (that row goes away on success).

export const accountDeletionJobs = pgTable(
  "account_deletion_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id"),
    authUserId: uuid("auth_user_id").notNull(),
    scope: text("scope").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    // Lesson ids this deletion anonymized (past lessons still in Google
    // Calendar need patching, future ones need deleting). Captured at
    // deletion time because the anonymization itself nulled the ties
    // back to the household — the retry drain needs an authoritative
    // list to walk. Empty for 'leave' scope and for solo deletions
    // whose household owned no lessons.
    anonymizedLessonIds: uuid("anonymized_lesson_ids").array().notNull().default(sql`'{}'::uuid[]`),
    // Earliest time this row is eligible for the retry drain. Null
    // means immediately eligible (fresh insert, pre-0071 rows). The
    // drain sets this to now() + exponential backoff on real errors,
    // or now() + a short pause when the calendar step is blocked on
    // a disconnected Google integration. See the backoff constants
    // in services/accountDeletion/retry.ts.
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastError: text("last_error"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date()),
  },
  (table) => [
    check(
      "account_deletion_jobs_scope_valid",
      sql`${table.scope} IN ('solo', 'leave')`,
    ),
    check(
      "account_deletion_jobs_status_valid",
      sql`${table.status} IN ('pending', 'completed', 'failed')`,
    ),
    // Partial index on next_attempt_at, which is what the retry drain's
    // WHERE/ORDER BY hits (services/accountDeletion/retry.ts). Rows at
    // status='pending' are only candidate when next_attempt_at <= now,
    // and the drain picks the earliest-eligible row first.
    index("account_deletion_jobs_pending_idx")
      .on(table.nextAttemptAt.asc())
      .where(sql`status = 'pending'`),
  ],
).enableRLS();

