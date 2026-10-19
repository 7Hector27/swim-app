import { Router } from "express";
import { and, asc, eq, gt, gte, inArray, isNull, lte, ne } from "drizzle-orm";
import type {
  LessonLocation,
  AvailabilityConfig,
  AvailabilityPreviewDay,
  AvailabilityPreviewQuery,
  AvailabilityPreviewResponse,
  AvailabilitySeason,
  AvailabilityOverride,
  BlockedTime,
  CopyNextYearResponse,
  CreateBlockedTimeBody,
  CreateLocationBody,
  CreateOverrideBody,
  CreateSeasonBody,
  OverrideDeleteResponse,
  OverrideMutationResponse,
  PatchAvailabilityConfigBody,
  PatchLocationBody,
  PatchOverrideBody,
  PatchSeasonBody,
  SeasonDeleteResponse,
  SeasonMutationResponse,
  SeasonWithIsCurrent,
  TravelBufferOverride,
  UpsertTravelBufferBody,
} from "@swim-app/shared";
import {
  AvailabilityPreviewQuerySchema,
  CreateBlockedTimeBodySchema,
  CreateLocationBodySchema,
  CreateOverrideBodySchema,
  CreateSeasonBodySchema,
  PatchAvailabilityConfigBodySchema,
  PatchLocationBodySchema,
  PatchOverrideBodySchema,
  PatchSeasonBodySchema,
  UpsertTravelBufferBodySchema,
} from "@swim-app/shared";
import { db } from "../db/client";
import {
  availabilityConfig,
  availabilityOverrides,
  availabilitySeasons,
  blockedTimes,
  lessons,
  lessonLocations,
  lessonSwimmers,
  swimmers,
  travelBufferOverrides,
} from "../db/schema";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/asyncHandler";
import { z } from "zod";
import { mapConfigRow, mapOverrideRow, mapSeasonRow } from "../lib/availabilityMappers";
import { fetchAvailabilityDefaults } from "../lib/availabilityQueries";
import { effectiveHours } from "../lib/effectiveHours";
import {
  computeImpactWarnings,
  dstStartDate,
  type UpcomingLessonForWarning,
} from "../lib/availabilityWarnings";

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
      defaultTeachesDays: config.defaultTeachesDays,
      defaultStartTime: config.defaultStartTime.slice(0, 5),
      defaultEndTime: config.defaultEndTime.slice(0, 5),
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

    // Validate the resulting start < end when only one side is being changed.
    const nextStart = body.defaultStartTime ?? existing[0].defaultStartTime.slice(0, 5);
    const nextEnd = body.defaultEndTime ?? existing[0].defaultEndTime.slice(0, 5);
    if (nextStart >= nextEnd) {
      res.status(422).json({ error: "Default end time must be after default start time." });
      return;
    }

    const rows = await db
      .update(availabilityConfig)
      .set({
        ...(body.maxDailyLessonMinutes !== undefined && { maxDailyLessonMinutes: body.maxDailyLessonMinutes }),
        ...(body.bookingMinAdvanceHours !== undefined && { bookingMinAdvanceHours: body.bookingMinAdvanceHours }),
        ...(body.bookingMaxAdvanceWeeks !== undefined && { bookingMaxAdvanceWeeks: body.bookingMaxAdvanceWeeks }),
        ...(body.defaultTeachesDays !== undefined && { defaultTeachesDays: body.defaultTeachesDays }),
        ...(body.defaultStartTime !== undefined && { defaultStartTime: body.defaultStartTime }),
        ...(body.defaultEndTime !== undefined && { defaultEndTime: body.defaultEndTime }),
      })
      .where(eq(availabilityConfig.id, existing[0].id))
      .returning();

    const updated = rows[0]!;

    const responseBody: AvailabilityConfig = {
      id: updated.id,
      maxDailyLessonMinutes: updated.maxDailyLessonMinutes,
      bookingMinAdvanceHours: updated.bookingMinAdvanceHours,
      bookingMaxAdvanceWeeks: updated.bookingMaxAdvanceWeeks,
      defaultTeachesDays: updated.defaultTeachesDays,
      defaultStartTime: updated.defaultStartTime.slice(0, 5),
      defaultEndTime: updated.defaultEndTime.slice(0, 5),
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

// ── Availability seasons ─────────────────────────────────────────────────────

const SeasonIdParamsSchema = z.object({ id: z.string().uuid() });
const OverrideIdParamsSchema = z.object({ id: z.string().uuid() });

function isValidTimeGranularity(time: string | null | undefined): boolean {
  if (time === null || time === undefined) return true;
  if (!/^\d{2}:\d{2}$/.test(time)) return false;
  const minute = Number(time.slice(3, 5));
  return minute === 0 || minute === 15 || minute === 30 || minute === 45;
}

function hasWeekday(days: number[]): boolean {
  return days.some((day) => day >= 1 && day <= 5);
}

function hasWeekend(days: number[]): boolean {
  return days.some((day) => day === 6 || day === 7);
}

// Validates season fields. Returns an error code on failure, null on success.
function validateSeasonFields(fields: {
  startDate: string;
  endDate: string;
  teachesDays: number[];
  weekdayStartTime: string | null;
  weekdayEndTime: string | null;
  weekendStartTime: string | null;
  weekendEndTime: string | null;
}): string | null {
  if (fields.endDate < fields.startDate) return "end_date_before_start";
  if (!isValidTimeGranularity(fields.weekdayStartTime)) return "invalid_time_granularity";
  if (!isValidTimeGranularity(fields.weekdayEndTime)) return "invalid_time_granularity";
  if (!isValidTimeGranularity(fields.weekendStartTime)) return "invalid_time_granularity";
  if (!isValidTimeGranularity(fields.weekendEndTime)) return "invalid_time_granularity";

  const teachesWeekday = hasWeekday(fields.teachesDays);
  const teachesWeekend = hasWeekend(fields.teachesDays);

  if (teachesWeekday && fields.weekdayStartTime === null) return "weekday_start_required";
  if (!teachesWeekday && fields.weekdayStartTime !== null) return "weekday_start_without_weekday";
  if (teachesWeekday && fields.weekdayEndTime === null) return "weekday_end_required";
  if (!teachesWeekday && fields.weekdayEndTime !== null) return "weekday_end_without_weekday";

  if (teachesWeekend && fields.weekendStartTime === null) return "weekend_start_required";
  if (!teachesWeekend && fields.weekendStartTime !== null) return "weekend_start_without_weekend";
  if (teachesWeekend && fields.weekendEndTime === null) return "weekend_end_required";
  if (!teachesWeekend && fields.weekendEndTime !== null) return "weekend_end_without_weekend";

  if (fields.weekdayStartTime !== null && fields.weekdayEndTime !== null && fields.weekdayStartTime >= fields.weekdayEndTime) {
    return "start_not_before_end";
  }
  if (fields.weekendStartTime !== null && fields.weekendEndTime !== null && fields.weekendStartTime >= fields.weekendEndTime) {
    return "start_not_before_end";
  }
  return null;
}

function toSeasonWithIsCurrent(
  season: AvailabilitySeason,
  allSeasons: AvailabilitySeason[],
  todayIso: string,
): SeasonWithIsCurrent {
  const active = allSeasons.find(
    (row) => row.startDate <= todayIso && row.endDate >= todayIso,
  ) ?? null;
  return { ...season, isCurrent: active !== null && active.id === season.id };
}

async function findOverlappingSeason(
  startDate: string,
  endDate: string,
  excludeId: string | null,
): Promise<string | null> {
  const whereClause = excludeId === null
    ? and(
        lte(availabilitySeasons.startDate, endDate),
        gte(availabilitySeasons.endDate, startDate),
      )
    : and(
        lte(availabilitySeasons.startDate, endDate),
        gte(availabilitySeasons.endDate, startDate),
        ne(availabilitySeasons.id, excludeId),
      );
  const rows = await db
    .select({ id: availabilitySeasons.id, name: availabilitySeasons.name })
    .from(availabilitySeasons)
    .where(whereClause)
    .limit(1);
  return rows[0] ? rows[0].name : null;
}

function todayInLA(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// Fetches upcoming approved+pending lessons for impact-warning computation,
// enriched with swimmer first names and pool name for the coach-only warning UI.
// Archived swimmers are excluded so warnings never surface ghost names.
//
// COACH-ONLY: the returned shape (`swimmerFirstNames`, `poolName`) is personal
// data for other households' kids. Never surface it to a parent or public route.
// Only call this inside handlers mounted under /coach (guarded by `requireCoach`).
async function fetchUpcomingLessons(): Promise<UpcomingLessonForWarning[]> {
  const lessonRows = await db
    .select({
      id: lessons.id,
      startsAt: lessons.startsAt,
      durationMinutes: lessons.durationMinutes,
      poolName: lessonLocations.name,
    })
    .from(lessons)
    .innerJoin(lessonLocations, eq(lessons.locationId, lessonLocations.id))
    .where(and(inArray(lessons.status, ["pending", "approved"]), gt(lessons.startsAt, new Date())));

  if (lessonRows.length === 0) return [];

  const swimmerRows = await db
    .select({
      lessonId: lessonSwimmers.lessonId,
      firstName: swimmers.firstName,
    })
    .from(lessonSwimmers)
    .innerJoin(swimmers, eq(lessonSwimmers.swimmerId, swimmers.id))
    .where(
      and(
        inArray(lessonSwimmers.lessonId, lessonRows.map((row) => row.id)),
        isNull(swimmers.archivedAt),
      ),
    );

  const firstNamesByLesson = new Map<string, string[]>();
  for (const row of swimmerRows) {
    const list = firstNamesByLesson.get(row.lessonId) ?? [];
    list.push(row.firstName);
    firstNamesByLesson.set(row.lessonId, list);
  }

  return lessonRows.map((row) => ({
    id: row.id,
    startsAt: row.startsAt,
    durationMinutes: row.durationMinutes,
    swimmerFirstNames: firstNamesByLesson.get(row.id) ?? [],
    poolName: row.poolName,
  }));
}

coachAvailabilityRouter.get(
  "/seasons",
  validate({}),
  asyncHandler(async (_req, res) => {
    const rows = await db
      .select()
      .from(availabilitySeasons)
      .orderBy(asc(availabilitySeasons.startDate));

    const seasons = rows.map(mapSeasonRow);
    const today = todayInLA();
    const body: SeasonWithIsCurrent[] = seasons.map((season) =>
      toSeasonWithIsCurrent(season, seasons, today),
    );
    res.json(body);
  }),
);

coachAvailabilityRouter.post(
  "/seasons",
  validate({ body: CreateSeasonBodySchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as CreateSeasonBody;

    const invalid = validateSeasonFields({
      startDate: body.startDate,
      endDate: body.endDate,
      teachesDays: body.teachesDays,
      weekdayStartTime: body.weekdayStartTime,
      weekdayEndTime: body.weekdayEndTime,
      weekendStartTime: body.weekendStartTime,
      weekendEndTime: body.weekendEndTime,
    });
    if (invalid !== null) {
      res.status(422).json({ error: invalid });
      return;
    }

    const existing = await db
      .select({ id: availabilitySeasons.id })
      .from(availabilitySeasons)
      .where(eq(availabilitySeasons.startDate, body.startDate))
      .limit(1);
    if (existing[0]) {
      res.status(422).json({ error: "season_date_taken" });
      return;
    }

    const overlappingName = await findOverlappingSeason(body.startDate, body.endDate, null);
    if (overlappingName !== null) {
      res.status(422).json({ error: `season_overlap:${overlappingName}` });
      return;
    }

    try {
      const inserted = await db
        .insert(availabilitySeasons)
        .values({
          name: body.name,
          startDate: body.startDate,
          endDate: body.endDate,
          teachesDays: body.teachesDays,
          weekdayStartTime: body.weekdayStartTime,
          weekdayEndTime: body.weekdayEndTime,
          weekendStartTime: body.weekendStartTime,
          weekendEndTime: body.weekendEndTime,
          startsAtDst: body.startsAtDst ?? false,
        })
        .returning();

      const season = mapSeasonRow(inserted[0]!);
      const allRows = await db.select().from(availabilitySeasons);
      const overrideRows = await db.select().from(availabilityOverrides);
      const allSeasons = allRows.map(mapSeasonRow);
      const overrides = overrideRows.map(mapOverrideRow);

      const defaults = await fetchAvailabilityDefaults();
      const upcoming = await fetchUpcomingLessons();
      const warnings = computeImpactWarnings(upcoming, allSeasons, overrides, defaults);

      const responseBody: SeasonMutationResponse = {
        season: toSeasonWithIsCurrent(season, allSeasons, todayInLA()),
        warnings,
      };
      res.status(201).json(responseBody);
    } catch (err) {
      req.log.error({ err, route: "POST /coach/seasons" }, "availability mutation failed");
      throw err;
    }
  }),
);

coachAvailabilityRouter.patch(
  "/seasons/:id",
  validate({ params: SeasonIdParamsSchema, body: PatchSeasonBodySchema }),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const body = req.body as PatchSeasonBody;

    const existingRows = await db
      .select()
      .from(availabilitySeasons)
      .where(eq(availabilitySeasons.id, id))
      .limit(1);
    const existing = existingRows[0];
    if (!existing) {
      res.status(404).json({ error: "Season not found" });
      return;
    }

    const next = {
      name: body.name ?? existing.name,
      startDate: body.startDate ?? existing.startDate,
      endDate: body.endDate ?? existing.endDate,
      teachesDays: body.teachesDays ?? existing.teachesDays,
      weekdayStartTime: body.weekdayStartTime !== undefined ? body.weekdayStartTime : existing.weekdayStartTime,
      weekdayEndTime: body.weekdayEndTime !== undefined ? body.weekdayEndTime : existing.weekdayEndTime,
      weekendStartTime: body.weekendStartTime !== undefined ? body.weekendStartTime : existing.weekendStartTime,
      weekendEndTime: body.weekendEndTime !== undefined ? body.weekendEndTime : existing.weekendEndTime,
      startsAtDst: body.startsAtDst ?? existing.startsAtDst,
    };

    const invalid = validateSeasonFields({
      startDate: next.startDate,
      endDate: next.endDate,
      teachesDays: next.teachesDays,
      weekdayStartTime: next.weekdayStartTime,
      weekdayEndTime: next.weekdayEndTime,
      weekendStartTime: next.weekendStartTime,
      weekendEndTime: next.weekendEndTime,
    });
    if (invalid !== null) {
      res.status(422).json({ error: invalid });
      return;
    }

    if (next.startDate !== existing.startDate) {
      const clash = await db
        .select({ id: availabilitySeasons.id })
        .from(availabilitySeasons)
        .where(eq(availabilitySeasons.startDate, next.startDate))
        .limit(1);
      if (clash[0]) {
        res.status(422).json({ error: "season_date_taken" });
        return;
      }
    }

    if (next.startDate !== existing.startDate || next.endDate !== existing.endDate) {
      const overlappingName = await findOverlappingSeason(next.startDate, next.endDate, id);
      if (overlappingName !== null) {
        res.status(422).json({ error: `season_overlap:${overlappingName}` });
        return;
      }
    }

    try {
      const updated = await db
        .update(availabilitySeasons)
        .set(next)
        .where(eq(availabilitySeasons.id, id))
        .returning();

      const season = mapSeasonRow(updated[0]!);
      const allRows = await db.select().from(availabilitySeasons);
      const overrideRows = await db.select().from(availabilityOverrides);
      const allSeasons = allRows.map(mapSeasonRow);
      const overrides = overrideRows.map(mapOverrideRow);

      const defaults = await fetchAvailabilityDefaults();
      const upcoming = await fetchUpcomingLessons();
      const warnings = computeImpactWarnings(upcoming, allSeasons, overrides, defaults);

      const responseBody: SeasonMutationResponse = {
        season: toSeasonWithIsCurrent(season, allSeasons, todayInLA()),
        warnings,
      };
      res.json(responseBody);
    } catch (err) {
      req.log.error({ err, route: "PATCH /coach/seasons/:id", seasonId: id }, "availability mutation failed");
      throw err;
    }
  }),
);

