// Covers the LevelLadder helpers (pure functions) and the component's
// visible behavior across the states the rebuilt brief called out:
// 12 CSS px text throughout, a left gutter wide enough for "2 Developing",
// single-rating anchored at the right edge of the plot, last date label
// anchored to end, the shape legend moved out of the chart into
// LadderDetails, and the details column rendering with / without the
// Next-level descriptor.

import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { stepLinePath } from "../lib/stepChart";
import LevelLadder, {
  LADDER_LABEL_GUTTER,
  LADDER_LABEL_RIGHT_PAD,
  LADDER_VIEW_WIDTH,
} from "../components/LevelLadder/LevelLadder";
import LadderDetails from "../components/LevelLadder/LadderDetails";
import {
  BAND_ORDER,
  buildChips,
  buildLadderSeries,
  buildNextDescriptor,
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

// ── Helper tests ─────────────────────────────────────────────────────────

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
  it("produces a step path with horizontal-then-vertical segments for a known series", () => {
    const path = stepLinePath([
      { x: 0, y: 30 },
      { x: 50, y: 20 },
      { x: 100, y: 10 },
    ]);
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
    // The streak chip was dropped in the rebuilt ladder — only now + delta remain.
    expect(chips.find((chip) => chip.key === "streak")).toBeUndefined();
  });

  it("Down: emits 'Down N levels since <date>' when the swimmer has regressed", () => {
    const regressed: LadderPoint[] = [
      makePoint({ id: "p3", sessionDate: "2026-10-25", grade: 2 }),
      makePoint({ id: "p1", sessionDate: "2026-10-11", grade: 4 }),
    ];
    const chips = buildChips(buildLadderSeries(regressed));
    expect(chips.find((chip) => chip.key === "delta")?.label).toMatch(/^Down 2 levels since /);
  });

  it("single rating: emits 'Now' and 'First rating' — no streak, no 'since'", () => {
    const single = [makePoint({ id: "p1", sessionDate: "2026-10-25", grade: 3 })];
    const chips = buildChips(buildLadderSeries(single));
    expect(chips.map((chip) => chip.key)).toEqual(["now", "delta"]);
    expect(chips[0]?.label).toBe("Now: Competent");
    expect(chips[1]?.label).toBe("First rating");
  });

  it("no Next chip — the Next descriptor renders as plain text in LadderDetails, not as a chip", () => {
    const series = buildLadderSeries([makePoint({ id: "p1", sessionDate: "2026-10-25", grade: 3 })]);
    const chips = buildChips(series);
    expect(chips.find((chip) => chip.key === "next")).toBeUndefined();
  });
});

describe("LevelLadder helpers — buildNextDescriptor", () => {
  const series = buildLadderSeries([makePoint({ id: "p1", sessionDate: "2026-10-25", grade: 3 })]);

  it("returns null when descriptors are undefined", () => {
    expect(buildNextDescriptor(series, undefined)).toBeNull();
  });

  it("returns null when the next-level descriptor is missing or blank", () => {
    expect(buildNextDescriptor(series, { 4: "" })).toBeNull();
    expect(buildNextDescriptor(series, { 5: "A" })).toBeNull();
  });

  it("returns the next level name and the descriptor text when both are present", () => {
    expect(buildNextDescriptor(series, { 4: "Efficient at race pace" })).toEqual({
      levelName: "Advanced",
      text: "Efficient at race pace",
    });
  });

  it("returns null when the latest rating is already at level 5", () => {
    const mastered = buildLadderSeries([makePoint({ id: "p1", sessionDate: "2026-10-25", grade: 5 })]);
    expect(buildNextDescriptor(mastered, { 5: "N/A" })).toBeNull();
  });
});

