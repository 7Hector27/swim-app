import { describe, expect, it } from "vitest";
import {
  calculateStartGrade,
  type StartComponent,
  type StartComponentRatingRecord,
} from "../lib/startGrade";

const ALL_COMPONENTS: StartComponent[] = [
  "reaction_time",
  "block_position",
  "entry_angle",
  "entry_point",
  "streamline",
  "breakout",
];

function record(
  component: StartComponent,
  overrides: Partial<StartComponentRatingRecord> = {},
): StartComponentRatingRecord {
  return {
    component,
    grade: 3,
    notLegal: false,
    noConcept: false,
    ratedAt: "2024-01-01T10:00:00Z",
    voidedAt: null,
    ...overrides,
  };
}

function allSix(grade: 1 | 2 | 3 | 4 | 5 = 3): StartComponentRatingRecord[] {
  return ALL_COMPONENTS.map((component) => record(component, { grade }));
}

describe("calculateStartGrade", () => {
  it("returns graded with floor(avg) when all 6 components are rated", () => {
    const history = [
      record("reaction_time", { grade: 4 }),
      record("block_position", { grade: 3 }),
      record("entry_angle", { grade: 5 }),
      record("entry_point", { grade: 3 }),
      record("streamline", { grade: 4 }),
      record("breakout", { grade: 3 }),
    ];
    // avg = (4+3+5+3+4+3)/6 = 22/6 = 3.66… → floor = 3
    expect(calculateStartGrade(history)).toEqual({ status: "graded", grade: 3 });
  });

  it("returns in_progress when no components are rated", () => {
    const result = calculateStartGrade([]);
    expect(result).toEqual({
      status: "in_progress",
      missing: expect.arrayContaining(ALL_COMPONENTS),
    });
    if (result.status === "in_progress") {
      expect(result.missing).toHaveLength(6);
    }
  });

  it("returns in_progress listing exactly the missing components", () => {
    const history = [
      record("reaction_time"),
      record("block_position"),
      record("entry_angle"),
    ];
    const result = calculateStartGrade(history);
    expect(result).toEqual({
      status: "in_progress",
      missing: expect.arrayContaining(["entry_point", "streamline", "breakout"]),
    });
    if (result.status === "in_progress") {
      expect(result.missing).toHaveLength(3);
    }
  });

  it("returns not_legal when any component is not_legal, even with missing components", () => {
    const history = [
      record("reaction_time", { notLegal: true }),
      record("block_position"),
      // 4 components missing
    ];
    expect(calculateStartGrade(history)).toEqual({ status: "not_legal" });
  });

  it("returns not_legal when all 6 rated and one is not_legal", () => {
    const history = allSix().map((r) =>
      r.component === "entry_angle" ? { ...r, notLegal: true } : r,
    );
    expect(calculateStartGrade(history)).toEqual({ status: "not_legal" });
  });

  it("returns no_concept when all 6 are rated no_concept", () => {
    const history = ALL_COMPONENTS.map((component) =>
      record(component, { grade: null, noConcept: true }),
    );
    expect(calculateStartGrade(history)).toEqual({ status: "no_concept" });
  });

  it("excludes no_concept components from the average but counts them as rated", () => {
    const history = [
      record("reaction_time", { grade: 4 }),
      record("block_position", { grade: 4 }),
      record("entry_angle", { grade: null, noConcept: true }),
      record("entry_point", { grade: null, noConcept: true }),
      record("streamline", { grade: 4 }),
      record("breakout", { grade: 4 }),
    ];
    // Only 4 graded components: avg = (4+4+4+4)/4 = 4 → grade 4
    expect(calculateStartGrade(history)).toEqual({ status: "graded", grade: 4 });
  });

  it("uses latest non-voided rating per component from mixed sessions", () => {
    // Two sessions for the same swimmer: session 2 is newer.
    const history = [
      // Session 1 (older): reaction_time = 2
      record("reaction_time", { grade: 2, ratedAt: "2024-01-01T10:00:00Z" }),
      // Session 2 (newer): reaction_time = 5
      record("reaction_time", { grade: 5, ratedAt: "2024-02-01T10:00:00Z" }),
      // Remaining 5 components from session 1
      record("block_position", { grade: 3, ratedAt: "2024-01-01T10:00:00Z" }),
      record("entry_angle", { grade: 3, ratedAt: "2024-01-01T10:00:00Z" }),
      record("entry_point", { grade: 3, ratedAt: "2024-01-01T10:00:00Z" }),
      record("streamline", { grade: 3, ratedAt: "2024-01-01T10:00:00Z" }),
      record("breakout", { grade: 3, ratedAt: "2024-01-01T10:00:00Z" }),
    ];
    // Latest reaction_time = 5; rest = 3 → avg = (5+3+3+3+3+3)/6 = 20/6 = 3.33 → 3
    expect(calculateStartGrade(history)).toEqual({ status: "graded", grade: 3 });
  });

  it("falls back to earlier rating when latest is voided", () => {
    const history = [
      // Voided newer rating
      record("reaction_time", {
        grade: 5,
        ratedAt: "2024-02-01T10:00:00Z",
        voidedAt: "2024-02-02T10:00:00Z",
      }),
      // Valid older rating
      record("reaction_time", { grade: 2, ratedAt: "2024-01-01T10:00:00Z" }),
      record("block_position", { grade: 2, ratedAt: "2024-01-01T10:00:00Z" }),
      record("entry_angle", { grade: 2, ratedAt: "2024-01-01T10:00:00Z" }),
      record("entry_point", { grade: 2, ratedAt: "2024-01-01T10:00:00Z" }),
      record("streamline", { grade: 2, ratedAt: "2024-01-01T10:00:00Z" }),
      record("breakout", { grade: 2, ratedAt: "2024-01-01T10:00:00Z" }),
    ];
    // Should use grade 2 for reaction_time (voided 5 ignored)
    expect(calculateStartGrade(history)).toEqual({ status: "graded", grade: 2 });
  });

  it("treats a component as missing when all its ratings are voided", () => {
    const history = [
      record("reaction_time", {
        grade: 4,
        ratedAt: "2024-01-01T10:00:00Z",
        voidedAt: "2024-01-02T10:00:00Z",
      }),
      record("block_position"),
      record("entry_angle"),
      record("entry_point"),
      record("streamline"),
      record("breakout"),
    ];
    const result = calculateStartGrade(history);
    expect(result).toEqual({
      status: "in_progress",
      missing: ["reaction_time"],
    });
  });

  it("not_legal takes priority over missing components check", () => {
    const history = [
      record("reaction_time", { notLegal: true }),
      // Only 1 of 6 rated
    ];
    expect(calculateStartGrade(history)).toEqual({ status: "not_legal" });
  });

  it("floors the average correctly for non-integer results", () => {
    const history = [
      record("reaction_time", { grade: 5 }),
      record("block_position", { grade: 5 }),
      record("entry_angle", { grade: 4 }),
      record("entry_point", { grade: 4 }),
      record("streamline", { grade: 4 }),
      record("breakout", { grade: 4 }),
    ];
    // avg = (5+5+4+4+4+4)/6 = 26/6 = 4.33 → floor = 4
    expect(calculateStartGrade(history)).toEqual({ status: "graded", grade: 4 });
  });
});
