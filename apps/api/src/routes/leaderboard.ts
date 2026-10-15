import { Router } from "express";
import { and, eq, inArray, isNull } from "drizzle-orm";
import rateLimit from "express-rate-limit";
import { db } from "../db/client";
import { leagueRegistrations, motivationalStandards, swimmers } from "../db/schema";
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
  type MotivationalStandardName,
  calculateAge,
  currentSeasonStartYear,
  todayLA,
  formatSwimTime,
} from "@swim-app/shared";
import {
  type RawSwimmer,
  type RawStandard,
  fetchPbs,
  applyFilters,
  assignRanks,
  assignMasterRanks,
  highestStandard,
} from "../lib/leaderboard";

export const leaderboardRouter = Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

leaderboardRouter.use(limiter);

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
// Age group uses the registered_on date, not today. See ADR 023.

leaderboardRouter.get(
  "/leaderboard/isl",
  validate({ query: LeaderboardQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as LeaderboardQuery;
    const today = todayLA();
    const seasonYear = currentSeasonStartYear("summer_league", today);

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
      const ageDate = registeredOnMap.get(swimmer.id);
      if (!ageDate) return [];
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
// Eligibility: all active is_public swimmers regardless of league registration.
// See ADR 023.

leaderboardRouter.get(
  "/leaderboard/master",
  validate({ query: LeaderboardQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as LeaderboardQuery;
    const today = todayLA();

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
      standard: row.standard as MotivationalStandardName,
    }));

    const body: PublicMasterResponse = { standardsAvailable: true, rows };
    res.json(body);
  }),
);
