import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";

// Approval gate: approval is required if the household has no prior approved
// lessons at all, or has never been approved at this specific location.
// Declined and canceled lessons are excluded from the count.
export async function needsApproval(
  householdId: string,
  locationId: string,
  tx: PostgresJsDatabase<typeof schema>,
): Promise<boolean> {
  const approvedAtLocation = await tx
    .select({ id: schema.lessons.id })
    .from(schema.lessons)
    .where(
      and(
        eq(schema.lessons.householdId, householdId),
        eq(schema.lessons.locationId, locationId),
        eq(schema.lessons.status, "approved"),
      ),
    )
    .limit(1);

  return approvedAtLocation.length === 0;
}

// Stub — wired in PR 7.
export function notifyBookingCreated(
  _lessonId: string,
  _autoApproved: boolean,
): void {}

// Stub — wired in PR 7.
export function notifyLessonApproved(_lessonId: string): void {}

// Stub — wired in PR 7.
export function notifyLessonDeclined(_lessonId: string): void {}

// Stub — wired in PR 8.
export function chargeLessonComplete(_lessonId: string): void {}

// Stub — wired in PR 6.
export function syncCalendarApproved(_lessonId: string): void {}