coachAvailabilityRouter.delete(
  "/seasons/:id",
  validate({ params: SeasonIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };

    try {
      const deleted = await db
        .delete(availabilitySeasons)
        .where(eq(availabilitySeasons.id, id))
        .returning();
      if (deleted.length === 0) {
        res.status(404).json({ error: "Season not found" });
        return;
      }

      const remainingRows = await db.select().from(availabilitySeasons);
      const overrideRows = await db.select().from(availabilityOverrides);
      const remaining = remainingRows.map(mapSeasonRow);
      const overrides = overrideRows.map(mapOverrideRow);
      const defaults = await fetchAvailabilityDefaults();
      const upcoming = await fetchUpcomingLessons();
      const warnings = computeImpactWarnings(upcoming, remaining, overrides, defaults);

      const responseBody: SeasonDeleteResponse = { warnings };
      res.json(responseBody);
    } catch (err) {
      req.log.error({ err, route: "DELETE /coach/seasons/:id", seasonId: id }, "availability mutation failed");
      throw err;
    }
  }),
);

// POST /coach/seasons/copy-next-year
//
// Roll the current cycle forward one year. Rules:
//   1. "Current cycle" = seasons whose start_date is within 12 months of the
//      latest season's start_date. Older rows (prior cycles) are left alone.
//   2. For each candidate, compute `nextStart = startDate + 1 year` (or that
//      year's DST start when `startsAtDst = true`).
//   3. Skip rows whose `nextStart` already exists (idempotent on repeated
//      calls) OR whose prior-year sibling `prevStart` already exists (so a
//      row that was itself produced by a previous copy run isn't re-copied).
//
// The `prevStart` check assumes manually-created rows don't happen to share a
// start_date with a hypothetical prior-year version. If a coach hand-creates a
// season on a date that would also be the prior-year date of some other row,
// that other row will be skipped on the next copy. Flagged as a known edge
// case; revisit if it ever bites.
coachAvailabilityRouter.post(
  "/seasons/copy-next-year",
  validate({}),
  asyncHandler(async (_req, res) => {
    const existingRows = await db.select().from(availabilitySeasons);
    const existingDates = new Set(existingRows.map((row) => row.startDate));

    // Only consider seasons whose startDate is within 12 months of the latest
    // season's startDate: those make up the "current cycle" Jason wants to roll
    // forward. Older seasons from past years are not copied again.
    let latestStart: string | null = null;
    for (const row of existingRows) {
      if (latestStart === null || row.startDate > latestStart) {
        latestStart = row.startDate;
      }
    }
    const cycleCutoff = latestStart === null ? null : addMonthsIso(latestStart, -12);

    // A season is "original" when no prior-year version exists; copies produced
    // by a previous run are skipped so repeated calls stay idempotent.
    const toInsert = existingRows
      .filter((row) => cycleCutoff === null || row.startDate > cycleCutoff)
      .map((row) => {
        const year = Number(row.startDate.slice(0, 4));
        const prevStart = row.startsAtDst
          ? dstStartDate(year - 1)
          : `${year - 1}${row.startDate.slice(4)}`;
        const nextStart = row.startsAtDst
          ? dstStartDate(year + 1)
          : `${year + 1}${row.startDate.slice(4)}`;
        const endYear = Number(row.endDate.slice(0, 4));
        const nextEnd = `${endYear + 1}${row.endDate.slice(4)}`;
        return { row, prevStart, nextStart, nextEnd };
      })
      .filter(({ prevStart, nextStart }) =>
        !existingDates.has(prevStart) && !existingDates.has(nextStart),
      );

    if (toInsert.length === 0) {
      const body: CopyNextYearResponse = { inserted: [] };
      res.status(201).json(body);
      return;
    }

    const inserted = await db
      .insert(availabilitySeasons)
      .values(
        toInsert.map(({ row, nextStart, nextEnd }) => ({
          name: row.name,
          startDate: nextStart,
          endDate: nextEnd,
          teachesDays: row.teachesDays,
          weekdayStartTime: row.weekdayStartTime,
          weekdayEndTime: row.weekdayEndTime,
          weekendStartTime: row.weekendStartTime,
          weekendEndTime: row.weekendEndTime,
          startsAtDst: row.startsAtDst,
        })),
      )
      .returning();

    const responseBody: CopyNextYearResponse = { inserted: inserted.map(mapSeasonRow) };
    res.status(201).json(responseBody);
  }),
);

