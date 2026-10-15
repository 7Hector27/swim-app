import { Router } from "express";
import { and, asc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import type { IdParams } from "@swim-app/shared";
import { db } from "../db/client";
import {
  coachNotes,
  evaluationSessions,
  householdMembers,
  leagueRegistrations,
  lessonLocations,
  lessonSwimmers,
  profiles,
  skillRatings,
  swimmers,
  swimmerClubs,
} from "../db/schema";
import { requireUser } from "../middleware/requireUser";
import { requireCoach } from "../middleware/requireCoach";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/asyncHandler";
import { isActiveSwimmer } from "../db/queries";
import { z } from "zod";
import {
  IdParamsSchema,
  CoachVisibilityBodySchema,
  CreateCoachNoteBodySchema,
  UpdateCoachNoteBodySchema,
  calculateAge,
  currentSeasonStartYear,
  todayLA,
  type CoachSwimmer,
  type CoachSwimmerDetail,
  type CoachVisibilityBody,
  type CreateCoachNoteBody,
  type UpdateCoachNoteBody,
  type TimelineItem,
} from "@swim-app/shared";

const NoteIdParamsSchema = z.object({ id: z.string().uuid(), noteId: z.string().uuid() });
type NoteIdParams = z.infer<typeof NoteIdParamsSchema>;

export const coachSwimmersRouter = Router();

function toISO(date: Date): string {
  return date.toISOString();
}

const swimmerColumns = {
  id: swimmers.id,
  firstName: swimmers.firstName,
  lastName: swimmers.lastName,
  birthDate: swimmers.birthDate,
  sex: swimmers.sex,
  isPublic: swimmers.isPublic,
  householdId: swimmers.householdId,
  createdAt: swimmers.createdAt,
  updatedAt: swimmers.updatedAt,
} as const;

const swimmerClubColumns = {
  id: swimmerClubs.id,
  swimmerId: swimmerClubs.swimmerId,
  clubId: swimmerClubs.clubId,
  otherClubName: swimmerClubs.otherClubName,
  createdAt: swimmerClubs.createdAt,
  updatedAt: swimmerClubs.updatedAt,
} as const;

type SwimmerClubRow = {
  id: string;
  swimmerId: string;
  clubId: string | null;
  otherClubName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function mapClub(club: SwimmerClubRow): CoachSwimmer["clubs"][number] {
  return {
    id: club.id,
    swimmerId: club.swimmerId,
    clubId: club.clubId,
    otherClubName: club.otherClubName,
    createdAt: toISO(club.createdAt),
    updatedAt: toISO(club.updatedAt),
  };
}

function activeRegsWhere(swimmerIds: string[]) {
  const today = todayLA();
  const clubYear = currentSeasonStartYear("club", today);
  const summerYear = currentSeasonStartYear("summer_league", today);
  return and(
    inArray(leagueRegistrations.swimmerId, swimmerIds),
    isNull(leagueRegistrations.withdrawnAt),
    or(
      and(
        eq(leagueRegistrations.league, "club"),
        eq(leagueRegistrations.seasonStartYear, clubYear),
      ),
      and(
        eq(leagueRegistrations.league, "summer_league"),
        eq(leagueRegistrations.seasonStartYear, summerYear),
      ),
    ),
  );
}

// ── Routes ────────────────────────────────────────────────────────────────────

coachSwimmersRouter.get(
  "/",
  requireUser,
  requireCoach,
  validate({}),
  asyncHandler(async (_req, res) => {
    const swimmerRows = await db
      .select(swimmerColumns)
      .from(swimmers)
      .where(isActiveSwimmer)
      .orderBy(asc(swimmers.lastName), asc(swimmers.firstName));

    if (swimmerRows.length === 0) {
      res.json([]);
      return;
    }

    const swimmerIds = swimmerRows.map((row) => row.id);
    const householdIds = [...new Set(swimmerRows.map((row) => row.householdId))];

    const [clubRows, regRows, memberRows] = await Promise.all([
      db.select(swimmerClubColumns).from(swimmerClubs).where(inArray(swimmerClubs.swimmerId, swimmerIds)),
      db
        .select({ swimmerId: leagueRegistrations.swimmerId, league: leagueRegistrations.league })
        .from(leagueRegistrations)
        .where(activeRegsWhere(swimmerIds)),
      db
        .select({ householdId: householdMembers.householdId, fullName: profiles.fullName })
        .from(householdMembers)
        .innerJoin(profiles, eq(profiles.id, householdMembers.profileId))
        .where(inArray(householdMembers.householdId, householdIds)),
    ]);

    const clubsBySwimmer = new Map<string, SwimmerClubRow[]>();
    for (const club of clubRows) {
      const existing = clubsBySwimmer.get(club.swimmerId) ?? [];
      existing.push(club);
      clubsBySwimmer.set(club.swimmerId, existing);
    }

    const leaguesBySwimmer = new Map<string, Array<"club" | "summer_league">>();
    for (const reg of regRows) {
      const existing = leaguesBySwimmer.get(reg.swimmerId) ?? [];
      existing.push(reg.league);
      leaguesBySwimmer.set(reg.swimmerId, existing);
    }

    const memberNamesByHousehold = new Map<string, string[]>();
    for (const row of memberRows) {
      const names = memberNamesByHousehold.get(row.householdId) ?? [];
      if (row.fullName !== null) names.push(row.fullName);
      memberNamesByHousehold.set(row.householdId, names);
    }

    const today = todayLA();
    const result: CoachSwimmer[] = swimmerRows.map((swimmer) => ({
      id: swimmer.id,
      firstName: swimmer.firstName,
      lastName: swimmer.lastName,
      age: calculateAge(swimmer.birthDate, today),
      sex: swimmer.sex,
      isPublic: swimmer.isPublic,
      createdAt: toISO(swimmer.createdAt),
      updatedAt: toISO(swimmer.updatedAt),
      clubs: (clubsBySwimmer.get(swimmer.id) ?? []).map(mapClub),
      currentLeagues: leaguesBySwimmer.get(swimmer.id) ?? [],
      memberNames: memberNamesByHousehold.get(swimmer.householdId) ?? [],
    }));

    res.json(result);
  }),
);

coachSwimmersRouter.get(
  "/:id",
  requireUser,
  requireCoach,
  validate({ params: IdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { id: swimmerId } = req.params as unknown as IdParams;

    const swimmerRows = await db
      .select(swimmerColumns)
      .from(swimmers)
      .where(and(isActiveSwimmer, eq(swimmers.id, swimmerId)))
      .limit(1);

    const swimmer = swimmerRows[0];
    if (!swimmer) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const [clubRows, regRows, memberRows, homePoolRows] = await Promise.all([
      db.select(swimmerClubColumns).from(swimmerClubs).where(eq(swimmerClubs.swimmerId, swimmerId)),
      db
        .select({ swimmerId: leagueRegistrations.swimmerId, league: leagueRegistrations.league })
        .from(leagueRegistrations)
        .where(activeRegsWhere([swimmerId])),
      db
        .select({ fullName: profiles.fullName, phone: profiles.phone })
        .from(householdMembers)
        .innerJoin(profiles, eq(profiles.id, householdMembers.profileId))
        .where(eq(householdMembers.householdId, swimmer.householdId)),
      db
        .select({
          address: lessonLocations.address,
          city: lessonLocations.city,
          state: lessonLocations.state,
          zip: lessonLocations.zip,
        })
        .from(lessonLocations)
        .where(
          and(
            eq(lessonLocations.householdId, swimmer.householdId),
            eq(lessonLocations.isActive, true),
          ),
        )
        .limit(1),
    ]);

    const homePool = homePoolRows[0] ?? null;

    const result: CoachSwimmerDetail = {
      id: swimmer.id,
      firstName: swimmer.firstName,
      lastName: swimmer.lastName,
      age: calculateAge(swimmer.birthDate, todayLA()),
      birthDate: swimmer.birthDate,
      sex: swimmer.sex,
      isPublic: swimmer.isPublic,
      createdAt: toISO(swimmer.createdAt),
      updatedAt: toISO(swimmer.updatedAt),
      clubs: clubRows.map(mapClub),
      currentLeagues: regRows.map((row) => row.league),
      members: memberRows,
      memberNames: memberRows
        .map((member) => member.fullName)
        .filter((name): name is string => name !== null),
      homePool,
    };

    res.json(result);
  }),
);

coachSwimmersRouter.patch(
  "/:id/visibility",
  requireUser,
  requireCoach,
  validate({ params: IdParamsSchema, body: CoachVisibilityBodySchema }),
  asyncHandler(async (req, res) => {
    const { id: swimmerId } = req.params as unknown as IdParams;
    const body = req.body as CoachVisibilityBody;

    const rows = await db
      .update(swimmers)
      .set({ isPublic: body.isPublic })
      .where(and(isActiveSwimmer, eq(swimmers.id, swimmerId)))
      .returning({ id: swimmers.id });

    if (rows.length === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    res.status(204).end();
  }),
);

coachSwimmersRouter.get(
  "/:id/timeline",
  requireUser,
  requireCoach,
  validate({ params: IdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { id: swimmerId } = req.params as unknown as IdParams;

    const swimmerRows = await db
      .select({ id: swimmers.id })
      .from(swimmers)
      .where(and(isActiveSwimmer, eq(swimmers.id, swimmerId)))
      .limit(1);

    if (!swimmerRows[0]) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const [noteRows, ratingRows, sessionRows] = await Promise.all([
      db
        .select({
          id: coachNotes.id,
          body: coachNotes.body,
          noteType: coachNotes.noteType,
          sessionId: coachNotes.sessionId,
          lessonId: coachNotes.lessonId,
          skillId: coachNotes.skillId,
          createdAt: coachNotes.createdAt,
        })
        .from(coachNotes)
        .where(eq(coachNotes.swimmerId, swimmerId)),
      db
        .select({
          id: skillRatings.id,
          note: skillRatings.note,
          sessionId: skillRatings.sessionId,
          skillId: skillRatings.skillId,
          createdAt: skillRatings.createdAt,
        })
        .from(skillRatings)
        .where(
          and(
            eq(skillRatings.swimmerId, swimmerId),
            isNotNull(skillRatings.note),
            isNull(skillRatings.voidedAt),
          ),
        ),
      db
        .select({
          id: evaluationSessions.id,
          coachingPriority: evaluationSessions.coachingPriority,
          createdAt: evaluationSessions.createdAt,
        })
        .from(evaluationSessions)
        .where(eq(evaluationSessions.swimmerId, swimmerId)),
    ]);

    const items: TimelineItem[] = [
      ...noteRows.map((note): TimelineItem => ({
        type: "note",
        id: note.id,
        body: note.body,
        noteType: note.noteType,
        createdAt: toISO(note.createdAt),
        ...(
          (note.sessionId !== null || note.lessonId !== null || note.skillId !== null) && {
            tiedTo: {
              ...(note.sessionId !== null && { sessionId: note.sessionId }),
              ...(note.lessonId !== null && { lessonId: note.lessonId }),
              ...(note.skillId !== null && { skillId: note.skillId }),
            },
          }
        ),
      })),
      ...ratingRows
        .filter((rating): rating is typeof rating & { note: string } => rating.note !== null)
        .map((rating): TimelineItem => ({
          type: "rating_note",
          id: rating.id,
          body: rating.note,
          createdAt: toISO(rating.createdAt),
          tiedTo: {
            sessionId: rating.sessionId,
            skillId: rating.skillId,
          },
        })),
      ...sessionRows.map((session): TimelineItem => ({
        type: "coaching_priority",
        id: session.id,
        body: session.coachingPriority,
        createdAt: toISO(session.createdAt),
        tiedTo: { sessionId: session.id },
      })),
    ];

    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    res.json(items);
  }),
);

coachSwimmersRouter.post(
  "/:id/notes",
  requireUser,
  requireCoach,
  validate({ params: IdParamsSchema, body: CreateCoachNoteBodySchema }),
  asyncHandler(async (req, res) => {
    const { id: swimmerId } = req.params as unknown as IdParams;
    const body = req.body as CreateCoachNoteBody;

    const swimmerRows = await db
      .select({ id: swimmers.id })
      .from(swimmers)
      .where(and(isActiveSwimmer, eq(swimmers.id, swimmerId)))
      .limit(1);

    if (!swimmerRows[0]) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    if (body.sessionId !== undefined) {
      const sessionRows = await db
        .select({ id: evaluationSessions.id, swimmerId: evaluationSessions.swimmerId })
        .from(evaluationSessions)
        .where(eq(evaluationSessions.id, body.sessionId))
        .limit(1);
      const session = sessionRows[0];
      if (!session || session.swimmerId !== swimmerId) {
        res.status(422).json({ error: "session_swimmer_mismatch" });
        return;
      }
    }

    if (body.lessonId !== undefined) {
      const linkRows = await db
        .select({ lessonId: lessonSwimmers.lessonId })
        .from(lessonSwimmers)
        .where(and(eq(lessonSwimmers.lessonId, body.lessonId), eq(lessonSwimmers.swimmerId, swimmerId)))
        .limit(1);
      if (!linkRows[0]) {
        res.status(422).json({ error: "lesson_swimmer_mismatch" });
        return;
      }
    }

    const [inserted] = await db
      .insert(coachNotes)
      .values({
        swimmerId,
        body: body.body,
        noteType: body.noteType,
        createdBy: req.profile.id,
        ...(body.sessionId !== undefined && { sessionId: body.sessionId }),
        ...(body.lessonId !== undefined && { lessonId: body.lessonId }),
        ...(body.skillId !== undefined && { skillId: body.skillId }),
      })
      .returning({ id: coachNotes.id, createdAt: coachNotes.createdAt });

    res.status(201).json({ id: inserted!.id, createdAt: toISO(inserted!.createdAt) });
  }),
);

coachSwimmersRouter.patch(
  "/:id/notes/:noteId",
  requireUser,
  requireCoach,
  validate({ params: NoteIdParamsSchema, body: UpdateCoachNoteBodySchema }),
  asyncHandler(async (req, res) => {
    const { id: swimmerId, noteId } = req.params as unknown as NoteIdParams;
    const body = req.body as UpdateCoachNoteBody;

    const swimmerRows = await db
      .select({ id: swimmers.id })
      .from(swimmers)
      .where(and(isActiveSwimmer, eq(swimmers.id, swimmerId)))
      .limit(1);

    if (!swimmerRows[0]) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const noteRows = await db
      .select({ id: coachNotes.id, swimmerId: coachNotes.swimmerId, createdBy: coachNotes.createdBy })
      .from(coachNotes)
      .where(eq(coachNotes.id, noteId))
      .limit(1);

    const note = noteRows[0];
    if (!note || note.swimmerId !== swimmerId) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    if (note.createdBy !== req.profile.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    await db
      .update(coachNotes)
      .set({
        body: body.body,
        noteType: body.noteType,
        ...(body.skillId !== undefined && { skillId: body.skillId }),
      })
      .where(eq(coachNotes.id, noteId));

    res.status(200).json({ ok: true });
  }),
);

coachSwimmersRouter.delete(
  "/:id/notes/:noteId",
  requireUser,
  requireCoach,
  validate({ params: NoteIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { id: swimmerId, noteId } = req.params as unknown as NoteIdParams;

    const swimmerRows = await db
      .select({ id: swimmers.id })
      .from(swimmers)
      .where(and(isActiveSwimmer, eq(swimmers.id, swimmerId)))
      .limit(1);

    if (!swimmerRows[0]) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const noteRows = await db
      .select({ id: coachNotes.id, swimmerId: coachNotes.swimmerId, createdBy: coachNotes.createdBy })
      .from(coachNotes)
      .where(eq(coachNotes.id, noteId))
      .limit(1);

    const note = noteRows[0];
    if (!note || note.swimmerId !== swimmerId) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    if (note.createdBy !== req.profile.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    await db.delete(coachNotes).where(eq(coachNotes.id, noteId));

    res.status(204).end();
  }),
);
