import { Router } from "express";
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import type {
  CoachListLessonsQuery,
  CoachScheduleQuery,
  CoachStats,
  DeclineLessonBody,
  LessonResponse,
  LessonSwimmer,
  ScheduleDay,
  ScheduleItem,
  UpcomingLesson,
} from "@swim-app/shared";
import {
  CoachListLessonsQuerySchema,
  CoachScheduleQuerySchema,
  DeclineLessonBodySchema,
} from "@swim-app/shared";
import { db } from "../db/client";
import {
  availabilityConfig,
  blockedTimes,
  lessonLocations,
  lessonSwimmers,
  lessons,
  seasonSummerEndDates,
  swimmers,
  travelBufferOverrides,
} from "../db/schema";
import { computeAvailableSlots } from "../lib/slots";
import { requireUser } from "../middleware/requireUser";
import { requireCoach } from "../middleware/requireCoach";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/asyncHandler";
import { notifyLessonApproved, notifyLessonDeclined, syncCalendarApproved } from "../lib/lessonApproval";
import { z } from "zod";

export const coachLessonsRouter = Router();

coachLessonsRouter.use(requireUser, requireCoach);

// ── GET /coach/lessons ────────────────────────────────────────────────────────

coachLessonsRouter.get(
  "/lessons",
  validate({ query: CoachListLessonsQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as CoachListLessonsQuery;

    // Lazy expiry safety net: expire any pending lessons past their deadline
    // in case the cron hasn't run recently.
    const now = new Date();
    await db
      .update(lessons)
      .set({ status: "expired" })
      .where(and(eq(lessons.status, "pending"), lt(lessons.expiresAt, now)));

    const filters = [];
    if (query.status !== undefined) {
      filters.push(eq(lessons.status, query.status));
    }
    if (query.householdId !== undefined) {
      filters.push(eq(lessons.householdId, query.householdId));
    }
    if (query.date !== undefined) {
      // Filter lessons whose starts_at falls on the given LA calendar date.
      // We compare via date_trunc in the LA timezone.
      filters.push(
        sql`date_trunc('day', ${lessons.startsAt} AT TIME ZONE 'America/Los_Angeles') = ${query.date}::date`,
      );
    }

    const lessonRows = await db
      .select()
      .from(lessons)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(asc(lessons.startsAt));

    const lessonIds = lessonRows.map((row) => row.id);

    const swimmerRows =
      lessonIds.length > 0
        ? await db
            .select({
              lessonId: lessonSwimmers.lessonId,
              swimmerId: lessonSwimmers.swimmerId,
              firstName: swimmers.firstName,
              lastName: swimmers.lastName,
            })
            .from(lessonSwimmers)
            .innerJoin(swimmers, eq(lessonSwimmers.swimmerId, swimmers.id))
            .where(inArray(lessonSwimmers.lessonId, lessonIds))
        : [];

    const swimmersByLesson = new Map<string, LessonSwimmer[]>();
    for (const row of swimmerRows) {
      const list = swimmersByLesson.get(row.lessonId) ?? [];
      list.push({ swimmerId: row.swimmerId, firstName: row.firstName, lastName: row.lastName });
      swimmersByLesson.set(row.lessonId, list);
    }

    const body: LessonResponse[] = lessonRows.map((row) => ({
      id: row.id,
      householdId: row.householdId,
      locationId: row.locationId,
      startsAt: row.startsAt.toISOString(),
      durationMinutes: row.durationMinutes as 30 | 45 | 60,
      type: row.type,
      status: row.status,
      swimmers: swimmersByLesson.get(row.id) ?? [],
      expiresAt: row.expiresAt?.toISOString() ?? null,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      declinedAt: row.declinedAt?.toISOString() ?? null,
      declineReason: row.declineReason ?? null,
      createdAt: row.createdAt.toISOString(),
    }));

    res.json(body);
  }),
);

// ── PATCH /coach/lessons/:id/approve ─────────────────────────────────────────

const LessonIdParamsSchema = z.object({ id: z.string().uuid() });

