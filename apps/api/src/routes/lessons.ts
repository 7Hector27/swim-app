import { Router } from "express";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type {
  AvailableSlot,
  AvailableSlotsQuery,
  CreateLessonBody,
  HouseholdRole,
  LessonResponse,
  LessonSwimmer,
  UpdateLessonBody,
  UpcomingLesson,
  UpcomingLessonsQuery,
} from "@swim-app/shared";
import { AvailableSlotsQuerySchema, CreateLessonBodySchema, HOUSEHOLD_ROLE_RANK, UpdateLessonBodySchema, UpcomingLessonsQuerySchema } from "@swim-app/shared";
import { db } from "../db/client";
import {
  availabilityConfig,
  blockedTimes,
  householdMembers,
  lessonLocations,
  lessonSwimmers,
  lessons,
  seasonSummerEndDates,
  swimmers,
  travelBufferOverrides,
} from "../db/schema";
import { requireUser } from "../middleware/requireUser";
import { requireParent } from "../middleware/requireParent";
import { requireHouseholdMember } from "../middleware/requireHouseholdMember";
import { requireHouseholdRole } from "../middleware/requireHouseholdRole";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/asyncHandler";
import { computeAvailableSlots } from "../lib/slots";
import { needsApproval, notifyBookingCreated, notifyCoachOfChange } from "../lib/lessonApproval";
import { isActiveSwimmer } from "../db/queries";

export const lessonsRouter = Router();

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

    const afterDate = query.after
      ? new Date(Math.max(new Date(query.after).getTime(), now.getTime()))
      : now;

    const limit = query.limit ?? 20;

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
        createdAt: lessons.createdAt,
      })
      .from(lessons)
      .innerJoin(lessonLocations, eq(lessons.locationId, lessonLocations.id))
      .where(
        and(
          eq(lessons.householdId, householdId),
          inArray(lessons.status, ["pending", "approved"]),
          sql`${lessons.startsAt} >= ${afterDate.toISOString()}`,
        ),
      )
      .orderBy(asc(lessons.startsAt))
      .limit(limit);

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

    const [configRows, blockedRows, bufferRows, existingLessonRows, endDateRow] =
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
        db
          .select({ endDate: seasonSummerEndDates.endDate })
          .from(seasonSummerEndDates)
          .where(eq(seasonSummerEndDates.year, parseInt(query.date.slice(0, 4), 10)))
          .limit(1),
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
      nowUtc: new Date(),
    });

    const body: AvailableSlot[] = slots.map((slot) => ({
      startsAt: slot.startsAt.toISOString(),
    }));

    res.json(body);
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
    // Computed before the config fetch so laYear can be used for the
    // season_summer_end_dates lookup (Jan 1 UTC can still be Dec 31 LA).
    const laDateParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(startsAt);
    const getPart = (type: string) =>
      laDateParts.find((p) => p.type === type)?.value ?? "";
    const laDateStr = `${getPart("year")}-${getPart("month")}-${getPart("day")}`;
    const laYear = Number(laDateStr.slice(0, 4));
    const laMonth = Number(laDateStr.slice(5, 7));
    const laDay = Number(laDateStr.slice(8, 10));
    const jsDay = new Date(Date.UTC(laYear, laMonth - 1, laDay, 12)).getUTCDay();
    const isoDayOfWeek = jsDay === 0 ? 7 : jsDay;

    // ── Fetch availability config ─────────────────────────────────────────────
    const [configRows, endDateRow] = await Promise.all([
      db.select().from(availabilityConfig).limit(1),
      db
        .select({ endDate: seasonSummerEndDates.endDate })
        .from(seasonSummerEndDates)
        .where(eq(seasonSummerEndDates.year, laYear))
        .limit(1),
    ]);

    const config = configRows[0];
    if (!config) {
      res.status(503).json({ error: "Availability config not found" });
      return;
    }

    // ── Booking window validation (pre-lock) ──────────────────────────────────

    if (!config.lessonDays.includes(isoDayOfWeek)) {
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
      createdAt: newLesson.createdAt.toISOString(),
    };

    res.status(201).json(responseBody);
  }),
);

// ── GET /lessons/:id ──────────────────────────────────────────────────────────

lessonsRouter.get(
  "/:id",
  requireParent,
  requireHouseholdMember,
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
      createdAt: lessonRow.createdAt.toISOString(),
    };

    res.json(body);
  }),
);

// ── DELETE /lessons/:id ───────────────────────────────────────────────────────

lessonsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = req.params.id as string;
    const profileId = req.profile.id;

    let lessonHouseholdId: string;

    if (req.profile.role === "coach") {
      const rows = await db.select().from(lessons).where(eq(lessons.id, id)).limit(1);
      const lesson = rows[0];
      if (!lesson) { res.status(404).json({ error: "Lesson not found" }); return; }
      if (!["pending", "approved"].includes(lesson.status)) {
        res.status(422).json({ error: "lesson_not_active" });
        return;
      }
      lessonHouseholdId = lesson.householdId;
    } else {
      const memberRows = await db
        .select({ householdId: householdMembers.householdId, role: householdMembers.role })
        .from(householdMembers)
        .where(eq(householdMembers.profileId, profileId))
        .limit(1);
      const member = memberRows[0];
      if (!member) { res.status(403).json({ error: "Forbidden" }); return; }
      if (HOUSEHOLD_ROLE_RANK[member.role as HouseholdRole] < HOUSEHOLD_ROLE_RANK["manager"]) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      const lessonRows = await db
        .select()
        .from(lessons)
        .where(and(eq(lessons.id, id), eq(lessons.householdId, member.householdId)))
        .limit(1);
      const lesson = lessonRows[0];
      if (!lesson) { res.status(404).json({ error: "Lesson not found" }); return; }
      if (!["pending", "approved"].includes(lesson.status)) {
        res.status(422).json({ error: "lesson_not_active" });
        return;
      }
      lessonHouseholdId = lesson.householdId;
    }

    void lessonHouseholdId;

    await db
      .update(lessons)
      .set({ status: "canceled", canceledAt: new Date(), canceledBy: profileId })
      .where(eq(lessons.id, id));

    notifyCoachOfChange(id);

    res.status(204).end();
  }),
);

