import { Router } from "express";
import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "../db/client";
import { leagueRegistrations, swimmers, swimmerClubs } from "../db/schema";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireUser } from "../middleware/requireUser";
import { requireParent } from "../middleware/requireParent";
import { requireHouseholdMember } from "../middleware/requireHouseholdMember";
import { requireHouseholdSwimmer } from "../middleware/requireHouseholdSwimmer";
import { isActiveSwimmer } from "../db/queries";
import { computeSwimmerProgress } from "../lib/progressCalculation";
import {
  IdParamsSchema,
  currentSeasonStartYear,
  todayLA,
  type IdParams,
  type ParentSwimmer,
  type ParentSwimmerProgressResponse,
} from "@swim-app/shared";

export const parentProgressRouter = Router();

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
  publicConsentAt: swimmers.publicConsentAt,
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

function activeRegWhereClause(swimmerId: string) {
  const today = todayLA();
  const clubYear = currentSeasonStartYear("club", today);
  const summerYear = currentSeasonStartYear("summer_league", today);
  return and(
    eq(leagueRegistrations.swimmerId, swimmerId),
    isNull(leagueRegistrations.withdrawnAt),
    or(
      and(eq(leagueRegistrations.league, "club"), eq(leagueRegistrations.seasonStartYear, clubYear)),
      and(eq(leagueRegistrations.league, "summer_league"), eq(leagueRegistrations.seasonStartYear, summerYear)),
    ),
  );
}

async function fetchSwimmerWithClubs(swimmerId: string): Promise<ParentSwimmer | null> {
  const rows = await db
    .select(swimmerColumns)
    .from(swimmers)
    .where(and(isActiveSwimmer, eq(swimmers.id, swimmerId)))
    .limit(1);
  const swimmer = rows[0];
  if (!swimmer) return null;

  const [clubRows, regRows] = await Promise.all([
    db.select(swimmerClubColumns).from(swimmerClubs).where(eq(swimmerClubs.swimmerId, swimmerId)),
    db
      .select({ league: leagueRegistrations.league })
      .from(leagueRegistrations)
      .where(activeRegWhereClause(swimmerId)),
  ]);

  return {
    id: swimmer.id,
    firstName: swimmer.firstName,
    lastName: swimmer.lastName,
    birthDate: swimmer.birthDate,
    sex: swimmer.sex,
    isPublic: swimmer.isPublic,
    publicConsentAt: swimmer.publicConsentAt ? toISO(swimmer.publicConsentAt) : null,
    createdAt: toISO(swimmer.createdAt),
    updatedAt: toISO(swimmer.updatedAt),
    clubs: clubRows.map((club) => ({
      id: club.id,
      swimmerId: club.swimmerId,
      clubId: club.clubId,
      otherClubName: club.otherClubName,
      createdAt: toISO(club.createdAt),
      updatedAt: toISO(club.updatedAt),
    })),
    currentLeagues: regRows.map((row) => row.league),
  };
}

// GET /swimmers/:id — single swimmer for household members
parentProgressRouter.get(
  "/:id",
  requireUser,
  requireParent,
  requireHouseholdMember,
  requireHouseholdSwimmer,
  validate({ params: IdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { id: swimmerId } = req.params as unknown as IdParams;
    const swimmer = await fetchSwimmerWithClubs(swimmerId);
    if (!swimmer) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(swimmer);
  }),
);

// GET /swimmers/:id/progress — parent-facing progress (no fault tags)
parentProgressRouter.get(
  "/:id/progress",
  requireUser,
  requireParent,
  requireHouseholdMember,
  requireHouseholdSwimmer,
  validate({ params: IdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { id: swimmerId } = req.params as unknown as IdParams;
    const full = await computeSwimmerProgress(swimmerId);

    // Strip faultTags from every history point
    const parentSkills = full.skills.map((skill) => ({
      ...skill,
      history: skill.history.map(({ faultTags: _faultTags, ...point }) => point),
    }));

    const response: ParentSwimmerProgressResponse = {
      skills: parentSkills,
      startProgress: full.startProgress,
      headPositionOverall: full.headPositionOverall,
      coachingPriorities: full.coachingPriorities,
    };

    req.log.info({ swimmerId, skillCount: parentSkills.length }, "parent swimmer progress fetched");
    res.json(response);
  }),
);
