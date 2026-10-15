import { Router } from "express";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type {
  LessonLocation,
  AvailabilityConfig,
  BlockedTime,
  TravelBufferOverride,
  SeasonSummerEndDate,
  CreateLocationBody,
  PatchLocationBody,
  PatchAvailabilityConfigBody,
  CreateBlockedTimeBody,
  UpsertTravelBufferBody,
  SetSeasonEndDateBody,
} from "@swim-app/shared";
import {
  CreateLocationBodySchema,
  PatchLocationBodySchema,
  PatchAvailabilityConfigBodySchema,
  CreateBlockedTimeBodySchema,
  UpsertTravelBufferBodySchema,
  SetSeasonEndDateBodySchema,
} from "@swim-app/shared";
import { db } from "../db/client";
import {
  lessonLocations,
  availabilityConfig,
  blockedTimes,
  travelBufferOverrides,
  seasonSummerEndDates,
} from "../db/schema";
import { requireUser } from "../middleware/requireUser";
import { requireCoach } from "../middleware/requireCoach";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/asyncHandler";
import { z } from "zod";

export const coachAvailabilityRouter = Router();

coachAvailabilityRouter.use(requireUser, requireCoach);

// ── Locations ─────────────────────────────────────────────────────────────────

coachAvailabilityRouter.get(
  "/locations",
  validate({}),
  asyncHandler(async (_req, res) => {
    const rows = await db
      .select()
      .from(lessonLocations)
      .where(isNull(lessonLocations.householdId))
      .orderBy(lessonLocations.sortOrder);

    const body: LessonLocation[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      address: row.address,
      city: row.city,
      state: row.state,
      zip: row.zip,
      isHomePool: false,
      isActive: row.isActive,
      sortOrder: row.sortOrder,
    }));

    res.json(body);
  }),
);

coachAvailabilityRouter.post(
  "/locations",
  validate({ body: CreateLocationBodySchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as CreateLocationBody;

    const rows = await db
      .insert(lessonLocations)
      .values({
        name: body.name,
        address: body.address,
        city: body.city,
        state: body.state,
        zip: body.zip,
        householdId: null,
        isActive: true,
        sortOrder: body.sortOrder,
      })
      .returning();

    const newLocation = rows[0]!;

    const responseBody: LessonLocation = {
      id: newLocation.id,
      name: newLocation.name,
      address: newLocation.address,
      city: newLocation.city,
      state: newLocation.state,
      zip: newLocation.zip,
      isHomePool: false,
      isActive: newLocation.isActive,
      sortOrder: newLocation.sortOrder,
    };

    res.status(201).json(responseBody);
  }),
);

const LocationIdParamsSchema = z.object({ id: z.string().uuid() });

coachAvailabilityRouter.patch(
  "/locations/:id",
  validate({ params: LocationIdParamsSchema, body: PatchLocationBodySchema }),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const body = req.body as PatchLocationBody;

    const rows = await db
      .update(lessonLocations)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.address !== undefined && { address: body.address }),
        ...(body.city !== undefined && { city: body.city }),
        ...(body.state !== undefined && { state: body.state }),
        ...(body.zip !== undefined && { zip: body.zip }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
        ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
      })
      .where(and(eq(lessonLocations.id, id), isNull(lessonLocations.householdId)))
      .returning();

    const updated = rows[0];
    if (!updated) {
      res.status(404).json({ error: "Location not found" });
      return;
    }

    const responseBody: LessonLocation = {
      id: updated.id,
      name: updated.name,
      address: updated.address,
      city: updated.city,
      state: updated.state,
      zip: updated.zip,
      isHomePool: updated.householdId !== null,
      isActive: updated.isActive,
      sortOrder: updated.sortOrder,
    };

    res.json(responseBody);
  }),
);

// ── Availability config ───────────────────────────────────────────────────────

