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
  LeaderboardSummarySchema,
  MIN_SWIMMERS_PER_EVENT_LIST,
  type LeaderboardBoardId,
  type LeaderboardQuery,
  PublicBoardResponseSchema,
  PublicMasterResponseSchema,
  ageToGroup,
  type AgeGroup,
  type MotivationalStandardName,
  calculateAge,
  currentSeasonStartYear,
  todayLA,
  formatSwimTime,
} from "@swim-app/shared";
import {
  type RawStandard,
  fetchPbs,
  applyFilters,
  assignRanks,
  assignMasterRanks,
  filterByEventListThreshold,
  highestStandard,
} from "../lib/leaderboard";

export const leaderboardRouter = Router();

// Rate limit only the three heavy public board endpoints. `/leaderboard/
// summary` is intentionally exempt: the web root layout uses it to decide
// whether to render the Leaderboards nav links, and every server-side
// render comes from the same web-host IP pool. If the summary shared this
// limiter with the heavy endpoints, a scraper hammering any board could
// starve the summary and hide the nav for every user on that Next.js
// instance for a minute. The summary is already cheap (LRU-cached on the
// API, see summaryCache below) and tiny.
const boardLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

// ── Board loaders (shared by endpoints + summary) ──────────────────────────

type ClubRow = {
  firstName: string;
  lastInitial: string;
  sex: "female" | "male";
  ageGroup: AgeGroup;
  eventDistance: number;
  eventStroke: "free" | "back" | "breast" | "fly" | "im";
  course: "scy" | "scm" | "lcm";
  timeHundredths: number;
};

type MasterRow = ClubRow & { standard: MotivationalStandardName | null };

async function loadLeagueBoardRows(league: "club" | "summer_league"): Promise<ClubRow[]> {
  const today = todayLA();
  const seasonYear = currentSeasonStartYear(league, today);

  const registrations = await db
    .select({
      swimmerId: leagueRegistrations.swimmerId,
      registeredOn: leagueRegistrations.registeredOn,
    })
    .from(leagueRegistrations)
    .where(
      and(
        eq(leagueRegistrations.league, league),
        eq(leagueRegistrations.seasonStartYear, seasonYear),
        isNull(leagueRegistrations.withdrawnAt),
      ),
    );

  const swimmerIds = registrations.map((row) => row.swimmerId);
  if (swimmerIds.length === 0) return [];

  // ISL uses `registeredOn` for age (ADR 023); club uses today.
  const ageDateBySwimmer = new Map<string, string>(
    registrations.map((row) => [row.swimmerId, league === "summer_league" ? row.registeredOn : today]),
  );

  const eligibleSwimmers = await db
    .select({
      id: swimmers.id,
      firstName: swimmers.firstName,
      lastName: swimmers.lastName,
      birthDate: swimmers.birthDate,
      sex: swimmers.sex,
    })
    .from(swimmers)
    .where(and(isActiveSwimmer, eq(swimmers.isPublic, true), inArray(swimmers.id, swimmerIds)));

  const pbs = await fetchPbs(eligibleSwimmers.map((swimmer) => swimmer.id));
  const swimmerMap = new Map(eligibleSwimmers.map((swimmer) => [swimmer.id, swimmer]));

  // Age group + lastInitial resolved here; birthDate, id, and lastName never
  // cross the public boundary.
  return pbs.flatMap((pb) => {
    const swimmer = swimmerMap.get(pb.swimmerId);
    if (!swimmer) return [];
    const ageDate = ageDateBySwimmer.get(swimmer.id);
    if (!ageDate) return [];
    const ageGroup = ageToGroup(calculateAge(swimmer.birthDate, ageDate));
    if (!ageGroup) return [];
    return [{
      firstName: swimmer.firstName,
      lastInitial: swimmer.lastName.charAt(0).toUpperCase(),
      sex: swimmer.sex,
      ageGroup,
      eventDistance: pb.eventDistance,
      eventStroke: pb.eventStroke,
      course: pb.course,
      timeHundredths: pb.timeHundredths,
    }];
  });
}

