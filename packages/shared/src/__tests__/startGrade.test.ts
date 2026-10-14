import { describe, expect, it } from "vitest";
import { calculateStartGrade } from "../lib/startGrade";
import type { RatingRecord } from "../lib/dependencyMap";

// Representative component slugs for a track start (6 child skills).
const SLUGS = [
  "track-start-reaction-time",
  "track-start-block-position",
  "track-start-entry-angle",
  "track-start-entry-point",
  "track-start-streamline",
  "track-start-breakout",
] as const;

function rating(
  skillSlug: string,
  overrides: Partial<RatingRecord> = {},
): RatingRecord {
  return {
    skillSlug,
    grade: 3,
    notLegal: false,
    noConcept: false,
    ratedAt: "2024-01-01T10:00:00Z",
    voidedAt: null,
    ...overrides,
  };
}

function allSix(grade: 1 | 2 | 3 | 4 | 5 = 3): RatingRecord[] {
  return SLUGS.map((slug) => rating(slug, { grade }));
}

describe("calculateStartGrade", () => {
  it("returns graded with floor(avg) when all 6 components are rated", () => {
    const ratings = [
      rating("track-start-reaction-time", { grade: 4 }),
      rating("track-start-block-position", { grade: 3 }),
      rating("track-start-entry-angle", { grade: 5 }),
      rating("track-start-entry-point", { grade: 3 }),
      rating("track-start-streamline", { grade: 4 }),
      rating("track-start-breakout", { grade: 3 }),
    ];
    // avg = (4+3+5+3+4+3)/6 = 22/6 = 3.66… → floor = 3
    expect(calculateStartGrade([...SLUGS], ratings)).toEqual({ status: "graded", grade: 3 });
  });

  it("returns in_progress when no components are rated", () => {
    const result = calculateStartGrade([...SLUGS], []);
    expect(result).toEqual({
      status: "in_progress",
      missing: expect.arrayContaining([...SLUGS]),
    });
    if (result.status === "in_progress") {
      expect(result.missing).toHaveLength(6);
    }
  });

  it("returns in_progress listing exactly the missing component slugs", () => {
    const ratings = [
      rating("track-start-reaction-time"),
      rating("track-start-block-position"),
      rating("track-start-entry-angle"),
    ];
    const result = calculateStartGrade([...SLUGS], ratings);
    expect(result).toEqual({
      status: "in_progress",
      missing: expect.arrayContaining([
        "track-start-entry-point",
        "track-start-streamline",
        "track-start-breakout",
      ]),
    });
    if (result.status === "in_progress") {
      expect(result.missing).toHaveLength(3);
    }
  });

  it("returns not_legal when any component is not_legal, even with missing components", () => {
    const ratings = [
      rating("track-start-reaction-time", { notLegal: true }),
      rating("track-start-block-position"),
      // 4 components missing
    ];
    expect(calculateStartGrade([...SLUGS], ratings)).toEqual({ status: "not_legal" });
  });

  it("returns not_legal when all 6 rated and one is not_legal", () => {
    const ratings = allSix().map((r) =>
      r.skillSlug === "track-start-entry-angle" ? { ...r, notLegal: true } : r,
    );
    expect(calculateStartGrade([...SLUGS], ratings)).toEqual({ status: "not_legal" });
  });

  it("returns no_concept when all 6 are rated no_concept", () => {
    const ratings = SLUGS.map((slug) =>
      rating(slug, { grade: null, noConcept: true }),
    );
    expect(calculateStartGrade([...SLUGS], ratings)).toEqual({ status: "no_concept" });
  });

  it("excludes no_concept components from the average but counts them as rated", () => {
    const ratings = [
      rating("track-start-reaction-time", { grade: 4 }),
      rating("track-start-block-position", { grade: 4 }),
      rating("track-start-entry-angle", { grade: null, noConcept: true }),
      rating("track-start-entry-point", { grade: null, noConcept: true }),
      rating("track-start-streamline", { grade: 4 }),
      rating("track-start-breakout", { grade: 4 }),
    ];
    // Only 4 graded components: avg = (4+4+4+4)/4 = 4 → grade 4
    expect(calculateStartGrade([...SLUGS], ratings)).toEqual({ status: "graded", grade: 4 });
  });

  it("uses latest non-voided rating per component from mixed sessions", () => {
    const ratings = [
      // Session 1 (older): reaction-time = 2
      rating("track-start-reaction-time", { grade: 2, ratedAt: "2024-01-01T10:00:00Z" }),
      // Session 2 (newer): reaction-time = 5
      rating("track-start-reaction-time", { grade: 5, ratedAt: "2024-02-01T10:00:00Z" }),
      // Remaining 5 components from session 1
      rating("track-start-block-position", { grade: 3, ratedAt: "2024-01-01T10:00:00Z" }),
      rating("track-start-entry-angle", { grade: 3, ratedAt: "2024-01-01T10:00:00Z" }),
      rating("track-start-entry-point", { grade: 3, ratedAt: "2024-01-01T10:00:00Z" }),
      rating("track-start-streamline", { grade: 3, ratedAt: "2024-01-01T10:00:00Z" }),
      rating("track-start-breakout", { grade: 3, ratedAt: "2024-01-01T10:00:00Z" }),
    ];
    // Latest reaction-time = 5; rest = 3 → avg = (5+3+3+3+3+3)/6 = 20/6 = 3.33 → 3
    expect(calculateStartGrade([...SLUGS], ratings)).toEqual({ status: "graded", grade: 3 });
  });

  it("falls back to earlier rating when latest is voided", () => {
    const ratings = [
      // Voided newer rating
      rating("track-start-reaction-time", {
        grade: 5,
        ratedAt: "2024-02-01T10:00:00Z",
        voidedAt: "2024-02-02T10:00:00Z",
      }),
      // Valid older rating
      rating("track-start-reaction-time", { grade: 2, ratedAt: "2024-01-01T10:00:00Z" }),
      rating("track-start-block-position", { grade: 2, ratedAt: "2024-01-01T10:00:00Z" }),
      rating("track-start-entry-angle", { grade: 2, ratedAt: "2024-01-01T10:00:00Z" }),
      rating("track-start-entry-point", { grade: 2, ratedAt: "2024-01-01T10:00:00Z" }),
      rating("track-start-streamline", { grade: 2, ratedAt: "2024-01-01T10:00:00Z" }),
      rating("track-start-breakout", { grade: 2, ratedAt: "2024-01-01T10:00:00Z" }),
    ];
    // Should use grade 2 for reaction-time (voided 5 ignored)
    expect(calculateStartGrade([...SLUGS], ratings)).toEqual({ status: "graded", grade: 2 });
  });

  it("treats a component as missing when all its ratings are voided", () => {
    const ratings = [
      rating("track-start-reaction-time", {
        grade: 4,
        ratedAt: "2024-01-01T10:00:00Z",
        voidedAt: "2024-01-02T10:00:00Z",
      }),
      rating("track-start-block-position"),
      rating("track-start-entry-angle"),
      rating("track-start-entry-point"),
      rating("track-start-streamline"),
      rating("track-start-breakout"),
    ];
    const result = calculateStartGrade([...SLUGS], ratings);
    expect(result).toEqual({
      status: "in_progress",
      missing: ["track-start-reaction-time"],
    });
  });

  it("not_legal takes priority over missing components check", () => {
    const ratings = [
      rating("track-start-reaction-time", { notLegal: true }),
      // Only 1 of 6 rated
    ];
    expect(calculateStartGrade([...SLUGS], ratings)).toEqual({ status: "not_legal" });
  });

  it("floors the average correctly for non-integer results", () => {
    const ratings = [
      rating("track-start-reaction-time", { grade: 5 }),
      rating("track-start-block-position", { grade: 5 }),
      rating("track-start-entry-angle", { grade: 4 }),
      rating("track-start-entry-point", { grade: 4 }),
      rating("track-start-streamline", { grade: 4 }),
      rating("track-start-breakout", { grade: 4 }),
    ];
    // avg = (5+5+4+4+4+4)/6 = 26/6 = 4.33 → floor = 4
    expect(calculateStartGrade([...SLUGS], ratings)).toEqual({ status: "graded", grade: 4 });
  });

  it("ignores extra ratings for skills outside componentSlugs", () => {
    const ratings = [
      ...allSix(4),
      // Unrelated skills in the same history
      rating("freestyle-kick", { grade: 2 }),
      rating("backstroke-rotation", { grade: 5 }),
    ];
    expect(calculateStartGrade([...SLUGS], ratings)).toEqual({ status: "graded", grade: 4 });
  });
});
