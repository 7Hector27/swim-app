import { Router } from "express";
import { asc, eq, inArray, sql } from "drizzle-orm";
import type {
  CoachBatchDetail,
  CoachBatchLesson,
  LessonDurationMinutes,
  LessonSwimmer,
} from "@swim-app/shared";
import { z } from "zod";
import { db } from "../db/client";
import {
  bookingBatches,
  householdMembers,
  households,
  lessonLocations,
  lessonSwimmers,
  lessons,
  profiles,
  swimmers,
} from "../db/schema";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/asyncHandler";

export const coachBatchesRouter = Router();

const BatchIdParamsSchema = z.object({ id: z.string().uuid() });

// ── GET /coach/batches/:id ───────────────────────────────────────────────────

coachBatchesRouter.get(
  "/batches/:id",
  validate({ params: BatchIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };

    const batchRows = await db
      .select({
        id: bookingBatches.id,
        mode: bookingBatches.mode,
        householdId: bookingBatches.householdId,
        createdBy: bookingBatches.createdBy,
        createdAt: bookingBatches.createdAt,
        householdName: households.name,
        createdByName: profiles.fullName,
      })
      .from(bookingBatches)
      .innerJoin(households, eq(bookingBatches.householdId, households.id))
      .leftJoin(profiles, eq(bookingBatches.createdBy, profiles.id))
      .where(eq(bookingBatches.id, id))
      .limit(1);

    const batchRow = batchRows[0];
    if (!batchRow) {
      res.status(404).json({ error: "Batch not found" });
      return;
    }

    // Household name fallback: owner first, then oldest member by joined_at,
    // with profile_id as a final tiebreaker so two members who joined in the
    // same transaction still resolve deterministically. Only used when
    // households.name itself is empty.
    let householdName: string | null = batchRow.householdName;
    if (!householdName) {
      const memberRows = await db
        .select({ fullName: profiles.fullName })
        .from(householdMembers)
        .innerJoin(profiles, eq(householdMembers.profileId, profiles.id))
        .where(eq(householdMembers.householdId, batchRow.householdId))
        .orderBy(
          sql`CASE WHEN ${householdMembers.role} = 'owner' THEN 0 ELSE 1 END`,
          asc(householdMembers.joinedAt),
          asc(householdMembers.profileId),
        )
        .limit(1);
      householdName = memberRows[0]?.fullName ?? null;
    }

    // Fetch lessons + their swimmers in a single pair of queries (no N+1).
    const lessonRows = await db
      .select({
        id: lessons.id,
        startsAt: lessons.startsAt,
        durationMinutes: lessons.durationMinutes,
        type: lessons.type,
        status: lessons.status,
        locationId: lessons.locationId,
        locationName: lessonLocations.name,
      })
      .from(lessons)
      .innerJoin(lessonLocations, eq(lessons.locationId, lessonLocations.id))
      .where(eq(lessons.batchId, id))
      .orderBy(asc(lessons.startsAt));

    const swimmersByLesson = new Map<string, LessonSwimmer[]>();
    if (lessonRows.length > 0) {
      const swimmerRows = await db
        .select({
          lessonId: lessonSwimmers.lessonId,
          swimmerId: lessonSwimmers.swimmerId,
          firstName: swimmers.firstName,
          lastName: swimmers.lastName,
        })
        .from(lessonSwimmers)
        .innerJoin(swimmers, eq(lessonSwimmers.swimmerId, swimmers.id))
        .where(
          inArray(
            lessonSwimmers.lessonId,
            lessonRows.map((row) => row.id),
          ),
        );
      for (const row of swimmerRows) {
        const entry = swimmersByLesson.get(row.lessonId) ?? [];
        entry.push({
          swimmerId: row.swimmerId,
          firstName: row.firstName,
          lastName: row.lastName,
        });
        swimmersByLesson.set(row.lessonId, entry);
      }
    }

    const batchLessons: CoachBatchLesson[] = lessonRows.map((row) => ({
      id: row.id,
      startsAt: row.startsAt.toISOString(),
      durationMinutes: row.durationMinutes as LessonDurationMinutes,
      type: row.type,
      status: row.status,
      locationId: row.locationId,
      locationName: row.locationName,
      swimmers: swimmersByLesson.get(row.id) ?? [],
    }));

    const body: CoachBatchDetail = {
      id: batchRow.id,
      mode: batchRow.mode as "manual" | "weekly",
      householdName,
      createdByName: batchRow.createdByName ?? null,
      createdAt: batchRow.createdAt.toISOString(),
      lessons: batchLessons,
    };

    res.json(body);
  }),
);