coachLessonsRouter.patch(
  "/lessons/:id/approve",
  validate({ params: LessonIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const now = new Date();

    const rows = await db
      .update(lessons)
      .set({ status: "approved", approvedAt: now, approvedBy: req.profile.id })
      .where(and(eq(lessons.id, id), eq(lessons.status, "pending")))
      .returning();

    const updated = rows[0];
    if (!updated) {
      const existing = await db.select({ status: lessons.status }).from(lessons).where(eq(lessons.id, id)).limit(1);
      if (!existing[0]) {
        res.status(404).json({ error: "Lesson not found" });
        return;
      }
      res.status(422).json({ error: "Lesson is not pending" });
      return;
    }

    syncCalendarApproved(updated.id);
    notifyLessonApproved(updated.id);

    // Fetch swimmers for response.
    const swimmerRows = await db
      .select({ swimmerId: lessonSwimmers.swimmerId, firstName: swimmers.firstName, lastName: swimmers.lastName })
      .from(lessonSwimmers)
      .innerJoin(swimmers, eq(lessonSwimmers.swimmerId, swimmers.id))
      .where(eq(lessonSwimmers.lessonId, updated.id));

    const body: LessonResponse = {
      id: updated.id,
      householdId: updated.householdId,
      locationId: updated.locationId,
      startsAt: updated.startsAt.toISOString(),
      durationMinutes: updated.durationMinutes as 30 | 45 | 60,
      type: updated.type,
      status: updated.status,
      swimmers: swimmerRows.map((row) => ({
        swimmerId: row.swimmerId,
        firstName: row.firstName,
        lastName: row.lastName,
      })),
      expiresAt: updated.expiresAt?.toISOString() ?? null,
      approvedAt: updated.approvedAt?.toISOString() ?? null,
      declinedAt: null,
      declineReason: null,
      createdAt: updated.createdAt.toISOString(),
    };

    res.json(body);
  }),
);

// ── PATCH /coach/lessons/:id/decline ─────────────────────────────────────────

coachLessonsRouter.patch(
  "/lessons/:id/decline",
  validate({ params: LessonIdParamsSchema, body: DeclineLessonBodySchema }),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const body = req.body as DeclineLessonBody;
    const now = new Date();

    const rows = await db
      .update(lessons)
      .set({
        status: "declined",
        declinedAt: now,
        declinedBy: req.profile.id,
        ...(body.reason !== undefined && { declineReason: body.reason }),
      })
      .where(and(eq(lessons.id, id), eq(lessons.status, "pending")))
      .returning();

    const updated = rows[0];
    if (!updated) {
      const existing = await db.select({ status: lessons.status }).from(lessons).where(eq(lessons.id, id)).limit(1);
      if (!existing[0]) {
        res.status(404).json({ error: "Lesson not found" });
        return;
      }
      res.status(422).json({ error: "Lesson is not pending" });
      return;
    }

    notifyLessonDeclined(updated.id);

    const swimmerRows = await db
      .select({ swimmerId: lessonSwimmers.swimmerId, firstName: swimmers.firstName, lastName: swimmers.lastName })
      .from(lessonSwimmers)
      .innerJoin(swimmers, eq(lessonSwimmers.swimmerId, swimmers.id))
      .where(eq(lessonSwimmers.lessonId, updated.id));

    const responseBody: LessonResponse = {
      id: updated.id,
      householdId: updated.householdId,
      locationId: updated.locationId,
      startsAt: updated.startsAt.toISOString(),
      durationMinutes: updated.durationMinutes as 30 | 45 | 60,
      type: updated.type,
      status: updated.status,
      swimmers: swimmerRows.map((row) => ({
        swimmerId: row.swimmerId,
        firstName: row.firstName,
        lastName: row.lastName,
      })),
      expiresAt: updated.expiresAt?.toISOString() ?? null,
      approvedAt: updated.approvedAt?.toISOString() ?? null,
      declinedAt: updated.declinedAt?.toISOString() ?? null,
      declineReason: updated.declineReason ?? null,
      createdAt: updated.createdAt.toISOString(),
    };

    res.json(responseBody);
  }),
);

// ── Helper ────────────────────────────────────────────────────────────────────

function mergeSlotWindows(slots: Array<{ startsAt: Date; endsAt: Date }>): Array<{ startsAt: Date; endsAt: Date }> {
  if (slots.length === 0) return [];
  const sorted = [...slots].sort((slotA, slotB) => slotA.startsAt.getTime() - slotB.startsAt.getTime());
  const merged: Array<{ startsAt: Date; endsAt: Date }> = [];
  let currentStart = sorted[0]!.startsAt;
  let currentEnd = sorted[0]!.endsAt;
  for (let index = 1; index < sorted.length; index++) {
    const slot = sorted[index]!;
    if (slot.startsAt.getTime() <= currentEnd.getTime()) {
      if (slot.endsAt.getTime() > currentEnd.getTime()) {
        currentEnd = slot.endsAt;
      }
    } else {
      merged.push({ startsAt: currentStart, endsAt: currentEnd });
      currentStart = slot.startsAt;
      currentEnd = slot.endsAt;
    }
  }
  merged.push({ startsAt: currentStart, endsAt: currentEnd });
  return merged;
}

// ── GET /coach/schedule ───────────────────────────────────────────────────────

