import { Router } from "express";
import { and, eq, inArray, isNull, min, sql } from "drizzle-orm";
import rateLimit from "express-rate-limit";
import { db } from "../db/client";
import { leagueRegistrations, meetSwims, motivationalStandards, swimmers } from "../db/schema";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/asyncHandler";
import { isActiveSwimmer } from "../db/queries";
import {
  LeaderboardQuerySchema,
  type LeaderboardQuery,
  type PublicBoardRow,
  type PublicMasterRow,
  type PublicBoardResponse,
  type PublicMasterResponse,
  ageToGroup,
  type AgeGroup,
  type MotivationalStandardName,
  calculateAge,
  currentSeasonStartYear,
  todayLA,
  formatSwimTime,
} from "@swim-app/shared";

export const leaderboardRouter = Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

leaderboardRouter.use(limiter);

// ── Shared helpers ────────────────────────────────────────────────────────────

type RawSwimmer = {
  id: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  sex: "female" | "male";
};

type RawPb = {
  swimmerId: string;
  eventDistance: number;
  eventStroke: "free" | "back" | "breast" | "fly" | "im";
  course: "scy" | "scm" | "lcm";
  timeHundredths: number;
};

type RawStandard = {
  standardName: MotivationalStandardName;
  eventDistance: number;
  eventStroke: "free" | "back" | "breast" | "fly" | "im";
  course: "scy" | "scm" | "lcm";
  sex: "female" | "male";
  ageGroup: string;
  cutTimeHundredths: number;
};

const STANDARD_ORDER: Record<MotivationalStandardName, number> = {
  B: 1,
  BB: 2,
  A: 3,
  AA: 4,
  AAA: 5,
  AAAA: 6,
};

async function fetchPbs(swimmerIds: string[]): Promise<RawPb[]> {
  if (swimmerIds.length === 0) return [];
  return db
    .select({
      swimmerId: meetSwims.swimmerId,
      eventDistance: meetSwims.eventDistance,
      eventStroke: meetSwims.eventStroke,
      course: meetSwims.course,
      timeHundredths: min(meetSwims.timeHundredths).as("time_hundredths"),
    })
    .from(meetSwims)
    .where(and(eq(meetSwims.swimType, "meet"), inArray(meetSwims.swimmerId, swimmerIds)))
    .groupBy(meetSwims.swimmerId, meetSwims.eventDistance, meetSwims.eventStroke, meetSwims.course) as Promise<RawPb[]>;
}

function applyFilters<T extends { ageGroup: AgeGroup; sex: string; eventDistance: number; eventStroke: string; course: string }>(
  rows: T[],
  query: LeaderboardQuery,
): T[] {
  return rows.filter((row) => {
    if (query.ageGroup && row.ageGroup !== query.ageGroup) return false;
    if (query.sex && row.sex !== query.sex) return false;
    if (query.eventDistance && row.eventDistance !== query.eventDistance) return false;
    if (query.eventStroke && row.eventStroke !== query.eventStroke) return false;
    if (query.course && row.course !== query.course) return false;
    return true;
  });
}

// Rank within each (sex, ageGroup, eventDistance, eventStroke, course) partition.
// Ties on time share a rank (1,1,3 not 1,1,2).
function assignRanks<T extends { sex: string; ageGroup: string; eventDistance: number; eventStroke: string; course: string; timeHundredths: number }>(
  rows: T[],
): (T & { rank: number })[] {
  type GroupKey = string;
  const groups = new Map<GroupKey, T[]>();
  for (const row of rows) {
    const key = `${row.sex}|${row.ageGroup}|${row.eventDistance}|${row.eventStroke}|${row.course}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const result: (T & { rank: number })[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.timeHundredths - b.timeHundredths);
    let rank = 1;
    for (let index = 0; index < sorted.length; index++) {
      const row = sorted[index]!;
      if (index > 0 && row.timeHundredths !== sorted[index - 1]!.timeHundredths) {
        rank = index + 1;
      }
      result.push({ ...row, rank });
    }
  }
  return result;
}

function assignMasterRanks<
  T extends { sex: string; ageGroup: string; eventDistance: number; eventStroke: string; course: string; timeHundredths: number; standard: MotivationalStandardName },
>(rows: T[]): (T & { rank: number })[] {
  type GroupKey = string;
  const groups = new Map<GroupKey, T[]>();
  for (const row of rows) {
    const key = `${row.sex}|${row.ageGroup}|${row.eventDistance}|${row.eventStroke}|${row.course}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const result: (T & { rank: number })[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => {
      const standardDiff = STANDARD_ORDER[b.standard] - STANDARD_ORDER[a.standard];
      if (standardDiff !== 0) return standardDiff;
      return a.timeHundredths - b.timeHundredths;
    });
    let rank = 1;
    for (let index = 0; index < sorted.length; index++) {
      const row = sorted[index]!;
      if (index > 0) {
        const prev = sorted[index - 1]!;
        if (row.standard !== prev.standard || row.timeHundredths !== prev.timeHundredths) {
          rank = index + 1;
        }
      }
      result.push({ ...row, rank });
    }
  }
  return result;
}