describe("LevelLadder helpers — pickDateTickIndices", () => {
  it("returns every index when the series fits (≤ maxLabels)", () => {
    const picks = pickDateTickIndices(3);
    expect([...picks].sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });

  it("spans 10 points with at most 4 labels including first + last", () => {
    const picks = pickDateTickIndices(10);
    expect(picks.has(0)).toBe(true);
    expect(picks.has(9)).toBe(true);
    expect(picks.size).toBeGreaterThanOrEqual(3);
    expect(picks.size).toBeLessThanOrEqual(4);
  });
});

describe("LevelLadder helpers — trimToRecent", () => {
  it("keeps the most recent entries when the series exceeds maxPoints", () => {
    const series = Array.from({ length: 12 }, (_, index) => makePoint({ id: `p${index}`, sessionDate: "2026-01-01", grade: 3 }));
    const trimmed = trimToRecent(series, 10);
    expect(trimmed.map((point) => point.id)).toEqual(series.slice(2).map((point) => point.id));
  });
});

// ── Chart rendering ──────────────────────────────────────────────────────

describe("LevelLadder — chart rendering", () => {
  it("renders the five band labels using the rating-scale names, at 12px CSS font-size", () => {
    render(
      <LevelLadder
        skillName="Freestyle Kick"
        history={[makePoint({ id: "p1", sessionDate: "2026-10-25", grade: 3 })]}
        ratedPerSide={false}
      />,
    );
    for (const label of ["1 Emerging", "2 Developing", "3 Competent", "4 Advanced", "5 Mastery"]) {
      const node = screen.getByText(label);
      expect(node).toBeInTheDocument();
      // CSS px, not viewBox units — keeps text size stable at every viewport.
      expect(node.getAttribute("style") ?? "").toContain("font-size: 12px");
    }
  });

  it("left gutter fits the longest level label ('2 Developing') at 12px with padding", () => {
    render(
      <LevelLadder
        skillName="Freestyle Kick"
        history={[makePoint({ id: "p1", sessionDate: "2026-10-25", grade: 3 })]}
        ratedPerSide={false}
      />,
    );
    // Upper-bound width per character at 12px Figtree. categoryRadar.test
    // uses the same 7.5 * (font/13) heuristic — kept in lockstep so a passing
    // assertion here is conservative vs. real rendering.
    const CHAR_WIDTH_12PX = 7.5 * (12 / 13);
    const labelNodes = screen.getAllByTestId("level-ladder-band-label");
    for (const node of labelNodes) {
      const content = Array.from(node.childNodes)
        .map((child) => child.textContent ?? "")
        .join("")
        .trim();
      const widthEstimate = content.length * CHAR_WIDTH_12PX;
      // Labels anchor at x = LADDER_LABEL_GUTTER - LADDER_LABEL_RIGHT_PAD with
      // textAnchor="end", so the left edge of the label is at
      // (gutter - padRight) - width. That must stay ≥ 0 so the "3" in
      // "3 Competent" doesn't clip to a "B".
      const labelRightX = LADDER_LABEL_GUTTER - LADDER_LABEL_RIGHT_PAD;
      const labelLeftX = labelRightX - widthEstimate;
      expect(labelLeftX, `${content} left edge @12px`).toBeGreaterThanOrEqual(0);
    }
  });

  it("caps the drawing size at 400 CSS px wide and never scales up above it", () => {
    render(
      <LevelLadder
        skillName="Freestyle Kick"
        history={[makePoint({ id: "p1", sessionDate: "2026-10-25", grade: 3 })]}
        ratedPerSide={false}
      />,
    );
    const svg = screen.getByTestId("level-ladder");
    const style = svg.getAttribute("style") ?? "";
    expect(style).toContain(`max-width: ${LADDER_VIEW_WIDTH}px`);
    expect(style).toContain("width: 100%");
  });

  it("single rating anchors the point to the right edge of the plot (not floating in the middle)", () => {
    render(
      <LevelLadder
        skillName="Freestyle Kick"
        history={[makePoint({ id: "p1", sessionDate: "2026-10-25", grade: 3 })]}
        ratedPerSide={false}
      />,
    );
    const newest = screen.getByTestId("level-ladder-newest");
    const circle = newest.querySelector("circle");
    expect(circle).not.toBeNull();
    const cx = Number(circle!.getAttribute("cx"));
    // Right edge = VIEW_WIDTH - PAD_RIGHT. The component exports the
    // gutter + VIEW_WIDTH but not PAD_RIGHT; its value (16) is reflected
    // in the single-rating test by asserting cx lands ≥ the plot's right
    // third rather than its centre (which would be ~248).
    expect(cx).toBeGreaterThan(LADDER_VIEW_WIDTH * 0.75);
  });

  it("single rating date label sits under the right-edge point and anchors to end", () => {
    render(
      <LevelLadder
        skillName="Freestyle Kick"
        history={[makePoint({ id: "p1", sessionDate: "2026-10-25", grade: 3 })]}
        ratedPerSide={false}
      />,
    );
    const dates = screen.getAllByTestId("level-ladder-date-label");
    expect(dates).toHaveLength(1);
    expect(dates[0]?.getAttribute("data-anchor")).toBe("end");
  });

  it("first and last date labels anchor to the plot edges; middle ticks stay centred", () => {
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
    const first = dateLabels[0];
    const last = dateLabels[dateLabels.length - 1];
    expect(first?.getAttribute("data-anchor")).toBe("start");
    expect(last?.getAttribute("data-anchor")).toBe("end");
    const middle = dateLabels.filter((node) => node.getAttribute("data-first-or-last") !== "true");
    for (const node of middle) {
      expect(node.getAttribute("data-anchor")).toBe("middle");
    }
  });

  it("dates render at 12px (stays 12 CSS px even as the SVG shrinks)", () => {
    render(
      <LevelLadder
        skillName="Freestyle Kick"
        history={[
          makePoint({ id: "p2", sessionDate: "2026-10-25", grade: 4 }),
          makePoint({ id: "p1", sessionDate: "2026-10-11", grade: 2 }),
        ]}
        ratedPerSide={false}
      />,
    );
    const dates = screen.getAllByTestId("level-ladder-date-label");
    for (const node of dates) {
      expect(node.getAttribute("style") ?? "").toContain("font-size: 12px");
    }
  });

  it("newest point is a filled circle with the grade number (even when the context is a drill or race)", () => {
    render(
      <LevelLadder
        skillName="Freestyle Kick"
        history={[makePoint({ id: "p1", sessionDate: "2026-10-25", grade: 3, context: "race" })]}
        ratedPerSide={false}
      />,
    );
    const newest = screen.getByTestId("level-ladder-newest");
    expect(newest.querySelector("circle")).not.toBeNull();
    const numberText = newest.querySelector("text");
    expect(numberText?.textContent).toBe("3");
    expect(numberText?.getAttribute("style") ?? "").toContain("font-size: 12px");
  });

  it("left/right: draws two step lines (one dashed)", () => {
    const history: LadderPoint[] = [
      makePoint({ id: "l2", sessionDate: "2026-10-25", grade: 4, side: "left" }),
      makePoint({ id: "r2", sessionDate: "2026-10-25", grade: 3, side: "right" }),
      makePoint({ id: "l1", sessionDate: "2026-10-11", grade: 2, side: "left" }),
      makePoint({ id: "r1", sessionDate: "2026-10-11", grade: 2, side: "right" }),
    ];
    render(<LevelLadder skillName="Bilateral breathing" history={history} ratedPerSide={true} />);
    expect(screen.getByTestId("level-ladder-line-left")).toBeInTheDocument();
    expect(screen.getByTestId("level-ladder-line-right")).toBeInTheDocument();
    expect(screen.getByTestId("level-ladder-line-right").getAttribute("stroke-dasharray")).toBeTruthy();
    expect(screen.getByTestId("level-ladder-line-left").getAttribute("stroke-dasharray")).toBeFalsy();
  });

  it("Not legal: draws the dedicated marker below the bands rather than plotting a level", () => {
    const history: LadderPoint[] = [
      makePoint({ id: "p2", sessionDate: "2026-10-25", grade: 3 }),
      makePoint({ id: "p1", sessionDate: "2026-10-18", grade: 2, notLegal: true }),
    ];
    render(<LevelLadder skillName="Freestyle Kick" history={history} ratedPerSide={false} />);
    const specials = screen.getAllByTestId("level-ladder-special");
    expect(specials).toHaveLength(1);
    expect(specials[0]).toHaveTextContent("NL");
    expect(screen.getAllByTestId("level-ladder-newest")).toHaveLength(1);
  });

  it("does not render the shape legend inside the chart — the legend lives in LadderDetails", () => {
    const { container } = render(
      <LevelLadder
        skillName="Freestyle Kick"
        history={[makePoint({ id: "p1", sessionDate: "2026-10-25", grade: 3 })]}
        ratedPerSide={false}
      />,
    );
    // No "Practice / Drill / Race" legend text inside the chart.
    expect(container.textContent ?? "").not.toMatch(/Practice.*Drill.*Race/);
  });
});

// ── LadderDetails rendering ──────────────────────────────────────────────

describe("LadderDetails", () => {
  const history: LadderPoint[] = [
    makePoint({ id: "p3", sessionDate: "2026-10-25", grade: 4 }),
    makePoint({ id: "p2", sessionDate: "2026-10-18", grade: 3 }),
    makePoint({ id: "p1", sessionDate: "2026-10-11", grade: 2 }),
  ];

  it("renders the Now + delta chips", () => {
    render(<LadderDetails history={history} ratedPerSide={false} />);
    const now = screen.getByTestId("level-ladder-chip-now");
    expect(now).toHaveTextContent("Now: Advanced");
    const delta = screen.getByTestId("level-ladder-chip-delta");
    expect(delta.textContent ?? "").toMatch(/^Up 2 levels since /);
  });

  it("renders the Next, <levelName>: descriptor line when descriptors are present", () => {
    render(
      <LadderDetails
        history={history}
        ratedPerSide={false}
        levelDescriptors={{ 5: "Efficient at race pace on most strokes." }}
      />,
    );
    const next = screen.getByTestId("ladder-details-next-single");
    expect(next.textContent ?? "").toContain("Next, Mastery:");
    expect(next.textContent ?? "").toContain("Efficient at race pace on most strokes.");
  });

  it("omits the Next line when the skill has no descriptors", () => {
    render(<LadderDetails history={history} ratedPerSide={false} />);
    expect(screen.queryByTestId("ladder-details-next-single")).toBeNull();
  });

  it("surfaces the shape legend as a single text line", () => {
    render(<LadderDetails history={history} ratedPerSide={false} />);
    const legend = screen.getByTestId("ladder-details-legend");
    expect(legend).toHaveTextContent("Circle is practice, triangle is a drill, diamond is a race.");
  });

  it("per-side skills: emits one chip row per side labelled L / R", () => {
    const sided: LadderPoint[] = [
      makePoint({ id: "l2", sessionDate: "2026-10-25", grade: 4, side: "left" }),
      makePoint({ id: "r2", sessionDate: "2026-10-25", grade: 3, side: "right" }),
      makePoint({ id: "l1", sessionDate: "2026-10-11", grade: 2, side: "left" }),
      makePoint({ id: "r1", sessionDate: "2026-10-11", grade: 2, side: "right" }),
    ];
    render(<LadderDetails history={sided} ratedPerSide={true} />);
    const left = screen.getByTestId("ladder-details-chips-left");
    const right = screen.getByTestId("ladder-details-chips-right");
    expect(within(left).getByText("L:")).toBeInTheDocument();
    expect(within(right).getByText("R:")).toBeInTheDocument();
  });

  it("renders the coach-only extras slot under the legend when provided", () => {
    render(
      <LadderDetails
        history={history}
        ratedPerSide={false}
        extras={<p data-testid="coach-extras">Edit list goes here</p>}
      />,
    );
    expect(screen.getByTestId("coach-extras")).toBeInTheDocument();
  });
});
