// Resolve the coach's profile id in the single-coach app.
//
// Routes under /coach already have the coach's id on req.profile.id — those
// should NOT call this helper. The helper exists for code paths that run
// without a request (background microtasks after a parent-triggered
// booking write, backfill loops, cron) where there is no "current user" to
// read from. Returns null if no active coach profile exists.
//
// When the app grows beyond one coach, this helper becomes a lookup from
// the lesson's `coach_id` column — not a change in call-site shape.

import { and, eq, isNull } from "drizzle-orm";

import { db } from "../db/client";
import { profiles } from "../db/schema";

export async function getActiveCoachProfileId(): Promise<string | null> {
  const rows = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.role, "coach"), isNull(profiles.disabledAt)))
    .limit(1);
  return rows[0]?.id ?? null;
}