coachLessonsRouter.get(
  "/schedule",
  validate({ query: CoachScheduleQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as CoachScheduleQuery;
    const { date } = query;

    const lessonRows = await db
      .select({
        id: lessons.id,
        householdId: lessons.householdId,
        locationId: lessons.locationId,
        locationName: lessonLocations.name,
        startsAt: lessons.startsAt,
        durationMinutes: lessons.durationMinutes,
        type: lessons.type,
        status: lessons.status,
        expiresAt: lessons.expiresAt,
        approvedAt: lessons.approvedAt,
        declinedAt: lessons.declinedAt,
        declineReason: lessons.declineReason,
        createdAt: lessons.createdAt,
      })
      .from(lessons)
      .innerJoin(lessonLocations, eq(lessons.locationId, lessonLocations.id))
      .where(
        and(
          inArray(lessons.status, ["pending", "approved"]),
          sql`date_trunc('day', ${lessons.startsAt} AT TIME ZONE 'America/Los_Angeles') = ${date}::date`,
        ),
      )
      .orderBy(asc(lessons.startsAt));

    const lessonIds = lessonRows.map((row) => row.id);

    const swimmerRows =
      lessonIds.length > 0
        ? await db
            .select({
              lessonId: lessonSwimmers.lessonId,
              swimmerId: lessonSwimmers.swimmerId,
              firstName: swimmers.firstName,
              lastName: swimmers.lastName,
            })
            .from(lessonSwimmers)
            .innerJoin(swimmers, eq(lessonSwimmers.swimmerId, swimmers.id))
            .where(inArray(lessonSwimmers.lessonId, lessonIds))
        : [];

    const swimmersByLesson = new Map<string, LessonSwimmer[]>();
    for (const row of swimmerRows) {
      const list = swimmersByLesson.get(row.lessonId) ?? [];
      list.push({ swimmerId: row.swimmerId, firstName: row.firstName, lastName: row.lastName });
      swimmersByLesson.set(row.lessonId, list);
    }

    const dayLessons: UpcomingLesson[] = lessonRows.map((row) => ({
      id: row.id,
      householdId: row.householdId,
      locationId: row.locationId,
      locationName: row.locationName,
      startsAt: row.startsAt.toISOString(),
      durationMinutes: row.durationMinutes as 30 | 45 | 60,
      type: row.type,
      status: row.status,
      swimmers: swimmersByLesson.get(row.id) ?? [],
      expiresAt: row.expiresAt?.toISOString() ?? null,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      declinedAt: row.declinedAt?.toISOString() ?? null,
      declineReason: row.declineReason ?? null,
      createdAt: row.createdAt.toISOString(),
    }));

    const [configRows, bufferRows, blockedRows, existingLessonRows, endDateRow] =
      await Promise.all([
        db.select().from(availabilityConfig).limit(1),
        db.select().from(travelBufferOverrides),
        db.select().from(blockedTimes),
        db
          .select({
            startsAt: lessons.startsAt,
            durationMinutes: lessons.durationMinutes,
            locationId: lessons.locationId,
          })
          .from(lessons)
          .where(inArray(lessons.status, ["pending", "approved"])),
        db
          .select({ endDate: seasonSummerEndDates.endDate })
          .from(seasonSummerEndDates)
          .where(eq(seasonSummerEndDates.year, parseInt(date.slice(0, 4), 10)))
          .limit(1),
      ]);

    const config = configRows[0];
    const items: ScheduleItem[] = [];

    if (config) {
      const locationForSlots = lessonRows[0]?.locationId;

      if (locationForSlots) {
        const openSlots = computeAvailableSlots({
          date,
          durationMinutes: 30,
          locationId: locationForSlots,
          existingLessons: existingLessonRows.map((row) => ({
            startsAt: row.startsAt,
            durationMinutes: row.durationMinutes,
            locationId: row.locationId,
          })),
          blockedTimes: blockedRows.map((row) => ({ startsAt: row.startsAt, endsAt: row.endsAt })),
          travelBufferOverrides: bufferRows.map((row) => ({
            fromLocationId: row.fromLocationId,
            toLocationId: row.toLocationId,
            bufferMinutes: row.bufferMinutes,
          })),
          config: {
            id: config.id,
            lessonDays: config.lessonDays,
            schoolYearStartTime: config.schoolYearStartTime,
            schoolYearEndTime: config.schoolYearEndTime,
            summerMorningStartTime: config.summerMorningStartTime,
            summerMorningEndTime: config.summerMorningEndTime,
            summerEveningStartTime: config.summerEveningStartTime,
            summerEveningEndTime: config.summerEveningEndTime,
            maxDailyLessonMinutes: config.maxDailyLessonMinutes,
            bookingMinAdvanceHours: config.bookingMinAdvanceHours,
            bookingMaxAdvanceWeeks: config.bookingMaxAdvanceWeeks,
          },
          summerEndDate: endDateRow[0]?.endDate ?? null,
          gcalBusyTimes: [],
          nowUtc: new Date(0),
        });

        const merged = mergeSlotWindows(openSlots);
        for (const window of merged) {
          items.push({
            type: "open_slot",
            startsAt: window.startsAt.toISOString(),
            endsAt: window.endsAt.toISOString(),
          });
        }
      }
    }

    for (const lesson of dayLessons) {
      items.push({ type: "lesson", lesson });
    }

    const bufferLookup = new Map<string, number>();
    for (const buf of bufferRows) {
      bufferLookup.set(`${buf.fromLocationId}:${buf.toLocationId}`, buf.bufferMinutes);
    }

    const locationNameById = new Map<string, string>();
    for (const row of lessonRows) {
      locationNameById.set(row.locationId, row.locationName);
    }

    for (let index = 0; index < dayLessons.length - 1; index++) {
      const current = dayLessons[index]!;
      const next = dayLessons[index + 1]!;
      if (current.locationId !== next.locationId) {
        const bufMin =
          bufferLookup.get(`${current.locationId}:${next.locationId}`) ?? 30;
        const bufferStartsAt = new Date(
          new Date(current.startsAt).getTime() + current.durationMinutes * 60 * 1000,
        );
        const bufferEndsAt = new Date(bufferStartsAt.getTime() + bufMin * 60 * 1000);
        items.push({
          type: "travel_buffer",
          startsAt: bufferStartsAt.toISOString(),
          endsAt: bufferEndsAt.toISOString(),
          fromLocationName: locationNameById.get(current.locationId) ?? current.locationId,
          toLocationName: locationNameById.get(next.locationId) ?? next.locationId,
          bufferMinutes: bufMin,
        });
      }
    }

    items.sort((itemA, itemB) => {
      const getStart = (item: ScheduleItem) =>
        item.type === "lesson" ? item.lesson.startsAt : item.startsAt;
      return getStart(itemA).localeCompare(getStart(itemB));
    });

    const body: ScheduleDay = { date, items };
    res.json(body);
  }),
);

