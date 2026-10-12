import { sql } from "drizzle-orm";
import { authUsers } from "drizzle-orm/supabase";
import {
  boolean,
  check,
  date,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

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
