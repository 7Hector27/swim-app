import { Router } from "express";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import {
  CoachStatsSchema,
  type CoachStats,
} from "@swim-app/shared";

import { db } from "../db/client";
import { lessons, swimmers } from "../db/schema";
import { nowUtc } from "../lib/clock";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/asyncHandler";

export const coachStatsRouter = Router();

// ── GET /coach/stats ──────────────────────────────────────────────────────────
//
// Dashboard stat cards. Day/week buckets use America/Los_Angeles so a late
// Sunday PST lesson still counts in this week. "Lessons today/this week"
// count booked sessions only — status in (approved, completed, no_show) and
// not anonymized (ADR 034). Pending is deliberately excluded: those surface
// in the Requests to review card and would otherwise double-count. Completed
// and no_show stay so a card doesn't drop as the day progresses. Note that
// `coachSwimmerList.fetchLastLessonsForSwimmers` excludes `no_show` from its
// "last lesson" value — these cards count no-shows as lessons that happened
// (something was on the schedule), while the per-swimmer "last lesson"
// pointer tracks the last actual interaction with the swimmer. Both are
// intentional; keep them in sync if the product definition shifts. Pending
// requests mirror BookingRequestsCard: status=pending with a future start.

coachStatsRouter.get(
  "/stats",
  validate({}),
  asyncHandler(async (_req, res) => {
    // The LA today / week-Monday pair lands in a single CTE so the dashboard
    // query doesn't re-evaluate date_trunc('week', ...) for every row of a
    // scan it did not need.
    const lessonCountsRows = await db.execute<{ today_count: number; week_count: number }>(sql`
      WITH la AS (
        SELECT
          (now() AT TIME ZONE 'America/Los_Angeles')::date AS today,
          date_trunc('week', (now() AT TIME ZONE 'America/Los_Angeles')::date)::date AS week_mon
      )
      SELECT
        (SELECT count(*)::int FROM ${lessons}, la
          WHERE date_trunc('day', ${lessons.startsAt} AT TIME ZONE 'America/Los_Angeles') = la.today
            AND ${lessons.status} IN ('approved', 'completed', 'no_show')
            AND ${lessons.anonymizedAt} IS NULL) AS today_count,
        (SELECT count(*)::int FROM ${lessons}, la
          WHERE date_trunc('day', ${lessons.startsAt} AT TIME ZONE 'America/Los_Angeles')
                  BETWEEN la.week_mon AND la.week_mon + 6
            AND ${lessons.status} IN ('approved', 'completed', 'no_show')
            AND ${lessons.anonymizedAt} IS NULL) AS week_count
    `);

    const [pendingRows, swimmerRows] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(lessons)
        .where(and(eq(lessons.status, "pending"), gt(lessons.startsAt, nowUtc()))),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(swimmers)
        .where(isNull(swimmers.archivedAt)),
    ]);

    const lessonCounts = lessonCountsRows[0] ?? { today_count: 0, week_count: 0 };
    const body: CoachStats = {
      lessonsToday: Number(lessonCounts.today_count ?? 0),
      lessonsThisWeek: Number(lessonCounts.week_count ?? 0),
      pendingRequests: Number(pendingRows[0]?.count ?? 0),
      activeSwimmers: Number(swimmerRows[0]?.count ?? 0),
    };
    res.json(CoachStatsSchema.parse(body));
  }),
);
