import { Router } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type {
  AvailableSlot,
  AvailableSlotsQuery,
  CreateLessonBody,
  LessonResponse,
  LessonSwimmer,
} from "@swim-app/shared";
import { AvailableSlotsQuerySchema, CreateLessonBodySchema } from "@swim-app/shared";
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
import { requireUser } from "../middleware/requireUser";
import { requireParent } from "../middleware/requireParent";
import { requireHouseholdMember } from "../middleware/requireHouseholdMember";
import { requireHouseholdRole } from "../middleware/requireHouseholdRole";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/asyncHandler";
import { computeAvailableSlots } from "../lib/slots";
import { needsApproval, notifyBookingCreated } from "../lib/lessonApproval";
import { isActiveSwimmer } from "../db/queries";

export const lessonsRouter = Router();

lessonsRouter.use(requireUser, requireParent, requireHouseholdMember);

// ── GET /lessons/available-slots ──────────────────────────────────────────────

lessonsRouter.get(
  "/available-slots",
  validate({ query: AvailableSlotsQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as AvailableSlotsQuery;

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

    // ── Fetch availability config ─────────────────────────────────────────────
    const [configRows, endDateRow] = await Promise.all([
      db.select().from(availabilityConfig).limit(1),
      db
        .select({ endDate: seasonSummerEndDates.endDate })
        .from(seasonSummerEndDates)
        .where(eq(seasonSummerEndDates.year, startsAt.getUTCFullYear()))
        .limit(1),
    ]);

    const config = configRows[0];
    if (!config) {
      res.status(503).json({ error: "Availability config not found" });
      return;
    }

    // ── Booking window validation (pre-lock) ──────────────────────────────────

    // Derive the calendar date in America/Los_Angeles from startsAt, then
    // compute ISO day-of-week (1=Mon … 7=Sun) to check lesson_days.
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
        sql`SELECT pg_advisory_xact_lock(hashtext(${"lesson-day:" + body.startsAt.slice(0, 10)}))`,
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
        date: body.startsAt.slice(0, 10),
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

// ── Helper: load lesson with swimmers ─────────────────────────────────────────

export async function loadLessonWithSwimmers(lessonId: string): Promise<LessonResponse | null> {
  const lessonRows = await db
    .select()
    .from(lessons)
    .where(eq(lessons.id, lessonId))
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
