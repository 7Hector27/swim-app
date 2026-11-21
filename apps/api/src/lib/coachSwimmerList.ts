// Shared loader for the coach-facing swimmer list shape (CoachSwimmer[]).
//
// The /coach/swimmers roster and the /coach/households/:id/swimmers family
// panel both render the same per-swimmer card (name, age, clubs, current-
// season leagues, last lesson, household member names). Pulling the
// grouping + join logic in here keeps the two routes identical in output
// and lets future callers (progress exports, etc.) opt in with one
// predicate instead of copying ~80 lines of fan-out joins.

import { and, asc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import {
  currentSeasonStartYear,
  todayLA,
  type CoachSwimmer,
} from "@swim-app/shared";

import { db } from "../db/client";
import { isActiveSwimmer } from "../db/queries";
import {
  clubs,
  householdMembers,
  households,
  leagueRegistrations,
  lessonSwimmers,
  lessons,
  profiles,
  swimmerClubs,
  swimmers,
} from "../db/schema";
import { nowUtc } from "./clock";

// Detail-column set — includes `birthDate`, which the per-swimmer detail
// endpoint (/coach/swimmers/:id) returns in its CoachSwimmerDetail shape.
// The list endpoints never surface birthDate (they return `age` plus a
// `YYYY-MM` `birthMonthYear` used by the coach-only swimmer picker on the
// meet-detail page). Use `swimmerListColumns` below for lists and never
// select birthDate from it.
export const swimmerColumns = {
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

// List-column set — age is computed in SQL against LA today, so a raw
// birth_date value never crosses the wire from this file. Keeping this
// local (non-exported) makes the invariant explicit for any future caller
// building a list response: use this helper, don't hand-roll one that
// might accidentally forward the birthDate column.
const swimmerListColumns = {
  id: swimmers.id,
  firstName: swimmers.firstName,
  lastName: swimmers.lastName,
  age: sql<number>`EXTRACT(YEAR FROM AGE((now() AT TIME ZONE 'America/Los_Angeles')::date, ${swimmers.birthDate}))::int`.as("age"),
  // Coarse month-year derived from birthDate — enough to disambiguate two
  // same-name swimmers in a picker without exposing the full date.
  birthMonthYear: sql<string>`to_char(${swimmers.birthDate}, 'YYYY-MM')`.as("birth_month_year"),
  sex: swimmers.sex,
  isPublic: swimmers.isPublic,
  householdId: swimmers.householdId,
  createdAt: swimmers.createdAt,
  updatedAt: swimmers.updatedAt,
} as const;

export type SwimmerClubRow = {
  id: string;
  swimmerId: string;
  clubId: string | null;
  clubName: string | null;
  otherClubName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toISO(date: Date): string {
  return date.toISOString();
}

export function mapClub(club: SwimmerClubRow): CoachSwimmer["clubs"][number] {
  return {
    id: club.id,
    swimmerId: club.swimmerId,
    clubId: club.clubId,
    clubName: club.clubName,
    otherClubName: club.otherClubName,
    createdAt: toISO(club.createdAt),
    updatedAt: toISO(club.updatedAt),
  };
}

// Per-swimmer most recent lesson that has already started and wasn't
// cancelled or marked a no-show. One SQL round-trip via DISTINCT ON.
//
// Why `no_show` is excluded here while the dashboard's `/coach/stats`
// counts it: "last lesson" is the last actual coach-swimmer interaction,
// so a scheduled slot the swimmer didn't show up for should not reset the
// clock. The stats cards, by contrast, count booked sessions on the
// calendar — a no-show is still a session the coach planned around. Both
// are intentional; keep them in sync if the product definition shifts.
export async function fetchLastLessonsForSwimmers(
  swimmerIds: string[],
  now: Date,
): Promise<Map<string, { id: string; startsAt: Date }>> {
  const out = new Map<string, { id: string; startsAt: Date }>();
  if (swimmerIds.length === 0) return out;
  const rows = await db.execute<{
    swimmer_id: string;
    lesson_id: string;
    starts_at: Date;
  }>(sql`
    SELECT DISTINCT ON (${lessonSwimmers.swimmerId})
      ${lessonSwimmers.swimmerId} AS swimmer_id,
      ${lessons.id} AS lesson_id,
      ${lessons.startsAt} AS starts_at
    FROM ${lessonSwimmers}
    INNER JOIN ${lessons} ON ${lessons.id} = ${lessonSwimmers.lessonId}
    WHERE ${lessonSwimmers.swimmerId} IN (${sql.join(
      swimmerIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
      AND ${lessons.startsAt} <= ${now.toISOString()}::timestamptz
      AND ${lessons.status} NOT IN ('canceled', 'no_show')
    ORDER BY ${lessonSwimmers.swimmerId}, ${lessons.startsAt} DESC
  `);
  for (const row of rows) {
    out.set(row.swimmer_id, {
      id: row.lesson_id,
      startsAt: row.starts_at instanceof Date ? row.starts_at : new Date(row.starts_at),
    });
  }
  return out;
}

export function activeRegsWhere(swimmerIds: string[]) {
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

// Loads active swimmers matching `extraWhere` (archived rows are always
// excluded) and hydrates them with clubs, current-season leagues, household
// member names, and last-completed lesson.
export async function loadCoachSwimmerList(
  extraWhere?: SQL,
): Promise<CoachSwimmer[]> {
  const whereClause = extraWhere ? and(isActiveSwimmer, extraWhere) : isActiveSwimmer;

  const swimmerRows = await db
    .select(swimmerListColumns)
    .from(swimmers)
    .where(whereClause)
    .orderBy(asc(swimmers.lastName), asc(swimmers.firstName));

  if (swimmerRows.length === 0) return [];

  const swimmerIds = swimmerRows.map((row) => row.id);
  const householdIds = [...new Set(swimmerRows.map((row) => row.householdId))];

  const [clubRows, regRows, memberRows, householdRows, lastLessonBySwimmer] = await Promise.all([
    db
      .select({
        id: swimmerClubs.id,
        swimmerId: swimmerClubs.swimmerId,
        clubId: swimmerClubs.clubId,
        clubName: clubs.name,
        otherClubName: swimmerClubs.otherClubName,
        createdAt: swimmerClubs.createdAt,
        updatedAt: swimmerClubs.updatedAt,
      })
      .from(swimmerClubs)
      .leftJoin(clubs, eq(swimmerClubs.clubId, clubs.id))
      .where(inArray(swimmerClubs.swimmerId, swimmerIds)),
    db
      .select({ swimmerId: leagueRegistrations.swimmerId, league: leagueRegistrations.league })
      .from(leagueRegistrations)
      .where(activeRegsWhere(swimmerIds)),
    db
      .select({ householdId: householdMembers.householdId, fullName: profiles.fullName })
      .from(householdMembers)
      .innerJoin(profiles, eq(profiles.id, householdMembers.profileId))
      .where(inArray(householdMembers.householdId, householdIds)),
    db
      .select({ id: households.id, name: households.name })
      .from(households)
      .where(inArray(households.id, householdIds)),
    fetchLastLessonsForSwimmers(swimmerIds, nowUtc()),
  ]);

  const householdNameById = new Map(householdRows.map((row) => [row.id, row.name]));

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

  return swimmerRows.map((swimmer) => {
    const last = lastLessonBySwimmer.get(swimmer.id);
    return {
      id: swimmer.id,
      firstName: swimmer.firstName,
      lastName: swimmer.lastName,
      age: Number(swimmer.age),
      sex: swimmer.sex,
      isPublic: swimmer.isPublic,
      createdAt: toISO(swimmer.createdAt),
      updatedAt: toISO(swimmer.updatedAt),
      clubs: (clubsBySwimmer.get(swimmer.id) ?? []).map(mapClub),
      currentLeagues: leaguesBySwimmer.get(swimmer.id) ?? [],
      memberNames: memberNamesByHousehold.get(swimmer.householdId) ?? [],
      householdName: householdNameById.get(swimmer.householdId) ?? "",
      birthMonthYear: swimmer.birthMonthYear,
      lastLesson: last ? { id: last.id, startsAt: toISO(last.startsAt) } : null,
    };
  });
}