async function loadMasterBoardRows(): Promise<MasterRow[]> {
  const today = todayLA();

  const [allStandardsRaw, eligibleSwimmers] = await Promise.all([
    db
      .select({
        standardName: motivationalStandards.standardName,
        eventDistance: motivationalStandards.eventDistance,
        eventStroke: motivationalStandards.eventStroke,
        course: motivationalStandards.course,
        sex: motivationalStandards.sex,
        ageGroup: motivationalStandards.ageGroup,
        cutTimeHundredths: motivationalStandards.cutTimeHundredths,
      })
      .from(motivationalStandards),
    db
      .select({
        id: swimmers.id,
        firstName: swimmers.firstName,
        lastName: swimmers.lastName,
        birthDate: swimmers.birthDate,
        sex: swimmers.sex,
      })
      .from(swimmers)
      .where(and(isActiveSwimmer, eq(swimmers.isPublic, true))),
  ]);
  const allStandards = allStandardsRaw as RawStandard[];

  const pbs = await fetchPbs(eligibleSwimmers.map((swimmer) => swimmer.id));
  const swimmerMap = new Map(eligibleSwimmers.map((swimmer) => [swimmer.id, swimmer]));

  // ADR 023 (decided): master board no longer requires standards. Every
  // eligible swimmer with a meet time appears. A standard is attached when
  // one exists for the row's (event, stroke, course, sex, age) and the PB
  // meets its cut; otherwise it's null and the row is ranked purely by time.
  return pbs.flatMap((pb) => {
    const swimmer = swimmerMap.get(pb.swimmerId);
    if (!swimmer) return [];
    const ageGroup = ageToGroup(calculateAge(swimmer.birthDate, today));
    if (!ageGroup) return [];
    const standard = allStandards.length === 0
      ? null
      : highestStandard(pb, swimmer.sex, ageGroup, allStandards);
    return [{
      firstName: swimmer.firstName,
      lastInitial: swimmer.lastName.charAt(0).toUpperCase(),
      sex: swimmer.sex,
      ageGroup,
      eventDistance: pb.eventDistance,
      eventStroke: pb.eventStroke,
      course: pb.course,
      timeHundredths: pb.timeHundredths,
      standard,
    }];
  });
}

// ── Club board ─────────────────────────────────────────────────────────────

leaderboardRouter.get(
  "/leaderboard/club",
  boardLimiter,
  validate({ query: LeaderboardQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as LeaderboardQuery;
    const rawRows = await loadLeagueBoardRows("club");
    const qualifying = filterByEventListThreshold(rawRows, MIN_SWIMMERS_PER_EVENT_LIST);
    const filtered = applyFilters(qualifying, query);
    const ranked = assignRanks(filtered);

    const rows = ranked.map((row) => ({
      firstName: row.firstName,
      lastInitial: row.lastInitial,
      ageGroup: row.ageGroup,
      sex: row.sex,
      time: formatSwimTime(row.timeHundredths),
      eventDistance: row.eventDistance,
      eventStroke: row.eventStroke,
      course: row.course,
      rank: row.rank,
    }));

    res.json(PublicBoardResponseSchema.parse({ rows }));
  }),
);

// ── ISL board ──────────────────────────────────────────────────────────────

leaderboardRouter.get(
  "/leaderboard/isl",
  boardLimiter,
  validate({ query: LeaderboardQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as LeaderboardQuery;
    const rawRows = await loadLeagueBoardRows("summer_league");
    const qualifying = filterByEventListThreshold(rawRows, MIN_SWIMMERS_PER_EVENT_LIST);
    const filtered = applyFilters(qualifying, query);
    const ranked = assignRanks(filtered);

    const rows = ranked.map((row) => ({
      firstName: row.firstName,
      lastInitial: row.lastInitial,
      ageGroup: row.ageGroup,
      sex: row.sex,
      time: formatSwimTime(row.timeHundredths),
      eventDistance: row.eventDistance,
      eventStroke: row.eventStroke,
      course: row.course,
      rank: row.rank,
    }));

    res.json(PublicBoardResponseSchema.parse({ rows }));
  }),
);

