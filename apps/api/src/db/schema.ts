import { sql } from "drizzle-orm";
import { authUsers } from "drizzle-orm/supabase";
import {
  AnyPgColumn,
  boolean,
  check,
  date,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

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

export const availabilityConfig = pgTable("availability_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  // ISO day numbers: 1=Mon … 7=Sun. Default {1,2,3,5} = Mon/Tue/Wed/Fri.
  lessonDays: integer("lesson_days").array().notNull().default(sql`'{1,2,3,5}'`),
  schoolYearStartTime: time("school_year_start_time").notNull(),
  schoolYearEndTime: time("school_year_end_time").notNull(),
  summerMorningStartTime: time("summer_morning_start_time").notNull(),
  // Must be <= 15:00 — validated at the API layer, not via DB constraint.
  summerMorningEndTime: time("summer_morning_end_time").notNull(),
  // Must be >= 19:00 — validated at the API layer.
  summerEveningStartTime: time("summer_evening_start_time").notNull(),
  summerEveningEndTime: time("summer_evening_end_time").notNull(),
  maxDailyLessonMinutes: integer("max_daily_lesson_minutes").notNull().default(240),
  bookingMinAdvanceHours: integer("booking_min_advance_hours").notNull().default(16),
  bookingMaxAdvanceWeeks: integer("booking_max_advance_weeks").notNull().default(10),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date()),
}).enableRLS();

// ── Per-year summer end dates (ISL Championships vary annually) ───────────────

export const seasonSummerEndDates = pgTable("season_summer_end_dates", {
  year: integer("year").primaryKey(),
  endDate: date("end_date").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

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
    categoryId: uuid("category_id").notNull().references(() => skillCategories.id, { onDelete: "restrict" }),
    sessionDate: date("session_date").notNull(),
    context: evaluationContextEnum("context").notNull(),
    coachingPriority: text("coaching_priority").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date()),
  },
  (table) => [
    check("coaching_priority_not_blank", sql`${table.coachingPriority} <> ''`),
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

