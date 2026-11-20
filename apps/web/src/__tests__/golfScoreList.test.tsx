// Covers GolfScoreList — the parent-facing golf-score renderer that
// switches between a compact one-row-per-stroke list (desktop side
// column) and a card grid (phone + tablet) via viewport CSS. Both forms
// render in the DOM; JSDOM doesn't apply media queries, so the tests
// assert the structure of each.

import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import type { ParentGolfScoreTrend } from "@swim-app/shared";
import GolfScoreList from "../content/ParentSwimmerProgressContent/sections/GolfScoreList";

function trendWithPoints(options: {
  skillSlug: string;
  skillName: string;
  category: "push_off_in_water" | "deck_dive" | "block_dive";
  points: Array<{ sessionDate: string; timeSeconds: number; strokes: number }>;
}): ParentGolfScoreTrend {
  return {
    skillSlug: options.skillSlug,
    skillName: options.skillName,
    byCategory: [
      {
        category: options.category,
        ageBands: null,
        points: options.points.map((point) => ({
          ratedAt: `${point.sessionDate}T18:00:00.000Z`,
          sessionDate: point.sessionDate,
          grade: 3,
          timeSeconds: point.timeSeconds,
          strokeCountValue: point.strokes,
        })),
      },
    ],
  };
}

describe("GolfScoreList — empty", () => {
  it("renders null when no trends are passed", () => {
    const { container } = render(<GolfScoreList trends={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders null when every trend has an empty points array", () => {
    const trend: ParentGolfScoreTrend = {
      skillSlug: "free-golf-score",
      skillName: "Freestyle golf score",
      byCategory: [{ category: "push_off_in_water", ageBands: null, points: [] }],
    };
    const { container } = render(<GolfScoreList trends={[trend]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("GolfScoreList — populated", () => {
  const twoCategoriesTrend: ParentGolfScoreTrend = {
    skillSlug: "free-golf-score",
    skillName: "Freestyle golf score",
    byCategory: [
      {
        category: "push_off_in_water",
        ageBands: null,
        points: [
          { ratedAt: "2026-09-10T18:00:00.000Z", sessionDate: "2026-09-10", grade: 3, timeSeconds: 14.5, strokeCountValue: 22 },
          { ratedAt: "2026-11-10T18:00:00.000Z", sessionDate: "2026-11-10", grade: 3, timeSeconds: 13.0, strokeCountValue: 21 },
        ],
      },
      {
        category: "block_dive",
        ageBands: null,
        points: [
          { ratedAt: "2026-11-10T18:00:00.000Z", sessionDate: "2026-11-10", grade: 3, timeSeconds: 12.0, strokeCountValue: 20 },
        ],
      },
    ],
  };

  it("renders both the card grid (phone/tablet) and the compact list (desktop)", () => {
    render(<GolfScoreList trends={[twoCategoriesTrend]} />);
    expect(screen.getByTestId("parent-golf-score-cards")).toBeInTheDocument();
    expect(screen.getByTestId("parent-golf-score-compact-list")).toBeInTheDocument();
    // Both forms carry the stroke name.
    expect(screen.getAllByText("Freestyle golf score").length).toBeGreaterThan(0);
  });

  it("surfaces the category switch when more than one category has data", () => {
    render(<GolfScoreList trends={[twoCategoriesTrend]} />);
    const switcher = screen.getByTestId("parent-golf-category-switch");
    expect(within(switcher).getByText("Push-off")).toBeInTheDocument();
    expect(within(switcher).getByText("Block dive")).toBeInTheDocument();
    // Default selection: the first category with data (push-off).
    const selected = switcher.querySelector('[aria-checked="true"]');
    expect(selected?.textContent).toBe("Push-off");
  });

  it("hides the category switch when only one category has data", () => {
    const oneCategoryTrend = trendWithPoints({
      skillSlug: "free-golf-score",
      skillName: "Freestyle golf score",
      category: "push_off_in_water",
      points: [{ sessionDate: "2026-11-10", timeSeconds: 13, strokes: 21 }],
    });
    render(<GolfScoreList trends={[oneCategoryTrend]} />);
    expect(screen.queryByTestId("parent-golf-category-switch")).toBeNull();
  });

  it("switches the visible trends when a different category is picked", () => {
    const freeOnBlock = trendWithPoints({
      skillSlug: "free-golf-score",
      skillName: "Freestyle golf score",
      category: "block_dive",
      points: [{ sessionDate: "2026-11-10", timeSeconds: 13, strokes: 21 }],
    });
    const backOnPush = trendWithPoints({
      skillSlug: "back-golf-score",
      skillName: "Backstroke golf score",
      category: "push_off_in_water",
      points: [{ sessionDate: "2026-11-10", timeSeconds: 15, strokes: 25 }],
    });
    render(<GolfScoreList trends={[freeOnBlock, backOnPush]} />);
    // Default selection → push-off → shows back-golf-score only.
    expect(screen.getAllByText("Backstroke golf score").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Freestyle golf score")).toHaveLength(0);
    // Click Block dive → shows free-golf-score only.
    fireEvent.click(screen.getByText("Block dive"));
    expect(screen.getAllByText("Freestyle golf score").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Backstroke golf score")).toHaveLength(0);
  });

  it("change-label: shows 'Down 2.5 since Sep' for a two-point improving trend", () => {
    render(<GolfScoreList trends={[twoCategoriesTrend]} />);
    const list = screen.getByTestId("parent-golf-score-compact-list");
    expect(list.textContent ?? "").toMatch(/Down 2\.5 since Sep/);
  });
});