// ── Availability overrides ───────────────────────────────────────────────────

function validateOverrideShape(fields: {
  kind: "day_off" | "custom_hours";
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
}): string | null {
  if (fields.endDate < fields.startDate) return "invalid_date_range";
  if (fields.kind === "day_off") {
    if (fields.startTime !== null || fields.endTime !== null) return "day_off_with_times";
  } else {
    if (fields.startTime === null || fields.endTime === null) return "custom_hours_missing_times";
    if (fields.startDate !== fields.endDate) return "custom_hours_date_mismatch";
    if (!isValidTimeGranularity(fields.startTime)) return "invalid_time_granularity";
    if (!isValidTimeGranularity(fields.endTime)) return "invalid_time_granularity";
    if (fields.startTime >= fields.endTime) return "start_not_before_end";
  }
  return null;
}

async function hasOverlappingOverride(
  startDate: string,
  endDate: string,
  excludeId: string | null,
): Promise<boolean> {
  // Overlap: existing.start_date <= endDate AND existing.end_date >= startDate.
  // Kind-agnostic: any overlapping override (day_off or custom_hours) conflicts,
  // since a date can only have one source of truth.
  const whereClause = excludeId === null
    ? and(
        lte(availabilityOverrides.startDate, endDate),
        gte(availabilityOverrides.endDate, startDate),
      )
    : and(
        lte(availabilityOverrides.startDate, endDate),
        gte(availabilityOverrides.endDate, startDate),
        ne(availabilityOverrides.id, excludeId),
      );
  const rows = await db
    .select({ id: availabilityOverrides.id })
    .from(availabilityOverrides)
    .where(whereClause)
    .limit(1);
  return rows.length > 0;
}

