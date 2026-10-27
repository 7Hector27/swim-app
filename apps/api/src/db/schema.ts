import { sql } from "drizzle-orm";
import { authUsers } from "drizzle-orm/supabase";
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
    // No default — this id mirrors auth.users.id and is set by the on_auth_user_created trigger.
    id: uuid("id")
      .primaryKey()
      .references(() => authUsers.id, { onDelete: "cascade" }),
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
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date()),
  },
  (table) => [
    check("blocked_times_ends_after_starts", sql`${table.endsAt} > ${table.startsAt}`),
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
  householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "restrict" }),
  locationId: uuid("location_id").notNull().references(() => lessonLocations.id, { onDelete: "restrict" }),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  type: lessonTypeEnum("type").notNull(),
  status: lessonStatusEnum("status").notNull().default("pending"),
  requestedBy: uuid("requested_by").notNull().references(() => profiles.id),
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
    coachingPriority: text("coaching_priority").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date()),
  },
  (table) => [
    check("coaching_priority_not_blank", sql`${table.coachingPriority} <> ''`),
    check("screen_slug_valid", sql`${table.screenSlug} IN ('fundamentals','water-confidence','freestyle','backstroke','breaststroke','butterfly','starts','im-turns','racing')`),
    check("breathing_pattern_valid", sql`${table.breathingPattern} IS NULL OR ${table.breathingPattern} IN ('every_1','every_2','every_3','every_4','every_5','other')`),
  ],
).enableRLS();

// Ratings are append-only: after insert the only columns that change are the
// three void fields (voided_at, void_reason, void_by), set atomically by the
// void endpoint. All other mutations are forbidden at the API layer (E-3).
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
    // When the coach observed the skill (may differ from row insert time).
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
    // durationMinutes: 30 | 45 | 60, swimmerIds: string[] }`. Non-null only
    // when mode='weekly'. The CHECK below asserts the shape at the column
    // level; the API also validates it against the shared
    // BatchPatternPairSchema on write (via the request body) and on read
    // via mapBookingBatchRow(). swimmerIds was added in ADR 030 phase 2;
    // batches written before that upgrade may be missing it, so readers
    // use StoredWeeklyPatternSchema.safeParse and treat the row as
    // best-effort (see cancel-remaining path).
    weeklyPattern: jsonb("weekly_pattern").$type<
      {
        weekday: number;
        timeOfDay: string;
        durationMinutes: 30 | 45 | 60;
        swimmerIds: string[];
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
export const lessonEmailOutbox = pgTable(
  "lesson_email_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable because batch-scoped rows reference booking_batches via
    // batch_id instead. The exactly-one CHECK below enforces that each row
    // populates exactly one of lesson_id / batch_id. See ADR 030.
    lessonId: uuid("lesson_id").references(() => lessons.id, { onDelete: "restrict" }),
    // Non-null for batch-scoped rows (events: batch_booked, batch_approved,
    // batch_canceled). NULL for per-lesson rows. See ADR 030.
    batchId: uuid("batch_id").references(() => bookingBatches.id, { onDelete: "restrict" }),
    // One of: 'booking_requested', 'lesson_confirmed', 'request_declined',
    // 'request_expired', 'lesson_canceled', 'lesson_rescheduled', or (for
    // batch rows) 'batch_booked', 'batch_approved', 'batch_canceled'.
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
    // Two partial unique indexes replace the old (lesson_id, event, sequence)
    // UNIQUE constraint. Per-lesson dedup and per-batch dedup are independent
    // namespaces — a batch's batch_booked row with sequence=0 does not
    // collide with any per-lesson lesson_confirmed row's sequence=0.
    uniqueIndex("lesson_email_outbox_lesson_event_seq_uq")
      .on(table.lessonId, table.event, table.sequence)
      .where(sql`lesson_id IS NOT NULL`),
    uniqueIndex("lesson_email_outbox_batch_event_seq_uq")
      .on(table.batchId, table.event, table.sequence)
      .where(sql`batch_id IS NOT NULL`),
    check(
      "lesson_email_outbox_event_valid",
      sql`${table.event} IN ('booking_requested', 'lesson_confirmed', 'request_declined', 'request_expired', 'lesson_canceled', 'lesson_rescheduled', 'batch_booked', 'batch_approved', 'batch_canceled')`,
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
    // Every row is scoped to exactly one of a lesson or a batch — never both,
    // never neither. See ADR 030.
    check(
      "lesson_email_outbox_scope_exactly_one",
      sql`(CASE WHEN ${table.lessonId} IS NOT NULL THEN 1 ELSE 0 END)
        + (CASE WHEN ${table.batchId} IS NOT NULL THEN 1 ELSE 0 END) = 1`,
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
  ],
).enableRLS();

