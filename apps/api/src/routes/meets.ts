import { Router } from "express";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { meetSwims, meets, swimmers } from "../db/schema";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/asyncHandler";
import { formatSwimTime } from "../lib/swimTime";
import { z } from "zod";
import type {
  CreateMeetBody,
  MeetDetailSwimResponse,
  MeetResponse,
  MeetWithSwimsResponse,
} from "@swim-app/shared";
import { CreateMeetBodySchema } from "@swim-app/shared";

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

    const body: MeetResponse[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      meetDate: row.meetDate,
      course: row.course,
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
      .orderBy(asc(meetSwims.swumOn), asc(meetSwims.eventDistance), asc(meetSwims.eventStroke));

    const responseBody: MeetWithSwimsResponse = {
      id: meet.id,
      name: meet.name,
      meetDate: meet.meetDate,
      course: meet.course,
      createdAt: meet.createdAt.toISOString(),
      updatedAt: meet.updatedAt.toISOString(),
      swims: swimRows.map((swim): MeetDetailSwimResponse => ({
        id: swim.id,
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

// ── DELETE /meets/:id ─────────────────────────────────────────────────────────

meetsRouter.delete(
  "/meets/:id",
  validate({ params: MeetIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { id: meetId } = req.params as { id: string };

    const swimRows = await db
      .select({ id: meetSwims.id })
      .from(meetSwims)
      .where(eq(meetSwims.meetId, meetId))
      .limit(1);

    if (swimRows[0]) {
      res.status(422).json({ error: "meet_has_swims" });
      return;
    }

    const deleted = await db
      .delete(meets)
      .where(eq(meets.id, meetId))
      .returning({ id: meets.id });

    if (deleted.length === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    res.status(200).json({ ok: true });
  }),
);
