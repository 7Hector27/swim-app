import { type RequestHandler, Router } from "express";
import { and, asc, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type {
  AvailableSlot,
  AvailableSlotsQuery,
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
  WeekAvailabilityResponse,
  WeekDayAvailability,
} from "@swim-app/shared";
import { AvailableSlotsQuerySchema, CreateLessonBodySchema, HOUSEHOLD_ROLE_RANK, RangeAvailabilityQuerySchema, UpdateLessonBodySchema, UpcomingLessonsQuerySchema } from "@swim-app/shared";
import { db } from "../db/client";
import {
  availabilityConfig,
  availabilityOverrides,
  availabilitySeasons,
  blockedTimes,
  householdMembers,
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
import { classifyDaySlots, computeAvailableSlots, getDateInLA, getISODayOfWeek } from "../lib/slots";
import { effectiveHours } from "../lib/effectiveHours";
import { mapConfigRow, mapSeasonRow, mapOverrideRow } from "../lib/availabilityMappers";
import { needsApproval, notifyBookingCreated, notifyCoachOfChange } from "../lib/lessonApproval";
import { syncLessonToGoogle } from "../services/googleCalendarSync";
import { enqueueLessonEmail } from "../services/emails/outbox";
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
    };

    const lessonRows = filter === "past"
      ? await db
          .select(selectShape)
          .from(lessons)
          .innerJoin(lessonLocations, eq(lessons.locationId, lessonLocations.id))
          .where(
            and(
              eq(lessons.householdId, householdId),
              sql`${lessons.startsAt} + ${lessons.durationMinutes} * interval '1 minute' <= ${now.toISOString()}::timestamptz`,
            ),
          )
          .orderBy(desc(lessons.startsAt))
          .limit(limit)
          .offset(offset)
      : await db
          .select(selectShape)
          .from(lessons)
          .innerJoin(lessonLocations, eq(lessons.locationId, lessonLocations.id))
          .where(
            and(
              eq(lessons.householdId, householdId),
              inArray(lessons.status, ["pending", "approved"]),
              sql`${lessons.startsAt} + ${lessons.durationMinutes} * interval '1 minute' > ${now.toISOString()}::timestamptz`,
            ),
          )
          .orderBy(asc(lessons.startsAt))
          .limit(limit)
          .offset(offset);

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
    }));

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
      nowUtc: new Date(),
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

    const nowUtc = new Date();
    const todayDateLA = getDateInLA(nowUtc);
    const maxAdvanceDateLA = getDateInLA(
      new Date(nowUtc.getTime() + config.bookingMaxAdvanceWeeks * 7 * 24 * 60 * 60 * 1000),
    );

    const sharedClassifyParams = {
      locationId: query.locationId,
      durationMinutes: query.durationMinutes,
      existingLessons: filteredLessons.map((row) => ({
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
      nowUtc,
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
      const body: WeekAvailabilityResponse = { needsApproval: approvalRequired, days: responseDays };
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
      const body: MonthAvailabilityResponse = { needsApproval: approvalRequired, days: responseDays };
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
  validate({ body: CreateLessonBodySchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as CreateLessonBody;
    const { householdId } = req;
    const profileId = req.profile.id;

    const startsAt = new Date(body.startsAt);
    const nowUtc = new Date();

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
    const maxMs = nowUtc.getTime() + config.bookingMaxAdvanceWeeks * 7 * 24 * 60 * 60 * 1000;

    if (startsAt.getTime() < minMs) {
      res.status(422).json({ error: "too_soon" });
      return;
    }
    if (startsAt.getTime() > maxMs) {
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

      const availableSlots = computeAvailableSlots({
        date: laDateStr,
        durationMinutes: body.durationMinutes,
        locationId: body.locationId,
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
        nowUtc,
      });

      const slotAvailable = availableSlots.some(
        (slot) => slot.startsAt.getTime() === startsAt.getTime(),
      );

      if (!slotAvailable) {
        return null;
      }

      // Check lesson_days — computeAvailableSlots already does this, but we
      // want a specific error code for it vs. a general slot_unavailable.
      // If slot not available, could be because the day is invalid or the slot
      // is taken; we handle both as slot_unavailable per plan.

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
            ? { expiresAt: new Date(startsAt.getTime() - 16 * 60 * 60 * 1000) }
            : { approvedAt: now, approvedBy: null }),
        })
        .returning();

      const inserted = insertedRows[0]!;

      await tx.insert(lessonSwimmers).values(
        body.swimmerIds.map((swimmerId) => ({ lessonId: inserted.id, swimmerId })),
      );

      // Parent booking email outbox (ADR 028). Auto-approved bookings get
      // the confirmed email directly; never a request-received email on top.
      await enqueueLessonEmail(tx, {
        lessonId: inserted.id,
        event: inserted.status === "approved" ? "lesson_confirmed" : "booking_requested",
        actorRole: "parent",
      });

      return inserted;
    });

    if (!newLesson) {
      res.status(422).json({ error: "slot_unavailable" });
      return;
    }

    notifyBookingCreated(newLesson.id, newLesson.status === "approved");

    // Fetch swimmers for response.
    const swimmerResponseRows = await db
      .select({ swimmerId: lessonSwimmers.swimmerId, firstName: swimmers.firstName, lastName: swimmers.lastName })
      .from(lessonSwimmers)
      .innerJoin(swimmers, eq(lessonSwimmers.swimmerId, swimmers.id))
      .where(eq(lessonSwimmers.lessonId, newLesson.id));

    const lessonSwimmerList: LessonSwimmer[] = swimmerResponseRows.map((row) => ({
      swimmerId: row.swimmerId,
      firstName: row.firstName,
      lastName: row.lastName,
    }));

    const responseBody: LessonResponse = {
      id: newLesson.id,
      householdId: newLesson.householdId,
      locationId: newLesson.locationId,
      startsAt: newLesson.startsAt.toISOString(),
      durationMinutes: newLesson.durationMinutes as 30 | 45 | 60,
      type: newLesson.type,
      status: newLesson.status,
      swimmers: lessonSwimmerList,
      expiresAt: newLesson.expiresAt?.toISOString() ?? null,
      approvedAt: newLesson.approvedAt?.toISOString() ?? null,
      declinedAt: null,
      declineReason: null,
      movedAt: null,
      previousStartsAt: null,
      createdAt: newLesson.createdAt.toISOString(),
    };

    res.status(201).json(responseBody);
    // A new booking can be created directly in status='approved' when the
    // household's auto-approval rule fires (ADR 021). The reconcile is a
    // no-op for pending bookings but required for auto-approved ones, so
    // fire the microtask unconditionally — mirrors the other lesson routes.
    queueMicrotask(() => { void syncLessonToGoogle(newLesson.id); });
  }),
);