function highestStandard(
  pb: RawPb,
  sex: "female" | "male",
  ageGroup: AgeGroup,
  allStandards: RawStandard[],
): MotivationalStandardName | null {
  let best: MotivationalStandardName | null = null;
  for (const standard of allStandards) {
    if (
      standard.eventDistance === pb.eventDistance &&
      standard.eventStroke === pb.eventStroke &&
      standard.course === pb.course &&
      standard.sex === sex &&
      standard.ageGroup === ageGroup &&
      pb.timeHundredths <= standard.cutTimeHundredths
    ) {
      if (best === null || STANDARD_ORDER[standard.standardName] > STANDARD_ORDER[best]) {
        best = standard.standardName;
      }
    }
  }
  return best;
}

// ── Club board ─────────────────────────────────────────────────────────────────

leaderboardRouter.get(
  "/leaderboard/club",
  validate({ query: LeaderboardQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as LeaderboardQuery;
    const today = todayLA();
    const seasonYear = currentSeasonStartYear("club", today);

    const registrations = await db
      .select({ swimmerId: leagueRegistrations.swimmerId })
      .from(leagueRegistrations)
      .where(
        and(
          eq(leagueRegistrations.league, "club"),
          eq(leagueRegistrations.seasonStartYear, seasonYear),
          isNull(leagueRegistrations.withdrawnAt),
        ),
      );

    const swimmerIds = registrations.map((row) => row.swimmerId);

    const eligibleSwimmers = swimmerIds.length === 0
      ? []
      : await db
          .select({
            id: swimmers.id,
            firstName: swimmers.firstName,
            lastName: swimmers.lastName,
            birthDate: swimmers.birthDate,
            sex: swimmers.sex,
          })
          .from(swimmers)
          .where(
            and(isActiveSwimmer, eq(swimmers.isPublic, true), inArray(swimmers.id, swimmerIds)),
          );

    const pbs = await fetchPbs(eligibleSwimmers.map((swimmer) => swimmer.id));

    const swimmerMap = new Map<string, RawSwimmer>(eligibleSwimmers.map((swimmer) => [swimmer.id, swimmer as RawSwimmer]));

    const rawRows = pbs.flatMap((pb) => {
      const swimmer = swimmerMap.get(pb.swimmerId);
      if (!swimmer) return [];
      const ageGroup = ageToGroup(calculateAge(swimmer.birthDate, today));
      if (!ageGroup) return [];
      return [{ ...pb, ...swimmer, ageGroup }];
    });

    const filtered = applyFilters(rawRows, query);
    const ranked = assignRanks(filtered);

    const rows: PublicBoardRow[] = ranked.map((row) => ({
      firstName: row.firstName,
      lastInitial: row.lastName.charAt(0).toUpperCase(),
      ageGroup: row.ageGroup,
      sex: row.sex,
      time: formatSwimTime(row.timeHundredths),
      eventDistance: row.eventDistance,
      eventStroke: row.eventStroke,
      course: row.course,
      rank: row.rank,
    }));

    const body: PublicBoardResponse = { rows };
    res.json(body);
  }),
);

// ── ISL board ──────────────────────────────────────────────────────────────────