coachAvailabilityRouter.get(
  "/availability-config",
  validate({}),
  asyncHandler(async (_req, res) => {
    const rows = await db.select().from(availabilityConfig).limit(1);
    const config = rows[0];

    if (!config) {
      res.status(404).json({ error: "Availability config not found" });
      return;
    }

    const body: AvailabilityConfig = {
      id: config.id,
      lessonDays: config.lessonDays,
      schoolYearStartTime: config.schoolYearStartTime.slice(0, 5),
      schoolYearEndTime: config.schoolYearEndTime.slice(0, 5),
      summerMorningStartTime: config.summerMorningStartTime.slice(0, 5),
      summerMorningEndTime: config.summerMorningEndTime.slice(0, 5),
      summerEveningStartTime: config.summerEveningStartTime.slice(0, 5),
      summerEveningEndTime: config.summerEveningEndTime.slice(0, 5),
      maxDailyLessonMinutes: config.maxDailyLessonMinutes,
      bookingMinAdvanceHours: config.bookingMinAdvanceHours,
      bookingMaxAdvanceWeeks: config.bookingMaxAdvanceWeeks,
    };

    res.json(body);
  }),
);

coachAvailabilityRouter.patch(
  "/availability-config",
  validate({ body: PatchAvailabilityConfigBodySchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as PatchAvailabilityConfigBody;

    // 1. absolute bounds — validate before DB read
    if (body.lessonDays !== undefined) {
      const hasWeekend = body.lessonDays.some((day) => day > 5);
      if (hasWeekend) {
        res.status(422).json({ error: "lesson_days must contain only weekday numbers (1–5)" });
        return;
      }
    }

    if (body.summerMorningEndTime !== undefined && body.summerMorningEndTime > "15:00") {
      res.status(422).json({ error: "summerMorningEndTime must be at or before 15:00" });
      return;
    }

    if (body.summerEveningStartTime !== undefined && body.summerEveningStartTime < "19:00") {
      res.status(422).json({ error: "summerEveningStartTime must be at or after 19:00" });
      return;
    }

    // 2. fetch existing (needed for merged cross-field validation)
    const existing = await db.select().from(availabilityConfig).limit(1);
    if (!existing[0]) {
      res.status(404).json({ error: "Availability config not found" });
      return;
    }

    // 3. merge patch with existing, then validate every start < end
    const merged = {
      schoolYearStartTime: body.schoolYearStartTime ?? existing[0].schoolYearStartTime,
      schoolYearEndTime: body.schoolYearEndTime ?? existing[0].schoolYearEndTime,
      summerMorningStartTime: body.summerMorningStartTime ?? existing[0].summerMorningStartTime,
      summerMorningEndTime: body.summerMorningEndTime ?? existing[0].summerMorningEndTime,
      summerEveningStartTime: body.summerEveningStartTime ?? existing[0].summerEveningStartTime,
      summerEveningEndTime: body.summerEveningEndTime ?? existing[0].summerEveningEndTime,
    };

    if (merged.schoolYearStartTime >= merged.schoolYearEndTime) {
      res.status(422).json({ error: "schoolYearStartTime must be before schoolYearEndTime" });
      return;
    }
    if (merged.summerMorningStartTime >= merged.summerMorningEndTime) {
      res.status(422).json({ error: "summerMorningStartTime must be before summerMorningEndTime" });
      return;
    }
    if (merged.summerEveningStartTime >= merged.summerEveningEndTime) {
      res.status(422).json({ error: "summerEveningStartTime must be before summerEveningEndTime" });
      return;
    }

    // 4. apply update
    const rows = await db
      .update(availabilityConfig)
      .set({
        ...(body.lessonDays !== undefined && { lessonDays: body.lessonDays }),
        ...(body.schoolYearStartTime !== undefined && { schoolYearStartTime: body.schoolYearStartTime }),
        ...(body.schoolYearEndTime !== undefined && { schoolYearEndTime: body.schoolYearEndTime }),
        ...(body.summerMorningStartTime !== undefined && { summerMorningStartTime: body.summerMorningStartTime }),
        ...(body.summerMorningEndTime !== undefined && { summerMorningEndTime: body.summerMorningEndTime }),
        ...(body.summerEveningStartTime !== undefined && { summerEveningStartTime: body.summerEveningStartTime }),
        ...(body.summerEveningEndTime !== undefined && { summerEveningEndTime: body.summerEveningEndTime }),
        ...(body.maxDailyLessonMinutes !== undefined && { maxDailyLessonMinutes: body.maxDailyLessonMinutes }),
        ...(body.bookingMinAdvanceHours !== undefined && { bookingMinAdvanceHours: body.bookingMinAdvanceHours }),
        ...(body.bookingMaxAdvanceWeeks !== undefined && { bookingMaxAdvanceWeeks: body.bookingMaxAdvanceWeeks }),
      })
      .where(eq(availabilityConfig.id, existing[0].id))
      .returning();

    const updated = rows[0]!;

    const responseBody: AvailabilityConfig = {
      id: updated.id,
      lessonDays: updated.lessonDays,
      schoolYearStartTime: updated.schoolYearStartTime.slice(0, 5),
      schoolYearEndTime: updated.schoolYearEndTime.slice(0, 5),
      summerMorningStartTime: updated.summerMorningStartTime.slice(0, 5),
      summerMorningEndTime: updated.summerMorningEndTime.slice(0, 5),
      summerEveningStartTime: updated.summerEveningStartTime.slice(0, 5),
      summerEveningEndTime: updated.summerEveningEndTime.slice(0, 5),
      maxDailyLessonMinutes: updated.maxDailyLessonMinutes,
      bookingMinAdvanceHours: updated.bookingMinAdvanceHours,
      bookingMaxAdvanceWeeks: updated.bookingMaxAdvanceWeeks,
    };

    res.json(responseBody);
  }),
);

