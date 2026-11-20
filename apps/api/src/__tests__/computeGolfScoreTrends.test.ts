// Direct unit tests for computeGolfScoreTrends. The route-level tests in
// golfScoreTrends.test.ts exercise the HTTP surface; this file drives the
// shared library function directly so the N+1 fix can be asserted as
// "exactly one cohort select across all (slug, category) combinations"
// and the age-band output can be pinned to known values for a fixture
// with several strokes and categories.

import { vi, describe, it, expect, beforeEach } from "vitest";
import pino from "pino";

// ── Fixture data ─────────────────────────────────────────────────────────

const SWIMMER_ID = "cccccccc-0000-0000-0000-000000000001";
const FREE_SKILL_ID = "dddddddd-0000-0000-0000-000000000001";
const BACK_SKILL_ID = "dddddddd-0000-0000-0000-000000000002";
const FREE_SLUG = "free-golf-score";
const BACK_SLUG = "back-golf-score";

// Target swimmer is age 12 (birthDate 2013-05-10, today ~2026-01-01), so
// ageGroup is 11-12. Cohort consists of eleven swimmers in the same group
// (over the 10-swimmer minimum so a band is emitted).
const BIRTH_DATE = "2013-05-10";

const freePushRatings = [
  // Swimmer's own ratings for Freestyle / push-off
  mkRating({ skillId: FREE_SKILL_ID, slug: FREE_SLUG, name: "Freestyle golf score", category: "push_off_in_water", time: "14.0", strokes: 22, ratedAt: "2026-11-01T12:00:00Z", sessionDate: "2026-11-01", grade: 3, sessionId: "ssss-1" }),
  mkRating({ skillId: FREE_SKILL_ID, slug: FREE_SLUG, name: "Freestyle golf score", category: "push_off_in_water", time: "13.0", strokes: 21, ratedAt: "2026-11-15T12:00:00Z", sessionDate: "2026-11-15", grade: 3, sessionId: "ssss-2" }),
];
const freeBlockRatings = [
  mkRating({ skillId: FREE_SKILL_ID, slug: FREE_SLUG, name: "Freestyle golf score", category: "block_dive", time: "12.5", strokes: 20, ratedAt: "2026-11-15T12:00:00Z", sessionDate: "2026-11-15", grade: 3, sessionId: "ssss-2" }),
];
const backPushRatings = [
  mkRating({ skillId: BACK_SKILL_ID, slug: BACK_SLUG, name: "Backstroke golf score", category: "push_off_in_water", time: "16.0", strokes: 25, ratedAt: "2026-11-15T12:00:00Z", sessionDate: "2026-11-15", grade: 3, sessionId: "ssss-2" }),
];

const ownRatings = [...freePushRatings, ...freeBlockRatings, ...backPushRatings];

// Fifteen cohort swimmers in the age group so there's enough data for a
// band on every (slug, category) pair this swimmer rated. Each has one
// rating per category of each slug, to keep the test deterministic.
const COHORT_IDS = Array.from({ length: 15 }, (_, index) => `aaaaaaaa-0000-0000-0000-00000000${String(index).padStart(4, "0")}`);
const COHORT_BIRTHDATE = "2013-05-10"; // same age group

// Cohort rating rows, sorted by (swimmerId, desc(ratedAt)) — the real SQL
// orders this way. Values are spaced so percentile math is easy to verify.
function cohortRows() {
  const rows: Array<{
    swimmerId: string;
    slug: string;
    category: string;
    timeSeconds: string;
    strokeCountValue: number;
    ratedAt: Date;
  }> = [];
  for (let index = 0; index < COHORT_IDS.length; index += 1) {
    const id = COHORT_IDS[index]!;
    // Freestyle / push-off: scores 35 + index (cohort total = 35..49)
    rows.push({ swimmerId: id, slug: FREE_SLUG, category: "push_off_in_water", timeSeconds: `${(15 + index).toFixed(1)}`, strokeCountValue: 20, ratedAt: new Date("2026-10-01T12:00:00Z") });
    // Freestyle / block_dive: scores 30 + index (cohort total = 30..44)
    rows.push({ swimmerId: id, slug: FREE_SLUG, category: "block_dive", timeSeconds: `${(13 + index).toFixed(1)}`, strokeCountValue: 17, ratedAt: new Date("2026-10-01T12:00:00Z") });
    // Backstroke / push-off: scores 40 + index (cohort total = 40..54)
    rows.push({ swimmerId: id, slug: BACK_SLUG, category: "push_off_in_water", timeSeconds: `${(18 + index).toFixed(1)}`, strokeCountValue: 22, ratedAt: new Date("2026-10-01T12:00:00Z") });
  }
  // Sort by swimmerId ascending then by desc(ratedAt) — matches the SQL.
  rows.sort((a, b) => {
    if (a.swimmerId !== b.swimmerId) return a.swimmerId < b.swimmerId ? -1 : 1;
    return b.ratedAt.getTime() - a.ratedAt.getTime();
  });
  return rows;
}