coachAvailabilityRouter.get(
  "/overrides",
  validate({}),
  asyncHandler(async (_req, res) => {
    const rows = await db
      .select()
      .from(availabilityOverrides)
      .orderBy(asc(availabilityOverrides.startDate));
    const body: AvailabilityOverride[] = rows.map(mapOverrideRow);
    res.json(body);
  }),
);

coachAvailabilityRouter.post(
  "/overrides",
  validate({ body: CreateOverrideBodySchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as CreateOverrideBody;

    const shape = validateOverrideShape({
      kind: body.kind,
      startDate: body.startDate,
      endDate: body.endDate,
      startTime: body.startTime ?? null,
      endTime: body.endTime ?? null,
    });
    if (shape !== null) {
      res.status(422).json({ error: shape });
      return;
    }

    if (await hasOverlappingOverride(body.startDate, body.endDate, null)) {
      res.status(422).json({ error: "override_conflict" });
      return;
    }

    try {
      const inserted = await db
        .insert(availabilityOverrides)
        .values({
          kind: body.kind,
          startDate: body.startDate,
          endDate: body.endDate,
          startTime: body.startTime ?? null,
          endTime: body.endTime ?? null,
          ...(body.note !== undefined && { note: body.note }),
        })
        .returning();

      const override = mapOverrideRow(inserted[0]!);
      const seasonsRows = await db.select().from(availabilitySeasons);
      const overridesRows = await db.select().from(availabilityOverrides);
      const seasons = seasonsRows.map(mapSeasonRow);
      const overrides = overridesRows.map(mapOverrideRow);
      const defaults = await fetchAvailabilityDefaults();
      const upcoming = await fetchUpcomingLessons();
      const warnings = computeImpactWarnings(upcoming, seasons, overrides, defaults);

      const responseBody: OverrideMutationResponse = { override, warnings };
      res.status(201).json(responseBody);
    } catch (err) {
      req.log.error({ err, route: "POST /coach/overrides" }, "availability mutation failed");
      throw err;
    }
  }),
);

