import { Router } from "express";
import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type {
  CoachLessonDetail,
  CoachLessonSwimmer,
  CoachListLessonsQuery,
  CoachNoteResponse,
  CoachScheduleItem,
  CoachScheduleLessonItem,
  CoachScheduleQuery,
  CoachWeekScheduleQuery,
  CoachWeekScheduleResponse,
  DeclineLessonBody,
  LessonResponse,
  LessonSwimmer,
} from "@swim-app/shared";
import {
  CoachListLessonsQuerySchema,
  CoachScheduleQuerySchema,
  CoachWeekScheduleQuerySchema,
  DeclineLessonBodySchema,
} from "@swim-app/shared";
import { db } from "../db/client";
import {
  availabilityConfig,
  availabilityOverrides,
  availabilitySeasons,
  blockedTimes,
  clubs,
  coachNotes,
  householdMembers,
  lessonLocations,
  lessonSwimmers,
  lessons,
  profiles,
  swimmers,
  swimmerClubs,
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
        movedAt: lessons.movedAt,
        previousStartsAt: lessons.previousStartsAt,
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

    // 2. Load swimmers for those lessons (with club names, left-join deduplicated).
    const rawSwimmerRows =
      lessonIds.length > 0
        ? await db
            .select({
              lessonId: lessonSwimmers.lessonId,
              swimmerId: lessonSwimmers.swimmerId,
              firstName: swimmers.firstName,
              lastName: swimmers.lastName,
              clubName: clubs.name,
              otherClubName: swimmerClubs.otherClubName,
            })
            .from(lessonSwimmers)
            .innerJoin(swimmers, eq(lessonSwimmers.swimmerId, swimmers.id))
            .leftJoin(swimmerClubs, eq(swimmers.id, swimmerClubs.swimmerId))
            .leftJoin(clubs, eq(swimmerClubs.clubId, clubs.id))
            .where(inArray(lessonSwimmers.lessonId, lessonIds))
        : [];

    // Deduplicate: one row per lessonId+swimmerId (take first club found).
    const swimmersByLesson = new Map<string, CoachLessonSwimmer[]>();
    const seenSwimmerKeys = new Set<string>();
    for (const row of rawSwimmerRows) {
      const key = `${row.lessonId}:${row.swimmerId}`;
      if (!seenSwimmerKeys.has(key)) {
        seenSwimmerKeys.add(key);
        const list = swimmersByLesson.get(row.lessonId) ?? [];
        list.push({
          swimmerId: row.swimmerId,
          firstName: row.firstName,
          lastName: row.lastName,
          clubName: row.clubName ?? row.otherClubName ?? null,
        });
        swimmersByLesson.set(row.lessonId, list);
      }
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
    const items: CoachScheduleItem[] = [];

    // Add lesson items.
    for (const row of lessonRows) {
      const coachLessonResponse = {
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
        movedAt: row.movedAt?.toISOString() ?? null,
        previousStartsAt: row.previousStartsAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      };
      items.push({ type: "lesson", lesson: coachLessonResponse, locationName: row.locationName, householdId: row.householdId });
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
        endDate: row.endDate,
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
      const getStart = (item: CoachScheduleItem) =>
        new Date(item.type === "lesson" ? item.lesson.startsAt : item.startsAt).getTime();
      return getStart(itemA) - getStart(itemB);
    });

    res.json(items);
  }),
);

// ── GET /coach/schedule/week ──────────────────────────────────────────────────

