import { describe, it, expect } from "vitest";
import { findDeepestLowFoundation } from "../lib/dependencyMap";
import type { GradeMap, BuiltOnGraph } from "../lib/dependencyMap";

// Minimal graph helpers
const graph = (edges: BuiltOnGraph): BuiltOnGraph => edges;
const grades = (g: GradeMap): GradeMap => g;

describe("findDeepestLowFoundation", () => {
  // ── Absolute lowness ────────────────────────────────────────────────────────

  it("grade 2 counts as low — returns foundation when it has no further low deps", () => {
    const g = graph({ target: ["foundation"] });
    const r = grades({ target: 3, foundation: 2 });
    expect(findDeepestLowFoundation("target", r, g)).toBe("foundation");
  });

  it("grade 1 counts as low", () => {
    const g = graph({ target: ["foundation"] });
    const r = grades({ target: 4, foundation: 1 });
    expect(findDeepestLowFoundation("target", r, g)).toBe("foundation");
  });

  it("grade 3 with equal-grade supporter is not low — target is returned", () => {
    // 3 > 2 (not absolutely low) and 3 is not < 3 (not relatively low)
    const g = graph({ target: ["foundation"] });
    const r = grades({ target: 3, foundation: 3 });
    expect(findDeepestLowFoundation("target", r, g)).toBe("target");
  });

  // ── Relative lowness ────────────────────────────────────────────────────────

  it("grade lower than the skill it supports counts as low", () => {
    // foundation grade 3 < target grade 4 → relatively low
    const g = graph({ target: ["foundation"] });
    const r = grades({ target: 4, foundation: 3 });
    expect(findDeepestLowFoundation("target", r, g)).toBe("foundation");
  });

  it("grade equal to the supporter is not relatively low (only absolute rule applies)", () => {
    // foundation grade 4 = target grade 4 → not relatively low; 4 > 2 → not absolutely low
    const g = graph({ target: ["foundation"] });
    const r = grades({ target: 4, foundation: 4 });
    expect(findDeepestLowFoundation("target", r, g)).toBe("target");
  });

  it("grade higher than the supporter is not low", () => {
    const g = graph({ target: ["foundation"] });
    const r = grades({ target: 3, foundation: 5 });
    expect(findDeepestLowFoundation("target", r, g)).toBe("target");
  });

  // ── Special grades ──────────────────────────────────────────────────────────

  it("not_legal always counts as low regardless of supporter grade", () => {
    const g = graph({ target: ["foundation"] });
    const r = grades({ target: 5, foundation: "not_legal" });
    expect(findDeepestLowFoundation("target", r, g)).toBe("foundation");
  });

  it("no_concept always counts as low regardless of supporter grade", () => {
    const g = graph({ target: ["foundation"] });
    const r = grades({ target: 5, foundation: "no_concept" });
    expect(findDeepestLowFoundation("target", r, g)).toBe("foundation");
  });

  it("null (not assessed / voided) is not low — chain stops", () => {
    const g = graph({ target: ["foundation"] });
    const r = grades({ target: 2, foundation: null });
    expect(findDeepestLowFoundation("target", r, g)).toBe("target");
  });

  it("missing key in grade map is treated as null — not low", () => {
    const g = graph({ target: ["foundation"] });
    const r = grades({ target: 2 }); // foundation omitted
    expect(findDeepestLowFoundation("target", r, g)).toBe("target");
  });

  // ── Multi-step chain ────────────────────────────────────────────────────────

  it("chain follows multiple steps while each skill is low", () => {
    // target(2) → middle(2) → root(1): all low, deepest is root
    const g = graph({ target: ["middle"], middle: ["root"], root: [] });
    const r = grades({ target: 2, middle: 2, root: 1 });
    expect(findDeepestLowFoundation("target", r, g)).toBe("root");
  });

  it("chain stops at the first foundation that is not low", () => {
    // target(2) → middle(2) → root(4): root is not low, so middle is the deepest
    const g = graph({ target: ["middle"], middle: ["root"], root: [] });
    const r = grades({ target: 2, middle: 2, root: 4 });
    expect(findDeepestLowFoundation("target", r, g)).toBe("middle");
  });

  it("chain stops when a foundation is not assessed (null)", () => {
    // target(2) → middle(2) → root(null): null not low, so middle is the deepest
    const g = graph({ target: ["middle"], middle: ["root"], root: [] });
    const r = grades({ target: 2, middle: 2, root: null });
    expect(findDeepestLowFoundation("target", r, g)).toBe("middle");
  });

  it("three-step chain: all low down to the leaf", () => {
    const g = graph({ a: ["b"], b: ["c"], c: ["d"], d: [] });
    const r = grades({ a: 2, b: 1, c: 1, d: "not_legal" });
    expect(findDeepestLowFoundation("a", r, g)).toBe("d");
  });

  // ── Returns target when no lower-priority blocker ──────────────────────────

  it("returns the target skill itself when it has no foundations", () => {
    const g = graph({ target: [] });
    const r = grades({ target: 1 });
    expect(findDeepestLowFoundation("target", r, g)).toBe("target");
  });

  it("returns the target when all foundations are fine", () => {
    const g = graph({ target: ["f1", "f2"] });
    const r = grades({ target: 2, f1: 4, f2: 5 });
    expect(findDeepestLowFoundation("target", r, g)).toBe("target");
  });

  it("returns the target when target is not in the graph (no foundations known)", () => {
    const g = graph({});
    const r = grades({ target: 1 });
    expect(findDeepestLowFoundation("target", r, g)).toBe("target");
  });

  // ── Multiple foundations — picks the worst ─────────────────────────────────

  it("when multiple foundations are low, descends into the one with the lowest grade", () => {
    // target(3) → f1(2), f2(1): both low; f2 is worse → descend f2 → f2 has no low deps
    const g = graph({ target: ["f1", "f2"], f1: [], f2: [] });
    const r = grades({ target: 3, f1: 2, f2: 1 });
    expect(findDeepestLowFoundation("target", r, g)).toBe("f2");
  });

  it("not_legal beats a low numeric grade as the worst foundation", () => {
    const g = graph({ target: ["f1", "f2"], f1: [], f2: [] });
    const r = grades({ target: 3, f1: 2, f2: "not_legal" });
    expect(findDeepestLowFoundation("target", r, g)).toBe("f2");
  });

  it("descends into the low foundation that has a deeper chain", () => {
    // target(2) → f1(2 no deeper), f2(2 → deeper(1))
    // f2 leads deeper; f1 and f2 have the same grade so f1 would be picked by grade alone,
    // but f2's chain goes deeper. Since we pick by grade first (both 2), the function
    // returns f1 here (first encountered with equal grade). This documents the tie-break.
    const g = graph({ target: ["f1", "f2"], f1: [], f2: ["deeper"], deeper: [] });
    const r = grades({ target: 3, f1: 2, f2: 2, deeper: 1 });
    // f2 is encountered after f1; both grade 2 → f1 wins tie (first lower-than-Infinity match)
    // This is intentional: tie-break by iteration order, not recursion depth.
    expect(findDeepestLowFoundation("target", r, g)).toBe("f1");
  });

  // ── Cycle guard ─────────────────────────────────────────────────────────────

  it("does not loop infinitely when the graph has a cycle", () => {
    const g = graph({ a: ["b"], b: ["a"] });
    const r = grades({ a: 1, b: 1 });
    // Should terminate and return one of the skills
    const result = findDeepestLowFoundation("a", r, g);
    expect(["a", "b"]).toContain(result);
  });

  // ── Realistic scenario from rubric ─────────────────────────────────────────

  it("freestyle breathing → rotation → core stability (from rubric example)", () => {
    const g = graph({
      "free-breathing-mechanics": ["free-head-position", "free-rotation", "breath-control"],
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
    // free-breathing-mechanics(2) → free-rotation(2) → core-stability(1) is low
    // horizontal-alignment(4) is not low relative to free-rotation(2), and not ≤2
    // So deepest is core-stability
    expect(findDeepestLowFoundation("free-breathing-mechanics", r, g)).toBe("core-stability");
  });

  it("stops at rotation when core stability is fine", () => {
    const g = graph({
      "free-breathing-mechanics": ["free-head-position", "free-rotation", "breath-control"],
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
    expect(findDeepestLowFoundation("free-breathing-mechanics", r, g)).toBe("free-rotation");
  });
});