function mkRating(options: {
  skillId: string;
  slug: string;
  name: string;
  category: string;
  time: string;
  strokes: number;
  ratedAt: string;
  sessionDate: string;
  grade: number;
  sessionId: string;
}) {
  return {
    grade: options.grade,
    timeSeconds: options.time,
    strokeCountValue: options.strokes,
    golfScoreCategory: options.category,
    ratedAt: new Date(options.ratedAt),
    sessionId: options.sessionId,
    sessionDate: options.sessionDate,
    skillId: options.skillId,
    slug: options.slug,
    name: options.name,
  };
}

// ── Mocks ────────────────────────────────────────────────────────────────

const { mockDbSelect } = vi.hoisted(() => ({ mockDbSelect: vi.fn() }));

vi.mock("../db/client", () => ({
  db: {
    select: mockDbSelect,
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
  },
}));

import { computeGolfScoreTrends } from "../lib/golfScoreTrends";

const logger = pino({ level: "silent" });

beforeEach(() => {
  vi.resetAllMocks();
});

// Each helper matches one of the four select chains the function issues
// in order:
//   1. ratings for the target swimmer
//   2. swimmer row (birthDate)
//   3. cohort swimmer IDs
//   4. cohort rating rows across every (slug, category) — ONCE total
function ratingsChain(rows: unknown[]) {
  return {
    from: () => ({
      innerJoin: () => ({
        innerJoin: () => ({
          where: () => ({ orderBy: () => Promise.resolve(rows) }),
        }),
      }),
    }),
  };
}

function swimmerRowChain(rows: unknown[]) {
  return {
    from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }),
  };
}

function cohortIdsChain(rows: unknown[]) {
  return {
    from: () => ({ where: () => Promise.resolve(rows) }),
  };
}