// ── GET /lessons/count ───────────────────────────────────────────────────────

lessonsRouter.get(
  "/count",
  requireParent,
  requireHouseholdMember,
  validate({}),
  asyncHandler(async (req, res) => {
    const { householdId } = req;
    const now = new Date();
    const rows = await db
      .select({ count: count() })
      .from(lessons)
      .where(
        and(
          eq(lessons.householdId, householdId),
          inArray(lessons.status, ["pending", "approved"]),
          sql`${lessons.startsAt} + ${lessons.durationMinutes} * interval '1 minute' > ${now.toISOString()}::timestamptz`,
        ),
      );
    res.json({ count: Number(rows[0]?.count ?? 0) });
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
      })
      .from(lessons)
      .innerJoin(lessonLocations, eq(lessons.locationId, lessonLocations.id))
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

    await db.transaction(async (tx) => {
      await tx
        .update(lessons)
        .set({ status: "canceled", canceledAt: new Date(), canceledBy: profileId })
        .where(eq(lessons.id, id));

      // Parent booking email outbox (ADR 028). Writes CANCEL .ics iff a
      // prior invite was issued; sends a plain-content email otherwise.
      await enqueueLessonEmail(tx, {
        lessonId: id,
        event: "lesson_canceled",
        actorRole: isCoach ? "coach" : "parent",
      });
    });

    notifyCoachOfChange(id);
    res.status(204).end();
    // Reconcile Google Calendar after the response. For a cancel this will
    // delete the event if one exists; a never-synced lesson is a safe no-op.
    queueMicrotask(() => { void syncLessonToGoogle(id); });
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
    const nowUtc = new Date();

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
        const maxMs = nowUtc.getTime() + config.bookingMaxAdvanceWeeks * 7 * 24 * 60 * 60 * 1000;
        if (newStartsAt.getTime() < minMs) {
          res.status(422).json({ error: "too_soon" });
          return;
        }
        if (newStartsAt.getTime() > maxMs) {
          res.status(422).json({ error: "too_far" });
          return;
        }
      }
    }

    // For honor-system edits (no new startsAt), shift the slot-check clock backward
    // so the existing time appears inside the booking window to computeAvailableSlots.
    // Coach can also pick near-future slots — use epoch to open all teaching-hour slots.
    const nowForSlotCheck = isCoach
      ? new Date(0)
      : body.startsAt !== undefined
        ? nowUtc
        : new Date(newStartsAt.getTime() - (config.bookingMinAdvanceHours + 1) * 60 * 60 * 1000);

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

      const availableSlots = computeAvailableSlots({
        date: laDateStr,
        durationMinutes: newDurationMinutes,
        locationId: newLocationId,
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
        nowUtc: nowForSlotCheck,
      });

      const slotAvailable = availableSlots.some(
        (slot) => slot.startsAt.getTime() === newStartsAt.getTime(),
      );

      if (!slotAvailable) return null;

      let newStatus = existingLesson!.status;
      let newApprovedAt: Date | null = existingLesson!.approvedAt;
      let newApprovedBy: string | null = existingLesson!.approvedBy;
      let newExpiresAt: Date | null = existingLesson!.expiresAt;

      if (isCoach) {
        // Coach reschedule: lesson keeps its current status (approved stays approved).
        // Only update expiresAt for pending lessons whose time is being moved.
        if (body.startsAt !== undefined && existingLesson!.status === "pending") {
          newExpiresAt = new Date(newStartsAt.getTime() - 16 * 60 * 60 * 1000);
        }
      } else if (body.locationId !== undefined && body.locationId !== existingLesson!.locationId) {
        const approval = await needsApproval(existingLesson!.householdId, newLocationId, tx);
        if (approval) {
          newStatus = "pending";
          newExpiresAt = new Date(newStartsAt.getTime() - 16 * 60 * 60 * 1000);
          newApprovedAt = null;
          newApprovedBy = null;
        } else {
          newStatus = "approved";
          newApprovedAt = new Date();
          newApprovedBy = null;
          newExpiresAt = null;
        }
      } else if (body.startsAt !== undefined && existingLesson!.status === "pending") {
        newExpiresAt = new Date(newStartsAt.getTime() - 16 * 60 * 60 * 1000);
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
      if (droppedTrust) {
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
        });
        await enqueueLessonEmail(tx, {
          lessonId: id,
          event: "booking_requested",
          actorRole: isCoach ? "coach" : "parent",
        });
      } else {
        await enqueueLessonEmail(tx, {
          lessonId: id,
          event: "lesson_rescheduled",
          actorRole: isCoach ? "coach" : "parent",
          previousStartsAt: existingLesson!.startsAt,
        });
      }

      return updated;
    });

    if (!updatedLesson) {
      res.status(422).json({ error: "slot_unavailable" });
      return;
    }

    notifyCoachOfChange(id);

    const result = isCoach
      ? await loadLessonWithSwimmers(id)
      : await loadLessonWithSwimmers(id, existingLesson.householdId);
    if (!result) { res.status(404).json({ error: "Lesson not found" }); return; }
    res.json(result);
    // Reconcile Google Calendar after the response. Covers reschedule from
    // either role path, and transparently handles the status transitions a
    // parent reschedule can trigger (approved → pending re-check).
    queueMicrotask(() => { void syncLessonToGoogle(id); });
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
