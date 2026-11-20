import { Router } from "express";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db/client";
import { meetSwims, meets, swimmers } from "../db/schema";
import { isActiveSwimmer } from "../db/queries";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/asyncHandler";
import { formatSwimTime, parseSwimTime } from "../lib/swimTime";
import { z } from "zod";
import type {
  BatchRowError,
  CreateMeetBody,
  CreateMeetSwimsBatchBody,
  MeetDetailSwimResponse,
  MeetResponse,
  MeetWithSwimsResponse,
  PatchMeetBody,
} from "@swim-app/shared";
import {
  CreateMeetBodySchema,
  CreateMeetSwimsBatchBodySchema,
  MAX_SWIM_HUNDREDTHS,
  PatchMeetBodySchema,
  isValidEvent,
} from "@swim-app/shared";

export const meetsRouter = Router();

const MeetIdParamsSchema = z.object({ id: z.string().uuid() });

// ── GET /meets ────────────────────────────────────────────────────────────────

meetsRouter.get(
  "/meets",
  validate({}),
  asyncHandler(async (_req, res) => {
    const rows = await db
      .select()
      .from(meets)
      .orderBy(asc(meets.meetDate));

    if (rows.length === 0) {
      res.json([]);
      return;
    }

    const countRows = await db
      .select({
        meetId: meetSwims.meetId,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(meetSwims)
      .innerJoin(swimmers, eq(swimmers.id, meetSwims.swimmerId))
      .where(and(inArray(meetSwims.meetId, rows.map((row) => row.id)), isNull(swimmers.archivedAt)))
      .groupBy(meetSwims.meetId);

    const countByMeet = new Map(countRows.map((countRow) => [countRow.meetId, countRow.count]));

    const body: MeetResponse[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      meetDate: row.meetDate,
      course: row.course,
      swimCount: countByMeet.get(row.id) ?? 0,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));

    res.json(body);
  }),
);

// ── POST /meets ───────────────────────────────────────────────────────────────

meetsRouter.post(
  "/meets",
  validate({ body: CreateMeetBodySchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as CreateMeetBody;

    const rows = await db
      .insert(meets)
      .values({
        name: body.name,
        meetDate: body.meetDate,
        course: body.course,
        createdBy: req.profile.id,
      })
      .returning();

    const created = rows[0]!;

    const responseBody: MeetResponse = {
      id: created.id,
      name: created.name,
      meetDate: created.meetDate,
      course: created.course,
      swimCount: 0,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    };

    res.status(201).json(responseBody);
  }),
);

// ── GET /meets/:id ────────────────────────────────────────────────────────────

meetsRouter.get(
  "/meets/:id",
  validate({ params: MeetIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { id: meetId } = req.params as { id: string };

    const meetRows = await db
      .select()
      .from(meets)
      .where(eq(meets.id, meetId))
      .limit(1);

    const meet = meetRows[0];
    if (!meet) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const swimRows = await db
      .select({
        id: meetSwims.id,
        swimmerId: meetSwims.swimmerId,
        swimmerFirstName: swimmers.firstName,
        swimmerLastName: swimmers.lastName,
        swimType: meetSwims.swimType,
        meetId: meetSwims.meetId,
        eventDistance: meetSwims.eventDistance,
        eventStroke: meetSwims.eventStroke,
        course: meetSwims.course,
        swumOn: meetSwims.swumOn,
        timeHundredths: meetSwims.timeHundredths,
        createdAt: meetSwims.createdAt,
      })
      .from(meetSwims)
      .innerJoin(swimmers, eq(swimmers.id, meetSwims.swimmerId))
      .where(and(eq(meetSwims.meetId, meetId), isNull(swimmers.archivedAt)))
      .orderBy(asc(meetSwims.eventDistance), asc(meetSwims.eventStroke), asc(meetSwims.timeHundredths));

    const responseBody: MeetWithSwimsResponse = {
      id: meet.id,
      name: meet.name,
      meetDate: meet.meetDate,
      course: meet.course,
      createdAt: meet.createdAt.toISOString(),
      updatedAt: meet.updatedAt.toISOString(),
      swims: swimRows.map((swim): MeetDetailSwimResponse => ({
        id: swim.id,
        swimmerId: swim.swimmerId,
        swimmerFirstName: swim.swimmerFirstName,
        swimmerLastName: swim.swimmerLastName,
        swimType: swim.swimType,
        meetId: swim.meetId,
        meetName: meet.name,
        meetDate: meet.meetDate,
        eventDistance: swim.eventDistance,
        eventStroke: swim.eventStroke,
        course: swim.course,
        timeHundredths: swim.timeHundredths,
        timeString: formatSwimTime(swim.timeHundredths),
        swumOn: swim.swumOn,
        createdAt: swim.createdAt.toISOString(),
      })),
    };

    res.json(responseBody);
  }),
);

// ── PATCH /meets/:id ──────────────────────────────────────────────────────────
// Edit the meet's header (name, date, course). If `meetDate` moves later than
// any already-recorded swim's `swumOn`, the update is rejected so existing
// rows don't violate the `swumOn >= meet.meetDate` invariant.

meetsRouter.patch(
  "/meets/:id",
  validate({ params: MeetIdParamsSchema, body: PatchMeetBodySchema }),
  asyncHandler(async (req, res) => {
    const { id: meetId } = req.params as { id: string };
    const body = req.body as PatchMeetBody;

    const current = await db.select().from(meets).where(eq(meets.id, meetId)).limit(1);
    const meet = current[0];
    if (!meet) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    if (body.meetDate !== undefined && body.meetDate !== meet.meetDate) {
      const earliest = await db
        .select({ earliest: sql<string | null>`min(${meetSwims.swumOn})` })
        .from(meetSwims)
        .where(eq(meetSwims.meetId, meetId));
      const first = earliest[0]?.earliest ?? null;
      if (first !== null && body.meetDate > first) {
        res.status(422).json({ error: "meet_date_after_existing_swim" });
        return;
      }
    }

    const updates: Partial<typeof meets.$inferInsert> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.meetDate !== undefined) updates.meetDate = body.meetDate;
    if (body.course !== undefined) updates.course = body.course;

    const updated = await db
      .update(meets)
      .set(updates)
      .where(eq(meets.id, meetId))
      .returning();

    const row = updated[0]!;

    const countRows = await db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(meetSwims)
      .innerJoin(swimmers, eq(swimmers.id, meetSwims.swimmerId))
      .where(and(eq(meetSwims.meetId, meetId), isNull(swimmers.archivedAt)));

    const response: MeetResponse = {
      id: row.id,
      name: row.name,
      meetDate: row.meetDate,
      course: row.course,
      swimCount: countRows[0]?.count ?? 0,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
    res.json(response);
  }),
);

// ── POST /meets/:id/swims (batch) ─────────────────────────────────────────────
// Validate every row, then insert the whole batch in one transaction.
// If any row fails, nothing is persisted and the response body lists the
// failing indexes with their reason.

meetsRouter.post(
  "/meets/:id/swims",
  validate({ params: MeetIdParamsSchema, body: CreateMeetSwimsBatchBodySchema }),
  asyncHandler(async (req, res) => {
    const { id: meetId } = req.params as { id: string };
    const body = req.body as CreateMeetSwimsBatchBody;

    const meetRows = await db
      .select({ id: meets.id, meetDate: meets.meetDate, name: meets.name })
      .from(meets)
      .where(eq(meets.id, meetId))
      .limit(1);
    const meet = meetRows[0];
    if (!meet) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const swimmerIds = Array.from(new Set(body.rows.map((row) => row.swimmerId)));
    const activeSwimmers = await db
      .select({ id: swimmers.id })
      .from(swimmers)
      .where(and(isActiveSwimmer, inArray(swimmers.id, swimmerIds)));
    const activeSet = new Set(activeSwimmers.map((row) => row.id));

    // Existing (swimmer, event, course, time) quads for this meet — used for
    // duplicate detection against already-saved swims.
    const existingSwims = await db
      .select({
        swimmerId: meetSwims.swimmerId,
        eventDistance: meetSwims.eventDistance,
        eventStroke: meetSwims.eventStroke,
        course: meetSwims.course,
        timeHundredths: meetSwims.timeHundredths,
      })
      .from(meetSwims)
      .where(eq(meetSwims.meetId, meetId));

    const seenKey = (row: {
      swimmerId: string;
      eventDistance: number;
      eventStroke: string;
      course: string;
      timeHundredths: number;
    }): string => `${row.swimmerId}|${row.eventDistance}|${row.eventStroke}|${row.course}|${row.timeHundredths}`;
    const existingKeys = new Set(existingSwims.map((row) => seenKey(row)));
    const batchKeys = new Set<string>();

    const rowErrors: BatchRowError[] = [];
    const prepared: Array<{
      swimmerId: string;
      eventDistance: number;
      eventStroke: "free" | "back" | "breast" | "fly" | "im";
      course: "scy" | "scm" | "lcm";
      timeHundredths: number;
      swumOn: string;
    }> = [];

    body.rows.forEach((row, index) => {
      if (!activeSet.has(row.swimmerId)) {
        rowErrors.push({ index, error: "swimmer_inactive_or_missing" });
        return;
      }
      if (!isValidEvent(row.eventDistance, row.eventStroke)) {
        rowErrors.push({ index, error: "invalid_event" });
        return;
      }
      const timeHundredths = parseSwimTime(row.timeString);
      if (timeHundredths === null) {
        rowErrors.push({ index, error: "invalid_time" });
        return;
      }
      if (timeHundredths <= 0 || timeHundredths > MAX_SWIM_HUNDREDTHS) {
        rowErrors.push({ index, error: "time_out_of_range" });
        return;
      }
      if (row.swumOn < meet.meetDate) {
        rowErrors.push({ index, error: "swum_on_before_meet" });
        return;
      }
      const key = seenKey({
        swimmerId: row.swimmerId,
        eventDistance: row.eventDistance,
        eventStroke: row.eventStroke,
        course: row.course,
        timeHundredths,
      });
      if (existingKeys.has(key) || batchKeys.has(key)) {
        rowErrors.push({ index, error: "duplicate_swim" });
        return;
      }
      batchKeys.add(key);
      prepared.push({
        swimmerId: row.swimmerId,
        eventDistance: row.eventDistance,
        eventStroke: row.eventStroke,
        course: row.course,
        timeHundredths,
        swumOn: row.swumOn,
      });
    });

    if (rowErrors.length > 0) {
      res.status(422).json({ error: "batch_validation_failed", rowErrors });
      return;
    }

    await db.transaction(async (tx) => {
      if (prepared.length === 0) return;
      await tx.insert(meetSwims).values(
        prepared.map((row) => ({
          swimmerId: row.swimmerId,
          swimType: "meet" as const,
          meetId,
          eventDistance: row.eventDistance,
          eventStroke: row.eventStroke,
          course: row.course,
          timeHundredths: row.timeHundredths,
          swumOn: row.swumOn,
          createdBy: req.profile.id,
        })),
      );
    });

    res.status(201).json({ inserted: prepared.length });
  }),
);

// ── DELETE /meets/:id ─────────────────────────────────────────────────────────
// Cascade-deletes all swims for the meet, then the meet itself.

meetsRouter.delete(
  "/meets/:id",
  validate({ params: MeetIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { id: meetId } = req.params as { id: string };

    const result = await db.transaction(async (tx) => {
      const deletedSwims = await tx
        .delete(meetSwims)
        .where(eq(meetSwims.meetId, meetId))
        .returning({ id: meetSwims.id });

      const deleted = await tx
        .delete(meets)
        .where(eq(meets.id, meetId))
        .returning({ id: meets.id });

      return { deletedSwims, deleted };
    });

    if (result.deleted.length === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    res.status(200).json({ ok: true, deletedSwims: result.deletedSwims.length });
  }),
);
