// Lane math + rendering coverage for WhereSheStands. The chart maps
// averages 1..5 to a pixel band inside a 520-unit viewBox; the helpers
// are tested directly (no render), and a smaller render pass asserts
// the SVG includes a ring + dot per rated lane and a dotted line + "Not
// rated yet" text per unrated lane.

import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import WhereSheStands from "../components/WhereSheStands/WhereSheStands";
import {
  averageToX,
  buildLanes,
  laneIsRated,
  TRACK_X_END,
  TRACK_X_START,
  totalViewHeight,
  type Lane,
} from "../components/WhereSheStands/helpers";

// ── averageToX ───────────────────────────────────────────────────────────

describe("averageToX", () => {
  it("1.0 lands at the left edge of the track", () => {
    expect(averageToX(1)).toBe(TRACK_X_START);
  });

  it("5.0 lands at the right edge of the track", () => {
    expect(averageToX(5)).toBe(TRACK_X_END);
  });

  it("3.0 lands at the midpoint of the track", () => {
    expect(averageToX(3)).toBe((TRACK_X_START + TRACK_X_END) / 2);
  });

  it("2.6 lands 40% of the way from 1 to 5 → x = 150 + 0.4 * 280 = 262", () => {
    // Coach mock uses this exact value for Freestyle at 2.6 average.
    expect(averageToX(2.6)).toBeCloseTo(262, 5);
  });

  it("1.6 lands 15% of the way from 1 to 5 → x = 150 + 0.15 * 280 = 192", () => {
    expect(averageToX(1.6)).toBeCloseTo(192, 5);
  });

  it("clamps averages below 1 to the left edge", () => {
    expect(averageToX(0.3)).toBe(TRACK_X_START);
  });

  it("clamps averages above 5 to the right edge", () => {
    expect(averageToX(5.8)).toBe(TRACK_X_END);
  });
});

// ── laneIsRated ──────────────────────────────────────────────────────────

describe("laneIsRated", () => {
  const baseLane: Lane = {
    slug: "freestyle",
    name: "Freestyle",
    firstAverage: null,
    firstAssessedCount: 0,
    currentAverage: null,
    currentAssessedCount: 0,
    totalCount: 25,
  };

  it("is false when nothing has ever been rated in the group", () => {
    expect(laneIsRated(baseLane)).toBe(false);
  });

  it("is true when the current evaluation has at least one rated skill", () => {
    expect(laneIsRated({ ...baseLane, currentAssessedCount: 1 })).toBe(true);
  });

  it("is true when the first evaluation had a rated skill (even if current regressed)", () => {
    expect(laneIsRated({ ...baseLane, firstAssessedCount: 2 })).toBe(true);
  });
});

// ── buildLanes ───────────────────────────────────────────────────────────

describe("buildLanes", () => {
  it("joins first + current rollups by slug, following the current snapshot's order", () => {
    const first = [
      { screenSlug: "backstroke", name: "Backstroke", average: 1.5, assessedCount: 2, totalCount: 24 },
      { screenSlug: "freestyle", name: "Freestyle", average: 1.8, assessedCount: 5, totalCount: 25 },
    ];
    const current = [
      { screenSlug: "freestyle", name: "Freestyle", average: 2.6, assessedCount: 18, totalCount: 25 },
      { screenSlug: "backstroke", name: "Backstroke", average: 2.1, assessedCount: 24, totalCount: 24 },
    ];
    const lanes = buildLanes(first, current);
    expect(lanes.map((lane) => lane.slug)).toEqual(["freestyle", "backstroke"]);
    expect(lanes[0]).toMatchObject({
      slug: "freestyle",
      firstAverage: 1.8,
      firstAssessedCount: 5,
      currentAverage: 2.6,
      currentAssessedCount: 18,
      totalCount: 25,
    });
  });

  it("drops firstAverage to null when the group didn't appear in the first snapshot", () => {
    const first = [
      { screenSlug: "freestyle", name: "Freestyle", average: 1.8, assessedCount: 5, totalCount: 25 },
    ];
    const current = [
      { screenSlug: "freestyle", name: "Freestyle", average: 2.6, assessedCount: 18, totalCount: 25 },
      { screenSlug: "backstroke", name: "Backstroke", average: 2.1, assessedCount: 24, totalCount: 24 },
    ];
    const lanes = buildLanes(first, current);
    const backstroke = lanes.find((lane) => lane.slug === "backstroke");
    expect(backstroke).toMatchObject({
      firstAverage: null,
      firstAssessedCount: 0,
      currentAverage: 2.1,
      currentAssessedCount: 24,
    });
  });

  it("returns an empty array when the latest snapshot is empty", () => {
    expect(buildLanes([], [])).toEqual([]);
  });

  it("firstSnapshot empty (single-evaluation swimmer) → every lane has firstAverage null", () => {
    const current = [
      { screenSlug: "freestyle", name: "Freestyle", average: 2.0, assessedCount: 4, totalCount: 25 },
    ];
    const lanes = buildLanes([], current);
    expect(lanes).toHaveLength(1);
    expect(lanes[0]!.firstAverage).toBeNull();
    expect(lanes[0]!.firstAssessedCount).toBe(0);
    expect(lanes[0]!.currentAverage).toBe(2.0);
  });
});

