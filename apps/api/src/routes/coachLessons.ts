import { Router } from "express";
import { and, asc, desc, eq, inArray, lt, max, or, sql } from "drizzle-orm";
import type {
  CoachBatchApproveResponse,
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
  MarkNoShowBodySchema,
  UndoNoShowBodySchema,
} from "@swim-app/shared";
import { db } from "../db/client";
import {
  requireLiveHouseholdId,
  requireLiveLessonFields,
  requireLiveLocationId,
} from "../db/liveLesson";
import {
  availabilityConfig,
  availabilityOverrides,
  availabilitySeasons,
  blockedTimes,
  bookingBatches,
  clubs,
  coachNotes,
  householdAuditLog,
  householdMembers,
  households,
  lessonEmailOutbox,
  lessonLocations,
  lessonSwimmers,
  lessons,
  profiles,
  swimmers,
  swimmerClubs,
  travelBufferOverrides,
} from "../db/schema";
import type { BatchEmailLesson, BatchEmailPayload } from "../services/emails/batchTypes";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/asyncHandler";
import { mapConfigRow, mapSeasonRow, mapOverrideRow } from "../lib/availabilityMappers";
import { computeCoachBookingWarnings } from "../lib/coachBookingWarnings";
import { nowUtc as getNowUtc } from "../lib/clock";
import {
  notifyBookingCreated,
  notifyLessonApproved,
  notifyLessonDeclined,
  queueCoachNotificationSend,
} from "../lib/lessonApproval";
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

    // 1. Load lessons for this LA day with their location names. All lesson
    // statuses are returned so past days show their real end state
    // (completed, canceled, no_show, declined, expired) with each row
    // tappable through to /coach/lessons/[id]. The planning subset used for
    // travel buffers and open slots stays limited to pending/approved below.
    // INNER JOIN on lessonLocations means every returned row has a live
    // locationId at runtime, and we never show anonymized rows on the
    // coach schedule — narrow per ADR 034.
    const lessonRows = (await db
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
        sql`date_trunc('day', ${lessons.startsAt} AT TIME ZONE 'America/Los_Angeles') = ${date}::date`,
      )
      .orderBy(asc(lessons.startsAt))).map(requireLiveLessonFields);

    // Planning subset: pending + approved only. Travel buffers between
    // these rows render on the schedule; terminal-status lessons never
    // generate buffers (they're history, not planning).
    const planningLessonRows = lessonRows.filter(
      (row) => row.status === "pending" || row.status === "approved",
    );

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
          )
          // Live pending/approved lessons always have locationId populated —
          // narrow per ADR 034.
          .then((rows) => rows.map(requireLiveLocationId)),
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

    // Insert travel buffer items between consecutive pending/approved
    // lessons at different locations. Terminal-status lessons (canceled,
    // declined, expired, no_show, completed) are excluded here so the
    // schedule never renders buffers around history rows.
    for (let index = 0; index < planningLessonRows.length - 1; index++) {
      const current = planningLessonRows[index]!;
      const next = planningLessonRows[index + 1]!;

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
          blockedTimes: blockedRows.map((row) => ({ startsAt: row.startsAt, endsAt: row.endsAt, locationId: row.locationId })),
          travelBufferOverrides: bufferRows.map((row) => ({
            fromLocationId: row.fromLocationId,
            toLocationId: row.toLocationId,
            bufferMinutes: row.bufferMinutes,
          })),
          config: mapConfigRow(config),
          seasons,
          overrides,
          gcalBusyTimes: [],
          nowUtc: getNowUtc(),
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

    // 1. Load all lessons for the 7-day window in one query. All statuses
    // are returned so past weeks show lessons in their real end state
    // (completed, canceled, no_show, declined, expired) with each card
    // tappable through to /coach/lessons/[id].
    // INNER JOIN on lessonLocations guarantees locationId non-null at
    // runtime; narrow per ADR 034.
    const lessonRows = (await db
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
          sql`date_trunc('day', ${lessons.startsAt} AT TIME ZONE 'America/Los_Angeles') >= ${startDate}::date`,
          sql`date_trunc('day', ${lessons.startsAt} AT TIME ZONE 'America/Los_Angeles') < ${endDate}::date + interval '1 day'`,
        ),
      )
      .orderBy(asc(lessons.startsAt))).map(requireLiveLessonFields);

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

    // Coach-facing lesson list excludes anonymized rows at the query level;
    // narrow per ADR 034.
    const lessonRows = (await db
      .select({
        id: lessons.id,
        householdId: lessons.householdId,
        locationId: lessons.locationId,
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
        batchId: lessons.batchId,
        batchMode: bookingBatches.mode,
      })
      .from(lessons)
      .leftJoin(bookingBatches, eq(lessons.batchId, bookingBatches.id))
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(asc(lessons.startsAt))).map(requireLiveLessonFields);

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
      batchId: row.batchId,
      batchMode:
        row.batchMode === "manual" || row.batchMode === "weekly" ? row.batchMode : null,
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
      const rawRow = rows[0];
      if (!rawRow) return null;
      // ADR 034: this UPDATE targets a live pending lesson; narrow the
      // schema-level null widening on identity columns.
      const row = requireLiveLessonFields(rawRow);

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

