import { Router } from "express";
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import type {
  CoachListLessonsQuery,
  CoachScheduleQuery,
  DeclineLessonBody,
  LessonResponse,
  LessonSwimmer,
  ScheduleItem,
} from "@swim-app/shared";
import {
  CoachListLessonsQuerySchema,
  CoachScheduleQuerySchema,
  DeclineLessonBodySchema,
} from "@swim-app/shared";
import { db } from "../db/client";
import {
  availabilityConfig,
  availabilityOverrides,
  availabilitySeasons,
  blockedTimes,
  lessonLocations,
  lessonSwimmers,
  lessons,
  swimmers,
  travelBufferOverrides,
} from "../db/schema";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/asyncHandler";
import { mapConfigRow } from "../lib/availabilityMappers";
import { notifyLessonApproved, notifyLessonDeclined, syncCalendarApproved } from "../lib/lessonApproval";
import { computeAvailableSlots, mergeSlotWindows } from "../lib/slots";
import { z } from "zod";

export const coachLessonsRouter = Router();

// ── GET /coach/schedule ───────────────────────────────────────────────────────

coachLessonsRouter.get(
  "/schedule",
  validate({ query: CoachScheduleQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as CoachScheduleQuery;
    const date = query.date;

    // 1. Load lessons for this LA day with their location names.
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

    // 2. Load swimmers for those lessons.
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

    // 3. Load config + buffers + blocked times + existing lessons + seasons + overrides for slot computation.
    const [configRows, bufferRows, blockedRows, existingLessonRows, seasonRows, overrideRows] =
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
          .where(
            and(
              inArray(lessons.status, ["pending", "approved"]),
              sql`date_trunc('day', ${lessons.startsAt} AT TIME ZONE 'America/Los_Angeles') = ${date}::date`,
            ),
          ),
        db.select().from(availabilitySeasons),
        db.select().from(availabilityOverrides),
      ]);

    // 4. Build schedule items.
    const items: ScheduleItem[] = [];

    // Add lesson items.
    for (const row of lessonRows) {
      const lessonResponse: LessonResponse = {
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
      };
      items.push({ type: "lesson", lesson: lessonResponse, locationName: row.locationName });
    }

    // Insert travel buffer items between consecutive lessons at different locations.
    for (let index = 0; index < lessonRows.length - 1; index++) {
      const current = lessonRows[index]!;
      const next = lessonRows[index + 1]!;

      if (current.locationId === next.locationId) continue;

      const currentEnd = new Date(current.startsAt.getTime() + current.durationMinutes * 60_000);
      const nextStart = next.startsAt;

      // Find buffer override or use default 30 min.
      const bufferOverride = bufferRows.find(
        (row) => row.fromLocationId === current.locationId && row.toLocationId === next.locationId,
      );
      const bufferMinutes = bufferOverride !== undefined ? bufferOverride.bufferMinutes : 30;
      const bufferEnd = new Date(currentEnd.getTime() + bufferMinutes * 60_000);

      // Only insert if the buffer window doesn't exceed the next lesson's start.
      if (bufferEnd.getTime() <= nextStart.getTime()) {
        items.push({
          type: "travel_buffer",
          startsAt: currentEnd.toISOString(),
          endsAt: bufferEnd.toISOString(),
          fromLocationName: current.locationName,
          toLocationName: next.locationName,
        });
      }
    }

    // 5. Compute open slots across all named pools.
    const config = configRows[0];
    if (config) {
      const namedPoolRows = await db
        .select({ id: lessonLocations.id })
        .from(lessonLocations)
        .where(
          and(
            sql`${lessonLocations.householdId} IS NULL`,
            eq(lessonLocations.isActive, true),
          ),
        );

      const seasons = seasonRows.map((row) => ({
        id: row.id,
        name: row.name,
        startDate: row.startDate,
        teachesDays: row.teachesDays,
        weekdayStartTime: row.weekdayStartTime,
        weekdayEndTime: row.weekdayEndTime,
        weekendStartTime: row.weekendStartTime,
        weekendEndTime: row.weekendEndTime,
        startsAtDst: row.startsAtDst,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }));
      const overrides = overrideRows.map((row) => ({
        id: row.id,
        kind: row.kind,
        startDate: row.startDate,
        endDate: row.endDate,
        startTime: row.startTime,
        endTime: row.endTime,
        note: row.note,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }));

      const allSlots: Array<{ startsAt: Date; endsAt: Date }> = [];
      for (const pool of namedPoolRows) {
        const poolSlots = computeAvailableSlots({
          date,
          durationMinutes: 30,
          locationId: pool.id,
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
          config: mapConfigRow(config),
          seasons,
          overrides,
          gcalBusyTimes: [],
          nowUtc: new Date(),
        });
        allSlots.push(...poolSlots);
      }

      const merged = mergeSlotWindows(allSlots);
      for (const window of merged) {
        items.push({
          type: "open_slot",
          startsAt: window.startsAt.toISOString(),
          endsAt: window.endsAt.toISOString(),
        });
      }
    }

    // 6. Sort all items by start time numerically.
    items.sort((itemA, itemB) => {
      const getStart = (item: ScheduleItem) =>
        new Date(item.type === "lesson" ? item.lesson.startsAt : item.startsAt).getTime();
      return getStart(itemA) - getStart(itemB);
    });

    res.json(items);
  }),
);

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
