import { Router } from "express";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type {
  LessonLocation,
  AvailabilityConfig,
  BlockedTime,
  TravelBufferOverride,
  CreateLocationBody,
  PatchLocationBody,
  PatchAvailabilityConfigBody,
  CreateBlockedTimeBody,
  UpsertTravelBufferBody,
} from "@swim-app/shared";
import {
  CreateLocationBodySchema,
  PatchLocationBodySchema,
  PatchAvailabilityConfigBodySchema,
  CreateBlockedTimeBodySchema,
  UpsertTravelBufferBodySchema,
} from "@swim-app/shared";
import { db } from "../db/client";
import {
  lessonLocations,
  availabilityConfig,
  blockedTimes,
  travelBufferOverrides,
} from "../db/schema";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/asyncHandler";
import { z } from "zod";

export const coachAvailabilityRouter = Router();

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

    const existing = await db.select().from(availabilityConfig).limit(1);
    if (!existing[0]) {
      res.status(404).json({ error: "Availability config not found" });
      return;
    }

    const rows = await db
      .update(availabilityConfig)
      .set({
        ...(body.maxDailyLessonMinutes !== undefined && { maxDailyLessonMinutes: body.maxDailyLessonMinutes }),
        ...(body.bookingMinAdvanceHours !== undefined && { bookingMinAdvanceHours: body.bookingMinAdvanceHours }),
        ...(body.bookingMaxAdvanceWeeks !== undefined && { bookingMaxAdvanceWeeks: body.bookingMaxAdvanceWeeks }),
      })
      .where(eq(availabilityConfig.id, existing[0].id))
      .returning();

    const updated = rows[0]!;

    const responseBody: AvailabilityConfig = {
      id: updated.id,
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