// ── PATCH /coach/lessons/batch/:batchId/approve-pending ──────────────────────
// Flip every pending lesson in a batch to approved in one transaction, snapshot
// then bump each lesson's calendar_sequence, write one audit row and one
// batch_approved outbox row covering only the newly approved lessons. 409
// no_pending_lessons when nothing is pending. See ADR 030.

const BatchIdParamsSchema = z.object({ batchId: z.string().uuid() });

coachLessonsRouter.patch(
  "/lessons/batch/:batchId/approve-pending",
  validate({ params: BatchIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { batchId } = req.params as { batchId: string };
    const coachProfileId = req.profile.id;

    // Resolve the batch row + its household (used to fetch recipients,
    // location, and swimmer names for the outbox payload).
    const batchRows = await db
      .select()
      .from(bookingBatches)
      .where(eq(bookingBatches.id, batchId))
      .limit(1);
    const batch = batchRows[0];
    if (!batch) {
      res.status(404).json({ error: "Batch not found" });
      return;
    }

    const result = await db.transaction(async (tx) => {
      // Lock every pending lesson in the batch so a concurrent per-lesson
      // approve/decline cannot flip rows underneath us.
      const pendingBefore = (await tx
        .select()
        .from(lessons)
        .where(and(eq(lessons.batchId, batchId), eq(lessons.status, "pending")))
        .for("update"))
        // SELECT ... FOR UPDATE on live pending lessons; narrow per ADR 034.
        .map(requireLiveLessonFields);

      if (pendingBefore.length === 0) return { kind: "none" as const };

      const now = getNowUtc();
      const pendingIds = pendingBefore.map((row) => row.id);

      // Snapshot pre-bump calendar_sequence per lesson.
      const sequenceByLesson = new Map<string, number>();
      for (const lesson of pendingBefore) {
        sequenceByLesson.set(lesson.id, lesson.calendarSequence);
      }

      await tx
        .update(lessons)
        .set({
          status: "approved",
          approvedAt: now,
          approvedBy: coachProfileId,
          expiresAt: null,
          calendarSequence: sql`${lessons.calendarSequence} + 1` as unknown as number,
          calendarInviteSentAt: now,
        })
        .where(inArray(lessons.id, pendingIds));

      // Approved rows after the bump — same column set the per-lesson route
      // returns. We don't re-SELECT because we have everything we need.
      const approvedLessons = pendingBefore.map((lesson) => ({
        ...lesson,
        status: "approved" as const,
        approvedAt: now,
        approvedBy: coachProfileId,
        expiresAt: null,
        calendarSequence: lesson.calendarSequence + 1,
        calendarInviteSentAt: now,
      }));

      // Load the batch's household context for the outbox payload.
      const recipientRows = await tx
        .select({ profileId: householdMembers.profileId })
        .from(householdMembers)
        .where(
          and(
            eq(householdMembers.householdId, batch.householdId),
            inArray(householdMembers.role, ["owner", "manager"]),
          ),
        );
      const recipientProfileIds = recipientRows.map((row) => row.profileId);

      // Per-lesson swimmer first names (ADR 030 phase 2 — a batch can mix
      // swimmer sets across lessons). The batch-wide `swimmerFirstNames`
      // below is the sorted union across every approved lesson for the
      // email intro + ICS summary.
      const approvedLessonIds = approvedLessons.map((lesson) => lesson.id);
      const perLessonSwimmerRows = await tx
        .select({
          lessonId: lessonSwimmers.lessonId,
          firstName: swimmers.firstName,
        })
        .from(lessonSwimmers)
        .innerJoin(swimmers, eq(lessonSwimmers.swimmerId, swimmers.id))
        .where(inArray(lessonSwimmers.lessonId, approvedLessonIds))
        .orderBy(swimmers.firstName);
      const firstNamesByLessonId = new Map<string, string[]>();
      for (const row of perLessonSwimmerRows) {
        const list = firstNamesByLessonId.get(row.lessonId) ?? [];
        list.push(row.firstName);
        firstNamesByLessonId.set(row.lessonId, list);
      }
      const swimmerFirstNames = Array.from(
        new Set(perLessonSwimmerRows.map((row) => row.firstName)),
      ).sort((a, b) => a.localeCompare(b));

      const locationId = approvedLessons[0]!.locationId;
      const locationRows = await tx
        .select({
          id: lessonLocations.id,
          name: lessonLocations.name,
          address: lessonLocations.address,
          city: lessonLocations.city,
          state: lessonLocations.state,
          zip: lessonLocations.zip,
          householdId: lessonLocations.householdId,
        })
        .from(lessonLocations)
        .where(eq(lessonLocations.id, locationId))
        .limit(1);
      const location = locationRows[0]!;

      const payloadLessons: BatchEmailLesson[] = approvedLessons.map((lesson) => ({
        lessonId: lesson.id,
        startsAtUtc: lesson.startsAt.toISOString(),
        durationMinutes: lesson.durationMinutes as 30 | 45 | 60,
        status: "approved" as const,
        swimmerFirstNames: firstNamesByLessonId.get(lesson.id) ?? [],
        // The sender's filter compares current calendar_sequence against
        // snapshot + 1 (ADR 028 and 030). We bumped by one above, so the
        // pre-bump value is what the payload holds.
        calendarSequence: sequenceByLesson.get(lesson.id)!,
      }));

      const payload: BatchEmailPayload = {
        batchId,
        mode: batch.mode as "manual" | "weekly",
        ...(batch.mode === "weekly" && batch.weeklyPattern && batch.weeklyStartDate && batch.weeklyWeeks !== null
          ? {
              weekly: {
                pattern: batch.weeklyPattern,
                startDate: batch.weeklyStartDate,
                weeks: batch.weeklyWeeks,
              },
            }
          : {}),
        location: {
          id: location.id,
          name: location.name,
          address: location.address,
          city: location.city,
          state: location.state,
          zip: location.zip,
          isHomePool: location.householdId !== null,
        },
        swimmerFirstNames,
        lessons: payloadLessons,
      };

      // Next (batch_id, event='batch_approved') sequence. Starts at 0.
      const seqRows = await tx
        .select({ max: max(lessonEmailOutbox.sequence) })
        .from(lessonEmailOutbox)
        .where(
          and(
            eq(lessonEmailOutbox.batchId, batchId),
            eq(lessonEmailOutbox.event, "batch_approved"),
          ),
        );
      const nextSeq = (seqRows[0]?.max ?? -1) + 1;

      const outboxInsert = await tx
        .insert(lessonEmailOutbox)
        .values({
          batchId,
          lessonId: null,
          event: "batch_approved",
          sequence: nextSeq,
          recipientProfileIds,
          icsMethod: null,
          icsSequence: null,
          payload,
        })
        .returning({ id: lessonEmailOutbox.id });
      const outboxId = outboxInsert[0]!.id;

      await tx.insert(householdAuditLog).values({
        householdId: batch.householdId,
        actorId: coachProfileId,
        action: "lesson_batch_approved",
        payload: {
          batchId,
          approvedLessonIds: approvedLessons.map((lesson) => lesson.id),
        },
      });

      return {
        kind: "approved" as const,
        approvedIds: approvedLessons.map((lesson) => lesson.id),
        outboxId,
      };
    });

    if (result.kind === "none") {
      res.status(409).json({ error: "no_pending_lessons" });
      return;
    }

    for (const lessonId of result.approvedIds) {
      notifyLessonApproved(lessonId);
      queueMicrotask(() => { void syncLessonToGoogle(lessonId); });
    }
    queueMicrotask(() => { void sendLessonEmailOutboxRow(result.outboxId); });

    const body: CoachBatchApproveResponse = {
      batchId,
      approvedLessonIds: result.approvedIds,
      approvedCount: result.approvedIds.length,
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
      const rawRow = rows[0];
      if (!rawRow) return null;
      // ADR 034: this UPDATE targets a live pending lesson; narrow the
      // schema-level null widening on identity columns.
      const row = requireLiveLessonFields(rawRow);

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

// ── PATCH /coach/lessons/:id/no-show ─────────────────────────────────────────
//
// Coach-only mark. Allowed on approved or completed lessons whose start time
// has already passed. The cron auto-complete at /internal/cron/tick only
// targets rows where status='approved', so once a lesson is no_show it is
// never auto-promoted back to completed. Keeps the lesson's Google Calendar
// event (ADR 027: no_show now mirrors completed on the shouldExist side).
// No parent email: parents see the status change in-app ("Missed").

coachLessonsRouter.patch(
  "/lessons/:id/no-show",
  validate({ params: LessonIdParamsSchema, body: MarkNoShowBodySchema }),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const now = new Date();
    const coachProfileId = req.profile.id;

    const outcome = await db.transaction(async (tx) => {
      const [lessonRow] = await tx
        .select()
        .from(lessons)
        .where(eq(lessons.id, id))
        .for("update")
        .limit(1);
      if (!lessonRow) return { kind: "not_found" as const };

      if (lessonRow.status === "no_show") {
        return { kind: "already" as const };
      }
      if (lessonRow.status !== "approved" && lessonRow.status !== "completed") {
        return { kind: "wrong_status" as const };
      }
      if (lessonRow.startsAt.getTime() >= now.getTime()) {
        return { kind: "not_started" as const };
      }

      const [rawUpdated] = await tx
        .update(lessons)
        .set({
          status: "no_show",
          noShowAt: now,
          noShowBy: coachProfileId,
        })
        .where(eq(lessons.id, id))
        .returning();
      if (!rawUpdated) throw new Error("no-show update returned no row");
      // ADR 034: this UPDATE targets a live lesson; narrow identity columns.
      const updated = requireLiveLessonFields(rawUpdated);

      await tx.insert(householdAuditLog).values({
        householdId: updated.householdId,
        actorId: coachProfileId,
        action: "lesson_marked_no_show",
        payload: {
          lessonId: updated.id,
          previousStatus: lessonRow.status,
        },
      });

      return { kind: "ok" as const, lesson: updated };
    });

    if (outcome.kind === "not_found") {
      res.status(404).json({ error: "Lesson not found" });
      return;
    }
    if (outcome.kind === "already") {
      res.status(409).json({ error: "already_no_show" });
      return;
    }
    if (outcome.kind === "wrong_status") {
      res.status(422).json({ error: "lesson_not_markable" });
      return;
    }
    if (outcome.kind === "not_started") {
      res.status(422).json({ error: "lesson_not_started" });
      return;
    }

    const swimmerRows = await db
      .select({ swimmerId: lessonSwimmers.swimmerId, firstName: swimmers.firstName, lastName: swimmers.lastName })
      .from(lessonSwimmers)
      .innerJoin(swimmers, eq(lessonSwimmers.swimmerId, swimmers.id))
      .where(eq(lessonSwimmers.lessonId, outcome.lesson.id));

    const updated = outcome.lesson;
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
    queueMicrotask(() => { void syncLessonToGoogle(updated.id); });
  }),
);

// ── PATCH /coach/lessons/:id/no-show/undo ────────────────────────────────────
//
// Reverts a no_show mark. Target status is `completed` when the lesson's end
// time has passed (the cron would have promoted it to completed if the
// lesson had stayed approved past end time), otherwise `approved` (lets the
// cron re-promote on its next tick, matching the normal approved→completed
// pathway). Clears no_show_at and no_show_by; preserves completedAt if the
// cron had already set it before the mark.

coachLessonsRouter.patch(
  "/lessons/:id/no-show/undo",
  validate({ params: LessonIdParamsSchema, body: UndoNoShowBodySchema }),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const now = new Date();
    const coachProfileId = req.profile.id;

    const outcome = await db.transaction(async (tx) => {
      const [lessonRow] = await tx
        .select()
        .from(lessons)
        .where(eq(lessons.id, id))
        .for("update")
        .limit(1);
      if (!lessonRow) return { kind: "not_found" as const };
      if (lessonRow.status !== "no_show") {
        return { kind: "not_no_show" as const };
      }

      const endMs = lessonRow.startsAt.getTime() + lessonRow.durationMinutes * 60_000;
      const nextStatus: "completed" | "approved" =
        endMs < now.getTime() ? "completed" : "approved";
      const nextCompletedAt =
        nextStatus === "completed" ? (lessonRow.completedAt ?? now) : null;

      const [rawUpdated] = await tx
        .update(lessons)
        .set({
          status: nextStatus,
          noShowAt: null,
          noShowBy: null,
          completedAt: nextCompletedAt,
        })
        .where(eq(lessons.id, id))
        .returning();
      if (!rawUpdated) throw new Error("no-show undo returned no row");
      // ADR 034: this UPDATE targets a live lesson; narrow identity columns.
      const updated = requireLiveLessonFields(rawUpdated);

      await tx.insert(householdAuditLog).values({
        householdId: updated.householdId,
        actorId: coachProfileId,
        action: "lesson_no_show_undone",
        payload: {
          lessonId: updated.id,
          newStatus: nextStatus,
        },
      });

      return { kind: "ok" as const, lesson: updated };
    });

    if (outcome.kind === "not_found") {
      res.status(404).json({ error: "Lesson not found" });
      return;
    }
    if (outcome.kind === "not_no_show") {
      res.status(422).json({ error: "lesson_not_no_show" });
      return;
    }

    const swimmerRows = await db
      .select({ swimmerId: lessonSwimmers.swimmerId, firstName: swimmers.firstName, lastName: swimmers.lastName })
      .from(lessonSwimmers)
      .innerJoin(swimmers, eq(lessonSwimmers.swimmerId, swimmers.id))
      .where(eq(lessonSwimmers.lessonId, outcome.lesson.id));

    const updated = outcome.lesson;
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
    queueMicrotask(() => { void syncLessonToGoogle(updated.id); });
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

    const rawLessonRow = lessonRows[0];
    if (!rawLessonRow) {
      res.status(404).json({ error: "Lesson not found" });
      return;
    }
    // ADR 034: coach lesson detail never renders anonymized rows; narrow.
    const lessonRow = requireLiveLessonFields(rawLessonRow);

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
    const nowUtc = getNowUtc();

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

    // A missing swimmer id (short count) is intentionally reported as
    // "swimmers_not_in_household", the SAME code used for the belongs-to-
    // a-different-household case below. Returning a distinct "not found"
    // code would let a caller probe which swimmer UUIDs exist in the
    // system vs. which belong to someone else's household. The row-level
    // existence of a swimmer id is itself household-private data.
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
          .where(inArray(lessons.status, ["pending", "approved"]))
          // Live pending/approved lessons always have locationId populated —
          // narrow per ADR 034.
          .then((rows) => rows.map(requireLiveLocationId)),
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
      // ADR 034: INSERT of a live lesson; narrow identity columns.
      const inserted = requireLiveLessonFields(insertedRows[0]!);

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

      // Coach alert row (ADR 031). Auto-approved category because the
      // coach booked it themselves. Inside the tx so a rollback also
      // rolls back the notification. The current single-coach stub
      // writes to self; a multi-coach future would route to the booking
      // coach via the lesson's coach_id column.
      const coachNotificationId = await notifyBookingCreated(tx, inserted.id, true);

      return { lesson: inserted, outboxId, coachNotificationId };
    });

    if (!result) {
      res.status(422).json({ error: "slot_unavailable" });
      return;
    }
    const { lesson: committed, outboxId, coachNotificationId } = result;

    queueCoachNotificationSend(coachNotificationId);

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
        isArchived: row.archivedAt !== null,
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

