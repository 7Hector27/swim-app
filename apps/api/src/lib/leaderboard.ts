import { and, eq, inArray, min } from "drizzle-orm";
import { db } from "../db/client";
import { meetSwims } from "../db/schema";
import { type AgeGroup, type LeaderboardQuery, type MotivationalStandardName } from "@swim-app/shared";

export type RawSwimmer = {
  id: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  sex: "female" | "male";
};

export type RawPb = {
  swimmerId: string;
  eventDistance: number;
  eventStroke: "free" | "back" | "breast" | "fly" | "im";
  course: "scy" | "scm" | "lcm";
  timeHundredths: number;
};

export type RawStandard = {
  standardName: MotivationalStandardName;
  eventDistance: number;
  eventStroke: "free" | "back" | "breast" | "fly" | "im";
  course: "scy" | "scm" | "lcm";
  sex: "female" | "male";
  ageGroup: string;
  cutTimeHundredths: number;
};

export const STANDARD_ORDER: Record<MotivationalStandardName, number> = {
  B: 1,
  BB: 2,
  A: 3,
  AA: 4,
  AAA: 5,
  AAAA: 6,
};

export async function fetchPbs(swimmerIds: string[]): Promise<RawPb[]> {
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

export function applyFilters<
  T extends { ageGroup: AgeGroup; sex: string; eventDistance: number; eventStroke: string; course: string },
>(rows: T[], query: LeaderboardQuery): T[] {
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
export function assignRanks<
  T extends {
    sex: string;
    ageGroup: string;
    eventDistance: number;
    eventStroke: string;
    course: string;
    timeHundredths: number;
  },
>(rows: T[]): (T & { rank: number })[] {
  const groups = new Map<string, T[]>();
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

// Rank within each partition. If any row in the partition carries a
// standard, sort by standard (highest first) then fastest time; otherwise
// plain time ranking. Nullable standards participate as the "no standard"
// floor — a row with null is ranked below every row with a standard, then
// among null rows by time. Ties share a rank.
export function assignMasterRanks<
  T extends {
    sex: string;
    ageGroup: string;
    eventDistance: number;
    eventStroke: string;
    course: string;
    timeHundredths: number;
    standard: MotivationalStandardName | null;
  },
>(rows: T[]): (T & { rank: number })[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = `${row.sex}|${row.ageGroup}|${row.eventDistance}|${row.eventStroke}|${row.course}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const result: (T & { rank: number })[] = [];
  for (const group of groups.values()) {
    const hasAnyStandard = group.some((row) => row.standard !== null);
    const sorted = [...group].sort((a, b) => {
      if (hasAnyStandard) {
        const rankA = a.standard === null ? 0 : STANDARD_ORDER[a.standard];
        const rankB = b.standard === null ? 0 : STANDARD_ORDER[b.standard];
        const diff = rankB - rankA;
        if (diff !== 0) return diff;
      }
      return a.timeHundredths - b.timeHundredths;
    });
    let rank = 1;
    for (let index = 0; index < sorted.length; index++) {
      const row = sorted[index]!;
      if (index > 0) {
        const prev = sorted[index - 1]!;
        const keyA = `${row.standard ?? ""}|${row.timeHundredths}`;
        const keyB = `${prev.standard ?? ""}|${prev.timeHundredths}`;
        if (keyA !== keyB) rank = index + 1;
      }
      result.push({ ...row, rank });
    }
  }
  return result;
}

// Drop event lists (same sex, age group, event, stroke, course) that have
// fewer than `minCount` swimmers. Operates before `applyFilters` on public
// endpoints so query-filtered views can't accidentally reveal a small group.
export function filterByEventListThreshold<
  T extends {
    sex: string;
    ageGroup: string;
    eventDistance: number;
    eventStroke: string;
    course: string;
  },
>(rows: T[], minCount: number): T[] {
  if (minCount <= 1) return rows;
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.sex}|${row.ageGroup}|${row.eventDistance}|${row.eventStroke}|${row.course}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return rows.filter((row) => {
    const key = `${row.sex}|${row.ageGroup}|${row.eventDistance}|${row.eventStroke}|${row.course}`;
    return (counts.get(key) ?? 0) >= minCount;
  });
}

// Returns the highest motivational standard whose cut time the PB meets,
// or null if no standard applies.
export function highestStandard(
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