coachAvailabilityRouter.patch(
  "/overrides/:id",
  validate({ params: OverrideIdParamsSchema, body: PatchOverrideBodySchema }),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const body = req.body as PatchOverrideBody;

    const existingRows = await db
      .select()
      .from(availabilityOverrides)
      .where(eq(availabilityOverrides.id, id))
      .limit(1);
    const existing = existingRows[0];
    if (!existing) {
      res.status(404).json({ error: "Override not found" });
      return;
    }

    const next = {
      kind: body.kind ?? existing.kind,
      startDate: body.startDate ?? existing.startDate,
      endDate: body.endDate ?? existing.endDate,
      startTime: body.startTime !== undefined ? body.startTime : existing.startTime,
      endTime: body.endTime !== undefined ? body.endTime : existing.endTime,
      note: body.note !== undefined ? body.note : existing.note,
    };

    const shape = validateOverrideShape(next);
    if (shape !== null) {
      res.status(422).json({ error: shape });
      return;
    }

    if (
      (next.startDate !== existing.startDate || next.endDate !== existing.endDate) &&
      (await hasOverlappingOverride(next.startDate, next.endDate, id))
    ) {
      res.status(422).json({ error: "override_conflict" });
      return;
    }

    try {
      const updated = await db
        .update(availabilityOverrides)
        .set(next)
        .where(eq(availabilityOverrides.id, id))
        .returning();

      const override = mapOverrideRow(updated[0]!);
      const seasonsRows = await db.select().from(availabilitySeasons);
      const overridesRows = await db.select().from(availabilityOverrides);
      const seasons = seasonsRows.map(mapSeasonRow);
      const overrides = overridesRows.map(mapOverrideRow);
      const defaults = await fetchAvailabilityDefaults();
      const upcoming = await fetchUpcomingLessons();
      const warnings = computeImpactWarnings(upcoming, seasons, overrides, defaults);

      const responseBody: OverrideMutationResponse = { override, warnings };
      res.json(responseBody);
    } catch (err) {
      req.log.error({ err, route: "PATCH /coach/overrides/:id", overrideId: id }, "availability mutation failed");
      throw err;
    }
  }),
);

