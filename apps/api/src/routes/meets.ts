import { Router } from "express";
import { asc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { meetSwims, meets } from "../db/schema";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/asyncHandler";
import { formatSwimTime } from "../lib/swimTime";
import { z } from "zod";
import type {
  CreateMeetBody,
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
      .select()
      .from(meetSwims)
      .where(eq(meetSwims.meetId, meetId));

    const responseBody: MeetWithSwimsResponse = {
      id: meet.id,
      name: meet.name,
      meetDate: meet.meetDate,
      course: meet.course,
      createdAt: meet.createdAt.toISOString(),
      updatedAt: meet.updatedAt.toISOString(),
      swims: swimRows.map((swim) => {
        const timeSeconds = parseFloat(swim.timeSeconds);
        return {
          id: swim.id,
          swimmerId: swim.swimmerId,
          swimType: swim.swimType,
          meetId: swim.meetId,
          meetName: meet.name,
          meetDate: meet.meetDate,
          eventDistance: swim.eventDistance,
          eventStroke: swim.eventStroke,
          timeSeconds,
          timeString: formatSwimTime(timeSeconds),
          swumOn: swim.swumOn,
          createdAt: swim.createdAt.toISOString(),
        };
      }),
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

    const swimCount = await db
      .select({ id: meetSwims.id })
      .from(meetSwims)
      .where(eq(meetSwims.meetId, meetId));

    if (swimCount.length > 0) {
      res.status(409).json({ error: "meet_has_swims" });
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

    res.status(204).end();
  }),
);