leaderboardRouter.get(
  "/leaderboard/isl",
  validate({ query: LeaderboardQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as LeaderboardQuery;
    const today = todayLA();
    const seasonYear = currentSeasonStartYear("summer_league", today);

    // inferred: age uses registered_on date — confirm with Jason
    const registrations = await db
      .select({
        swimmerId: leagueRegistrations.swimmerId,
        registeredOn: leagueRegistrations.registeredOn,
      })
      .from(leagueRegistrations)
      .where(
        and(
          eq(leagueRegistrations.league, "summer_league"),
          eq(leagueRegistrations.seasonStartYear, seasonYear),
          isNull(leagueRegistrations.withdrawnAt),
        ),
      );

    const swimmerIds = registrations.map((row) => row.swimmerId);
    const registeredOnMap = new Map<string, string>(
      registrations.map((row) => [row.swimmerId, row.registeredOn]),
    );

    const eligibleSwimmers = swimmerIds.length === 0
      ? []
      : await db
          .select({
            id: swimmers.id,
            firstName: swimmers.firstName,
            lastName: swimmers.lastName,
            birthDate: swimmers.birthDate,
            sex: swimmers.sex,
          })
          .from(swimmers)
          .where(
            and(isActiveSwimmer, eq(swimmers.isPublic, true), inArray(swimmers.id, swimmerIds)),
          );

    const pbs = await fetchPbs(eligibleSwimmers.map((swimmer) => swimmer.id));

    const swimmerMap = new Map<string, RawSwimmer>(eligibleSwimmers.map((swimmer) => [swimmer.id, swimmer as RawSwimmer]));

    const rawRows = pbs.flatMap((pb) => {
      const swimmer = swimmerMap.get(pb.swimmerId);
      if (!swimmer) return [];
      const ageDate = registeredOnMap.get(swimmer.id) ?? today;
      const ageGroup = ageToGroup(calculateAge(swimmer.birthDate, ageDate));
      if (!ageGroup) return [];
      return [{ ...pb, ...swimmer, ageGroup }];
    });

    const filtered = applyFilters(rawRows, query);
    const ranked = assignRanks(filtered);

    const rows: PublicBoardRow[] = ranked.map((row) => ({
      firstName: row.firstName,
      lastInitial: row.lastName.charAt(0).toUpperCase(),
      ageGroup: row.ageGroup,
      sex: row.sex,
      time: formatSwimTime(row.timeHundredths),
      eventDistance: row.eventDistance,
      eventStroke: row.eventStroke,
      course: row.course,
      rank: row.rank,
    }));

    const body: PublicBoardResponse = { rows };
    res.json(body);
  }),
);

// ── Master board ───────────────────────────────────────────────────────────────

leaderboardRouter.get(
  "/leaderboard/master",
  validate({ query: LeaderboardQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as LeaderboardQuery;
    const today = todayLA();

    // inferred: master board eligibility is all active swimmers — confirm with Jason
    const allStandards = await db
      .select({
        standardName: motivationalStandards.standardName,
        eventDistance: motivationalStandards.eventDistance,
        eventStroke: motivationalStandards.eventStroke,
        course: motivationalStandards.course,
        sex: motivationalStandards.sex,
        ageGroup: motivationalStandards.ageGroup,
        cutTimeHundredths: motivationalStandards.cutTimeHundredths,
      })
      .from(motivationalStandards);

    if (allStandards.length === 0) {
      const body: PublicMasterResponse = { standardsAvailable: false, rows: [] };
      res.json(body);
      return;
    }

    const eligibleSwimmers = await db
      .select({
        id: swimmers.id,
        firstName: swimmers.firstName,
        lastName: swimmers.lastName,
        birthDate: swimmers.birthDate,
        sex: swimmers.sex,
      })
      .from(swimmers)
      .where(and(isActiveSwimmer, eq(swimmers.isPublic, true)));

    const pbs = await fetchPbs(eligibleSwimmers.map((swimmer) => swimmer.id));

    const swimmerMap = new Map<string, RawSwimmer>(eligibleSwimmers.map((swimmer) => [swimmer.id, swimmer as RawSwimmer]));

    const rawRows = pbs.flatMap((pb) => {
      const swimmer = swimmerMap.get(pb.swimmerId);
      if (!swimmer) return [];
      const ageGroup = ageToGroup(calculateAge(swimmer.birthDate, today));
      if (!ageGroup) return [];
      const standard = highestStandard(pb, swimmer.sex, ageGroup, allStandards as RawStandard[]);
      if (!standard) return [];
      return [{ ...pb, ...swimmer, ageGroup, standard }];
    });

    const filtered = applyFilters(rawRows, query);
    const ranked = assignMasterRanks(filtered);

    const rows: PublicMasterRow[] = ranked.map((row) => ({
      firstName: row.firstName,
      lastInitial: row.lastName.charAt(0).toUpperCase(),
      ageGroup: row.ageGroup,
      sex: row.sex,
      time: formatSwimTime(row.timeHundredths),
      eventDistance: row.eventDistance,
      eventStroke: row.eventStroke,
      course: row.course,
      rank: row.rank,
      standard: row.standard,
    }));

    const body: PublicMasterResponse = { standardsAvailable: true, rows };
    res.json(body);
  }),
);
