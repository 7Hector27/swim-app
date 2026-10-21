import { and, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";

// Approval gate: approval is required if the household has no prior approved
// or completed lessons at this specific location. Declined, canceled, expired,
// no_show, and pending lessons do not count toward the approval threshold.
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
        inArray(schema.lessons.status, ["approved", "completed"]),
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

// Stub — wired in PR 7.
export function notifyCoachOfChange(_lessonId: string): void {}