// ── totalViewHeight ──────────────────────────────────────────────────────

describe("totalViewHeight", () => {
  it("grows linearly with the lane count (30 units per row + top/bottom pad)", () => {
    const one = totalViewHeight(1);
    const two = totalViewHeight(2);
    expect(two - one).toBe(30);
    const nine = totalViewHeight(9);
    expect(nine).toBeGreaterThan(one);
  });
});

// ── rendering ────────────────────────────────────────────────────────────

describe("WhereSheStands — rendering", () => {
  const laneFixture: Lane[] = [
    {
      slug: "freestyle",
      name: "Freestyle",
      firstAverage: 1.8,
      firstAssessedCount: 5,
      currentAverage: 2.6,
      currentAssessedCount: 18,
      totalCount: 25,
    },
    {
      slug: "butterfly",
      name: "Butterfly",
      firstAverage: null,
      firstAssessedCount: 0,
      currentAverage: null,
      currentAssessedCount: 0,
      totalCount: 25,
    },
  ];

  it("returns null for an empty lanes list", () => {
    const { container } = render(<WhereSheStands lanes={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("rated lane renders a ring at firstAverage, a dot at currentAverage, and the X-of-Y label", () => {
    render(<WhereSheStands lanes={laneFixture} />);
    const freestyleLane = document.querySelector('[data-testid="where-she-stands-lane"][data-slug="freestyle"]');
    expect(freestyleLane).not.toBeNull();
    const ring = within(freestyleLane as HTMLElement).getByTestId("where-she-stands-ring");
    const dot = within(freestyleLane as HTMLElement).getByTestId("where-she-stands-dot");
    // Ring at x = averageToX(1.8) = 150 + 0.2 * 280 = 206.
    expect(parseFloat(ring.getAttribute("data-cx") ?? "")).toBeCloseTo(206, 2);
    // Dot at x = averageToX(2.6) = 262.
    expect(parseFloat(dot.getAttribute("data-cx") ?? "")).toBeCloseTo(262, 2);
    expect(freestyleLane!.textContent).toMatch(/2\.6/);
    expect(freestyleLane!.textContent).toMatch(/18 of 25/);
  });

  it("unrated lane renders a dotted track + 'Not rated yet' and no dot/ring", () => {
    render(<WhereSheStands lanes={laneFixture} />);
    const butterflyLane = document.querySelector('[data-testid="where-she-stands-lane"][data-slug="butterfly"]');
    expect(butterflyLane).not.toBeNull();
    expect(butterflyLane!.getAttribute("data-rated")).toBe("false");
    expect(within(butterflyLane as HTMLElement).getByTestId("where-she-stands-not-rated-track")).toBeInTheDocument();
    expect(within(butterflyLane as HTMLElement).queryByTestId("where-she-stands-ring")).toBeNull();
    expect(within(butterflyLane as HTMLElement).queryByTestId("where-she-stands-dot")).toBeNull();
    expect(butterflyLane!.textContent).toContain("Not rated yet");
  });

  it("renders a dot without a ring when the first evaluation is missing (single-eval swimmer)", () => {
    render(
      <WhereSheStands
        lanes={[
          {
            slug: "freestyle",
            name: "Freestyle",
            firstAverage: null,
            firstAssessedCount: 0,
            currentAverage: 2.0,
            currentAssessedCount: 4,
            totalCount: 25,
          },
        ]}
      />,
    );
    const lane = document.querySelector('[data-testid="where-she-stands-lane"]')!;
    expect(within(lane as HTMLElement).queryByTestId("where-she-stands-ring")).toBeNull();
    expect(within(lane as HTMLElement).getByTestId("where-she-stands-dot")).toBeInTheDocument();
  });

  it("aria-label describes each lane for a screen reader", () => {
    render(<WhereSheStands lanes={laneFixture} />);
    const svg = screen.getByTestId("where-she-stands");
    const aria = svg.getAttribute("aria-label") ?? "";
    expect(aria).toContain("Freestyle: 2.6, 18 of 25");
    expect(aria).toContain("Butterfly: not rated yet");
  });
});
