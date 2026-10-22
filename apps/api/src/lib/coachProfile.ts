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

export interface ActiveCoachProfile {
  id: string;
  firstName: string | null;
}

// Reads the first active coach profile. One query, one filter — so when the
// app grows beyond one coach, every caller (Google Calendar sync, outbox
// render-payload build, future reminder worker) picks the same coach and
// the multi-coach fix lands in exactly one place. "First" is arbitrary
// under multiple active coaches today; see the integration test note.
export async function getActiveCoachProfile(): Promise<ActiveCoachProfile | null> {
  const rows = await db
    .select({ id: profiles.id, fullName: profiles.fullName })
    .from(profiles)
    .where(and(eq(profiles.role, "coach"), isNull(profiles.disabledAt)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, firstName: deriveFirstName(row.fullName) };
}

export async function getActiveCoachProfileId(): Promise<string | null> {
  const coach = await getActiveCoachProfile();
  return coach?.id ?? null;
}

function deriveFirstName(fullName: string | null): string | null {
  if (!fullName) return null;
  const trimmed = fullName.trim();
  if (trimmed.length === 0) return null;
  const firstSpace = trimmed.indexOf(" ");
  return firstSpace < 0 ? trimmed : trimmed.slice(0, firstSpace);
}
