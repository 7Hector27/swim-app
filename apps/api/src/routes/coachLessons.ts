import { Router } from "express";
import { and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import type {
  CoachBookingWarnings,
  CoachCreateLessonBody,
  CoachCreateLessonWarningsResponse,
  CoachHouseholdSearchQuery,
  CoachHouseholdSearchResponse,
  CoachHouseholdSearchResult,
  CoachHouseholdSearchSwimmer,
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
  COACH_HOUSEHOLD_SEARCH_MIN_LENGTH,
  CoachCreateLessonBodySchema,
  CoachHouseholdSearchQuerySchema,
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
  householdAuditLog,
  householdMembers,
  households,
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
import { mapConfigRow, mapSeasonRow, mapOverrideRow } from "../lib/availabilityMappers";
import { effectiveHours } from "../lib/effectiveHours";
import { notifyBookingCreated, notifyLessonApproved, notifyLessonDeclined } from "../lib/lessonApproval";
import { syncLessonToGoogle } from "../services/googleCalendarSync";
import { enqueueLessonEmail } from "../services/emails/outbox";
import { sendLessonEmailOutboxRow } from "../services/emails/sender";
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
    // in case the cron hasn't run recently. The outbox write for each
    // expired lesson lives in the same transaction so neither the status
    // change nor the parent email can be lost mid-flight (ADR 028).
    const now = new Date();
    const { expired: expiredRows, outboxIds: expiredOutboxIds } = await db.transaction(
      async (tx) => {
        const rows = await tx
          .update(lessons)
          .set({ status: "expired" })
          .where(and(eq(lessons.status, "pending"), lt(lessons.expiresAt, now)))
          .returning({ id: lessons.id });
        const ids: string[] = [];
        for (const row of rows) {
          ids.push(
            await enqueueLessonEmail(tx, {
              lessonId: row.id,
              event: "request_expired",
              actorRole: "system",
            }),
          );
        }
        return { expired: rows, outboxIds: ids };
      },
    );
    // Reconcile Google Calendar for each expired lesson. Pending lessons
    // normally have no event in Google so the service short-circuits; the
    // hook catches the edge case where a lesson got synced then rolled
    // back to pending and now expires.
    for (const row of expiredRows) {
      queueMicrotask(() => { void syncLessonToGoogle(row.id); });
    }
    for (const outboxId of expiredOutboxIds) {
      queueMicrotask(() => { void sendLessonEmailOutboxRow(outboxId); });
    }

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
    if (query.calendarSyncStatus !== undefined) {
      filters.push(eq(lessons.calendarSyncStatus, query.calendarSyncStatus));
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

    const approveResult = await db.transaction(async (tx) => {
      const rows = await tx
        .update(lessons)
        .set({ status: "approved", approvedAt: now, approvedBy: req.profile.id })
        .where(and(eq(lessons.id, id), eq(lessons.status, "pending")))
        .returning();
      const row = rows[0];
      if (!row) return null;

      // Parent booking email outbox (ADR 028): CONFIRMED with METHOD:REQUEST
      // .ics. Snapshot-then-increments lessons.calendar_sequence. The parent
      // created the lesson originally; the coach is only approving it here,
      // so initiatedBy stays 'parent'.
      const outboxId = await enqueueLessonEmail(tx, {
        lessonId: row.id,
        event: "lesson_confirmed",
        actorRole: "coach",
        initiatedBy: "parent",
      });

      return { row, outboxId };
    });

    const updated = approveResult?.row;
    const approveOutboxId = approveResult?.outboxId;
    if (!updated) {
      const existing = await db.select({ status: lessons.status }).from(lessons).where(eq(lessons.id, id)).limit(1);
      if (!existing[0]) {
        res.status(404).json({ error: "Lesson not found" });
        return;
      }
      res.status(422).json({ error: "Lesson is not pending" });
      return;
    }

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
    // Reconcile Google Calendar in the background after the response. The
    // service catches its own errors; any rejection here is swallowed by
    // the microtask queue and never affects the booking.
    queueMicrotask(() => { void syncLessonToGoogle(updated.id); });
    if (approveOutboxId) {
      queueMicrotask(() => { void sendLessonEmailOutboxRow(approveOutboxId); });
    }
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

    const declineResult = await db.transaction(async (tx) => {
      const rows = await tx
        .update(lessons)
        .set({
          status: "declined",
          declinedAt: now,
          declinedBy: req.profile.id,
          ...(body.reason !== undefined && { declineReason: body.reason }),
        })
        .where(and(eq(lessons.id, id), eq(lessons.status, "pending")))
        .returning();
      const row = rows[0];
      if (!row) return null;

      // Parent booking email outbox (ADR 028). Today the state machine only
      // allows decline from pending, so this never emits a CANCEL .ics; the
      // enqueue helper handles the approved→declined future case defensively.
      const outboxId = await enqueueLessonEmail(tx, {
        lessonId: row.id,
        event: "request_declined",
        actorRole: "coach",
        declineReason: body.reason ?? null,
      });

      return { row, outboxId };
    });

    const updated = declineResult?.row;
    const declineOutboxId = declineResult?.outboxId;
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
    // Reconcile Google Calendar in the background. For a decline the lesson
    // is pending and has no event id, so this is a safe no-op in practice;
    // the hook stays here so the state machine can grow approved→declined
    // later without a code change.
    queueMicrotask(() => { void syncLessonToGoogle(updated.id); });
    if (declineOutboxId) {
      queueMicrotask(() => { void sendLessonEmailOutboxRow(declineOutboxId); });
    }
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

// ── POST /coach/lessons ───────────────────────────────────────────────────────
// Coach-booked lessons (ADR 029). Approved immediately, no pending step.
// `approved_by` is the coach's profile id (non-null — distinct from system
// auto-approval where approved_by=null per ADR 021). Writes a household
// audit row + an outbox row + the lesson in one transaction under the same
// advisory day lock as parent booking.

coachLessonsRouter.post(
  "/lessons",
  validate({ body: CoachCreateLessonBodySchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as CoachCreateLessonBody;
    const coachProfileId = req.profile.id;
    const startsAt = new Date(body.startsAt);
    const nowUtc = new Date();

    // ── Hard reject: start in the past ────────────────────────────────────────
    // Not acknowledgeable. Lessons that would already be underway or over
    // cannot be booked, regardless of overrideWindow.
    if (startsAt.getTime() <= nowUtc.getTime()) {
      res.status(422).json({ error: "start_in_past" });
      return;
    }

    // ── Household exists ──────────────────────────────────────────────────────
    const householdRows = await db
      .select({ id: households.id })
      .from(households)
      .where(eq(households.id, body.householdId))
      .limit(1);
    if (!householdRows[0]) {
      res.status(404).json({ error: "Household not found" });
      return;
    }

    // ── Swimmers belong to the household and are active ───────────────────────
    const swimmerRows = await db
      .select({ id: swimmers.id, householdId: swimmers.householdId, archivedAt: swimmers.archivedAt })
      .from(swimmers)
      .where(inArray(swimmers.id, body.swimmerIds));

    if (swimmerRows.length !== body.swimmerIds.length) {
      res.status(422).json({ error: "swimmers_not_in_household" });
      return;
    }
    const allInHousehold = swimmerRows.every(
      (row) => row.householdId === body.householdId && row.archivedAt === null,
    );
    if (!allInHousehold) {
      res.status(422).json({ error: "swimmers_not_in_household" });
      return;
    }

    // ── Location exists and is accessible ─────────────────────────────────────
    const locationRows = await db
      .select({ id: lessonLocations.id, householdId: lessonLocations.householdId })
      .from(lessonLocations)
      .where(and(eq(lessonLocations.id, body.locationId), eq(lessonLocations.isActive, true)))
      .limit(1);
    const location = locationRows[0];
    if (!location) {
      res.status(422).json({ error: "Location not found or inactive" });
      return;
    }
    if (location.householdId !== null && location.householdId !== body.householdId) {
      res.status(422).json({ error: "not_this_households_home_pool" });
      return;
    }

    // ── Derive LA calendar date (for the lock key and the hours check) ───────
    const laDateParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(startsAt);
    const getPart = (type: string) => laDateParts.find((p) => p.type === type)?.value ?? "";
    const laDateStr = `${getPart("year")}-${getPart("month")}-${getPart("day")}`;

    // ── Fetch availability data for warning computation ───────────────────────
    const [configRows, seasonRows, overrideRows, blockedRows, bufferRows, existingLessonRows] =
      await Promise.all([
        db.select().from(availabilityConfig).limit(1),
        db.select().from(availabilitySeasons),
        db.select().from(availabilityOverrides),
        db.select().from(blockedTimes),
        db.select().from(travelBufferOverrides),
        db
          .select({
            startsAt: lessons.startsAt,
            durationMinutes: lessons.durationMinutes,
            locationId: lessons.locationId,
          })
          .from(lessons)
          .where(inArray(lessons.status, ["pending", "approved"])),
      ]);
    const config = configRows[0];
    if (!config) {
      res.status(503).json({ error: "Availability config not found" });
      return;
    }
    const seasons = seasonRows.map(mapSeasonRow);
    const overrides = overrideRows.map(mapOverrideRow);

    // ── Server-computed override warnings ─────────────────────────────────────
    // The server is the sole authority on what fired. The client's
    // `acknowledgedWarnings` is a question ("I'm OK with these"), never
    // an answer ("there aren't any").
    const warnings = computeCoachBookingWarnings({
      startsAt,
      durationMinutes: body.durationMinutes,
      locationId: body.locationId,
      laDateStr,
      nowUtc,
      config,
      seasons,
      overrides,
      blocked: blockedRows,
      buffers: bufferRows,
      existingLessons: existingLessonRows,
    });

    const anyWarning = (Object.values(warnings) as boolean[]).some((flag) => flag);

    if (anyWarning) {
      if (!body.overrideWindow) {
        const resp: CoachCreateLessonWarningsResponse = {
          error: "warnings_not_acknowledged",
          warnings,
        };
        res.status(409).json(resp);
        return;
      }
      // overrideWindow=true: every TRUE warning must be acknowledged.
      const unacknowledged = (Object.keys(warnings) as (keyof CoachBookingWarnings)[]).some(
        (key) => warnings[key] && !body.acknowledgedWarnings[key],
      );
      if (unacknowledged) {
        const resp: CoachCreateLessonWarningsResponse = {
          error: "warnings_not_acknowledged",
          warnings,
        };
        res.status(409).json(resp);
        return;
      }
    }

    // ── Transact: advisory lock → overlap check → insert ──────────────────────
    const result = await db.transaction(async (tx) => {
      // Same lock key as POST /lessons so parent + coach writes serialize.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${"lesson-day:" + laDateStr}))`,
      );

      // Re-fetch existing lessons inside the lock. Hard reject on any time
      // overlap at any location — Jason cannot be in two places at once.
      // This is independent of the slot engine's travel-buffer/daily-cap
      // behavior (those are warnings, not hard rejects).
      const freshExisting = await tx
        .select({
          startsAt: lessons.startsAt,
          durationMinutes: lessons.durationMinutes,
          locationId: lessons.locationId,
        })
        .from(lessons)
        .where(inArray(lessons.status, ["pending", "approved"]));

      const newStartMs = startsAt.getTime();
      const newEndMs = newStartMs + body.durationMinutes * 60_000;
      const overlaps = freshExisting.some((row) => {
        const existingStartMs = row.startsAt.getTime();
        const existingEndMs = existingStartMs + row.durationMinutes * 60_000;
        return newStartMs < existingEndMs && existingStartMs < newEndMs;
      });
      if (overlaps) return null;

      const type: "private" | "family" = body.swimmerIds.length === 1 ? "private" : "family";
      const now = new Date();

      const insertedRows = await tx
        .insert(lessons)
        .values({
          householdId: body.householdId,
          locationId: body.locationId,
          startsAt,
          durationMinutes: body.durationMinutes,
          type,
          status: "approved",
          requestedBy: coachProfileId,
          approvedAt: now,
          approvedBy: coachProfileId,
          expiresAt: null,
        })
        .returning();
      const inserted = insertedRows[0]!;

      await tx.insert(lessonSwimmers).values(
        body.swimmerIds.map((swimmerId) => ({ lessonId: inserted.id, swimmerId })),
      );

      // Audit row — SAME transaction as the lesson insert (CLAUDE.md rule).
      // `override` holds the SERVER-computed warnings for this submission,
      // or null when no warning fired. Never the client's acknowledgement set.
      await tx.insert(householdAuditLog).values({
        householdId: body.householdId,
        actorId: coachProfileId,
        action: "lesson_booked_by_coach",
        payload: {
          lessonId: inserted.id,
          locationId: body.locationId,
          startsAt: startsAt.toISOString(),
          durationMinutes: body.durationMinutes,
          swimmerIds: body.swimmerIds,
          override: anyWarning ? warnings : null,
        },
      });

      // Outbox row — same transaction. initiatedBy='coach' tells the
      // LessonConfirmed template to render coach-scheduled copy.
      const outboxId = await enqueueLessonEmail(tx, {
        lessonId: inserted.id,
        event: "lesson_confirmed",
        actorRole: "coach",
        initiatedBy: "coach",
      });

      return { lesson: inserted, outboxId };
    });

    if (!result) {
      res.status(422).json({ error: "slot_unavailable" });
      return;
    }
    const { lesson: committed, outboxId } = result;

    notifyBookingCreated(committed.id, true);

    // Response: fetch swimmers for the response body.
    const swimmerResponseRows = await db
      .select({ swimmerId: lessonSwimmers.swimmerId, firstName: swimmers.firstName, lastName: swimmers.lastName })
      .from(lessonSwimmers)
      .innerJoin(swimmers, eq(lessonSwimmers.swimmerId, swimmers.id))
      .where(eq(lessonSwimmers.lessonId, committed.id));

    const responseBody: LessonResponse = {
      id: committed.id,
      householdId: committed.householdId,
      locationId: committed.locationId,
      startsAt: committed.startsAt.toISOString(),
      durationMinutes: committed.durationMinutes as 30 | 45 | 60,
      type: committed.type,
      status: committed.status,
      swimmers: swimmerResponseRows.map((row) => ({
        swimmerId: row.swimmerId,
        firstName: row.firstName,
        lastName: row.lastName,
      } as LessonSwimmer)),
      expiresAt: null,
      approvedAt: committed.approvedAt?.toISOString() ?? null,
      declinedAt: null,
      declineReason: null,
      movedAt: null,
      previousStartsAt: null,
      createdAt: committed.createdAt.toISOString(),
    };

    res.status(201).json(responseBody);
    // Fire-and-forget: Google Calendar sync (ADR 027) + outbox sender (ADR 028).
    queueMicrotask(() => { void syncLessonToGoogle(committed.id); });
    queueMicrotask(() => { void sendLessonEmailOutboxRow(outboxId); });
  }),
);

// ── GET /coach/households ─────────────────────────────────────────────────────
// Search households by swimmer name, member name, or household name.
// Case-insensitive contains across four columns via a UNION on household ids.
// Short queries (< 2 chars) return []; this is UX, not an error.

coachLessonsRouter.get(
  "/households",
  validate({ query: CoachHouseholdSearchQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as CoachHouseholdSearchQuery;
    const limit = query.limit ?? 20;

    // Resolve the set of matching household ids. Two paths:
    // - householdId filter → direct lookup, used by /coach/book's pre-fill
    //   from /coach/swimmers/[id]. Bypasses the min-query-length rule.
    // - q filter → contains search across swimmer/member/household name.
    let topIds: string[];
    if (query.householdId !== undefined) {
      topIds = [query.householdId];
    } else {
      const q = (query.q ?? "").trim();
      if (q.length < COACH_HOUSEHOLD_SEARCH_MIN_LENGTH) {
        res.json([] as CoachHouseholdSearchResponse);
        return;
      }
      const pattern = `%${q}%`;

      // Four small ILIKE queries beat one giant UNION ALL for readability at
      // Jason's roster size; the DB plans each as an indexed table scan.
      const [swimmerHits, memberHits, householdHits] = await Promise.all([
        db
          .select({ householdId: swimmers.householdId })
          .from(swimmers)
          .where(
            or(
              sql`${swimmers.firstName} ILIKE ${pattern}`,
              sql`${swimmers.lastName} ILIKE ${pattern}`,
            ),
          ),
        db
          .select({ householdId: householdMembers.householdId })
          .from(householdMembers)
          .innerJoin(profiles, eq(profiles.id, householdMembers.profileId))
          .where(sql`${profiles.fullName} ILIKE ${pattern}`),
        db
          .select({ householdId: households.id })
          .from(households)
          .where(sql`${households.name} ILIKE ${pattern}`),
      ]);

      const matchingIds = Array.from(
        new Set<string>([
          ...swimmerHits.map((row) => row.householdId),
          ...memberHits.map((row) => row.householdId),
          ...householdHits.map((row) => row.householdId),
        ]),
      );
      if (matchingIds.length === 0) {
        res.json([] as CoachHouseholdSearchResponse);
        return;
      }
      topIds = matchingIds.slice(0, limit);
    }

    // Fetch each matched household's name, member full names, swimmers, and
    // its active home-pool location id (if any) in parallel.
    const [householdRows, memberRows, swimmerDetailRows, homePoolRows] = await Promise.all([
      db
        .select({ id: households.id, name: households.name })
        .from(households)
        .where(inArray(households.id, topIds))
        .orderBy(asc(households.name)),
      db
        .select({ householdId: householdMembers.householdId, fullName: profiles.fullName })
        .from(householdMembers)
        .innerJoin(profiles, eq(profiles.id, householdMembers.profileId))
        .where(inArray(householdMembers.householdId, topIds)),
      db
        .select({
          id: swimmers.id,
          householdId: swimmers.householdId,
          firstName: swimmers.firstName,
          lastName: swimmers.lastName,
          archivedAt: swimmers.archivedAt,
        })
        .from(swimmers)
        .where(inArray(swimmers.householdId, topIds))
        .orderBy(asc(swimmers.firstName)),
      db
        .select({ id: lessonLocations.id, householdId: lessonLocations.householdId })
        .from(lessonLocations)
        .where(
          and(
            inArray(lessonLocations.householdId, topIds),
            eq(lessonLocations.isActive, true),
          ),
        ),
    ]);

    const membersByHousehold = new Map<string, string[]>();
    for (const row of memberRows) {
      const list = membersByHousehold.get(row.householdId) ?? [];
      if (row.fullName) list.push(row.fullName);
      membersByHousehold.set(row.householdId, list);
    }

    const swimmersByHousehold = new Map<string, CoachHouseholdSearchSwimmer[]>();
    for (const row of swimmerDetailRows) {
      const list = swimmersByHousehold.get(row.householdId) ?? [];
      list.push({
        id: row.id,
        firstName: row.firstName,
        lastName: row.lastName,
        archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
      });
      swimmersByHousehold.set(row.householdId, list);
    }

    const homePoolByHousehold = new Map<string, string>();
    for (const row of homePoolRows) {
      if (row.householdId) homePoolByHousehold.set(row.householdId, row.id);
    }

    const results: CoachHouseholdSearchResult[] = householdRows.map((row) => ({
      householdId: row.id,
      householdName: row.name,
      memberFullNames: membersByHousehold.get(row.id) ?? [],
      swimmers: swimmersByHousehold.get(row.id) ?? [],
      homePoolLocationId: homePoolByHousehold.get(row.id) ?? null,
    }));

    res.json(results satisfies CoachHouseholdSearchResponse);
  }),
);

// ── Coach booking warning computation ─────────────────────────────────────────

interface ComputeWarningsInput {
  startsAt: Date;
  durationMinutes: 30 | 45 | 60;
  locationId: string;
  laDateStr: string;
  nowUtc: Date;
  config: typeof availabilityConfig.$inferSelect;
  seasons: ReturnType<typeof mapSeasonRow>[];
  overrides: ReturnType<typeof mapOverrideRow>[];
  blocked: (typeof blockedTimes.$inferSelect)[];
  buffers: (typeof travelBufferOverrides.$inferSelect)[];
  existingLessons: Array<{ startsAt: Date; durationMinutes: number; locationId: string }>;
}

// Computes every warning the ADR describes. Does NOT compute hard overlap —
// that's enforced inside the transaction under the advisory lock, since the
// data can change between warning computation and insert.
function computeCoachBookingWarnings(input: ComputeWarningsInput): CoachBookingWarnings {
  const {
    startsAt,
    durationMinutes,
    locationId,
    laDateStr,
    nowUtc,
    config,
    seasons,
    overrides,
    blocked,
    buffers,
    existingLessons,
  } = input;

  const startMs = startsAt.getTime();
  const endMs = startMs + durationMinutes * 60_000;
  const nowMs = nowUtc.getTime();

  // outsideHours: no teaching window on this LA day, OR the slot's LA
  // wall-clock range doesn't fit entirely inside one of the day's windows.
  const hoursWindows = effectiveHours(laDateStr, seasons, overrides, {
    defaultTeachesDays: config.defaultTeachesDays,
    defaultStartTime: config.defaultStartTime,
    defaultEndTime: config.defaultEndTime,
  });
  let outsideHours = false;
  if (hoursWindows.length === 0) {
    outsideHours = true;
  } else {
    const laTimeParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(startsAt);
    const hour = laTimeParts.find((p) => p.type === "hour")?.value ?? "00";
    const minute = laTimeParts.find((p) => p.type === "minute")?.value ?? "00";
    const startMinutes = parseInt(hour, 10) * 60 + parseInt(minute, 10);
    const endMinutes = startMinutes + durationMinutes;
    outsideHours = !hoursWindows.some((win) => {
      const [startH, startM] = win.start.split(":").map((n) => parseInt(n, 10));
      const [endH, endM] = win.end.split(":").map((n) => parseInt(n, 10));
      const winStart = (startH ?? 0) * 60 + (startM ?? 0);
      const winEnd = (endH ?? 0) * 60 + (endM ?? 0);
      return startMinutes >= winStart && endMinutes <= winEnd;
    });
  }

  // The 16-hour notice window is parent-only; coaches have no min-advance
  // rule (start_in_past is a hard reject earlier in the handler).

  // maxAdvanceExceeded: start is further out than bookingMaxAdvanceWeeks.
  const maxAdvanceMs = nowMs + config.bookingMaxAdvanceWeeks * 7 * 24 * 60 * 60 * 1000;
  const maxAdvanceExceeded = startMs > maxAdvanceMs;

  // travelBufferViolated: another lesson at a different pool is within its
  // configured travel-buffer-minutes window of this slot's start or end.
  const DEFAULT_BUFFER_MINUTES = 30;
  const bufferMinutes = (from: string, to: string): number => {
    if (from === to) return 0;
    const override = buffers.find((row) => row.fromLocationId === from && row.toLocationId === to);
    return override?.bufferMinutes ?? DEFAULT_BUFFER_MINUTES;
  };
  const travelBufferViolated = existingLessons.some((row) => {
    if (row.locationId === locationId) return false;
    const existingStart = row.startsAt.getTime();
    const existingEnd = existingStart + row.durationMinutes * 60_000;
    const bufAfterMs = bufferMinutes(row.locationId, locationId) * 60_000;
    const bufBeforeMs = bufferMinutes(locationId, row.locationId) * 60_000;
    // Buffer-after-existing collides with the new slot start.
    if (startMs < existingEnd + bufAfterMs && startMs >= existingEnd) return true;
    // Buffer-before-existing collides with the new slot end.
    if (endMs > existingStart - bufBeforeMs && endMs <= existingStart) return true;
    return false;
  });

  // dailyCapExceeded: existing lessons' minutes on this LA day + this one
  // exceed maxDailyLessonMinutes.
  const laDayMinutes = existingLessons
    .filter((row) => {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles",
        year: "numeric", month: "2-digit", day: "2-digit",
      }).formatToParts(row.startsAt);
      const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
      return `${get("year")}-${get("month")}-${get("day")}` === laDateStr;
    })
    .reduce((sum, row) => sum + row.durationMinutes, 0);
  const dailyCapExceeded = laDayMinutes + durationMinutes > config.maxDailyLessonMinutes;

  // blockedTimeOverlap: slot time range overlaps any blocked_times row.
  const blockedTimeOverlap = blocked.some((row) => {
    const bStart = row.startsAt.getTime();
    const bEnd = row.endsAt.getTime();
    return startMs < bEnd && bStart < endMs;
  });

  return {
    outsideHours,
    maxAdvanceExceeded,
    travelBufferViolated,
    dailyCapExceeded,
    blockedTimeOverlap,
  };
}