// ── Master board ───────────────────────────────────────────────────────────

leaderboardRouter.get(
  "/leaderboard/master",
  boardLimiter,
  validate({ query: LeaderboardQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as LeaderboardQuery;
    const rawRows = await loadMasterBoardRows();
    const qualifying = filterByEventListThreshold(rawRows, MIN_SWIMMERS_PER_EVENT_LIST);
    const filtered = applyFilters(qualifying, query);
    const ranked = assignMasterRanks(filtered);

    const rows = ranked.map((row) => ({
      firstName: row.firstName,
      lastInitial: row.lastInitial,
      ageGroup: row.ageGroup,
      sex: row.sex,
      time: formatSwimTime(row.timeHundredths),
      eventDistance: row.eventDistance,
      eventStroke: row.eventStroke,
      course: row.course,
      rank: row.rank,
      standard: row.standard,
    }));

    res.json(PublicMasterResponseSchema.parse({ rows }));
  }),
);

// ── Summary ────────────────────────────────────────────────────────────────
// Lightweight endpoint the homepage, landing page, and nav call to decide
// whether to show leaderboard surfaces. A board "qualifies" when it has at
// least one event list with ≥ MIN_SWIMMERS_PER_EVENT_LIST swimmers.
//
// This route is deliberately NOT behind boardLimiter — it's what the web
// server hits on every SSR to decide nav visibility, and all of those
// requests come from the same handful of outbound IPs. A per-IP limit
// here would let a scraper hide the nav for every user.
//
// Instead we memoize the result for SUMMARY_TTL_MS on each API instance.
// Each Next.js SSR instance already passes `revalidate: 60` on its fetch,
// so the end-to-end cache is Next Data Cache (≤60s per Next instance) →
// this in-memory cache (60s per API instance) → three cold loaders. On a
// warm cache the handler runs zero queries.

const SUMMARY_TTL_MS = 60 * 1000;

interface SummaryCacheEntry {
  expiresAt: number;
  qualifying: LeaderboardBoardId[];
}

let summaryCache: SummaryCacheEntry | null = null;

// Exported for tests so a fresh run isn't contaminated by a prior request.
export function clearLeaderboardSummaryCache(): void {
  summaryCache = null;
}

async function computeLeaderboardSummary(): Promise<LeaderboardBoardId[]> {
  const [club, isl, master] = await Promise.all([
    loadLeagueBoardRows("club").then((rows) => filterByEventListThreshold(rows, MIN_SWIMMERS_PER_EVENT_LIST)),
    loadLeagueBoardRows("summer_league").then((rows) => filterByEventListThreshold(rows, MIN_SWIMMERS_PER_EVENT_LIST)),
    loadMasterBoardRows().then((rows) => filterByEventListThreshold(rows, MIN_SWIMMERS_PER_EVENT_LIST)),
  ]);
  const qualifying: LeaderboardBoardId[] = [];
  if (club.length > 0) qualifying.push("club");
  if (isl.length > 0) qualifying.push("isl");
  if (master.length > 0) qualifying.push("master");
  return qualifying;
}

leaderboardRouter.get(
  "/leaderboard/summary",
  validate({}),
  asyncHandler(async (_req, res) => {
    const now = Date.now();
    if (summaryCache && summaryCache.expiresAt > now) {
      res.json(LeaderboardSummarySchema.parse({ qualifying: summaryCache.qualifying }));
      return;
    }
    const qualifying = await computeLeaderboardSummary();
    summaryCache = { qualifying, expiresAt: now + SUMMARY_TTL_MS };
    res.json(LeaderboardSummarySchema.parse({ qualifying }));
  }),
);
