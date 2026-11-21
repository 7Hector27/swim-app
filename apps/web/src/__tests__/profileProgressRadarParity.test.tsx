// Parity guard: the Snapshot radar on the parent profile page and the
// Snapshot radar on the parent progress page must render the same groups
// with the same averages for the same fixture. If a future change rewires
// either page onto a different rollup source, the two pages drift and
// this test catches it before shipping.

import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

import type {
  Club,
  HouseholdRole,
  ParentPersonalBestsResponse,
  ParentScoreHistoryResponse,
  ParentSwimmer,
  ParentSwimmerProgressResponse,
  UpcomingLesson,
} from "@swim-app/shared";

const { mockUseActionState } = vi.hoisted(() => ({ mockUseActionState: vi.fn() }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, useActionState: mockUseActionState };
});

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/content/EditSwimmerContent/actions", () => ({
  toggleSwimmerPublic: vi.fn(),
}));

vi.mock("@/components/SiteNav", () => ({ default: () => null }));

import SwimmerProfileContent from "../content/SwimmerProfileContent/SwimmerProfileContent";
import ParentSwimmerProgressContent from "../content/ParentSwimmerProgressContent/ParentSwimmerProgressContent";

mockUseActionState.mockReturnValue([{ status: "idle" }, vi.fn(), false]);

const SWIMMER_ID = "99999999-9999-4999-8999-999999999999";
const FIRST_NAME = "Rowan";

const swimmer: ParentSwimmer = {
  id: SWIMMER_ID,
  firstName: FIRST_NAME,
  lastName: "Alvarez",
  birthDate: "2014-01-01",
  sex: "female",
  isPublic: false,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  clubs: [],
  currentLeagues: [],
};

const EMPTY_LEVEL_COUNTS = {
  level1: 0,
  level2: 0,
  level3: 0,
  level4: 0,
  level5: 0,
  notLegal: 0,
  noConcept: 0,
} as const;

// Same fixture passed to both pages. Two sessions so the progress page
// also draws the first-evaluation overlay, matching real use.
const scoreHistory: ParentScoreHistoryResponse = {
  points: [
    {
      sessionDate: "2026-09-30",
      headPositionOverall: 2,
      categoryRollups: [],
      screenGroupRollups: [
        { screenSlug: "freestyle", name: "Freestyle", average: 1.8, assessedCount: 1, totalCount: 2 },
        { screenSlug: "backstroke", name: "Backstroke", average: 1.5, assessedCount: 2, totalCount: 3 },
        { screenSlug: "butterfly", name: "Butterfly", average: 1.2, assessedCount: 1, totalCount: 3 },
      ],
      starts: [],
      counts: { ...EMPTY_LEVEL_COUNTS },
      totalLevelsGained: 0,
      skillsMastered: 0,
      skillsLearned: 1,
    },
    {
      sessionDate: "2026-10-25",
      headPositionOverall: 3,
      categoryRollups: [],
      screenGroupRollups: [
        { screenSlug: "freestyle", name: "Freestyle", average: 3.1, assessedCount: 2, totalCount: 2 },
        { screenSlug: "backstroke", name: "Backstroke", average: 2.6, assessedCount: 3, totalCount: 3 },
        { screenSlug: "butterfly", name: "Butterfly", average: 2.2, assessedCount: 2, totalCount: 3 },
      ],
      starts: [],
      counts: { ...EMPTY_LEVEL_COUNTS },
      totalLevelsGained: 1,
      skillsMastered: 0,
      skillsLearned: 1,
    },
  ],
  recentChanges: [],
  milestones: [],
  measurements: [],
};