// ── GET /coach/stats ──────────────────────────────────────────────────────────

coachLessonsRouter.get(
  "/stats",
  validate({}),
  asyncHandler(async (req, res) => {
    const now = new Date();

    const todayLA = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
    }).format(now);

    const todayDate = new Date(todayLA + "T12:00:00Z");
    const dayOfWeek = todayDate.getUTCDay();
    const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const mondayLA = new Date(todayDate.getTime() - daysFromMonday * 24 * 60 * 60 * 1000);
    const mondayStr = mondayLA.toISOString().slice(0, 10);
    const sundayDate = new Date(mondayLA.getTime() + 6 * 24 * 60 * 60 * 1000);
    const sundayStr = sundayDate.toISOString().slice(0, 10);

    const [lessonsTodayRows, lessonsWeekRows, pendingRows, activeSwimmerRows, syncFailRows] =
      await Promise.all([
        db
          .select({ id: lessons.id })
          .from(lessons)
          .where(
            and(
              inArray(lessons.status, ["pending", "approved"]),
              sql`date_trunc('day', ${lessons.startsAt} AT TIME ZONE 'America/Los_Angeles') = ${todayLA}::date`,
            ),
          ),
        db
          .select({ id: lessons.id })
          .from(lessons)
          .where(
            and(
              inArray(lessons.status, ["pending", "approved"]),
              sql`(${lessons.startsAt} AT TIME ZONE 'America/Los_Angeles')::date >= ${mondayStr}::date`,
              sql`(${lessons.startsAt} AT TIME ZONE 'America/Los_Angeles')::date <= ${sundayStr}::date`,
            ),
          ),
        db
          .select({ id: lessons.id })
          .from(lessons)
          .where(eq(lessons.status, "pending")),
        db
          .select({ id: swimmers.id })
          .from(swimmers)
          .where(sql`${swimmers.archivedAt} IS NULL`),
        db
          .select({ id: lessons.id })
          .from(lessons)
          .where(eq(lessons.calendarSyncStatus, "sync_failed")),
      ]);

    const body: CoachStats = {
      lessonsToday: lessonsTodayRows.length,
      lessonsThisWeek: lessonsWeekRows.length,
      pendingRequests: pendingRows.length,
      activeSwimmers: activeSwimmerRows.length,
      calendarSyncFailures: syncFailRows.length,
    };

    res.json(body);
  }),
);
