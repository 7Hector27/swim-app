// Covers the LevelLadder helpers (pure functions) and the component's
// visible behavior across the states the brief called out: step path for a
// known series, up / held / down chips, single rating, left/right rendering,
// and a Not-legal point surfaced as a separate marker.

import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { stepLinePath } from "../lib/stepChart";
import LevelLadder from "../components/LevelLadder";
import {
  BAND_ORDER,
  buildChips,
  buildLadderSeries,
  LEVEL_NAMES,
  pickDateTickIndices,
  trimToRecent,
  type LadderPoint,
} from "../components/LevelLadder/helpers";

function makePoint(overrides: Partial<LadderPoint> & { id: string; sessionDate: string }): LadderPoint {
  return {
    id: overrides.id,
    sessionDate: overrides.sessionDate,
    grade: overrides.grade ?? 3,
    notLegal: overrides.notLegal ?? false,
    noConcept: overrides.noConcept ?? false,
    context: overrides.context ?? "practice",
    side: overrides.side ?? null,
  };
}

describe("LevelLadder helpers — LEVEL_NAMES", () => {
  it("names the five levels in the order the brief lists them", () => {
    expect(LEVEL_NAMES[1]).toBe("Emerging");
    expect(LEVEL_NAMES[2]).toBe("Developing");
    expect(LEVEL_NAMES[3]).toBe("Competent");
    expect(LEVEL_NAMES[4]).toBe("Advanced");
    expect(LEVEL_NAMES[5]).toBe("Mastery");
  });

  it("draws bands top-to-bottom 5 → 1", () => {
    expect(BAND_ORDER).toEqual([5, 4, 3, 2, 1]);
  });
});

