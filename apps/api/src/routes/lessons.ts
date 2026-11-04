import { type RequestHandler, Router } from "express";
import { and, asc, count, desc, eq, gt, inArray, max, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type {
  AvailableSlot,
  AvailableSlotsQuery,
  BatchCancelRemainingResponse,
  BatchConflictPick,
  BatchPickState,
  BatchPreviewBody,
  BatchPreviewPick,
  BatchPreviewResponse,
  BatchSubmitBody,
  BatchSubmitSuccessResponse,
  CreateLessonBody,
  DayAvailability,
  DayState,
  HouseholdRole,
  LessonResponse,
  LessonSwimmer,
  MonthAvailabilityResponse,
  RangeAvailabilityQuery,
  UpdateLessonBody,
  UpcomingLesson,
  UpcomingLessonsQuery,
  UpcomingLessonsResponse,
  WeekAvailabilityResponse,
  WeekDayAvailability,
} from "@swim-app/shared";
import {
  AvailableSlotsQuerySchema,
  BatchPreviewBodySchema,
  BatchSubmitBodySchema,
  StoredWeeklyPatternSchema,
  type StoredWeeklyPattern,
  BATCH_LESSON_MAX,
  BATCH_LESSON_MIN,
  CreateLessonBodySchema,
  HOUSEHOLD_ROLE_RANK,
  RangeAvailabilityQuerySchema,
  UpdateLessonBodySchema,
  UpcomingLessonsQuerySchema,
  bookingWindowEnd,
  isAfterBookingWindow,
} from "@swim-app/shared";
import { db } from "../db/client";
import {
  availabilityConfig,
  availabilityOverrides,
  availabilitySeasons,
  blockedTimes,
  bookingBatches,
  householdAuditLog,
  householdMembers,
  lessonEmailOutbox,
  lessonLocations,
  lessonSwimmers,
  lessons,
  swimmers,
  travelBufferOverrides,
} from "../db/schema";
import { requireUser } from "../middleware/requireUser";
import { requireParent } from "../middleware/requireParent";
import { requireHouseholdMember } from "../middleware/requireHouseholdMember";
import { requireHouseholdRole } from "../middleware/requireHouseholdRole";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/asyncHandler";
import { bookingLimiter, previewLimiter } from "../middleware/bookingRateLimit";
import { classifyDaySlots, computeAvailableSlots, diagnoseSlotRejection, getDateInLA, getISODayOfWeek } from "../lib/slots";
import {
  applyWeeklyOverridesAndSkips,
  expandWeeklyCandidates,
  slotRejectionToPickState,
  type Candidate,
} from "../lib/batchCandidates";
import { effectiveHours } from "../lib/effectiveHours";
import { nowUtc as getNowUtc } from "../lib/clock";
import { mapConfigRow, mapSeasonRow, mapOverrideRow } from "../lib/availabilityMappers";
import {
  needsApproval,
  notifyBatchBookingCreated,
  notifyBookingCreated,
  notifyCoachOfBatchChange,
  notifyCoachOfChange,
  queueCoachNotificationSend,
} from "../lib/lessonApproval";
import { syncLessonToGoogle } from "../services/googleCalendarSync";
import { enqueueLessonEmail } from "../services/emails/outbox";
import { sendLessonEmailOutboxRow } from "../services/emails/sender";
import type { BatchEmailLesson, BatchEmailPayload } from "../services/emails/batchTypes";
import { isActiveSwimmer } from "../db/queries";

export const lessonsRouter = Router();

// Allows parent and coach; rejects any other role (e.g. teen) before the handler runs.
const requireParentOrCoach: RequestHandler = (req, res, next) => {
  const role = req.profile.role;
  if (role !== "parent" && role !== "coach") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
};

lessonsRouter.use(requireUser);

// ── GET /lessons ──────────────────────────────────────────────────────────────

lessonsRouter.get(
  "/",
  requireParent,
  requireHouseholdMember,
  validate({ query: UpcomingLessonsQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as UpcomingLessonsQuery;
    const { householdId } = req;
    const now = new Date();
    const filter = query.filter ?? "upcoming";
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;

    const selectShape = {
      id: lessons.id,
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
      batchId: lessons.batchId,
      batchMode: bookingBatches.mode,
    };

    const filterCondition = filter === "past"
      ? and(
          eq(lessons.householdId, householdId),
          sql`${lessons.startsAt} + ${lessons.durationMinutes} * interval '1 minute' <= ${now.toISOString()}::timestamptz`,
        )
      : and(
          eq(lessons.householdId, householdId),
          inArray(lessons.status, ["pending", "approved"]),
          sql`${lessons.startsAt} + ${lessons.durationMinutes} * interval '1 minute' > ${now.toISOString()}::timestamptz`,
        );

    const [lessonRows, countRows] = await Promise.all([
      filter === "past"
        ? db
            .select(selectShape)
            .from(lessons)
            .innerJoin(lessonLocations, eq(lessons.locationId, lessonLocations.id))
            .leftJoin(bookingBatches, eq(lessons.batchId, bookingBatches.id))
            .where(filterCondition)
            .orderBy(desc(lessons.startsAt))
            .limit(limit)
            .offset(offset)
        : db
            .select(selectShape)
            .from(lessons)
            .innerJoin(lessonLocations, eq(lessons.locationId, lessonLocations.id))
            .leftJoin(bookingBatches, eq(lessons.batchId, bookingBatches.id))
            .where(filterCondition)
            .orderBy(asc(lessons.startsAt))
            .limit(limit)
            .offset(offset),
      // Count query omits the lessonLocations + bookingBatches joins because
      // filterCondition only references columns on `lessons`. If the filter
      // ever starts referencing joined columns, add the matching joins here.
      db.select({ count: count() }).from(lessons).where(filterCondition),
    ]);

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

    const items: UpcomingLesson[] = lessonRows.map((row) => ({
      id: row.id,
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
      movedAt: row.movedAt?.toISOString() ?? null,
      previousStartsAt: row.previousStartsAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      batchId: row.batchId,
      batchMode:
        row.batchMode === "manual" || row.batchMode === "weekly" ? row.batchMode : null,
    }));

    const body: UpcomingLessonsResponse = {
      items,
      total: Number(countRows[0]?.count ?? 0),
    };

    res.json(body);
  }),
);

// ── GET /lessons/available-slots ──────────────────────────────────────────────

lessonsRouter.get(
  "/available-slots",
  validate({ query: AvailableSlotsQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as AvailableSlotsQuery;

    // Verify the location exists. If it is a home pool (householdId non-null),
    // coaches may query any; parents may only query their own household's pool.
    const locationCheckRows = await db
      .select({ id: lessonLocations.id, householdId: lessonLocations.householdId })
      .from(lessonLocations)
      .where(and(eq(lessonLocations.id, query.locationId), eq(lessonLocations.isActive, true)))
      .limit(1);

    const checkedLocation = locationCheckRows[0];
    if (!checkedLocation) {
      res.status(404).json({ error: "Location not found" });
      return;
    }

    if (checkedLocation.householdId !== null && req.profile.role !== "coach") {
      const memberRows = await db
        .select({ householdId: householdMembers.householdId })
        .from(householdMembers)
        .where(eq(householdMembers.profileId, req.profile.id))
        .limit(1);
      if (memberRows[0]?.householdId !== checkedLocation.householdId) {
        res.status(404).json({ error: "Location not found" });
        return;
      }
    }

    const [configRows, blockedRows, bufferRows, existingLessonRows, seasonRows, overrideRows] =
      await Promise.all([
        db.select().from(availabilityConfig).limit(1),
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
        db.select().from(availabilitySeasons),
        db.select().from(availabilityOverrides),
      ]);

    const config = configRows[0];
    if (!config) {
      res.status(503).json({ error: "Availability config not found" });
      return;
    }

    // The min-advance notice window is parent-only. Coaches may skip it by
    // passing coachBypassNotice=true; parents passing the flag are ignored.
    const skipMinAdvance =
      req.profile.role === "coach" && query.coachBypassNotice === "true";

    const slots = computeAvailableSlots({
      date: query.date,
      durationMinutes: query.durationMinutes,
      locationId: query.locationId,
      existingLessons: existingLessonRows.map((row) => ({
        startsAt: row.startsAt,
        durationMinutes: row.durationMinutes,
        locationId: row.locationId,
      })),
      blockedTimes: blockedRows.map((row) => ({
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        locationId: row.locationId,
      })),
      travelBufferOverrides: bufferRows.map((row) => ({
        fromLocationId: row.fromLocationId,
        toLocationId: row.toLocationId,
        bufferMinutes: row.bufferMinutes,
      })),
      config: mapConfigRow(config),
      seasons: seasonRows.map(mapSeasonRow),
      overrides: overrideRows.map(mapOverrideRow),
      gcalBusyTimes: [],
      nowUtc: getNowUtc(),
      skipMinAdvance,
    });

    const body: AvailableSlot[] = slots.map((slot) => ({
      startsAt: slot.startsAt.toISOString(),
    }));

    res.json(body);
  }),
);

// ── GET /lessons/available-range ──────────────────────────────────────────────

lessonsRouter.get(
  "/available-range",
  requireParentOrCoach,
  validate({ query: RangeAvailabilityQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as RangeAvailabilityQuery;
    const isCoach = req.profile.role === "coach";

    const locationCheckRows = await db
      .select({ id: lessonLocations.id, householdId: lessonLocations.householdId })
      .from(lessonLocations)
      .where(and(eq(lessonLocations.id, query.locationId), eq(lessonLocations.isActive, true)))
      .limit(1);

    const checkedLocation = locationCheckRows[0];
    if (!checkedLocation) {
      res.status(404).json({ error: "Location not found" });
      return;
    }

    let callerHouseholdId: string | null = null;
    if (!isCoach) {
      const memberRows = await db
        .select({ householdId: householdMembers.householdId })
        .from(householdMembers)
        .where(eq(householdMembers.profileId, req.profile.id))
        .limit(1);
      callerHouseholdId = memberRows[0]?.householdId ?? null;

      if (checkedLocation.householdId !== null && callerHouseholdId !== checkedLocation.householdId) {
        res.status(404).json({ error: "Location not found" });
        return;
      }
    }

    const days = getRangeDays(query.view, query.date);

    const [configRows, blockedRows, bufferRows, existingLessonRows, seasonRows, overrideRows] =
      await Promise.all([
        db.select().from(availabilityConfig).limit(1),
        db.select().from(blockedTimes),
        db.select().from(travelBufferOverrides),
        db
          .select({
            id: lessons.id,
            householdId: lessons.householdId,
            startsAt: lessons.startsAt,
            durationMinutes: lessons.durationMinutes,
            locationId: lessons.locationId,
          })
          .from(lessons)
          .where(inArray(lessons.status, ["pending", "approved"])),
        db.select().from(availabilitySeasons),
        db.select().from(availabilityOverrides),
      ]);

    const config = configRows[0];
    if (!config) {
      res.status(503).json({ error: "Availability config not found" });
      return;
    }

    const seasons = seasonRows.map(mapSeasonRow);
    const overrides = overrideRows.map(mapOverrideRow);

    let filteredLessons = existingLessonRows;
    if (query.excludeLessonId !== undefined) {
      const excluded = existingLessonRows.find((lesson) => lesson.id === query.excludeLessonId);
      if (excluded !== undefined) {
        const callerOwns = isCoach || excluded.householdId === callerHouseholdId;
        if (callerOwns) {
          filteredLessons = existingLessonRows.filter((lesson) => lesson.id !== query.excludeLessonId);
        }
      }
    }

    let approvalRequired: boolean;
    if (isCoach) {
      approvalRequired = false;
    } else if (callerHouseholdId !== null) {
      approvalRequired = await needsApproval(callerHouseholdId, query.locationId, db);
    } else {
      approvalRequired = true;
    }

    const nowUtc = getNowUtc();
    const todayDateLA = getDateInLA(nowUtc);
    const maxAdvanceDateLA = bookingWindowEnd(nowUtc, config.bookingMaxAdvanceWeeks);

    // Coach-only: skip the min-advance notice-window filter. A parent passing
    // the flag is ignored and still sees the normal rule applied.
    const skipMinAdvance = isCoach && query.coachBypassNotice === "true";

    const sharedClassifyParams = {
      locationId: query.locationId,
      durationMinutes: query.durationMinutes,
      existingLessons: filteredLessons.map((row) => ({
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
      nowUtc,
      skipMinAdvance,
    };

    if (query.view === "week") {
      const responseDays: WeekDayAvailability[] = days.map((date: string) => {
        const windows = effectiveHours(date, seasons, overrides, config);
        const dayState = computeDayState(date, windows.length > 0, todayDateLA, maxAdvanceDateLA);
        if (dayState !== "open") {
          return { date, dayState, openCount: 0, totalCount: 0, teachingWindows: [], slots: [] };
        }
        const slots = classifyDaySlots({ ...sharedClassifyParams, date });
        return {
          date,
          dayState: "open" as const,
          openCount: slots.filter((slot) => slot.state === "available").length,
          totalCount: slots.length,
          teachingWindows: windows,
          slots,
        };
      });
      const body: WeekAvailabilityResponse = {
        needsApproval: approvalRequired,
        days: responseDays,
        maxDailyLessonMinutes: config.maxDailyLessonMinutes,
        bookingMaxAdvanceWeeks: config.bookingMaxAdvanceWeeks,
        bookingMinAdvanceHours: config.bookingMinAdvanceHours,
      };
      res.json(body);
    } else {
      const responseDays: DayAvailability[] = days.map((date: string) => {
        const windows = effectiveHours(date, seasons, overrides, config);
        const dayState = computeDayState(date, windows.length > 0, todayDateLA, maxAdvanceDateLA);
        if (dayState !== "open") {
          return { date, dayState, openCount: 0, totalCount: 0, teachingWindows: [] };
        }
        const slots = classifyDaySlots({ ...sharedClassifyParams, date });
        return {
          date,
          dayState: "open" as const,
          openCount: slots.filter((slot) => slot.state === "available").length,
          totalCount: slots.length,
          teachingWindows: windows,
        };
      });
      const body: MonthAvailabilityResponse = {
        needsApproval: approvalRequired,
        days: responseDays,
        maxDailyLessonMinutes: config.maxDailyLessonMinutes,
        bookingMaxAdvanceWeeks: config.bookingMaxAdvanceWeeks,
        bookingMinAdvanceHours: config.bookingMinAdvanceHours,
      };
      res.json(body);
    }
  }),
);

// ── POST /lessons ─────────────────────────────────────────────────────────────

lessonsRouter.post(
  "/",
  requireParent,
  requireHouseholdMember,
  requireHouseholdRole("manager"),
  bookingLimiter,
  validate({ body: CreateLessonBodySchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as CreateLessonBody;
    const { householdId } = req;
    const profileId = req.profile.id;

    const startsAt = new Date(body.startsAt);
    const nowUtc = getNowUtc();

    // ── Validate location access ──────────────────────────────────────────────
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

    if (location.householdId !== null && location.householdId !== householdId) {
      res.status(403).json({ error: "not_your_home_pool" });
      return;
    }

    // ── Validate swimmers ─────────────────────────────────────────────────────
    const swimmerRows = await db
      .select({ id: swimmers.id, householdId: swimmers.householdId })
      .from(swimmers)
      .where(and(isActiveSwimmer, inArray(swimmers.id, body.swimmerIds)));

    if (swimmerRows.length !== body.swimmerIds.length) {
      res.status(422).json({ error: "One or more swimmers not found or archived" });
      return;
    }

    if (swimmerRows.some((swimmer) => swimmer.householdId !== householdId)) {
      res.status(422).json({ error: "All swimmers must belong to your household" });
      return;
    }

    // ── Derive the Los Angeles calendar date of the slot ─────────────────────
    const laDateParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(startsAt);
    const getPart = (type: string) =>
      laDateParts.find((p) => p.type === type)?.value ?? "";
    const laDateStr = `${getPart("year")}-${getPart("month")}-${getPart("day")}`;

    // ── Fetch availability config, seasons, overrides ─────────────────────────
    const [configRows, seasonRows, overrideRows] = await Promise.all([
      db.select().from(availabilityConfig).limit(1),
      db.select().from(availabilitySeasons),
      db.select().from(availabilityOverrides),
    ]);

    const config = configRows[0];
    if (!config) {
      res.status(503).json({ error: "Availability config not found" });
      return;
    }

    const seasons = seasonRows.map(mapSeasonRow);
    const overrides = overrideRows.map(mapOverrideRow);

    // ── Booking window validation (pre-lock) ──────────────────────────────────

    if (effectiveHours(laDateStr, seasons, overrides, config).length === 0) {
      res.status(422).json({ error: "not_a_lesson_day" });
      return;
    }

    const minMs = nowUtc.getTime() + config.bookingMinAdvanceHours * 60 * 60 * 1000;

    if (startsAt.getTime() < minMs) {
      res.status(422).json({ error: "too_soon", bookingMinAdvanceHours: config.bookingMinAdvanceHours });
      return;
    }
    if (isAfterBookingWindow(startsAt, nowUtc, config.bookingMaxAdvanceWeeks)) {
      res.status(422).json({ error: "too_far" });
      return;
    }

    // ── Transact: advisory lock → re-validate slot → insert ──────────────────
    const newLesson = await db.transaction(async (tx) => {
      // Serialize concurrent bookings on the same calendar day (LA time).
      // pg_advisory_xact_lock takes a bigint; we hash the day string.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${"lesson-day:" + laDateStr}))`,
      );

      // Fetch fresh state inside the lock.
      const [blockedRows, bufferRows, existingLessonRows] = await Promise.all([
        tx.select().from(blockedTimes),
        tx.select().from(travelBufferOverrides),
        tx
          .select({
            startsAt: lessons.startsAt,
            durationMinutes: lessons.durationMinutes,
            locationId: lessons.locationId,
          })
          .from(lessons)
          .where(inArray(lessons.status, ["pending", "approved"])),
      ]);

      const slotParams = {
        date: laDateStr,
        durationMinutes: body.durationMinutes,
        locationId: body.locationId,
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
        nowUtc,
      };
      const availableSlots = computeAvailableSlots(slotParams);

      const slotAvailable = availableSlots.some(
        (slot) => slot.startsAt.getTime() === startsAt.getTime(),
      );

      if (!slotAvailable) {
        const reason = diagnoseSlotRejection(slotParams, startsAt.getTime());
        return { rejected: true as const, reason };
      }

      const approval = await needsApproval(householdId, body.locationId, tx);
      const type = body.swimmerIds.length === 1 ? "private" : "family";
      const now = new Date();

      const insertedRows = await tx
        .insert(lessons)
        .values({
          householdId,
          locationId: body.locationId,
          startsAt,
          durationMinutes: body.durationMinutes,
          type,
          status: approval ? "pending" : "approved",
          requestedBy: profileId,
          ...(approval
            ? { expiresAt: new Date(startsAt.getTime() - config.bookingMinAdvanceHours * 60 * 60 * 1000) }
            : { approvedAt: now, approvedBy: null }),
        })
        .returning();

      const inserted = insertedRows[0]!;

      await tx.insert(lessonSwimmers).values(
        body.swimmerIds.map((swimmerId) => ({ lessonId: inserted.id, swimmerId })),
      );

      // Parent booking email outbox (ADR 028). Auto-approved bookings get
      // the confirmed email directly; never a request-received email on top.
      const outboxId = await enqueueLessonEmail(tx, {
        lessonId: inserted.id,
        event: inserted.status === "approved" ? "lesson_confirmed" : "booking_requested",
        actorRole: "parent",
        // initiatedBy is only read by LessonConfirmed; passing it on both
        // branches is harmless and keeps the semantic ("parent made this
        // booking") true for both the auto-approved and future-approved
        // audit trail.
        initiatedBy: "parent",
      });

      // Coach alert row (ADR 031). Written inside the same tx as the lesson
      // insert so a rollback also rolls back the notification. The send
      // itself fires in a post-commit microtask below.
      const coachNotificationId = await notifyBookingCreated(
        tx,
        inserted.id,
        inserted.status === "approved",
      );

      return { lesson: inserted, outboxId, coachNotificationId };
    });

    if ("rejected" in newLesson) {
      req.log.warn(
        {
          event: "slot_unavailable",
          route: "POST /lessons",
          reason: newLesson.reason,
          startsAt: startsAt.toISOString(),
          durationMinutes: body.durationMinutes,
          locationId: body.locationId,
        },
        "slot rejected on booking recheck",
      );
      res.status(422).json({ error: "slot_unavailable" });
      return;
    }
    const {
      lesson: committedLesson,
      outboxId: committedOutboxId,
      coachNotificationId,
    } = newLesson;

    queueCoachNotificationSend(coachNotificationId);

    // Fetch swimmers for response.
    const swimmerResponseRows = await db
      .select({ swimmerId: lessonSwimmers.swimmerId, firstName: swimmers.firstName, lastName: swimmers.lastName })
      .from(lessonSwimmers)
      .innerJoin(swimmers, eq(lessonSwimmers.swimmerId, swimmers.id))
      .where(eq(lessonSwimmers.lessonId, committedLesson.id));

    const lessonSwimmerList: LessonSwimmer[] = swimmerResponseRows.map((row) => ({
      swimmerId: row.swimmerId,
      firstName: row.firstName,
      lastName: row.lastName,
    }));

    const responseBody: LessonResponse = {
      id: committedLesson.id,
      householdId: committedLesson.householdId,
      locationId: committedLesson.locationId,
      startsAt: committedLesson.startsAt.toISOString(),
      durationMinutes: committedLesson.durationMinutes as 30 | 45 | 60,
      type: committedLesson.type,
      status: committedLesson.status,
      swimmers: lessonSwimmerList,
      expiresAt: committedLesson.expiresAt?.toISOString() ?? null,
      approvedAt: committedLesson.approvedAt?.toISOString() ?? null,
      declinedAt: null,
      declineReason: null,
      movedAt: null,
      previousStartsAt: null,
      createdAt: committedLesson.createdAt.toISOString(),
    };

    res.status(201).json(responseBody);
    // A new booking can be created directly in status='approved' when the
    // household's auto-approval rule fires (ADR 021). The reconcile is a
    // no-op for pending bookings but required for auto-approved ones, so
    // fire the microtask unconditionally — mirrors the other lesson routes.
    queueMicrotask(() => { void syncLessonToGoogle(committedLesson.id); });
    // Parent booking email — post-commit sender. The sender's claim lease
    // + Resend Idempotency-Key keep this safe against the cron drain
    // racing on the same row.
    queueMicrotask(() => { void sendLessonEmailOutboxRow(committedOutboxId); });
  }),
);

// ── POST /lessons/batch/preview ───────────────────────────────────────────────

// Thrown from inside the batch submit's db.transaction() so Drizzle rolls
// back the booking_batches insert on a picks_conflict. Returning a tagged
// object from the callback would commit instead — only an exception
// triggers rollback.
class BatchPicksConflictError extends Error {
  constructor(readonly conflicts: BatchConflictPick[]) {
    super("picks_conflict");
    this.name = "BatchPicksConflictError";
  }
}

interface BatchContext {
  config: typeof availabilityConfig.$inferSelect;
  seasons: ReturnType<typeof mapSeasonRow>[];
  overrides: ReturnType<typeof mapOverrideRow>[];
  blocked: { startsAt: Date; endsAt: Date; locationId: string | null }[];
  buffers: { fromLocationId: string; toLocationId: string; bufferMinutes: number }[];
  dbLessons: { startsAt: Date; durationMinutes: number; locationId: string }[];
  nowUtc: Date;
}

function classifyBatchPick(
  candidate: Candidate,
  allCandidates: Candidate[],
  locationId: string,
  ctx: BatchContext,
): { state: BatchPickState; reason?: string } {
  const startsAtMs = candidate.startsAt.getTime();
  const nowMs = ctx.nowUtc.getTime();
  const minAdvMs = ctx.config.bookingMinAdvanceHours * 60 * 60 * 1000;

  if (startsAtMs < nowMs) return { state: "past", reason: "too_soon" };
  if (isAfterBookingWindow(candidate.startsAt, ctx.nowUtc, ctx.config.bookingMaxAdvanceWeeks)) {
    return { state: "not_open_yet", reason: "too_far" };
  }
  if (startsAtMs < nowMs + minAdvMs) return { state: "too_soon", reason: "too_soon" };

  const laDate = getDateInLA(candidate.startsAt);
  // Fold every other candidate in as an "existing lesson" at ITS OWN length,
  // so overlap and buffer checks respect per-pick duration (e.g. a 45-min
  // pick blocks a later 30-min pick that lands inside its span).
  const otherFoldIn = allCandidates
    .filter((other) => other.index !== candidate.index)
    .map((other) => ({
      startsAt: other.startsAt,
      durationMinutes: other.durationMinutes,
      locationId,
    }));
  const slotParams = {
    date: laDate,
    durationMinutes: candidate.durationMinutes,
    locationId,
    existingLessons: [...ctx.dbLessons, ...otherFoldIn],
    blockedTimes: ctx.blocked,
    travelBufferOverrides: ctx.buffers,
    config: mapConfigRow(ctx.config),
    seasons: ctx.seasons,
    overrides: ctx.overrides,
    gcalBusyTimes: [],
    nowUtc: ctx.nowUtc,
  };
  const availableSlots = computeAvailableSlots(slotParams);
  const matches = availableSlots.some((slot) => slot.startsAt.getTime() === startsAtMs);
  if (matches) return { state: "available" };

  const reason = diagnoseSlotRejection(slotParams, startsAtMs);
  let state = slotRejectionToPickState(reason);
  // Promote generic unavailability to conflicts_batch when the overlap is
  // specifically with another pick in the same submission.
  if (state === "unavailable") {
    const myEnd = startsAtMs + candidate.durationMinutes * 60_000;
    const overlapsAnotherPick = otherFoldIn.some((other) => {
      const otherEnd = other.startsAt.getTime() + other.durationMinutes * 60_000;
      return startsAtMs < otherEnd && myEnd > other.startsAt.getTime();
    });
    if (overlapsAnotherPick) state = "conflicts_batch";
  }
  return { state, reason };
}

function suggestionsForPick(
  candidate: Candidate,
  allCandidates: Candidate[],
  locationId: string,
  ctx: BatchContext,
): { startsAt: string }[] {
  const laDate = getDateInLA(candidate.startsAt);
  const otherFoldIn = allCandidates
    .filter((other) => other.index !== candidate.index)
    .map((other) => ({
      startsAt: other.startsAt,
      durationMinutes: other.durationMinutes,
      locationId,
    }));
  const slotParams = {
    date: laDate,
    durationMinutes: candidate.durationMinutes,
    locationId,
    existingLessons: [...ctx.dbLessons, ...otherFoldIn],
    blockedTimes: ctx.blocked,
    travelBufferOverrides: ctx.buffers,
    config: mapConfigRow(ctx.config),
    seasons: ctx.seasons,
    overrides: ctx.overrides,
    gcalBusyTimes: [],
    nowUtc: ctx.nowUtc,
  };
  const available = computeAvailableSlots(slotParams);
  const targetMs = candidate.startsAt.getTime();
  return available
    .map((slot) => ({ startsAt: slot.startsAt, delta: Math.abs(slot.startsAt.getTime() - targetMs) }))
    .sort((a, b) => a.delta - b.delta)
    .slice(0, 3)
    .map((entry) => ({ startsAt: entry.startsAt.toISOString() }));
}

// Union of every swimmer referenced by a batch body — manual mode flattens
// across picks, weekly mode flattens across pattern entries. Each pick (or
// pattern entry) owns its own set per ADR 030 phase 2.
function collectBatchSwimmerIds(body: BatchPreviewBody | BatchSubmitBody): string[] {
  const seen = new Set<string>();
  if (body.mode === "manual") {
    for (const pick of body.picks) for (const id of pick.swimmerIds) seen.add(id);
  } else {
    for (const pair of body.pattern) for (const id of pair.swimmerIds) seen.add(id);
  }
  return Array.from(seen);
}

async function assertBatchHouseholdAndSwimmers(
  body: BatchPreviewBody | BatchSubmitBody,
  callerHouseholdId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (body.householdId !== callerHouseholdId) {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  const batchSwimmerIds = collectBatchSwimmerIds(body);
  const swimmerRows = await db
    .select({ id: swimmers.id, householdId: swimmers.householdId })
    .from(swimmers)
    .where(and(isActiveSwimmer, inArray(swimmers.id, batchSwimmerIds)));
  if (swimmerRows.length !== batchSwimmerIds.length) {
    return { ok: false, status: 422, error: "One or more swimmers not found or archived" };
  }
  if (swimmerRows.some((swimmer) => swimmer.householdId !== callerHouseholdId)) {
    return { ok: false, status: 422, error: "All swimmers must belong to your household" };
  }
  const locationRows = await db
    .select({ id: lessonLocations.id, householdId: lessonLocations.householdId })
    .from(lessonLocations)
    .where(and(eq(lessonLocations.id, body.locationId), eq(lessonLocations.isActive, true)))
    .limit(1);
  const location = locationRows[0];
  if (!location) {
    return { ok: false, status: 422, error: "Location not found or inactive" };
  }
  if (location.householdId !== null && location.householdId !== callerHouseholdId) {
    return { ok: false, status: 403, error: "not_your_home_pool" };
  }
  return { ok: true };
}

lessonsRouter.post(
  "/batch/preview",
  requireParent,
  requireHouseholdMember,
  requireHouseholdRole("manager"),
  previewLimiter,
  validate({ body: BatchPreviewBodySchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as BatchPreviewBody;
    const { householdId } = req;
    const nowUtc = getNowUtc();

    const guard = await assertBatchHouseholdAndSwimmers(body, householdId);
    if (!guard.ok) {
      res.status(guard.status).json({ error: guard.error });
      return;
    }

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

    const ctx: BatchContext = {
      config,
      seasons: seasonRows.map(mapSeasonRow),
      overrides: overrideRows.map(mapOverrideRow),
      blocked: blockedRows.map((row) => ({ startsAt: row.startsAt, endsAt: row.endsAt, locationId: row.locationId })),
      buffers: bufferRows.map((row) => ({
        fromLocationId: row.fromLocationId,
        toLocationId: row.toLocationId,
        bufferMinutes: row.bufferMinutes,
      })),
      dbLessons: existingLessonRows.map((row) => ({
        startsAt: row.startsAt,
        durationMinutes: row.durationMinutes,
        locationId: row.locationId,
      })),
      nowUtc,
    };

    const candidates: Candidate[] = body.mode === "manual"
      ? body.picks.map((pick, index) => ({
          index,
          startsAt: new Date(pick.startsAt),
          durationMinutes: pick.durationMinutes,
          swimmerIds: pick.swimmerIds,
        }))
      : expandWeeklyCandidates({
          pattern: body.pattern,
          startDate: body.startDate,
          weeks: body.weeks,
        });

    const approvalRequired = await needsApproval(householdId, body.locationId, db);

    const picks: BatchPreviewPick[] = candidates.map((candidate) => {
      const classified = classifyBatchPick(
        candidate,
        candidates,
        body.locationId,
        ctx,
      );
      const base: BatchPreviewPick = {
        index: candidate.index,
        startsAt: candidate.startsAt.toISOString(),
        durationMinutes: candidate.durationMinutes,
        swimmerIds: candidate.swimmerIds,
        state: classified.state,
      };
      if (classified.state === "available") return base;
      if (classified.reason) base.reason = classified.reason;
      // Suggestions only when the day has an open teaching window at all.
      // past / too_soon / not_open_yet are not time-of-day failures, so no
      // same-day replacements will help, so the field is omitted.
      const suggestable: BatchPickState[] = [
        "unavailable",
        "outside_hours",
        "blocked_time",
        "day_closed",
        "conflicts_batch",
      ];
      if (suggestable.includes(classified.state)) {
        const suggestions = suggestionsForPick(
          candidate,
          candidates,
          body.locationId,
          ctx,
        );
        if (suggestions.length > 0) base.suggestions = suggestions;
      }
      return base;
    });

    const response: BatchPreviewResponse = {
      needsApproval: approvalRequired,
      picks,
    };
    res.json(response);
  }),
);

// ── POST /lessons/batch ───────────────────────────────────────────────────────

lessonsRouter.post(
  "/batch",
  requireParent,
  requireHouseholdMember,
  requireHouseholdRole("manager"),
  bookingLimiter,
  validate({ body: BatchSubmitBodySchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as BatchSubmitBody;
    const { householdId } = req;
    const profileId = req.profile.id;
    const nowUtc = getNowUtc();

    const guard = await assertBatchHouseholdAndSwimmers(body, householdId);
    if (!guard.ok) {
      res.status(guard.status).json({ error: guard.error });
      return;
    }

    // Compute final picks after applying weekly skips + overrides.
    let finalPicks: Candidate[];
    if (body.mode === "manual") {
      finalPicks = body.picks.map((pick, index) => ({
        index,
        startsAt: new Date(pick.startsAt),
        durationMinutes: pick.durationMinutes,
        swimmerIds: pick.swimmerIds,
      }));
    } else {
      const expanded = expandWeeklyCandidates({
        pattern: body.pattern,
        startDate: body.startDate,
        weeks: body.weeks,
      });
      finalPicks = applyWeeklyOverridesAndSkips(expanded, body.overrides, body.skips);
    }

    if (finalPicks.length < BATCH_LESSON_MIN) {
      res.status(422).json({ error: "picks_underflow" });
      return;
    }
    if (finalPicks.length > BATCH_LESSON_MAX) {
      res.status(422).json({ error: "picks_overflow" });
      return;
    }

    const [configRows, seasonRows, overrideRowsFetch] = await Promise.all([
      db.select().from(availabilityConfig).limit(1),
      db.select().from(availabilitySeasons),
      db.select().from(availabilityOverrides),
    ]);
    const config = configRows[0];
    if (!config) {
      res.status(503).json({ error: "Availability config not found" });
      return;
    }
    const seasons = seasonRows.map(mapSeasonRow);
    const overrides = overrideRowsFetch.map(mapOverrideRow);

    // Ascending unique LA dates for the deterministic lock order.
    const uniqueDates = Array.from(
      new Set(finalPicks.map((pick) => getDateInLA(pick.startsAt))),
    ).sort();
    const picksAsc = [...finalPicks].sort(
      (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
    );

    let result: {
      batch: typeof bookingBatches.$inferSelect;
      lessons: (typeof lessons.$inferSelect)[];
      outboxId: string;
      coachNotificationId: string | null;
    };
    try {
      result = await db.transaction(async (tx) => {
      // Shape matches the shared BatchPatternPairSchema so one Zod schema
      // validates on write (here, defense in depth after the body parse) and
      // on read (via parseStoredWeeklyPattern).
      const weeklyPatternForInsert: StoredWeeklyPattern | null =
        body.mode === "weekly"
          ? StoredWeeklyPatternSchema.parse(
              body.pattern.map((pair) => ({
                weekday: pair.weekday,
                timeOfDay: pair.timeOfDay,
                durationMinutes: pair.durationMinutes,
                // Per-entry swimmers (ADR 030 phase 2) must round-trip through
                // the stored pattern so cancel-remaining + any future re-expansion
                // can rebuild each candidate's swimmer set from the batch row.
                swimmerIds: pair.swimmerIds,
              })),
            )
          : null;

      const batchRows = await tx
        .insert(bookingBatches)
        .values(
          body.mode === "weekly"
            ? {
                householdId,
                createdBy: profileId,
                mode: "weekly" as const,
                weeklyPattern: weeklyPatternForInsert,
                weeklyStartDate: body.startDate,
                weeklyWeeks: body.weeks,
              }
            : {
                householdId,
                createdBy: profileId,
                mode: "manual" as const,
              },
        )
        .returning();
      const batch = batchRows[0]!;

      for (const laDate of uniqueDates) {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${"lesson-day:" + laDate}))`,
        );
      }

      const [blockedRows, bufferRows, existingLessonRows] = await Promise.all([
        tx.select().from(blockedTimes),
        tx.select().from(travelBufferOverrides),
        tx
          .select({
            startsAt: lessons.startsAt,
            durationMinutes: lessons.durationMinutes,
            locationId: lessons.locationId,
          })
          .from(lessons)
          .where(inArray(lessons.status, ["pending", "approved"])),
      ]);

      const ctx: BatchContext = {
        config,
        seasons,
        overrides,
        blocked: blockedRows.map((row) => ({ startsAt: row.startsAt, endsAt: row.endsAt, locationId: row.locationId })),
        buffers: bufferRows.map((row) => ({
          fromLocationId: row.fromLocationId,
          toLocationId: row.toLocationId,
          bufferMinutes: row.bufferMinutes,
        })),
        dbLessons: existingLessonRows.map((row) => ({
          startsAt: row.startsAt,
          durationMinutes: row.durationMinutes,
          locationId: row.locationId,
        })),
        nowUtc,
      };

      const conflicts: BatchConflictPick[] = [];
      for (const pick of picksAsc) {
        const classified = classifyBatchPick(
          pick,
          picksAsc,
          body.locationId,
          ctx,
        );
        if (classified.state !== "available") {
          const conflict: BatchConflictPick = {
            index: pick.index,
            startsAt: pick.startsAt.toISOString(),
            state: classified.state,
          };
          if (classified.reason) conflict.reason = classified.reason;
          conflicts.push(conflict);
        }
      }
      if (conflicts.length > 0) {
        // Throw a tagged class so the enclosing db.transaction() rolls back
        // the booking_batches insert we did above. Returning a tagged object
        // would commit; only an exception triggers Drizzle's rollback.
        throw new BatchPicksConflictError(conflicts);
      }

      const approvalRequired = await needsApproval(householdId, body.locationId, tx);
      const now = new Date();
      const noticeMs = config.bookingMinAdvanceHours * 60 * 60 * 1000;

      // Generate each lesson's id up front so every downstream insert and
      // payload mapping (lesson_swimmers rows, per-lesson email names,
      // approved-id snapshot) can key by the pick's own id. No positional
      // zipping between the insert's returning array and picksAsc.
      const picksWithIds = picksAsc.map((pick) => ({
        ...pick,
        id: crypto.randomUUID() as string,
      }));

      const insertedLessons = await tx
        .insert(lessons)
        .values(
          picksWithIds.map((pick) => ({
            id: pick.id,
            householdId,
            locationId: body.locationId,
            startsAt: pick.startsAt,
            durationMinutes: pick.durationMinutes,
            // Per-lesson type derivation (ADR 030 phase 2): private when a
            // single swimmer, family when two or more. Lets one batch mix
            // private and family rows under one booking.
            type: (pick.swimmerIds.length === 1 ? "private" : "family") as
              | "private"
              | "family",
            status: (approvalRequired ? "pending" : "approved") as "pending" | "approved",
            requestedBy: profileId,
            batchId: batch.id,
            ...(approvalRequired
              ? { expiresAt: new Date(pick.startsAt.getTime() - noticeMs) }
              : { approvedAt: now, approvedBy: null }),
          })),
        )
        .returning();

      await tx.insert(lessonSwimmers).values(
        picksWithIds.flatMap((pick) =>
          pick.swimmerIds.map((swimmerId) => ({ lessonId: pick.id, swimmerId })),
        ),
      );

      // Approved lessons: snapshot calendar_sequence (0) into the payload and
      // bump to 1 for the next REQUEST, set calendar_invite_sent_at.
      const approvedLessonIds = insertedLessons
        .filter((lesson) => lesson.status === "approved")
        .map((lesson) => lesson.id);
      if (approvedLessonIds.length > 0) {
        await tx
          .update(lessons)
          .set({
            calendarSequence: sql`${lessons.calendarSequence} + 1` as unknown as number,
            calendarInviteSentAt: now,
          })
          .where(inArray(lessons.id, approvedLessonIds));
      }

      const recipientRows = await tx
        .select({ profileId: householdMembers.profileId })
        .from(householdMembers)
        .where(
          and(
            eq(householdMembers.householdId, householdId),
            inArray(householdMembers.role, ["owner", "manager"]),
          ),
        );
      const recipientProfileIds = recipientRows.map((row) => row.profileId);

      // Build the batch-wide and per-lesson swimmer name maps in one join.
      // batchFirstNames (deduped union) feeds the email intro + ICS summary;
      // perLessonFirstNames feeds the per-lesson list in the summary email.
      const batchSwimmerIds = collectBatchSwimmerIds(body);
      const swimmerNameRows = await tx
        .select({ id: swimmers.id, firstName: swimmers.firstName })
        .from(swimmers)
        .where(inArray(swimmers.id, batchSwimmerIds))
        .orderBy(swimmers.firstName);
      const firstNameById = new Map(
        swimmerNameRows.map((row) => [row.id, row.firstName] as const),
      );
      const swimmerFirstNames = swimmerNameRows.map((row) => row.firstName);
      // Key per-lesson first names by the generated lesson id so the
      // payload mapping and email render can look them up without relying
      // on insertedLessons preserving picksAsc order.
      const firstNamesByLessonId = new Map(
        picksWithIds.map(
          (pick) =>
            [
              pick.id,
              pick.swimmerIds
                .map((id) => firstNameById.get(id))
                .filter((name): name is string => name !== undefined)
                .sort((a, b) => a.localeCompare(b)),
            ] as const,
        ),
      );

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
        .where(eq(lessonLocations.id, body.locationId))
        .limit(1);
      const location = locationRows[0]!;

      const batchPayload = {
        batchId: batch.id,
        mode: body.mode,
        ...(body.mode === "weekly"
          ? {
              weekly: {
                pattern: body.pattern,
                startDate: body.startDate,
                weeks: body.weeks,
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
        // Each lesson entry snapshots the pre-bump calendar_sequence straight
        // off the row INSERTed above. `insertedLessons` was captured BEFORE
        // the UPDATE that bumped approved rows to +1, so `lesson.calendarSequence`
        // is 0 here for every row -- the SEQUENCE: value the first REQUEST / the
        // first invite should ship. batch_approved reuses the same pattern:
        // read each row's current calendar_sequence, snapshot it into the
        // outbox payload, then bump the row.
        lessons: insertedLessons.map((lesson) => ({
          lessonId: lesson.id,
          startsAtUtc: lesson.startsAt.toISOString(),
          durationMinutes: lesson.durationMinutes,
          status: lesson.status,
          calendarSequence: lesson.calendarSequence,
          swimmerFirstNames: firstNamesByLessonId.get(lesson.id) ?? [],
        })),
      };

      const outboxInsert = await tx
        .insert(lessonEmailOutbox)
        .values({
          batchId: batch.id,
          lessonId: null,
          event: "batch_booked",
          sequence: 0,
          recipientProfileIds,
          icsMethod: null,
          icsSequence: null,
          payload: batchPayload,
        })
        .returning({ id: lessonEmailOutbox.id });
      const outboxId = outboxInsert[0]!.id;

      // Audit payload omits per-lesson startsAt / durationMinutes so a
      // minor's scheduling data does not sit in household_audit_log for
      // the 30-day retention window (accounts.md). Lesson ids are enough
      // to reconstruct the batch via the lessons table when truly needed;
      // the ids themselves are not kids'-data under accounts.md.
      await tx.insert(householdAuditLog).values({
        householdId,
        actorId: profileId,
        action: "lesson_batch_booked",
        payload: {
          batchId: batch.id,
          mode: body.mode,
          locationId: body.locationId,
          swimmerIds: batchSwimmerIds,
          lessonIds: insertedLessons.map((lesson) => lesson.id),
          lessonCount: insertedLessons.length,
          ...(body.mode === "weekly"
            ? {
                weekly: {
                  pattern: body.pattern,
                  startDate: body.startDate,
                  weeks: body.weeks,
                },
              }
            : {}),
        },
      });

      // Coach alert row (ADR 031). Inside the same tx so a rollback
      // includes the notification. The send fires in a post-commit
      // microtask below.
      const confirmedCountInTx = insertedLessons.filter((lesson) => lesson.status === "approved").length;
      const pendingCountInTx = insertedLessons.filter((lesson) => lesson.status === "pending").length;
      const coachNotificationId = await notifyBatchBookingCreated(tx, batch.id, {
        confirmedCount: confirmedCountInTx,
        pendingCount: pendingCountInTx,
      });

      return {
        batch,
        lessons: insertedLessons,
        outboxId,
        coachNotificationId,
      };
      });
    } catch (err) {
      if (err instanceof BatchPicksConflictError) {
        // Log aggregated metadata only: a count and the enum reason codes.
        // The per-pick startsAt is a specific datetime tied to a kid's
        // lesson request and should not sit in server logs (accounts.md).
        // The full conflicts array still goes back in the 422 response.
        req.log.warn(
          {
            event: "picks_conflict",
            route: "POST /lessons/batch",
            conflictCount: err.conflicts.length,
            reasons: err.conflicts.map((conflict) => conflict.reason ?? conflict.state),
          },
          "batch rejected on recheck",
        );
        res.status(422).json({ error: "picks_conflict", conflicts: err.conflicts });
        return;
      }
      throw err;
    }

    for (const lesson of result.lessons) {
      if (lesson.status === "approved") {
        queueMicrotask(() => {
          void syncLessonToGoogle(lesson.id);
        });
      }
    }
    queueMicrotask(() => {
      void sendLessonEmailOutboxRow(result.outboxId);
    });

    const confirmedCount = result.lessons.filter((lesson) => lesson.status === "approved").length;
    const pendingCount = result.lessons.filter((lesson) => lesson.status === "pending").length;

    // Coach notification fires once with a batch summary. The inbox-count
    // argument that justified a single parent email for the batch applies
    // to the coach's channel too — notifyBookingCreated's per-lesson stub
    // would otherwise fire N times per submission. The row itself was
    // written inside the batch tx; this just queues the send.
    queueCoachNotificationSend(result.coachNotificationId);

    const response: BatchSubmitSuccessResponse = {
      batchId: result.batch.id,
      mode: body.mode,
      lessonIds: result.lessons.map((lesson) => lesson.id),
      confirmedCount,
      pendingCount,
    };
    res.status(201).json(response);
  }),
);

const BatchIdParamsSchema = z.object({ batchId: z.string().uuid() });

// ── GET /lessons/batch/:batchId ─────────────────────────────────────────────
// Returns exactly the set of lessons that DELETE
// /lessons/batch/:batchId/remaining would cancel: same batch, same household,
// pending or approved, strictly future-dated. The parent cancel-remaining
// confirm dialog reads this so its listed lessons match the API's canceled
// set 1:1 instead of filtering the household's upcoming list heuristically.

lessonsRouter.get(
  "/batch/:batchId",
  requireParent,
  requireHouseholdMember,
  validate({ params: BatchIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const batchId = req.params.batchId as string;
    const { householdId } = req;
    const nowUtc = getNowUtc();

    const batchRows = await db
      .select({ id: bookingBatches.id, mode: bookingBatches.mode })
      .from(bookingBatches)
      .where(and(eq(bookingBatches.id, batchId), eq(bookingBatches.householdId, householdId)))
      .limit(1);
    const batch = batchRows[0];
    if (!batch) {
      res.status(404).json({ error: "Batch not found" });
      return;
    }

    const lessonRows = await db
      .select({
        id: lessons.id,
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
        batchId: lessons.batchId,
      })
      .from(lessons)
      .innerJoin(lessonLocations, eq(lessons.locationId, lessonLocations.id))
      .where(
        and(
          eq(lessons.batchId, batchId),
          eq(lessons.householdId, householdId),
          inArray(lessons.status, ["pending", "approved"]),
          gt(lessons.startsAt, nowUtc),
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

    const body: UpcomingLesson[] = lessonRows.map((row) => ({
      id: row.id,
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
      movedAt: row.movedAt?.toISOString() ?? null,
      previousStartsAt: row.previousStartsAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      batchId: row.batchId,
      batchMode: batch.mode === "manual" || batch.mode === "weekly" ? batch.mode : null,
    }));

    res.json(body);
  }),
);

// ── DELETE /lessons/batch/:batchId/remaining ─────────────────────────────────
// Owners / managers cancel every future-dated pending + approved lesson in the
// batch under the same rules as single-lesson cancel. One transaction, one
// audit row, one batch_canceled outbox row (CANCEL VEVENTs only for lessons
// that had invites; pending ones listed in the text). See ADR 030.

lessonsRouter.delete(
  "/batch/:batchId/remaining",
  requireParent,
  requireHouseholdMember,
  requireHouseholdRole("manager"),
  validate({ params: BatchIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const batchId = req.params.batchId as string;
    const { householdId } = req;
    const profileId = req.profile.id;

    const batchRows = await db
      .select()
      .from(bookingBatches)
      .where(and(eq(bookingBatches.id, batchId), eq(bookingBatches.householdId, householdId)))
      .limit(1);
    const batch = batchRows[0];
    if (!batch) {
      res.status(404).json({ error: "Batch not found" });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const now = new Date();

      // Lock + load every future-dated pending/approved lesson in the batch.
      // Past lessons are left alone. Match single-lesson cancel's "lesson_in_past"
      // rule by filtering on starts_at > now.
      const toCancel = await tx
        .select()
        .from(lessons)
        .where(
          and(
            eq(lessons.batchId, batchId),
            inArray(lessons.status, ["pending", "approved"]),
            gt(lessons.startsAt, now),
          ),
        )
        .for("update");

      if (toCancel.length === 0) return { kind: "none" as const };

      // Snapshot pre-bump calendar_sequence per lesson; only lessons that had
      // a prior invite get CANCEL rows. Pending-only lessons appear in the
      // email body text but not in the .ics (matches single-lesson rules).
      const sequenceByLesson = new Map<string, number>();
      for (const lesson of toCancel) {
        sequenceByLesson.set(lesson.id, lesson.calendarSequence);
      }

      const invitedIdSet = new Set(
        toCancel.filter((lesson) => lesson.calendarInviteSentAt !== null).map((lesson) => lesson.id),
      );
      const allIds = toCancel.map((lesson) => lesson.id);

      // Bump calendar_sequence on every canceled lesson so the sender's
      // send-time filter sees snapshot+1 for ALL of them (invited and
      // pending alike). Only invited lessons produce a CANCEL VEVENT; the
      // ics builder consults `wasInvited` on each payload lesson to decide.
      await tx
        .update(lessons)
        .set({
          status: "canceled",
          canceledAt: now,
          canceledBy: profileId,
          calendarSequence: sql`${lessons.calendarSequence} + 1` as unknown as number,
        })
        .where(inArray(lessons.id, allIds));

      const recipientRows = await tx
        .select({ profileId: householdMembers.profileId })
        .from(householdMembers)
        .where(
          and(
            eq(householdMembers.householdId, householdId),
            inArray(householdMembers.role, ["owner", "manager"]),
          ),
        );
      const recipientProfileIds = recipientRows.map((row) => row.profileId);

      // Per-lesson swimmer first names so the batch email can render each
      // row's kids. The batch-wide `swimmerFirstNames` field below is the
      // sorted union across all canceled lessons for the email intro.
      const perLessonSwimmerRows = await tx
        .select({
          lessonId: lessonSwimmers.lessonId,
          firstName: swimmers.firstName,
        })
        .from(lessonSwimmers)
        .innerJoin(swimmers, eq(lessonSwimmers.swimmerId, swimmers.id))
        .where(inArray(lessonSwimmers.lessonId, allIds))
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

      const locationId = toCancel[0]!.locationId;
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

      const payloadLessons: BatchEmailLesson[] = toCancel.map((lesson) => ({
        lessonId: lesson.id,
        startsAtUtc: lesson.startsAt.toISOString(),
        durationMinutes: lesson.durationMinutes as 30 | 45 | 60,
        status: "canceled" as const,
        swimmerFirstNames: firstNamesByLessonId.get(lesson.id) ?? [],
        // Pre-bump value. Every canceled lesson was bumped by one above, so
        // the sender's filter check (live === stored + 1) passes for both
        // invited and pending-only rows. wasInvited distinguishes the two:
        // invited rows produce a CANCEL VEVENT, pending-only rows don't.
        calendarSequence: sequenceByLesson.get(lesson.id)!,
        wasInvited: invitedIdSet.has(lesson.id),
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

      // Next (batch_id, event='batch_canceled') sequence. Starts at 0.
      const seqRows = await tx
        .select({ max: max(lessonEmailOutbox.sequence) })
        .from(lessonEmailOutbox)
        .where(
          and(
            eq(lessonEmailOutbox.batchId, batchId),
            eq(lessonEmailOutbox.event, "batch_canceled"),
          ),
        );
      const nextSeq = (seqRows[0]?.max ?? -1) + 1;

      const outboxInsert = await tx
        .insert(lessonEmailOutbox)
        .values({
          batchId,
          lessonId: null,
          event: "batch_canceled",
          sequence: nextSeq,
          recipientProfileIds,
          icsMethod: null,
          icsSequence: null,
          payload,
        })
        .returning({ id: lessonEmailOutbox.id });
      const outboxId = outboxInsert[0]!.id;

      await tx.insert(householdAuditLog).values({
        householdId,
        actorId: profileId,
        action: "lesson_batch_canceled_remaining",
        payload: {
          batchId,
          canceledLessonIds: allIds,
          invitedLessonIds: Array.from(invitedIdSet),
        },
      });

      // Coach alert row (ADR 031). Inside the same tx so a rollback also
      // rolls back the notification. The send fires in a post-commit
      // microtask below.
      const coachNotificationId = await notifyCoachOfBatchChange(
        tx,
        batchId,
        "canceled_remaining",
        { lessonCount: allIds.length },
      );

      return {
        kind: "canceled" as const,
        canceledIds: allIds,
        outboxId,
        coachNotificationId,
      };
    });

    if (result.kind === "none") {
      res.status(409).json({ error: "no_remaining_lessons" });
      return;
    }

    for (const lessonId of result.canceledIds) {
      queueMicrotask(() => { void syncLessonToGoogle(lessonId); });
    }
    queueMicrotask(() => { void sendLessonEmailOutboxRow(result.outboxId); });

    // One coach notification per batch cancel, not per lesson — mirrors
    // the single-lesson notifyCoachOfChange hook but at the batch grain so
    // the coach's channel sees a summary. Row was written in the tx above;
    // this just queues the send.
    queueCoachNotificationSend(result.coachNotificationId);

    const body: BatchCancelRemainingResponse = {
      batchId,
      canceledLessonIds: result.canceledIds,
      canceledCount: result.canceledIds.length,
    };
    res.json(body);
  }),
);

// ── GET /lessons/:id ──────────────────────────────────────────────────────────

lessonsRouter.get(
  "/:id",
  requireParent,
  requireHouseholdMember,
  validate({}),
  asyncHandler(async (req, res) => {
    const id = req.params.id as string;

    const lessonRows = await db
      .select({
        id: lessons.id,
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
        batchId: lessons.batchId,
        batchMode: bookingBatches.mode,
      })
      .from(lessons)
      .innerJoin(lessonLocations, eq(lessons.locationId, lessonLocations.id))
      .leftJoin(bookingBatches, eq(lessons.batchId, bookingBatches.id))
      .where(and(eq(lessons.id, id), eq(lessons.householdId, req.householdId)))
      .limit(1);

    const lessonRow = lessonRows[0];
    if (!lessonRow) {
      res.status(404).json({ error: "Lesson not found" });
      return;
    }

    const swimmerRows = await db
      .select({ swimmerId: lessonSwimmers.swimmerId, firstName: swimmers.firstName, lastName: swimmers.lastName })
      .from(lessonSwimmers)
      .innerJoin(swimmers, eq(lessonSwimmers.swimmerId, swimmers.id))
      .where(eq(lessonSwimmers.lessonId, id));

    const body: UpcomingLesson = {
      id: lessonRow.id,
      locationId: lessonRow.locationId,
      locationName: lessonRow.locationName,
      startsAt: lessonRow.startsAt.toISOString(),
      durationMinutes: lessonRow.durationMinutes as 30 | 45 | 60,
      type: lessonRow.type,
      status: lessonRow.status,
      swimmers: swimmerRows.map((row) => ({
        swimmerId: row.swimmerId,
        firstName: row.firstName,
        lastName: row.lastName,
      })),
      expiresAt: lessonRow.expiresAt?.toISOString() ?? null,
      approvedAt: lessonRow.approvedAt?.toISOString() ?? null,
      declinedAt: lessonRow.declinedAt?.toISOString() ?? null,
      declineReason: lessonRow.declineReason ?? null,
      movedAt: lessonRow.movedAt?.toISOString() ?? null,
      previousStartsAt: lessonRow.previousStartsAt?.toISOString() ?? null,
      createdAt: lessonRow.createdAt.toISOString(),
      batchId: lessonRow.batchId,
      batchMode:
        lessonRow.batchMode === "manual" || lessonRow.batchMode === "weekly"
          ? lessonRow.batchMode
          : null,
    };

    res.json(body);
  }),
);

// ── DELETE /lessons/:id ───────────────────────────────────────────────────────

lessonsRouter.delete(
  "/:id",
  requireParentOrCoach,
  validate({}),
  asyncHandler(async (req, res) => {
    const id = req.params.id as string;
    const profileId = req.profile.id;
    const isCoach = req.profile.role === "coach";

    let lessonToCancel: typeof lessons.$inferSelect | undefined;

    if (isCoach) {
      const rows = await db.select().from(lessons).where(eq(lessons.id, id)).limit(1);
      lessonToCancel = rows[0];
      if (!lessonToCancel) { res.status(404).json({ error: "Lesson not found" }); return; }
    } else {
      const memberRows = await db
        .select({ householdId: householdMembers.householdId, role: householdMembers.role })
        .from(householdMembers)
        .where(eq(householdMembers.profileId, profileId))
        .limit(1);
      const member = memberRows[0];
      if (!member || HOUSEHOLD_ROLE_RANK[member.role as HouseholdRole] < HOUSEHOLD_ROLE_RANK["manager"]) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      const rows = await db
        .select()
        .from(lessons)
        .where(and(eq(lessons.id, id), eq(lessons.householdId, member.householdId)))
        .limit(1);
      lessonToCancel = rows[0];
      if (!lessonToCancel) { res.status(404).json({ error: "Lesson not found" }); return; }
    }

    if (!["pending", "approved"].includes(lessonToCancel.status)) {
      res.status(422).json({ error: "lesson_not_active" });
      return;
    }

    if (!isCoach && lessonToCancel.startsAt <= new Date()) {
      res.status(422).json({ error: "lesson_in_past" });
      return;
    }

    const cancelResult = await db.transaction(async (tx) => {
      await tx
        .update(lessons)
        .set({ status: "canceled", canceledAt: new Date(), canceledBy: profileId })
        .where(eq(lessons.id, id));

      // Parent booking email outbox (ADR 028). Writes CANCEL .ics iff a
      // prior invite was issued; sends a plain-content email otherwise.
      const cancelOutboxId = await enqueueLessonEmail(tx, {
        lessonId: id,
        event: "lesson_canceled",
        actorRole: isCoach ? "coach" : "parent",
      });

      // Coach alert row (ADR 031). Inside the same tx so a rollback also
      // rolls back the notification. The notify helper no-ops when the
      // actor is the coach.
      const coachNotificationId = await notifyCoachOfChange(tx, id, "canceled", {
        actorIsCoach: isCoach,
      });

      return { cancelOutboxId, coachNotificationId };
    });

    res.status(204).end();
    queueCoachNotificationSend(cancelResult.coachNotificationId);
    // Reconcile Google Calendar after the response. For a cancel this will
    // delete the event if one exists; a never-synced lesson is a safe no-op.
    queueMicrotask(() => { void syncLessonToGoogle(id); });
    queueMicrotask(() => { void sendLessonEmailOutboxRow(cancelResult.cancelOutboxId); });
  }),
);

// ── PATCH /lessons/:id ────────────────────────────────────────────────────────

lessonsRouter.patch(
  "/:id",
  requireParentOrCoach,
  validate({ body: UpdateLessonBodySchema }),
  asyncHandler(async (req, res) => {
    const id = req.params.id as string;
    const profileId = req.profile.id;
    const body = req.body as UpdateLessonBody;
    const isCoach = req.profile.role === "coach";

    let existingLesson: typeof lessons.$inferSelect | undefined;

    if (isCoach) {
      const rows = await db.select().from(lessons).where(eq(lessons.id, id)).limit(1);
      existingLesson = rows[0];
      if (!existingLesson) { res.status(404).json({ error: "Lesson not found" }); return; }
    } else {
      const memberRows = await db
        .select({ householdId: householdMembers.householdId, role: householdMembers.role })
        .from(householdMembers)
        .where(eq(householdMembers.profileId, profileId))
        .limit(1);
      const member = memberRows[0];
      if (!member || HOUSEHOLD_ROLE_RANK[member.role as HouseholdRole] < HOUSEHOLD_ROLE_RANK["manager"]) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      const rows = await db
        .select()
        .from(lessons)
        .where(and(eq(lessons.id, id), eq(lessons.householdId, member.householdId)))
        .limit(1);
      existingLesson = rows[0];
      if (!existingLesson) { res.status(404).json({ error: "Lesson not found" }); return; }
    }

    if (!["pending", "approved"].includes(existingLesson.status)) {
      res.status(422).json({ error: "lesson_not_active" });
      return;
    }

    if (!isCoach && existingLesson.startsAt <= new Date()) {
      res.status(422).json({ error: "lesson_in_past" });
      return;
    }

    const newStartsAt = body.startsAt !== undefined ? new Date(body.startsAt) : existingLesson.startsAt;
    const newDurationMinutes = (body.durationMinutes ?? existingLesson.durationMinutes) as 30 | 45 | 60;
    const newLocationId = body.locationId ?? existingLesson.locationId;
    const nowUtc = getNowUtc();

    // Compute LA calendar date — needed for the advisory lock key and computeAvailableSlots.
    const laDateParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(newStartsAt);
    const getPart = (type: string) =>
      laDateParts.find((part) => part.type === type)?.value ?? "";
    const laDateStr = `${getPart("year")}-${getPart("month")}-${getPart("day")}`;

    const [configRows, seasonRows, overrideRows] = await Promise.all([
      db.select().from(availabilityConfig).limit(1),
      db.select().from(availabilitySeasons),
      db.select().from(availabilityOverrides),
    ]);

    const config = configRows[0];
    if (!config) { res.status(503).json({ error: "Availability config not found" }); return; }

    const seasons = seasonRows.map(mapSeasonRow);
    const overrides = overrideRows.map(mapOverrideRow);

    // Booking-window checks apply only when a new start time is explicitly requested.
    if (body.startsAt !== undefined) {
      if (effectiveHours(laDateStr, seasons, overrides, config).length === 0) {
        res.status(422).json({ error: "not_a_lesson_day" });
        return;
      }
      // Coach can move a lesson inside the min-advance window; parents cannot.
      if (!isCoach) {
        const minMs = nowUtc.getTime() + config.bookingMinAdvanceHours * 60 * 60 * 1000;
        if (newStartsAt.getTime() < minMs) {
          res.status(422).json({ error: "too_soon" });
          return;
        }
        if (isAfterBookingWindow(newStartsAt, nowUtc, config.bookingMaxAdvanceWeeks)) {
          res.status(422).json({ error: "too_far" });
          return;
        }
      }
    }

    // Coach reschedules bypass the min-advance notice rule (ADR 029). Parent
    // duration/location-only edits (no new startsAt) also skip the min-advance
    // check so a lesson already inside the window isn't rejected by the
    // recheck. Parent edits with a new startsAt get the full rule — the
    // explicit check at line 931 has already enforced it.
    const skipMinAdvance = isCoach || body.startsAt === undefined;
    const noticeMs = config.bookingMinAdvanceHours * 60 * 60 * 1000;

    // Track coach-initiated reschedule so the parent sees "Moved by Jason".
    const newMovedAt = isCoach && body.startsAt !== undefined ? nowUtc : (existingLesson.movedAt ?? null);
    const newPreviousStartsAt = isCoach && body.startsAt !== undefined
      ? existingLesson.startsAt
      : (existingLesson.previousStartsAt ?? null);

    const updatedLesson = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${"lesson-day:" + laDateStr}))`,
      );

      const [blockedRows, bufferRows, existingLessonRows] = await Promise.all([
        tx.select().from(blockedTimes),
        tx.select().from(travelBufferOverrides),
        tx
          .select({
            startsAt: lessons.startsAt,
            durationMinutes: lessons.durationMinutes,
            locationId: lessons.locationId,
          })
          .from(lessons)
          .where(and(inArray(lessons.status, ["pending", "approved"]), ne(lessons.id, id))),
      ]);

      const slotParams = {
        date: laDateStr,
        durationMinutes: newDurationMinutes,
        locationId: newLocationId,
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
        nowUtc,
        skipMinAdvance,
      };
      const availableSlots = computeAvailableSlots(slotParams);

      const slotAvailable = availableSlots.some(
        (slot) => slot.startsAt.getTime() === newStartsAt.getTime(),
      );

      if (!slotAvailable) {
        const reason = diagnoseSlotRejection(slotParams, newStartsAt.getTime());
        return { rejected: true as const, reason };
      }

      let newStatus = existingLesson!.status;
      let newApprovedAt: Date | null = existingLesson!.approvedAt;
      let newApprovedBy: string | null = existingLesson!.approvedBy;
      let newExpiresAt: Date | null = existingLesson!.expiresAt;

      if (isCoach) {
        // Coach reschedule: lesson keeps its current status (approved stays approved).
        // Only update expiresAt for pending lessons whose time is being moved.
        if (body.startsAt !== undefined && existingLesson!.status === "pending") {
          newExpiresAt = new Date(newStartsAt.getTime() - noticeMs);
        }
      } else if (body.locationId !== undefined && body.locationId !== existingLesson!.locationId) {
        const approval = await needsApproval(existingLesson!.householdId, newLocationId, tx);
        if (approval) {
          newStatus = "pending";
          newExpiresAt = new Date(newStartsAt.getTime() - noticeMs);
          newApprovedAt = null;
          newApprovedBy = null;
        } else {
          newStatus = "approved";
          newApprovedAt = new Date();
          newApprovedBy = null;
          newExpiresAt = null;
        }
      } else if (body.startsAt !== undefined && existingLesson!.status === "pending") {
        newExpiresAt = new Date(newStartsAt.getTime() - noticeMs);
      }

      const updatedRows = await tx
        .update(lessons)
        .set({
          startsAt: newStartsAt,
          durationMinutes: newDurationMinutes,
          locationId: newLocationId,
          status: newStatus,
          approvedAt: newApprovedAt,
          approvedBy: newApprovedBy,
          expiresAt: newExpiresAt,
          movedAt: newMovedAt,
          previousStartsAt: newPreviousStartsAt,
        })
        .where(eq(lessons.id, id))
        .returning();

      const updated = updatedRows[0];
      if (!updated) return null;

      // Parent booking email outbox (ADR 028). The approved→pending
      // parent-reschedule case emits TWO rows so the old invite is cleaned
      // out of the calendar app and the new slot is announced as pending.
      // Every other reschedule emits one lesson_rescheduled row.
      const droppedTrust =
        existingLesson!.status === "approved" && newStatus === "pending";
      const outboxIds: string[] = [];
      if (droppedTrust) {
        outboxIds.push(
          await enqueueLessonEmail(tx, {
            lessonId: id,
            event: "lesson_canceled",
            actorRole: isCoach ? "coach" : "parent",
            describe: {
              startsAt: existingLesson!.startsAt,
              durationMinutes: existingLesson!.durationMinutes,
              locationId: existingLesson!.locationId,
              expiresAt: existingLesson!.expiresAt,
            },
          }),
        );
        outboxIds.push(
          await enqueueLessonEmail(tx, {
            lessonId: id,
            event: "booking_requested",
            actorRole: isCoach ? "coach" : "parent",
          }),
        );
      } else {
        outboxIds.push(
          await enqueueLessonEmail(tx, {
            lessonId: id,
            event: "lesson_rescheduled",
            actorRole: isCoach ? "coach" : "parent",
            previousStartsAt: existingLesson!.startsAt,
          }),
        );
      }

      // Coach alert row (ADR 031). Written in the same tx as the lesson
      // update so a rollback also rolls back the notification. No-op when
      // the actor is the coach.
      const coachNotificationId = await notifyCoachOfChange(tx, id, "rescheduled", {
        actorIsCoach: isCoach,
        previousStartsAt: existingLesson!.startsAt,
      });

      return { updated, outboxIds, coachNotificationId };
    });

    if (!updatedLesson || "rejected" in updatedLesson) {
      if (updatedLesson && "rejected" in updatedLesson) {
        req.log.warn(
          {
            event: "slot_unavailable",
            route: "PATCH /lessons/:id",
            reason: updatedLesson.reason,
            lessonId: id,
            role: isCoach ? "coach" : "parent",
            startsAt: newStartsAt.toISOString(),
            durationMinutes: newDurationMinutes,
            locationId: newLocationId,
          },
          "slot rejected on reschedule recheck",
        );
      }
      res.status(422).json({ error: "slot_unavailable" });
      return;
    }
    const rescheduleOutboxIds = updatedLesson.outboxIds;
    queueCoachNotificationSend(updatedLesson.coachNotificationId);

    const result = isCoach
      ? await loadLessonWithSwimmers(id)
      : await loadLessonWithSwimmers(id, existingLesson.householdId);
    if (!result) { res.status(404).json({ error: "Lesson not found" }); return; }
    res.json(result);
    // Reconcile Google Calendar after the response. Covers reschedule from
    // either role path, and transparently handles the status transitions a
    // parent reschedule can trigger (approved → pending re-check).
    queueMicrotask(() => { void syncLessonToGoogle(id); });
    for (const outboxId of rescheduleOutboxIds) {
      queueMicrotask(() => { void sendLessonEmailOutboxRow(outboxId); });
    }
  }),
);

// ── Helper: load lesson with swimmers ─────────────────────────────────────────

// When called from a parent-facing route, always pass householdId to scope
// the query to the caller's household and prevent cross-household data access.
// Coach routes may omit it to load any lesson by ID.
export async function loadLessonWithSwimmers(
  lessonId: string,
  householdId?: string,
): Promise<LessonResponse | null> {
  const lessonRows = await db
    .select()
    .from(lessons)
    .where(
      householdId !== undefined
        ? and(eq(lessons.id, lessonId), eq(lessons.householdId, householdId))
        : eq(lessons.id, lessonId),
    )
    .limit(1);

  const lesson = lessonRows[0];
  if (!lesson) return null;

  const swimmerRows = await db
    .select({ swimmerId: lessonSwimmers.swimmerId, firstName: swimmers.firstName, lastName: swimmers.lastName })
    .from(lessonSwimmers)
    .innerJoin(swimmers, eq(lessonSwimmers.swimmerId, swimmers.id))
    .where(eq(lessonSwimmers.lessonId, lessonId));

  return {
    id: lesson.id,
    householdId: lesson.householdId,
    locationId: lesson.locationId,
    startsAt: lesson.startsAt.toISOString(),
    durationMinutes: lesson.durationMinutes as 30 | 45 | 60,
    type: lesson.type,
    status: lesson.status,
    swimmers: swimmerRows.map((row) => ({
      swimmerId: row.swimmerId,
      firstName: row.firstName,
      lastName: row.lastName,
    })),
    expiresAt: lesson.expiresAt?.toISOString() ?? null,
    approvedAt: lesson.approvedAt?.toISOString() ?? null,
    declinedAt: lesson.declinedAt?.toISOString() ?? null,
    declineReason: lesson.declineReason ?? null,
    movedAt: lesson.movedAt?.toISOString() ?? null,
    previousStartsAt: lesson.previousStartsAt?.toISOString() ?? null,
    createdAt: lesson.createdAt.toISOString(),
  };
}

// ── Range availability helpers ────────────────────────────────────────────────

function addDaysToDate(dateStr: string, days: number): string {
  const year = Number(dateStr.slice(0, 4));
  const month = Number(dateStr.slice(5, 7));
  const day = Number(dateStr.slice(8, 10));
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function getRangeDays(view: "week" | "month", date: string): string[] {
  if (view === "week") {
    const isoDay = getISODayOfWeek(date);
    const monday = addDaysToDate(date, 1 - isoDay);
    return Array.from({ length: 7 }, (_, index) => addDaysToDate(monday, index));
  }
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const firstOfMonth = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastOfMonth = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const gridStart = addDaysToDate(firstOfMonth, 1 - getISODayOfWeek(firstOfMonth));
  const gridEnd = addDaysToDate(lastOfMonth, 7 - getISODayOfWeek(lastOfMonth));
  const result: string[] = [];
  let current = gridStart;
  while (current <= gridEnd) {
    result.push(current);
    current = addDaysToDate(current, 1);
  }
  return result;
}

function computeDayState(
  date: string,
  isTeachingDay: boolean,
  todayDateLA: string,
  maxAdvanceDateLA: string,
): DayState {
  if (!isTeachingDay) return "closed";
  if (date < todayDateLA) return "past";
  if (date > maxAdvanceDateLA) return "not_open_yet";
  return "open";
}
