import { Router } from "express";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import type { IdParams } from "@swim-app/shared";
import { db } from "../db/client";
import { guardians, leagueRegistrations, profiles, swimmers, swimmerClubs } from "../db/schema";
import { requireUser } from "../middleware/requireUser";
import { requireCoach } from "../middleware/requireCoach";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/asyncHandler";
import { isActiveSwimmer } from "../db/queries";
import {
  IdParamsSchema,
  CoachVisibilityBodySchema,
  calculateAge,
  currentSeasonStartYear,
  todayLA,
  type CoachSwimmer,
  type CoachSwimmerDetail,
  type CoachVisibilityBody,
} from "@swim-app/shared";

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

    const [clubRows, regRows, guardianRows] = await Promise.all([
      db.select(swimmerClubColumns).from(swimmerClubs).where(inArray(swimmerClubs.swimmerId, swimmerIds)),
      db
        .select({ swimmerId: leagueRegistrations.swimmerId, league: leagueRegistrations.league })
        .from(leagueRegistrations)
        .where(activeRegsWhere(swimmerIds)),
      db
        .select({ swimmerId: guardians.swimmerId, fullName: profiles.fullName })
        .from(guardians)
        .innerJoin(profiles, eq(profiles.id, guardians.profileId))
        .where(inArray(guardians.swimmerId, swimmerIds)),
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

    const guardianNamesBySwimmer = new Map<string, string[]>();
    for (const row of guardianRows) {
      const names = guardianNamesBySwimmer.get(row.swimmerId) ?? [];
      if (row.fullName !== null) names.push(row.fullName);
      guardianNamesBySwimmer.set(row.swimmerId, names);
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
      guardianNames: guardianNamesBySwimmer.get(swimmer.id) ?? [],
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

    const [clubRows, regRows, guardianRows] = await Promise.all([
      db.select(swimmerClubColumns).from(swimmerClubs).where(eq(swimmerClubs.swimmerId, swimmerId)),
      db
        .select({ swimmerId: leagueRegistrations.swimmerId, league: leagueRegistrations.league })
        .from(leagueRegistrations)
        .where(activeRegsWhere([swimmerId])),
      db
        .select({ fullName: profiles.fullName, phone: profiles.phone })
        .from(guardians)
        .innerJoin(profiles, eq(profiles.id, guardians.profileId))
        .where(eq(guardians.swimmerId, swimmerId)),
    ]);

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
      guardians: guardianRows,
      guardianNames: guardianRows
        .map((g) => g.fullName)
        .filter((name): name is string => name !== null),
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