coachAvailabilityRouter.delete(
  "/overrides/:id",
  validate({ params: OverrideIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };

    try {
      const deleted = await db
        .delete(availabilityOverrides)
        .where(eq(availabilityOverrides.id, id))
        .returning();
      if (deleted.length === 0) {
        res.status(404).json({ error: "Override not found" });
        return;
      }

      const seasonsRows = await db.select().from(availabilitySeasons);
      const overridesRows = await db.select().from(availabilityOverrides);
      const seasons = seasonsRows.map(mapSeasonRow);
      const overrides = overridesRows.map(mapOverrideRow);
      const defaults = await fetchAvailabilityDefaults();
      const upcoming = await fetchUpcomingLessons();
      const warnings = computeImpactWarnings(upcoming, seasons, overrides, defaults);

      const responseBody: OverrideDeleteResponse = { warnings };
      res.json(responseBody);
    } catch (err) {
      req.log.error({ err, route: "DELETE /coach/overrides/:id", overrideId: id }, "availability mutation failed");
      throw err;
    }
  }),
);

// ── Availability preview ─────────────────────────────────────────────────────

function addDaysIso(date: string, offset: number): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const next = new Date(Date.UTC(year, month - 1, day + offset));
  const nextYear = next.getUTCFullYear();
  const nextMonth = String(next.getUTCMonth() + 1).padStart(2, "0");
  const nextDay = String(next.getUTCDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

function addMonthsIso(date: string, offset: number): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const next = new Date(Date.UTC(year, month - 1 + offset, day));
  const nextYear = next.getUTCFullYear();
  const nextMonth = String(next.getUTCMonth() + 1).padStart(2, "0");
  const nextDay = String(next.getUTCDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

coachAvailabilityRouter.get(
  "/availability-preview",
  validate({ query: AvailabilityPreviewQuerySchema }),
  asyncHandler(async (req, res) => {
    const { from, days } = req.query as unknown as AvailabilityPreviewQuery;

    const [seasonRows, overrideRows, configRows] = await Promise.all([
      db.select().from(availabilitySeasons),
      db.select().from(availabilityOverrides),
      db.select().from(availabilityConfig).limit(1),
    ]);
    const seasons = seasonRows.map(mapSeasonRow);
    const overrides = overrideRows.map(mapOverrideRow);
    const configRow = configRows[0];
    const defaults = configRow ? mapConfigRow(configRow) : null;

    const preview: AvailabilityPreviewDay[] = [];
    for (let index = 0; index < days; index++) {
      const date = addDaysIso(from, index);
      const windows = effectiveHours(date, seasons, overrides, defaults);
      preview.push({
        date,
        state: windows.length === 0 ? "closed" : "open",
        windows,
      });
    }

    const body: AvailabilityPreviewResponse = { days: preview };
    res.json(body);
  }),
);