coachLessonsRouter.get(
  "/schedule/week",
  validate({ query: CoachWeekScheduleQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as CoachWeekScheduleQuery;
    const startDate = query.startDate;

    // Parse the startDate into year/month/day integers for UTC arithmetic.
    const [yearStr, monthStr, dayStr] = startDate.split("-");
    const year = parseInt(yearStr!, 10);
    const month = parseInt(monthStr!, 10);
    const day = parseInt(dayStr!, 10);

    // Build 7 date strings (startDate + 0..6 days) using UTC arithmetic.
    const dateStrings: string[] = Array.from({ length: 7 }, (_, index) =>
      new Date(Date.UTC(year, month - 1, day + index)).toISOString().slice(0, 10),
    );

    const endDate = dateStrings[6]!;

    // 1. Load all lessons for the 7-day window in one query.
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
        movedAt: lessons.movedAt,
        previousStartsAt: lessons.previousStartsAt,
        createdAt: lessons.createdAt,
      })
      .from(lessons)
      .innerJoin(lessonLocations, eq(lessons.locationId, lessonLocations.id))
      .where(
        and(
          inArray(lessons.status, ["pending", "approved"]),
          sql`date_trunc('day', ${lessons.startsAt} AT TIME ZONE 'America/Los_Angeles') >= ${startDate}::date`,
          sql`date_trunc('day', ${lessons.startsAt} AT TIME ZONE 'America/Los_Angeles') < ${endDate}::date + interval '1 day'`,
        ),
      )
      .orderBy(asc(lessons.startsAt));

    const lessonIds = lessonRows.map((row) => row.id);

    // 2. Load swimmers for those lessons (with club names, deduplicated).
    const rawSwimmerRows =
      lessonIds.length > 0
        ? await db
            .select({
              lessonId: lessonSwimmers.lessonId,
              swimmerId: lessonSwimmers.swimmerId,
              firstName: swimmers.firstName,
              lastName: swimmers.lastName,
              clubName: clubs.name,
              otherClubName: swimmerClubs.otherClubName,
            })
            .from(lessonSwimmers)
            .innerJoin(swimmers, eq(lessonSwimmers.swimmerId, swimmers.id))
            .leftJoin(swimmerClubs, eq(swimmers.id, swimmerClubs.swimmerId))
            .leftJoin(clubs, eq(swimmerClubs.clubId, clubs.id))
            .where(inArray(lessonSwimmers.lessonId, lessonIds))
        : [];

    // Deduplicate: one row per lessonId+swimmerId (take first club found).
    const swimmersByLesson = new Map<string, CoachLessonSwimmer[]>();
    const seenSwimmerKeys = new Set<string>();
    for (const row of rawSwimmerRows) {
      const key = `${row.lessonId}:${row.swimmerId}`;
      if (!seenSwimmerKeys.has(key)) {
        seenSwimmerKeys.add(key);
        const list = swimmersByLesson.get(row.lessonId) ?? [];
        list.push({
          swimmerId: row.swimmerId,
          firstName: row.firstName,
          lastName: row.lastName,
          clubName: row.clubName ?? row.otherClubName ?? null,
        });
        swimmersByLesson.set(row.lessonId, list);
      }
    }

    // 3. Group lessons by LA calendar date.
    const itemsByDate = new Map<string, CoachScheduleLessonItem[]>();
    for (const dateStr of dateStrings) {
      itemsByDate.set(dateStr, []);
    }

    for (const row of lessonRows) {
      // Determine the LA calendar date for this lesson.
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(row.startsAt);

      const partMap: Record<string, string> = {};
      for (const part of parts) {
        partMap[part.type] = part.value;
      }
      const laDate = `${partMap["year"]!}-${partMap["month"]!}-${partMap["day"]!}`;

      const dayItems = itemsByDate.get(laDate);
      if (dayItems !== undefined) {
        dayItems.push({
          type: "lesson",
          lesson: {
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
            movedAt: row.movedAt?.toISOString() ?? null,
            previousStartsAt: row.previousStartsAt?.toISOString() ?? null,
            createdAt: row.createdAt.toISOString(),
          },
          locationName: row.locationName,
          householdId: row.householdId,
        });
      }
    }

    // 4. Build response with all 7 days.
    const body: CoachWeekScheduleResponse = {
      days: dateStrings.map((dateStr) => ({
        date: dateStr,
        items: itemsByDate.get(dateStr) ?? [],
      })),
    };

    res.json(body);
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
      movedAt: row.movedAt?.toISOString() ?? null,
      previousStartsAt: row.previousStartsAt?.toISOString() ?? null,
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
      movedAt: updated.movedAt?.toISOString() ?? null,
      previousStartsAt: updated.previousStartsAt?.toISOString() ?? null,
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
      movedAt: updated.movedAt?.toISOString() ?? null,
      previousStartsAt: updated.previousStartsAt?.toISOString() ?? null,
      createdAt: updated.createdAt.toISOString(),
    };

    res.json(responseBody);
  }),
);

// ── GET /coach/lessons/:id ────────────────────────────────────────────────────