// ── Blocked times ─────────────────────────────────────────────────────────────

coachAvailabilityRouter.get(
  "/blocked-times",
  validate({}),
  asyncHandler(async (_req, res) => {
    const rows = await db
      .select()
      .from(blockedTimes)
      .orderBy(asc(blockedTimes.startsAt));

    const body: BlockedTime[] = rows.map((row) => ({
      id: row.id,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      note: row.note ?? null,
      createdAt: row.createdAt.toISOString(),
    }));

    res.json(body);
  }),
);

coachAvailabilityRouter.post(
  "/blocked-times",
  validate({ body: CreateBlockedTimeBodySchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as CreateBlockedTimeBody;

    if (body.endsAt <= body.startsAt) {
      res.status(422).json({ error: "endsAt must be after startsAt" });
      return;
    }

    const rows = await db
      .insert(blockedTimes)
      .values({
        startsAt: new Date(body.startsAt),
        endsAt: new Date(body.endsAt),
        ...(body.note !== undefined && { note: body.note }),
      })
      .returning();

    const created = rows[0]!;

    const responseBody: BlockedTime = {
      id: created.id,
      startsAt: created.startsAt.toISOString(),
      endsAt: created.endsAt.toISOString(),
      note: created.note ?? null,
      createdAt: created.createdAt.toISOString(),
    };

    res.status(201).json(responseBody);
  }),
);

const BlockedTimeIdParamsSchema = z.object({ id: z.string().uuid() });

coachAvailabilityRouter.delete(
  "/blocked-times/:id",
  validate({ params: BlockedTimeIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };

    const deleted = await db.delete(blockedTimes).where(eq(blockedTimes.id, id)).returning({ id: blockedTimes.id });

    if (deleted.length === 0) {
      res.status(404).json({ error: "Blocked time not found" });
      return;
    }

    res.status(204).end();
  }),
);

// ── Travel buffer overrides ───────────────────────────────────────────────────

coachAvailabilityRouter.get(
  "/travel-buffers",
  validate({}),
  asyncHandler(async (_req, res) => {
    const rows = await db.select().from(travelBufferOverrides);

    const body: TravelBufferOverride[] = rows.map((row) => ({
      fromLocationId: row.fromLocationId,
      toLocationId: row.toLocationId,
      bufferMinutes: row.bufferMinutes,
    }));

    res.json(body);
  }),
);

const TravelBufferParamsSchema = z.object({
  fromId: z.string().uuid(),
  toId: z.string().uuid(),
});

