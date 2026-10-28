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
