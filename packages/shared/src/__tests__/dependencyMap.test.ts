import { describe, it, expect } from "vitest";
import {
  findDeepestLowFoundation,
  headPositionOverall,
  latestEffectiveRatings,
} from "../lib/dependencyMap";
import type {
  GradeMap,
  BuiltOnGraph,
  PerStrokeGrades,
  RatingRecord,
} from "../lib/dependencyMap";

const graph = (edges: BuiltOnGraph): BuiltOnGraph => edges;
const grades = (g: GradeMap): GradeMap => g;

describe("findDeepestLowFoundation", () => {
  // ── Target-lowness gate ──────────────────────────────────────────────────────

  it("returns null when target grade is 5 (not low)", () => {
    const g = graph({ target: ["foundation"] });
    const r = grades({ target: 5, foundation: 4 });
    expect(findDeepestLowFoundation("target", r, g)).toBeNull();
  });

  it("returns null when target grade is 3 (not low)", () => {
    const g = graph({ target: ["foundation"] });
    const r = grades({ target: 3, foundation: 2 });
    expect(findDeepestLowFoundation("target", r, g)).toBeNull();
  });

  it("returns null when target is not assessed (null grade)", () => {
    const g = graph({ target: ["foundation"] });
    const r = grades({ target: null });
    expect(findDeepestLowFoundation("target", r, g)).toBeNull();
  });

  it("returns null when target grade is missing from grade map", () => {
    const g = graph({ target: ["foundation"] });
    const r = grades({});
    expect(findDeepestLowFoundation("target", r, g)).toBeNull();
  });

  // ── Absolute lowness ────────────────────────────────────────────────────────

  it("grade 2 counts as low — returns chain through low foundation", () => {
    const g = graph({ target: ["foundation"], foundation: [] });
    const r = grades({ target: 2, foundation: 2 });
    expect(findDeepestLowFoundation("target", r, g)).toEqual([
      "target",
      "foundation",
    ]);
  });

  it("grade 1 counts as low", () => {
    const g = graph({ target: ["foundation"], foundation: [] });
    const r = grades({ target: 2, foundation: 1 });
    expect(findDeepestLowFoundation("target", r, g)).toEqual([
      "target",
      "foundation",
    ]);
  });

  it("grade 3 foundation is not low relative to a grade-2 target — chain stops at target", () => {
    const g = graph({ target: ["foundation"] });
    const r = grades({ target: 2, foundation: 3 });
    expect(findDeepestLowFoundation("target", r, g)).toEqual(["target"]);
  });

  // ── Special grades ──────────────────────────────────────────────────────────

  it("not_legal target always counts as low — enters the chain", () => {
    const g = graph({ target: [] });
    const r = grades({ target: "not_legal" });
    expect(findDeepestLowFoundation("target", r, g)).toEqual(["target"]);
  });

  it("no_concept target always counts as low — enters the chain", () => {
    const g = graph({ target: [] });
    const r = grades({ target: "no_concept" });
    expect(findDeepestLowFoundation("target", r, g)).toEqual(["target"]);
  });

  it("not_legal foundation always counts as low regardless of supporter grade", () => {
    const g = graph({ target: ["foundation"], foundation: [] });
    const r = grades({ target: 2, foundation: "not_legal" });
    expect(findDeepestLowFoundation("target", r, g)).toEqual([
      "target",
      "foundation",
    ]);
  });

  it("no_concept foundation always counts as low regardless of supporter grade", () => {
    const g = graph({ target: ["foundation"], foundation: [] });
    const r = grades({ target: 2, foundation: "no_concept" });
    expect(findDeepestLowFoundation("target", r, g)).toEqual([
      "target",
      "foundation",
    ]);
  });

  it("not_legal target: foundation grade 3 is not low (relative check skipped for not_legal supporter)", () => {
    const g = graph({ target: ["foundation"] });
    const r = grades({ target: "not_legal", foundation: 3 });
    expect(findDeepestLowFoundation("target", r, g)).toEqual(["target"]);
  });

  it("null foundation (not assessed) is not low — chain stops at target", () => {
    const g = graph({ target: ["foundation"] });
    const r = grades({ target: 2, foundation: null });
    expect(findDeepestLowFoundation("target", r, g)).toEqual(["target"]);
  });

  it("missing foundation key in grade map is treated as null — chain stops at target", () => {
    const g = graph({ target: ["foundation"] });
    const r = grades({ target: 2 }); // foundation omitted
    expect(findDeepestLowFoundation("target", r, g)).toEqual(["target"]);
  });

  // ── Multi-step chain ────────────────────────────────────────────────────────

  it("chain follows multiple steps while each skill is low", () => {
    const g = graph({ target: ["middle"], middle: ["root"], root: [] });
    const r = grades({ target: 2, middle: 2, root: 1 });
    expect(findDeepestLowFoundation("target", r, g)).toEqual([
      "target",
      "middle",
      "root",
    ]);
  });

  it("chain stops at the first foundation that is not low", () => {
    const g = graph({ target: ["middle"], middle: ["root"], root: [] });
    const r = grades({ target: 2, middle: 2, root: 4 });
    expect(findDeepestLowFoundation("target", r, g)).toEqual([
      "target",
      "middle",
    ]);
  });

  it("chain stops when a foundation is not assessed (null)", () => {
    const g = graph({ target: ["middle"], middle: ["root"], root: [] });
    const r = grades({ target: 2, middle: 2, root: null });
    expect(findDeepestLowFoundation("target", r, g)).toEqual([
      "target",
      "middle",
    ]);
  });

  it("three-step chain: all low down to the leaf", () => {
    const g = graph({ a: ["b"], b: ["c"], c: ["d"], d: [] });
    const r = grades({ a: 2, b: 1, c: 1, d: "not_legal" });
    expect(findDeepestLowFoundation("a", r, g)).toEqual(["a", "b", "c", "d"]);
  });

  // ── Returns chain with only target when no lower-priority blocker ────────────

  it("returns [target] when it has no foundations", () => {
    const g = graph({ target: [] });
    const r = grades({ target: 1 });
    expect(findDeepestLowFoundation("target", r, g)).toEqual(["target"]);
  });

  it("returns [target] when all foundations have passing grades", () => {
    const g = graph({ target: ["f1", "f2"] });
    const r = grades({ target: 2, f1: 4, f2: 5 });
    expect(findDeepestLowFoundation("target", r, g)).toEqual(["target"]);
  });

  it("returns [target] when target is not in the graph (no foundations known)", () => {
    const g = graph({});
    const r = grades({ target: 1 });
    expect(findDeepestLowFoundation("target", r, g)).toEqual(["target"]);
  });

  // ── Multiple foundations — picks the worst ─────────────────────────────────

  it("when multiple foundations are low, descends into the one with the lowest grade", () => {
    const g = graph({ target: ["f1", "f2"], f1: [], f2: [] });
    const r = grades({ target: 2, f1: 2, f2: 1 });
    expect(findDeepestLowFoundation("target", r, g)).toEqual(["target", "f2"]);
  });

  it("not_legal beats a low numeric grade as the worst foundation", () => {
    const g = graph({ target: ["f1", "f2"], f1: [], f2: [] });
    const r = grades({ target: 2, f1: 2, f2: "not_legal" });
    expect(findDeepestLowFoundation("target", r, g)).toEqual(["target", "f2"]);
  });

  it("ties break by catalog sort order — lower sort order wins", () => {
    const g = graph({ target: ["f1", "f2"], f1: [], f2: [] });
    const r = grades({ target: 2, f1: 2, f2: 2 });
    const so = { f1: 10, f2: 5 }; // f2 has lower sort order → wins
    expect(findDeepestLowFoundation("target", r, g, so)).toEqual([
      "target",
      "f2",
    ]);
  });

  it("without sort order, iteration order breaks ties (first match wins)", () => {
    const g = graph({ target: ["f1", "f2"], f1: [], f2: [] });
    const r = grades({ target: 2, f1: 2, f2: 2 });
    // f1 is at index 0, f2 at index 1 — f1 wins
    expect(findDeepestLowFoundation("target", r, g)).toEqual(["target", "f1"]);
  });

  // ── Cycle guard ─────────────────────────────────────────────────────────────

  it("does not loop infinitely when the graph has a cycle", () => {
    // a→b→a: descend(a) picks b, descend(b) picks a, descend(a) is visited → [a]
    // chain terminates as ["a", "b", "a"]
    const g = graph({ a: ["b"], b: ["a"] });
    const r = grades({ a: 1, b: 1 });
    expect(findDeepestLowFoundation("a", r, g)).toEqual(["a", "b", "a"]);
  });

  // ── Realistic scenario from rubric ─────────────────────────────────────────

  it("freestyle breathing → rotation → core stability (from rubric example)", () => {
    const g = graph({
      "free-breathing-mechanics": [
        "free-head-position",
        "free-rotation",
        "breath-control",
      ],
      "free-rotation": ["core-stability", "horizontal-alignment"],
      "core-stability": [],
      "horizontal-alignment": ["head-position-overall"],
      "head-position-overall": [],
      "free-head-position": [],
      "breath-control": [],
    });
    const r = grades({
      "free-breathing-mechanics": 2,
      "free-rotation": 2,
      "core-stability": 1,
      "horizontal-alignment": 4,
      "head-position-overall": 4,
      "free-head-position": 4,
      "breath-control": 4,
    });
    expect(
      findDeepestLowFoundation("free-breathing-mechanics", r, g),
    ).toEqual([
      "free-breathing-mechanics",
      "free-rotation",
      "core-stability",
    ]);
  });

  it("stops at rotation when core stability is fine", () => {
    const g = graph({
      "free-breathing-mechanics": [
        "free-head-position",
        "free-rotation",
        "breath-control",
      ],
      "free-rotation": ["core-stability", "horizontal-alignment"],
      "core-stability": [],
      "horizontal-alignment": [],
      "free-head-position": [],
      "breath-control": [],
    });
    const r = grades({
      "free-breathing-mechanics": 2,
      "free-rotation": 2,
      "core-stability": 4,
      "horizontal-alignment": 4,
      "free-head-position": 4,
      "breath-control": 4,
    });
    expect(
      findDeepestLowFoundation("free-breathing-mechanics", r, g),
    ).toEqual(["free-breathing-mechanics", "free-rotation"]);
  });
});