coachAvailabilityRouter.put(
  "/travel-buffers/:fromId/:toId",
  validate({ params: TravelBufferParamsSchema, body: UpsertTravelBufferBodySchema }),
  asyncHandler(async (req, res) => {
    const { fromId, toId } = req.params as { fromId: string; toId: string };
    const body = req.body as UpsertTravelBufferBody;

    if (fromId === toId) {
      res.status(422).json({ error: "fromId and toId must be different locations" });
      return;
    }

    const namedPools = await db
      .select({ id: lessonLocations.id })
      .from(lessonLocations)
      .where(and(inArray(lessonLocations.id, [fromId, toId]), isNull(lessonLocations.householdId)));

    if (namedPools.length < 2) {
      res.status(422).json({ error: "Travel buffers can only be set between named pools" });
      return;
    }

    const rows = await db
      .insert(travelBufferOverrides)
      .values({
        fromLocationId: fromId,
        toLocationId: toId,
        bufferMinutes: body.bufferMinutes,
      })
      .onConflictDoUpdate({
        target: [travelBufferOverrides.fromLocationId, travelBufferOverrides.toLocationId],
        set: { bufferMinutes: body.bufferMinutes },
      })
      .returning();

    const upserted = rows[0]!;

    const responseBody: TravelBufferOverride = {
      fromLocationId: upserted.fromLocationId,
      toLocationId: upserted.toLocationId,
      bufferMinutes: upserted.bufferMinutes,
    };

    res.json(responseBody);
  }),
);

coachAvailabilityRouter.delete(
  "/travel-buffers/:fromId/:toId",
  validate({ params: TravelBufferParamsSchema }),
  asyncHandler(async (req, res) => {
    const { fromId, toId } = req.params as { fromId: string; toId: string };

    const namedPools = await db
      .select({ id: lessonLocations.id })
      .from(lessonLocations)
      .where(and(inArray(lessonLocations.id, [fromId, toId]), isNull(lessonLocations.householdId)));

    if (namedPools.length < 2) {
      res.status(422).json({ error: "Travel buffers can only be set between named pools" });
      return;
    }

    const deleted = await db
      .delete(travelBufferOverrides)
      .where(
        and(
          eq(travelBufferOverrides.fromLocationId, fromId),
          eq(travelBufferOverrides.toLocationId, toId),
        ),
      )
      .returning({ fromLocationId: travelBufferOverrides.fromLocationId });

    if (deleted.length === 0) {
      res.status(404).json({ error: "Travel buffer not found" });
      return;
    }

    res.status(204).end();
  }),
);

// ── Season summer end dates ───────────────────────────────────────────────────

coachAvailabilityRouter.get(
  "/season-end-dates",
  validate({}),
  asyncHandler(async (_req, res) => {
    const rows = await db
      .select()
      .from(seasonSummerEndDates)
      .orderBy(asc(seasonSummerEndDates.year));

    const body: SeasonSummerEndDate[] = rows.map((row) => ({
      year: row.year,
      endDate: row.endDate,
    }));

    res.json(body);
  }),
);

const SeasonYearParamsSchema = z.object({
  year: z
    .string()
    .regex(/^\d{4}$/)
    .transform((value) => parseInt(value, 10)),
});

coachAvailabilityRouter.put(
  "/season-end-dates/:year",
  validate({ params: SeasonYearParamsSchema, body: SetSeasonEndDateBodySchema }),
  asyncHandler(async (req, res) => {
    const { year } = req.params as unknown as { year: number };
    const body = req.body as SetSeasonEndDateBody;

    const rows = await db
      .insert(seasonSummerEndDates)
      .values({ year, endDate: body.endDate })
      .onConflictDoUpdate({
        target: seasonSummerEndDates.year,
        set: { endDate: body.endDate },
      })
      .returning();

    const upserted = rows[0]!;

    const responseBody: SeasonSummerEndDate = {
      year: upserted.year,
      endDate: upserted.endDate,
    };

    res.json(responseBody);
  }),
);