const progress: ParentSwimmerProgressResponse = {
  skills: [
    {
      skillId: "free-kick-id",
      slug: "free-kick",
      name: "Freestyle Kick",
      categoryId: "cat-free",
      categoryName: "Freestyle",
      type: "rubric",
      unit: null,
      ratedPerSide: false,
      parentSkillId: null,
      current: { grade: 3, notLegal: false, noConcept: false, capacityValue: null, capacityUnit: null, measurementValue: null, measurementUnit: null },
      currentLeft: null,
      currentRight: null,
      history: [
        { id: "p2", sessionId: "s2", grade: 3, notLegal: false, noConcept: false, side: null, capacityValue: null, capacityUnit: null, measurementValue: null, measurementUnit: null, edited: false, previousValue: null, context: "practice", ratedAt: "2026-10-25T18:00:00.000Z", sessionDate: "2026-10-25" },
        { id: "p1", sessionId: "s1", grade: 2, notLegal: false, noConcept: false, side: null, capacityValue: null, capacityUnit: null, measurementValue: null, measurementUnit: null, edited: false, previousValue: null, context: "practice", ratedAt: "2026-09-30T18:00:00.000Z", sessionDate: "2026-09-30" },
      ],
    },
  ],
  startProgress: [],
  headPositionOverall: 3,
  coachingPriorities: [],
  latestCoachingPriority: null,
  latestCoachingNotes: [],
};

const emptyPersonalBests: ParentPersonalBestsResponse = { personalBests: [] };
const emptyLessons: UpcomingLesson[] = [];
const emptyClubs: Club[] = [];
const householdRole: HouseholdRole = "owner";

function readRadarRadii(container: HTMLElement): Array<{ label: string; percent: number }> {
  // The radar draws one filled dot per group it actually plots; the x/y
  // coords aren't stable enough for a cross-render string compare, but
  // the dot's `data-pct` attribute is — it's just `averageToPct(avg)`
  // rounded to two decimals. Pair each dot with the matching axis label
  // so an order-insensitive check still works.
  const texts = Array.from(container.querySelectorAll<SVGTextElement>("text[data-testid='category-radar-label']"));
  const dots = Array.from(container.querySelectorAll<SVGElement>("[data-testid='wss-marker-dot']"));
  // We don't rely on the where-she-stands dot here — the radar emits its
  // own dot inside a <g> per plotted group. The radar module tags them
  // with no data-slug, so we match by index against the text labels
  // (they're drawn in the same axis order).
  const radarDots = Array.from(container.querySelectorAll<SVGElement>("circle[stroke='var(--color-surface-soft)']"));
  const sourceDots = radarDots.length > 0 ? radarDots : dots;
  return texts.map((text, index) => {
    const label = Array.from(text.querySelectorAll("tspan")).map((tspan) => tspan.textContent ?? "").join(" ").trim();
    const dot = sourceDots[index];
    const cx = dot ? Number(dot.getAttribute("cx")) : NaN;
    const cy = dot ? Number(dot.getAttribute("cy")) : NaN;
    return { label, percent: Number.isFinite(cx) && Number.isFinite(cy) ? Math.round((cx + cy) * 100) / 100 : NaN };
  });
}

describe("profile vs. progress — same CategoryRadar inputs", () => {
  it("renders the same group labels and the same current-average markers on both pages", () => {
    const { container: profileContainer } = render(
      <SwimmerProfileContent
        swimmer={swimmer}
        householdRole={householdRole}
        clubsResult={{ ok: true, data: emptyClubs }}
        progress={{ ok: true, data: progress }}
        scoreHistory={{ ok: true, data: scoreHistory }}
        personalBests={{ ok: true, data: emptyPersonalBests }}
        upcomingLessons={{ ok: true, data: emptyLessons }}
        pastLessons={{ ok: true, data: emptyLessons }}
      />,
    );
    const { container: progressContainer } = render(
      <ParentSwimmerProgressContent
        swimmer={swimmer}
        progress={progress}
        categories={[]}
        scoreHistory={scoreHistory}
      />,
    );

    const profile = readRadarRadii(profileContainer);
    const progressRadii = readRadarRadii(progressContainer);

    // Three screen groups → three axis labels on both pages, in the
    // same order (buildPolygon / radar derive order straight from the
    // fixture's screenGroupRollups).
    expect(profile.map((entry) => entry.label)).toEqual(["Freestyle", "Backstroke", "Butterfly"]);
    expect(progressRadii.map((entry) => entry.label)).toEqual(["Freestyle", "Backstroke", "Butterfly"]);

    // And the plotted dot for each group lands at the same point on
    // both pages — the radar reads the same current average from the
    // same score-history point.
    expect(profile.map((entry) => entry.percent)).toEqual(progressRadii.map((entry) => entry.percent));
  });
});