describe("headPositionOverall", () => {
  const pg = (g: PerStrokeGrades): PerStrokeGrades => g;

  it("returns null when no strokes have been rated", () => {
    expect(headPositionOverall(pg({}))).toBeNull();
  });

  it("returns null when all strokes are null (unrated)", () => {
    expect(headPositionOverall(pg({ free: null, back: null }))).toBeNull();
  });

  it("returns null when all strokes are no_concept (excluded)", () => {
    expect(
      headPositionOverall(pg({ free: "no_concept", back: "no_concept" })),
    ).toBeNull();
  });

  it("has a value once one stroke is rated", () => {
    expect(headPositionOverall(pg({ breast: 5 }))).toBe(5);
  });

  it("single stroke — returns that grade", () => {
    expect(headPositionOverall(pg({ free: 3 }))).toBe(3);
  });

  it("averages rated strokes and floors the result", () => {
    // (3 + 4) / 2 = 3.5 → floor → 3
    expect(headPositionOverall(pg({ free: 3, back: 4 }))).toBe(3);
  });

  it("not_legal counts as 0 in the average", () => {
    // (0 + 4) / 2 = 2
    expect(headPositionOverall(pg({ free: "not_legal", back: 4 }))).toBe(2);
  });

  it("no_concept is excluded from the average entirely", () => {
    // only free(4) and back(2) count; breast excluded; (4 + 2) / 2 = 3
    expect(
      headPositionOverall(pg({ free: 4, back: 2, breast: "no_concept" })),
    ).toBe(3);
  });

  it("null strokes are excluded from the average", () => {
    // only free(4); 4/1 = 4
    expect(headPositionOverall(pg({ free: 4, back: null }))).toBe(4);
  });

  it("all not_legal clamps to minimum 1", () => {
    // (0 + 0) / 2 = 0 → clamped to 1
    expect(
      headPositionOverall(pg({ free: "not_legal", back: "not_legal" })),
    ).toBe(1);
  });

  it("four strokes rated — correct average", () => {
    // (2 + 3 + 4 + 5) / 4 = 3.5 → 3
    expect(headPositionOverall(pg({ free: 2, back: 3, breast: 4, fly: 5 }))).toBe(3);
  });
});

