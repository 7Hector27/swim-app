// Pass 2c: GolfScoreCard chart gets real data for the first time. The
// handler used to emit `measurementValue: null` for every point, so the
// chart's `allValues.length === 0` guard always short-circuited to
// `return null`. Now points carry timeSeconds + strokeCountValue; the
// chart plots the derived golf score = time + strokes.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { GolfScoreTrend } from "@swim-app/shared";
import GolfScoreCard from "../content/SwimmerProgressContent/charts/GolfScoreCard";

function makeTrend(overrides?: Partial<GolfScoreTrend>): GolfScoreTrend {
  return {
    skillSlug: "free-golf-score",
    skillName: "Freestyle golf score",
    byCategory: [
      {
        category: "push_off_in_water",
        points: [
          {
            ratedAt: "2026-10-11T18:00:00.000Z",
            sessionDate: "2026-10-11",
            sessionId: "ssss0000-0000-0000-0000-000000000011",
            grade: 3,
            timeSeconds: 13.40,
            strokeCountValue: 17,
          },
          {
            ratedAt: "2026-10-25T18:00:00.000Z",
            sessionDate: "2026-10-25",
            sessionId: "ssss0000-0000-0000-0000-000000000025",
            grade: 3,
            timeSeconds: 12.50,
            strokeCountValue: 17,
          },
        ],
        ageBands: null,
      },
    ],
    ...overrides,
  };
}

describe("GolfScoreCard", () => {
  it("renders the latest derived golf score (time + strokes) in the header", () => {
    render(<GolfScoreCard trend={makeTrend()} />);
    // Latest point is 12.50 + 17 = 29.50 → "29.5".
    expect(screen.getByText("29.5")).toBeInTheDocument();
  });

  it("falls back cleanly when points lack timeSeconds (legacy rows → chart returns null)", () => {
    const trend = makeTrend({
      byCategory: [
        {
          category: "push_off_in_water",
          points: [
            {
              ratedAt: "2026-10-25T18:00:00.000Z",
              sessionDate: "2026-10-25",
              sessionId: "ssss0000-0000-0000-0000-000000000025",
              grade: 3,
              timeSeconds: null,
              strokeCountValue: null,
            },
          ],
          ageBands: null,
        },
      ],
    });
    const { container } = render(<GolfScoreCard trend={trend} />);
    // GolfCategory returns null when there's no derivable score and no age
    // bands — the enclosing wrapper div still renders but the inner chart
    // + header never do.
    expect(container.querySelector("svg")).toBeNull();
  });
});