describe("LevelLadder helpers — buildLadderSeries", () => {
  // The progress payload ships newest-first; the ladder draws oldest-left.
  const history: LadderPoint[] = [
    makePoint({ id: "p3", sessionDate: "2026-10-25", grade: 4 }),
    makePoint({ id: "p2", sessionDate: "2026-10-18", grade: 3 }),
    makePoint({ id: "p1", sessionDate: "2026-10-11", grade: 2 }),
  ];

  it("reverses the newest-first history to oldest-first", () => {
    const series = buildLadderSeries(history, null);
    expect(series.map((point) => point.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("filters by side when requested", () => {
    const sided: LadderPoint[] = [
      makePoint({ id: "l2", sessionDate: "2026-10-25", grade: 4, side: "left" }),
      makePoint({ id: "r2", sessionDate: "2026-10-25", grade: 3, side: "right" }),
      makePoint({ id: "l1", sessionDate: "2026-10-11", grade: 2, side: "left" }),
    ];
    expect(buildLadderSeries(sided, "left").map((point) => point.id)).toEqual(["l1", "l2"]);
    expect(buildLadderSeries(sided, "right").map((point) => point.id)).toEqual(["r2"]);
  });
});

describe("LevelLadder helpers — step path", () => {
  // Shared with the ladder: dates are drawn as even-spaced slots, not
  // real-day spacing. Y collapses to the band centres. The step goes
  // horizontal-then-vertical so a rating is "held" until the next session
  // changed it, not interpolated.
  it("produces a step path with horizontal-then-vertical segments for a known series", () => {
    // Three points at grade 2 → 3 → 4, at indices 0, 1, 2, evenly spaced.
    // Y values are band centres; the helper doesn't care what they are, so
    // we feed deterministic numbers (10, 20, 30) and check the string.
    const path = stepLinePath([
      { x: 0, y: 30 },
      { x: 50, y: 20 },
      { x: 100, y: 10 },
    ]);
    // First a MoveTo. Then for each next point, a horizontal LineTo at the
    // previous y followed by a vertical LineTo to the new y.
    expect(path).toBe(
      "M 0.00 30.00 L 50.00 30.00 L 50.00 20.00 L 100.00 20.00 L 100.00 10.00",
    );
  });
});

describe("LevelLadder helpers — buildChips", () => {
  const baseHistory: LadderPoint[] = [
    makePoint({ id: "p3", sessionDate: "2026-10-25", grade: 4 }),
    makePoint({ id: "p2", sessionDate: "2026-10-18", grade: 3 }),
    makePoint({ id: "p1", sessionDate: "2026-10-11", grade: 2 }),
  ];

  it("Up: emits 'Now: <level>' and 'Up N levels since <date>' when the swimmer has improved", () => {
    const chips = buildChips(buildLadderSeries(baseHistory));
    expect(chips.find((chip) => chip.key === "now")?.label).toBe("Now: Advanced");
    expect(chips.find((chip) => chip.key === "delta")?.label).toMatch(/^Up 2 levels since /);
  });

  it("Held: emits 'Held since <date>' when the first and last ratings share a level", () => {
    const flat: LadderPoint[] = [
      makePoint({ id: "p3", sessionDate: "2026-10-25", grade: 3 }),
      makePoint({ id: "p2", sessionDate: "2026-10-18", grade: 3 }),
      makePoint({ id: "p1", sessionDate: "2026-10-11", grade: 3 }),
    ];
    const chips = buildChips(buildLadderSeries(flat));
    expect(chips.find((chip) => chip.key === "delta")?.label).toMatch(/^Held since /);
    const streakChip = chips.find((chip) => chip.key === "streak");
    expect(streakChip?.label).toBe("Held Competent 3 sessions in a row");
  });

  it("Down: emits 'Down N levels since <date>' when the swimmer has regressed", () => {
    const regressed: LadderPoint[] = [
      makePoint({ id: "p3", sessionDate: "2026-10-25", grade: 2 }),
      makePoint({ id: "p1", sessionDate: "2026-10-11", grade: 4 }),
    ];
    const chips = buildChips(buildLadderSeries(regressed));
    expect(chips.find((chip) => chip.key === "delta")?.label).toMatch(/^Down 2 levels since /);
  });

  it("single rating: emits 'Now' and 'Held since <date>' but no streak chip", () => {
    const single = [makePoint({ id: "p1", sessionDate: "2026-10-25", grade: 3 })];
    const chips = buildChips(buildLadderSeries(single));
    expect(chips.map((chip) => chip.key)).toEqual(["now", "delta"]);
    expect(chips[0]?.label).toBe("Now: Competent");
    expect(chips[1]?.label).toMatch(/^Held since /);
  });

  it("descriptors: 'Next: <level>' is emitted only when the next level's descriptor is non-empty", () => {
    const series = buildLadderSeries([
      makePoint({ id: "p1", sessionDate: "2026-10-25", grade: 3 }),
    ]);
    // Without descriptors: the chip is silently skipped.
    const noDescriptors = buildChips(series);
    expect(noDescriptors.find((chip) => chip.key === "next")).toBeUndefined();
    // With a descriptor for the next level (4 → Advanced): the chip appears.
    const withDescriptors = buildChips(series, { 4: "Efficient at race pace" });
    const nextChip = withDescriptors.find((chip) => chip.key === "next");
    expect(nextChip?.label).toBe("Next: Advanced — Efficient at race pace");
  });
});

describe("LevelLadder helpers — pickDateTickIndices", () => {
  it("returns every index when the series is short (≤ maxLabels)", () => {
    const picks = pickDateTickIndices(4, 5);
    expect([...picks].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it("spans 10 points with 5 labels including first and last", () => {
    const picks = pickDateTickIndices(10, 5);
    expect(picks.has(0)).toBe(true);
    expect(picks.has(9)).toBe(true);
    expect(picks.size).toBeGreaterThanOrEqual(3);
    expect(picks.size).toBeLessThanOrEqual(5);
  });
});

describe("LevelLadder helpers — trimToRecent", () => {
  it("keeps the most recent entries when the series exceeds maxPoints", () => {
    const series = Array.from({ length: 12 }, (_, index) => makePoint({ id: `p${index}`, sessionDate: "2026-01-01", grade: 3 }));
    const trimmed = trimToRecent(series, 10);
    expect(trimmed.map((point) => point.id)).toEqual(series.slice(2).map((point) => point.id));
  });
});

// ── Component-level tests ────────────────────────────────────────────────

describe("LevelLadder component", () => {
  it("renders the five band labels using the rating-scale names", () => {
    render(
      <LevelLadder
        skillName="Freestyle Kick"
        history={[makePoint({ id: "p1", sessionDate: "2026-10-25", grade: 3 })]}
        ratedPerSide={false}
      />,
    );
    // Band labels render inside the SVG as "<level> <name>" rows. Pattern
    // matches those directly and avoids colliding with the newest point's
    // tooltip (which also contains the level name).
    expect(screen.getByText("1 Emerging")).toBeInTheDocument();
    expect(screen.getByText("2 Developing")).toBeInTheDocument();
    expect(screen.getByText("3 Competent")).toBeInTheDocument();
    expect(screen.getByText("4 Advanced")).toBeInTheDocument();
    expect(screen.getByText("5 Mastery")).toBeInTheDocument();
  });

  it("single rating: renders one 'newest' point and the Now / Held chips", () => {
    render(
      <LevelLadder
        skillName="Freestyle Kick"
        history={[makePoint({ id: "p1", sessionDate: "2026-10-25", grade: 3 })]}
        ratedPerSide={false}
      />,
    );
    // Exactly one newest marker exists in a one-rating series.
    expect(screen.getAllByTestId("level-ladder-newest")).toHaveLength(1);
    expect(screen.getByTestId("level-ladder-chip-now")).toHaveTextContent("Now: Competent");
    expect(screen.getByTestId("level-ladder-chip-delta")).toHaveTextContent(/Held since /);
  });

  it("left/right: draws two step lines (one dashed) and labels chip groups L / R", () => {
    const history: LadderPoint[] = [
      makePoint({ id: "l2", sessionDate: "2026-10-25", grade: 4, side: "left" }),
      makePoint({ id: "r2", sessionDate: "2026-10-25", grade: 3, side: "right" }),
      makePoint({ id: "l1", sessionDate: "2026-10-11", grade: 2, side: "left" }),
      makePoint({ id: "r1", sessionDate: "2026-10-11", grade: 2, side: "right" }),
    ];
    render(
      <LevelLadder
        skillName="Bilateral breathing"
        history={history}
        ratedPerSide={true}
      />,
    );
    // Two distinct step lines, keyed by side.
    expect(screen.getByTestId("level-ladder-line-left")).toBeInTheDocument();
    expect(screen.getByTestId("level-ladder-line-right")).toBeInTheDocument();
    // Right side is dashed; left is not.
    expect(screen.getByTestId("level-ladder-line-right").getAttribute("stroke-dasharray")).toBeTruthy();
    expect(screen.getByTestId("level-ladder-line-left").getAttribute("stroke-dasharray")).toBeFalsy();
    // Chip groups carry side labels. The L group's Now chip shows the
    // left-side's current level, R shows the right's.
    const chipRoot = screen.getByTestId("level-ladder-chips");
    expect(within(chipRoot).getByText("L:")).toBeInTheDocument();
    expect(within(chipRoot).getByText("R:")).toBeInTheDocument();
  });

  it("Not legal: draws the dedicated marker below the bands rather than plotting a level", () => {
    const history: LadderPoint[] = [
      makePoint({ id: "p2", sessionDate: "2026-10-25", grade: 3 }),
      makePoint({ id: "p1", sessionDate: "2026-10-18", grade: 2, notLegal: true }),
    ];
    render(
      <LevelLadder
        skillName="Freestyle Kick"
        history={history}
        ratedPerSide={false}
      />,
    );
    // A separate special-row marker is present and is labelled "NL".
    const specials = screen.getAllByTestId("level-ladder-special");
    expect(specials).toHaveLength(1);
    expect(specials[0]).toHaveTextContent("NL");
    // And the step line only has one point drawn (the graded one — the NL
    // point is skipped), so there's exactly one "newest" marker.
    expect(screen.getAllByTestId("level-ladder-newest")).toHaveLength(1);
  });

  it("the first and last date labels anchor to their plot edges so they don't clip", () => {
    const history: LadderPoint[] = [
      makePoint({ id: "p3", sessionDate: "2026-10-25", grade: 4 }),
      makePoint({ id: "p2", sessionDate: "2026-10-18", grade: 3 }),
      makePoint({ id: "p1", sessionDate: "2026-10-11", grade: 2 }),
    ];
    render(
      <LevelLadder
        skillName="Freestyle Kick"
        history={history}
        ratedPerSide={false}
      />,
    );
    const dateLabels = screen.getAllByTestId("level-ladder-date-label");
    const edges = dateLabels.filter((node) => node.getAttribute("data-first-or-last") === "true");
    // Every rendered tick that's first-or-last anchors to its own
    // corner. Middle ticks stay centered.
    expect(edges.length).toBeGreaterThan(0);
    const first = dateLabels[0];
    const last = dateLabels[dateLabels.length - 1];
    expect(first?.getAttribute("data-anchor")).toBe("start");
    expect(last?.getAttribute("data-anchor")).toBe("end");
    // No middle label uses start or end.
    const middle = dateLabels.filter((node) => node.getAttribute("data-first-or-last") !== "true");
    for (const node of middle) {
      expect(node.getAttribute("data-anchor")).toBe("middle");
    }
  });

  it("parent view: `nextAsPlainText` lifts the Next chip out of the chip row into a paragraph", () => {
    const history: LadderPoint[] = [
      makePoint({ id: "p1", sessionDate: "2026-10-25", grade: 3 }),
    ];
    const { rerender } = render(
      <LevelLadder
        skillName="Freestyle Catch"
        history={history}
        ratedPerSide={false}
        levelDescriptors={{ "4": "Efficient at race pace on most strokes." }}
      />,
    );
    // Default (coach): Next renders as a chip.
    expect(screen.getByTestId("level-ladder-chip-next")).toBeInTheDocument();

    rerender(
      <LevelLadder
        skillName="Freestyle Catch"
        history={history}
        ratedPerSide={false}
        levelDescriptors={{ "4": "Efficient at race pace on most strokes." }}
        nextAsPlainText
      />,
    );
    // Parent view: no chip; plain-text paragraph instead.
    expect(screen.queryByTestId("level-ladder-chip-next")).toBeNull();
    expect(screen.getByTestId("level-ladder-next-text-single")).toHaveTextContent(
      "Advanced — Efficient at race pace on most strokes.",
    );
  });
});
