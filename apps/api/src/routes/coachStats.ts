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
// count only lessons actually happening — canceled/declined/expired rows and
// anonymized rows (ADR 034) are excluded; completed and no_show stay in so
// the counts don't collapse as sessions finish. Pending requests mirror the
// BookingRequestsCard: status=pending with a start time still in the future.

coachStatsRouter.get(
  "/stats",
  validate({}),
  asyncHandler(async (_req, res) => {
    const laDayOfStart = sql`date_trunc('day', ${lessons.startsAt} AT TIME ZONE 'America/Los_Angeles')`;
    const laToday = sql`(now() AT TIME ZONE 'America/Los_Angeles')::date`;
    const laWeekMonday = sql`date_trunc('week', (now() AT TIME ZONE 'America/Los_Angeles')::date)::date`;
    const liveStatus = sql`${lessons.status} NOT IN ('canceled','declined','expired')`;

    const [todayRows, weekRows, pendingRows, swimmerRows] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(lessons)
        .where(
          and(
            sql`${laDayOfStart} = ${laToday}`,
            liveStatus,
            isNull(lessons.anonymizedAt),
          ),
        ),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(lessons)
        .where(
          and(
            sql`${laDayOfStart} BETWEEN ${laWeekMonday} AND (${laWeekMonday} + 6)`,
            liveStatus,
            isNull(lessons.anonymizedAt),
          ),
        ),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(lessons)
        .where(and(eq(lessons.status, "pending"), gt(lessons.startsAt, nowUtc()))),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(swimmers)
        .where(isNull(swimmers.archivedAt)),
    ]);

    const body: CoachStats = {
      lessonsToday: Number(todayRows[0]?.count ?? 0),
      lessonsThisWeek: Number(weekRows[0]?.count ?? 0),
      pendingRequests: Number(pendingRows[0]?.count ?? 0),
      activeSwimmers: Number(swimmerRows[0]?.count ?? 0),
    };
    res.json(CoachStatsSchema.parse(body));
  }),
);
