// Lazy upsert for the coach notification preferences row. Called by the
// sender, the settings endpoints, and the daily-summary pass — any read
// that would otherwise race a signup. INSERT ... ON CONFLICT DO NOTHING
// is the exact shape the ADR calls for. See ADR 031.

import { eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { db } from "../../db/client";
import * as schema from "../../db/schema";
import { coachNotificationPreferences } from "../../db/schema";

type Tx = PostgresJsDatabase<typeof schema>;

export interface CoachNotificationPreferencesRow {
  profileId: string;
  bookingRequestEnabled: boolean;
  bookingRequestEmailBackupEnabled: boolean;
  requestExpiringSoonEnabled: boolean;
  parentChangeEnabled: boolean;
  autoApprovedMode: "off" | "summary" | "immediate";
  dailySummaryEnabled: boolean;
  dailySummaryTimeLocal: string;
  quietHoursEnabled: boolean;
  quietHoursStartLocal: string;
  quietHoursEndLocal: string;
  lockScreenDetail: "first_initial" | "full_name";
}

export async function getOrCreateCoachNotificationPreferences(
  profileId: string,
  tx: Tx = db,
): Promise<CoachNotificationPreferencesRow> {
  // Attempt insert first — ON CONFLICT DO NOTHING is cheap and leaves an
  // existing row untouched. Then read the row.
  await tx
    .insert(coachNotificationPreferences)
    .values({ profileId })
    .onConflictDoNothing({ target: coachNotificationPreferences.profileId });

  const rows = await tx
    .select()
    .from(coachNotificationPreferences)
    .where(eq(coachNotificationPreferences.profileId, profileId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(
      `getOrCreateCoachNotificationPreferences: upsert succeeded but select returned no row for ${profileId}`,
    );
  }
  return mapRow(row);
}

/**
 * Read-only companion to `getOrCreateCoachNotificationPreferences`.
 * Returns the stored row when it exists, or the default-value row (not
 * persisted) when it does not. Call this from read paths — the GET
 * notifications list, the devices read, etc. — so a stray caller cannot
 * provision a preferences row via a read. Only explicit writes (settings
 * PATCH, the sender's send-time read) should create.
 */
export async function readCoachNotificationPreferences(
  profileId: string,
  tx: Tx = db,
): Promise<CoachNotificationPreferencesRow> {
  const rows = await tx
    .select()
    .from(coachNotificationPreferences)
    .where(eq(coachNotificationPreferences.profileId, profileId))
    .limit(1);
  const row = rows[0];
  if (row) return mapRow(row);
  // Defaults mirror the column defaults in db/schema.ts. Keeping them
  // here as a literal (rather than echoing a SELECT) means reads never
  // need to touch the DB a second time to resolve the row.
  return {
    profileId,
    bookingRequestEnabled: true,
    bookingRequestEmailBackupEnabled: true,
    requestExpiringSoonEnabled: true,
    parentChangeEnabled: true,
    autoApprovedMode: "summary",
    dailySummaryEnabled: true,
    dailySummaryTimeLocal: "08:00:00",
    quietHoursEnabled: true,
    quietHoursStartLocal: "21:00:00",
    quietHoursEndLocal: "07:00:00",
    lockScreenDetail: "first_initial",
  };
}

export async function updateCoachNotificationPreferences(
  profileId: string,
  patch: Partial<Omit<CoachNotificationPreferencesRow, "profileId">>,
): Promise<CoachNotificationPreferencesRow> {
  // Upsert so a settings PATCH against a brand-new coach lands cleanly.
  await db
    .insert(coachNotificationPreferences)
    .values({ profileId, ...patch })
    .onConflictDoUpdate({
      target: coachNotificationPreferences.profileId,
      set: { ...patch, updatedAt: sql`now()` },
    });
  return getOrCreateCoachNotificationPreferences(profileId);
}

function mapRow(
  row: typeof coachNotificationPreferences.$inferSelect,
): CoachNotificationPreferencesRow {
  return {
    profileId: row.profileId,
    bookingRequestEnabled: row.bookingRequestEnabled,
    bookingRequestEmailBackupEnabled: row.bookingRequestEmailBackupEnabled,
    requestExpiringSoonEnabled: row.requestExpiringSoonEnabled,
    parentChangeEnabled: row.parentChangeEnabled,
    autoApprovedMode: row.autoApprovedMode as "off" | "summary" | "immediate",
    dailySummaryEnabled: row.dailySummaryEnabled,
    dailySummaryTimeLocal: row.dailySummaryTimeLocal,
    quietHoursEnabled: row.quietHoursEnabled,
    quietHoursStartLocal: row.quietHoursStartLocal,
    quietHoursEndLocal: row.quietHoursEndLocal,
    lockScreenDetail: row.lockScreenDetail as "first_initial" | "full_name",
  };
}