// ── PATCH /lessons/:id ────────────────────────────────────────────────────────

lessonsRouter.patch(
  "/:id",
  validate({ body: UpdateLessonBodySchema }),
  asyncHandler(async (req, res) => {
    const id = req.params.id as string;
    const profileId = req.profile.id;
    const body = req.body as UpdateLessonBody;

    let existingLesson: typeof lessons.$inferSelect | undefined;

    if (req.profile.role === "coach") {
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
      if (!member) { res.status(403).json({ error: "Forbidden" }); return; }
      if (HOUSEHOLD_ROLE_RANK[member.role as HouseholdRole] < HOUSEHOLD_ROLE_RANK["manager"]) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      const lessonRows = await db
        .select()
        .from(lessons)
        .where(and(eq(lessons.id, id), eq(lessons.householdId, member.householdId)))
        .limit(1);
      existingLesson = lessonRows[0];
      if (!existingLesson) { res.status(404).json({ error: "Lesson not found" }); return; }
    }

    if (!["pending", "approved"].includes(existingLesson.status)) {
      res.status(422).json({ error: "lesson_not_active" });
      return;
    }

    const newDurationMinutes = (body.durationMinutes ?? existingLesson.durationMinutes) as 30 | 45 | 60;
    const newLocationId = body.locationId ?? existingLesson.locationId;

    if (body.startsAt !== undefined) {
      const newStartsAt = new Date(body.startsAt);
      const nowUtc = new Date();

      // Compute LA date of new slot
      const laDateParts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(newStartsAt);
      const getPart = (type: string) =>
        laDateParts.find((part) => part.type === type)?.value ?? "";
      const laDateStr = `${getPart("year")}-${getPart("month")}-${getPart("day")}`;
      const laYear = Number(laDateStr.slice(0, 4));
      const laMonth = Number(laDateStr.slice(5, 7));
      const laDay = Number(laDateStr.slice(8, 10));
      const jsDay = new Date(Date.UTC(laYear, laMonth - 1, laDay, 12)).getUTCDay();
      const isoDayOfWeek = jsDay === 0 ? 7 : jsDay;

      const [configRows, endDateRow] = await Promise.all([
        db.select().from(availabilityConfig).limit(1),
        db
          .select({ endDate: seasonSummerEndDates.endDate })
          .from(seasonSummerEndDates)
          .where(eq(seasonSummerEndDates.year, laYear))
          .limit(1),
      ]);

      const config = configRows[0];
      if (!config) { res.status(503).json({ error: "Availability config not found" }); return; }

      if (!config.lessonDays.includes(isoDayOfWeek)) {
        res.status(422).json({ error: "not_a_lesson_day" });
        return;
      }

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
          nowUtc,
        });

        const slotAvailable = availableSlots.some(
          (slot) => slot.startsAt.getTime() === newStartsAt.getTime(),
        );

        if (!slotAvailable) {
          return null;
        }

        let newStatus = existingLesson!.status;
        let newApprovedAt: Date | null = existingLesson!.approvedAt;
        let newApprovedBy: string | null = existingLesson!.approvedBy;
        let newExpiresAt: Date | null = existingLesson!.expiresAt;

        if (body.locationId !== undefined && body.locationId !== existingLesson!.locationId) {
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
        } else if (existingLesson!.status === "pending") {
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
          })
          .where(eq(lessons.id, id))
          .returning();

        return updatedRows[0] ?? null;
      });

      if (!updatedLesson) {
        res.status(422).json({ error: "slot_unavailable" });
        return;
      }
    } else {
      // No new startsAt — only location or duration changes
      if (body.locationId !== undefined && body.locationId !== existingLesson.locationId) {
        await db.transaction(async (tx) => {
          const approval = await needsApproval(existingLesson!.householdId, newLocationId, tx);
          let newStatus = existingLesson!.status;
          let newApprovedAt: Date | null = existingLesson!.approvedAt;
          let newApprovedBy: string | null = existingLesson!.approvedBy;
          let newExpiresAt: Date | null = existingLesson!.expiresAt;

          if (approval) {
            newStatus = "pending";
            newExpiresAt = new Date(existingLesson!.startsAt.getTime() - 16 * 60 * 60 * 1000);
            newApprovedAt = null;
            newApprovedBy = null;
          } else {
            newStatus = "approved";
            newApprovedAt = new Date();
            newApprovedBy = null;
            newExpiresAt = null;
          }

          await tx
            .update(lessons)
            .set({
              durationMinutes: newDurationMinutes,
              locationId: newLocationId,
              status: newStatus,
              approvedAt: newApprovedAt,
              approvedBy: newApprovedBy,
              expiresAt: newExpiresAt,
            })
            .where(eq(lessons.id, id));
        });
      } else {
        await db
          .update(lessons)
          .set({ durationMinutes: newDurationMinutes, locationId: newLocationId })
          .where(eq(lessons.id, id));
      }
    }

    notifyCoachOfChange(id);

    const result = await loadLessonWithSwimmers(id);
    if (!result) { res.status(404).json({ error: "Lesson not found" }); return; }
    res.json(result);
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
    createdAt: lesson.createdAt.toISOString(),
  };
}