coachLessonsRouter.get(
  "/lessons/:id",
  validate({ params: LessonIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };

    const lessonRows = await db
      .select({
        id: lessons.id,
        householdId: lessons.householdId,
        locationId: lessons.locationId,
        locationName: lessonLocations.name,
        locationAddress: lessonLocations.address,
        locationCity: lessonLocations.city,
        locationState: lessonLocations.state,
        locationZip: lessonLocations.zip,
        isHomePool: sql<boolean>`${lessonLocations.householdId} IS NOT NULL`,
        startsAt: lessons.startsAt,
        durationMinutes: lessons.durationMinutes,
        type: lessons.type,
        status: lessons.status,
        expiresAt: lessons.expiresAt,
        approvedAt: lessons.approvedAt,
        declinedAt: lessons.declinedAt,
        declineReason: lessons.declineReason,
        movedAt: lessons.movedAt,
        previousStartsAt: lessons.previousStartsAt,
        createdAt: lessons.createdAt,
      })
      .from(lessons)
      .innerJoin(lessonLocations, eq(lessons.locationId, lessonLocations.id))
      .where(eq(lessons.id, id))
      .limit(1);

    const lessonRow = lessonRows[0];
    if (!lessonRow) {
      res.status(404).json({ error: "Lesson not found" });
      return;
    }

    // Load swimmers with club names (deduplicated).
    const rawSwimmerRows = await db
      .select({
        swimmerId: lessonSwimmers.swimmerId,
        firstName: swimmers.firstName,
        lastName: swimmers.lastName,
        clubName: clubs.name,
        otherClubName: swimmerClubs.otherClubName,
      })
      .from(lessonSwimmers)
      .innerJoin(swimmers, eq(lessonSwimmers.swimmerId, swimmers.id))
      .leftJoin(swimmerClubs, eq(swimmers.id, swimmerClubs.swimmerId))
      .leftJoin(clubs, eq(swimmerClubs.clubId, clubs.id))
      .where(eq(lessonSwimmers.lessonId, id));

    const swimmerMap = new Map<string, CoachLessonSwimmer>();
    for (const row of rawSwimmerRows) {
      if (!swimmerMap.has(row.swimmerId)) {
        swimmerMap.set(row.swimmerId, {
          swimmerId: row.swimmerId,
          firstName: row.firstName,
          lastName: row.lastName,
          clubName: row.clubName ?? row.otherClubName ?? null,
        });
      }
    }

    // Load household name: prefer the owner, then oldest member.
    const memberRows = await db
      .select({ fullName: profiles.fullName })
      .from(householdMembers)
      .innerJoin(profiles, eq(householdMembers.profileId, profiles.id))
      .where(eq(householdMembers.householdId, lessonRow.householdId))
      .orderBy(
        sql`CASE ${householdMembers.role} WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END`,
        asc(householdMembers.joinedAt),
      )
      .limit(1);

    const householdName = memberRows[0]?.fullName ?? null;

    const body: CoachLessonDetail = {
      id: lessonRow.id,
      householdId: lessonRow.householdId,
      householdName,
      locationId: lessonRow.locationId,
      locationName: lessonRow.locationName,
      locationAddress: lessonRow.locationAddress,
      locationCity: lessonRow.locationCity,
      locationState: lessonRow.locationState,
      locationZip: lessonRow.locationZip,
      isHomePool: lessonRow.isHomePool,
      startsAt: lessonRow.startsAt.toISOString(),
      durationMinutes: lessonRow.durationMinutes as 30 | 45 | 60,
      type: lessonRow.type,
      status: lessonRow.status,
      swimmers: [...swimmerMap.values()],
      expiresAt: lessonRow.expiresAt?.toISOString() ?? null,
      approvedAt: lessonRow.approvedAt?.toISOString() ?? null,
      declinedAt: lessonRow.declinedAt?.toISOString() ?? null,
      declineReason: lessonRow.declineReason ?? null,
      movedAt: lessonRow.movedAt?.toISOString() ?? null,
      previousStartsAt: lessonRow.previousStartsAt?.toISOString() ?? null,
      createdAt: lessonRow.createdAt.toISOString(),
    };

    res.json(body);
  }),
);

// ── GET /coach/lessons/:id/notes ──────────────────────────────────────────────

coachLessonsRouter.get(
  "/lessons/:id/notes",
  validate({ params: LessonIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };

    const lessonRows = await db
      .select({ id: lessons.id })
      .from(lessons)
      .where(eq(lessons.id, id))
      .limit(1);

    if (!lessonRows[0]) {
      res.status(404).json({ error: "Lesson not found" });
      return;
    }

    const noteRows = await db
      .select({
        id: coachNotes.id,
        swimmerId: coachNotes.swimmerId,
        sessionId: coachNotes.sessionId,
        lessonId: coachNotes.lessonId,
        body: coachNotes.body,
        createdBy: coachNotes.createdBy,
        createdAt: coachNotes.createdAt,
        updatedAt: coachNotes.updatedAt,
      })
      .from(coachNotes)
      .where(eq(coachNotes.lessonId, id))
      .orderBy(desc(coachNotes.createdAt));

    const notes: CoachNoteResponse[] = noteRows.map((note) => ({
      id: note.id,
      swimmerId: note.swimmerId,
      sessionId: note.sessionId,
      lessonId: note.lessonId,
      body: note.body,
      createdBy: note.createdBy,
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
    }));

    res.json(notes);
  }),
);