describe("latestEffectiveRatings", () => {
  function record(
    skillSlug: string,
    grade: 1 | 2 | 3 | 4 | 5 | null,
    ratedAt: string,
    voidedAt: string | null = null,
    notLegal = false,
    noConcept = false,
  ): RatingRecord {
    return { skillSlug, grade, notLegal, noConcept, ratedAt, voidedAt };
  }

  it("returns empty map for empty history", () => {
    expect(latestEffectiveRatings([])).toEqual({});
  });

  it("single non-voided record — returns its grade", () => {
    const result = latestEffectiveRatings([record("kick", 3, "2026-01-01")]);
    expect(result).toEqual({ kick: 3 });
  });

  it("voided latest rating falls back to the one before it", () => {
    const history = [
      record("kick", 3, "2026-01-01"),
      record("kick", 4, "2026-02-01", "2026-02-05"),
    ];
    expect(latestEffectiveRatings(history)).toEqual({ kick: 3 });
  });

  it("all ratings voided — skill is absent from result", () => {
    const history = [record("kick", 3, "2026-01-01", "2026-01-10")];
    expect(latestEffectiveRatings(history)).toEqual({});
  });

  it("notLegal flag maps to not_legal grade", () => {
    const r = record("kick", null, "2026-01-01");
    r.notLegal = true;
    expect(latestEffectiveRatings([r])).toEqual({ kick: "not_legal" });
  });

  it("noConcept flag maps to no_concept grade", () => {
    const r = record("kick", null, "2026-01-01");
    r.noConcept = true;
    expect(latestEffectiveRatings([r])).toEqual({ kick: "no_concept" });
  });

  it("multiple skills are tracked independently", () => {
    const history = [
      record("kick", 3, "2026-01-01"),
      record("pull", 4, "2026-01-01"),
      record("kick", 5, "2026-02-01"),
    ];
    expect(latestEffectiveRatings(history)).toEqual({ kick: 5, pull: 4 });
  });

  it("later non-voided rating replaces an earlier one", () => {
    const history = [
      record("kick", 2, "2026-01-01"),
      record("kick", 4, "2026-03-01"),
    ];
    expect(latestEffectiveRatings(history)).toEqual({ kick: 4 });
  });
});