function cohortScoresChain(rows: unknown[], onCall: () => void) {
  return {
    from: () => ({
      innerJoin: () => ({
        where: () => ({
          orderBy: () => {
            onCall();
            return Promise.resolve(rows);
          },
        }),
      }),
    }),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("computeGolfScoreTrends — N+1 fix", () => {
  it("runs the cohort-scores query exactly ONCE regardless of how many (slug, category) combinations the swimmer has", async () => {
    let cohortSelectCount = 0;
    mockDbSelect
      .mockReturnValueOnce(ratingsChain(ownRatings))
      .mockReturnValueOnce(swimmerRowChain([{ birthDate: BIRTH_DATE }]))
      .mockReturnValueOnce(cohortIdsChain(COHORT_IDS.map((id) => ({ id, birthDate: COHORT_BIRTHDATE }))))
      .mockReturnValueOnce(cohortScoresChain(cohortRows(), () => { cohortSelectCount += 1; }));

    const result = await computeGolfScoreTrends(SWIMMER_ID, logger);

    // 2 slugs × 2+ categories would have triggered 3 cohort queries in the
    // old implementation. The fix collapses them to one.
    expect(cohortSelectCount).toBe(1);
    // Four select() calls total: ratings + swimmer + cohortIds + cohortScores.
    expect(mockDbSelect).toHaveBeenCalledTimes(4);
    // Shape sanity: two skills rendered.
    expect(result.trends.map((trend) => trend.skillSlug).sort()).toEqual([BACK_SLUG, FREE_SLUG]);
  });

  it("produces the same per-category output a per-(slug,category) query would — pinned to known values", async () => {
    mockDbSelect
      .mockReturnValueOnce(ratingsChain(ownRatings))
      .mockReturnValueOnce(swimmerRowChain([{ birthDate: BIRTH_DATE }]))
      .mockReturnValueOnce(cohortIdsChain(COHORT_IDS.map((id) => ({ id, birthDate: COHORT_BIRTHDATE }))))
      .mockReturnValueOnce(cohortScoresChain(cohortRows(), () => {}));

    const result = await computeGolfScoreTrends(SWIMMER_ID, logger);

    // Each cohort swimmer has exactly one rating per (slug, category) in
    // the fixture, so the cohort N for each band is 15. Values are a
    // simple linear series:
    //
    //   FREE / push_off_in_water  → time 15..29, strokes 20 → total 35..49
    //   FREE / block_dive          → time 13..27, strokes 17 → total 30..44
    //   BACK / push_off_in_water  → time 18..32, strokes 22 → total 40..54
    //
    // Percentiles on a linear series i..i+14 are known: p25 = i+3.5,
    // p50 = i+7, p75 = i+10.5.
    const free = result.trends.find((trend) => trend.skillSlug === FREE_SLUG)!;
    const back = result.trends.find((trend) => trend.skillSlug === BACK_SLUG)!;

    const freePush = free.byCategory.find((cat) => cat.category === "push_off_in_water")!;
    expect(freePush.ageBands).toEqual({ bandCount: 15, p25: 38.5, p50: 42, p75: 45.5 });
    const freeBlock = free.byCategory.find((cat) => cat.category === "block_dive")!;
    expect(freeBlock.ageBands).toEqual({ bandCount: 15, p25: 33.5, p50: 37, p75: 40.5 });
    const backPush = back.byCategory.find((cat) => cat.category === "push_off_in_water")!;
    expect(backPush.ageBands).toEqual({ bandCount: 15, p25: 43.5, p50: 47, p75: 50.5 });
  });

  it("audience: 'parent' builds points WITHOUT sessionId so the field never leaves the library", async () => {
    mockDbSelect
      .mockReturnValueOnce(ratingsChain(ownRatings))
      .mockReturnValueOnce(swimmerRowChain([{ birthDate: BIRTH_DATE }]))
      .mockReturnValueOnce(cohortIdsChain(COHORT_IDS.map((id) => ({ id, birthDate: COHORT_BIRTHDATE }))))
      .mockReturnValueOnce(cohortScoresChain(cohortRows(), () => {}));

    const result = await computeGolfScoreTrends(SWIMMER_ID, logger, { audience: "parent" });

    for (const trend of result.trends) {
      for (const category of trend.byCategory) {
        for (const point of category.points) {
          expect(
            "sessionId" in point,
            `parent point should not carry sessionId (saw it on ${trend.skillSlug}/${category.category})`,
          ).toBe(false);
        }
      }
    }
  });

  it("audience: 'coach' (default) keeps sessionId on every point", async () => {
    mockDbSelect
      .mockReturnValueOnce(ratingsChain(ownRatings))
      .mockReturnValueOnce(swimmerRowChain([{ birthDate: BIRTH_DATE }]))
      .mockReturnValueOnce(cohortIdsChain(COHORT_IDS.map((id) => ({ id, birthDate: COHORT_BIRTHDATE }))))
      .mockReturnValueOnce(cohortScoresChain(cohortRows(), () => {}));

    const result = await computeGolfScoreTrends(SWIMMER_ID, logger);

    for (const trend of result.trends) {
      for (const category of trend.byCategory) {
        for (const point of category.points) {
          expect(typeof point.sessionId).toBe("string");
        }
      }
    }
  });

  it("emits no ageBands when the cohort has fewer than ten rated swimmers", async () => {
    // Trim cohort to nine and run only Freestyle / push-off.
    const trimmedCohort = COHORT_IDS.slice(0, 9);
    const trimmedCohortRows = cohortRows().filter((row) => trimmedCohort.includes(row.swimmerId));

    mockDbSelect
      .mockReturnValueOnce(ratingsChain(freePushRatings))
      .mockReturnValueOnce(swimmerRowChain([{ birthDate: BIRTH_DATE }]))
      .mockReturnValueOnce(cohortIdsChain(trimmedCohort.map((id) => ({ id, birthDate: COHORT_BIRTHDATE }))))
      .mockReturnValueOnce(cohortScoresChain(trimmedCohortRows, () => {}));

    const result = await computeGolfScoreTrends(SWIMMER_ID, logger);
    const free = result.trends.find((trend) => trend.skillSlug === FREE_SLUG)!;
    const freePush = free.byCategory.find((cat) => cat.category === "push_off_in_water")!;
    expect(freePush.ageBands).toBeNull();
  });
});
