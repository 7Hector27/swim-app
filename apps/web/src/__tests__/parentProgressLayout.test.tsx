// Breakpoint-structure tests for the rebuilt parent progress layout.
// JSDOM doesn't apply media queries, so the test strategy is
// structural: both the mobile-tablet and desktop subtrees are mounted
// in the DOM (CSS hides one at a time), and we assert the shape of
// each block via data-testids + class attributes.

import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type {
  ParentProgressRatingPoint,
  ParentSkillProgress,
  ParentSwimmer,
  ParentSwimmerProgressResponse,
  ProgressCoachingPriority,
  SkillCurrentLevel,
} from "@swim-app/shared";
import ParentSwimmerProgressContent from "../content/ParentSwimmerProgressContent/ParentSwimmerProgressContent";

vi.mock("@/components/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/LevelLadder", () => ({ default: () => null }));
vi.mock("@/components/StartsSection", () => ({ default: () => null }));
vi.mock("@/content/SwimmerProgressContent/charts/CategoryRadar", () => ({ default: () => null }));

const SWIMMER_ID = "aaaa0000-0000-0000-0000-000000000001";
const CAT_ID = "cccc0000-0000-0000-0000-000000000001";

const swimmer: ParentSwimmer = {
  id: SWIMMER_ID,
  firstName: "Lily",
  lastName: "Carbajal",
  birthDate: "2012-01-01",
  sex: "female",
  isPublic: false,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  clubs: [],
  currentLeagues: [],
};

function level(grade: 1 | 2 | 3 | 4 | 5 | null, overrides: Partial<SkillCurrentLevel> = {}): SkillCurrentLevel {
  return {
    grade,
    notLegal: overrides.notLegal ?? false,
    noConcept: overrides.noConcept ?? false,
    capacityValue: overrides.capacityValue ?? null,
    capacityUnit: overrides.capacityUnit ?? null,
    measurementValue: overrides.measurementValue ?? null,
    measurementUnit: overrides.measurementUnit ?? null,
  };
}

function point(id: string, sessionDate: string, grade: 1 | 2 | 3 | 4 | 5): ParentProgressRatingPoint {
  return {
    id,
    sessionId: `sess-${id}`,
    sessionDate,
    ratedAt: `${sessionDate}T18:00:00.000Z`,
    grade,
    notLegal: false,
    noConcept: false,
    side: null,
    capacityValue: null,
    capacityUnit: null,
    measurementValue: null,
    measurementUnit: null,
    context: "practice",
    edited: false,
    previousValue: null,
  };
}

function skill(options: { slug: string; name: string; current?: SkillCurrentLevel | null; history?: ParentProgressRatingPoint[] }): ParentSkillProgress {
  return {
    skillId: `${options.slug}-id`,
    slug: options.slug,
    name: options.name,
    categoryId: CAT_ID,
    categoryName: "Freestyle",
    type: "rubric",
    unit: null,
    ratedPerSide: false,
    parentSkillId: null,
    current: options.current ?? null,
    currentLeft: null,
    currentRight: null,
    history: options.history ?? [],
  };
}

function priority(slug: string, name: string): ProgressCoachingPriority {
  return { targetSlug: slug, targetName: name, chain: [] };
}

const baseProgress: ParentSwimmerProgressResponse = {
  skills: [
    skill({
      slug: "free-kick",
      name: "Kick",
      current: level(4),
      history: [point("k4", "2026-11-10", 4), point("k2", "2026-09-30", 2)],
    }),
  ],
  startProgress: [],
  headPositionOverall: 3,
  coachingPriorities: [priority("free-pull", "Pull"), priority("free-catch", "Catch"), priority("free-head-position", "Head position")],
  latestCoachingPriority: { text: "Rotate the hips more on each stroke", sessionDate: "2026-11-10", coachName: "Jason" },
  latestCoachingNotes: [],
};

describe("ParentSwimmerProgressContent — layout structure", () => {
  it("renders both the mobile-tablet and desktop subtrees", () => {
    render(<ParentSwimmerProgressContent swimmer={swimmer} progress={baseProgress} categories={[]} />);
    expect(screen.getByTestId("parent-layout-mobile-tablet")).toBeInTheDocument();
    expect(screen.getByTestId("parent-layout-desktop")).toBeInTheDocument();
  });

  it("desktop subtree lays out on a 12-column grid with `grid-template-columns:repeat(12,…)`", () => {
    render(<ParentSwimmerProgressContent swimmer={swimmer} progress={baseProgress} categories={[]} />);
    const desktop = screen.getByTestId("parent-layout-desktop");
    const className = desktop.getAttribute("class") ?? "";
    expect(className).toMatch(/grid-template-columns:repeat\(12/);
  });

  it("desktop subtree contains a side stack holding Snapshot + Starts + Golf slot", () => {
    const withSnapshot: ParentSwimmerProgressResponse = {
      ...baseProgress,
      startProgress: [
        {
          slug: "track-start",
          name: "Track start",
          grade: { status: "graded", grade: 3 },
          components: [{ slug: "track-start-reaction", name: "Reaction", current: level(3) }],
        },
      ],
    };
    render(
      <ParentSwimmerProgressContent
        swimmer={swimmer}
        progress={withSnapshot}
        categories={[]}
        scoreHistory={{
          points: [
            {
              sessionDate: "2026-11-10",
              headPositionOverall: 3,
              categoryRollups: [],
              screenGroupRollups: [{ screenSlug: "freestyle" as const, name: "Freestyle", average: 3, assessedCount: 1, totalCount: 1 }],
              starts: [{ slug: "track-start", name: "Track start", grade: { status: "graded", grade: 3 } }],
              counts: { level1: 0, level2: 0, level3: 1, level4: 0, level5: 0, notLegal: 0, noConcept: 0 },
              totalLevelsGained: 0,
              skillsMastered: 0,
              skillsLearned: 0,
            },
          ],
          recentChanges: [],
          milestones: [],
          measurements: [],
        }}
      />,
    );
    const sideStack = screen.getByTestId("parent-layout-side-stack");
    expect(within(sideStack).getByTestId("parent-progress-snapshot")).toBeInTheDocument();
    expect(within(sideStack).getByTestId("parent-progress-starts")).toBeInTheDocument();
  });
});

describe("ParentSwimmerProgressContent — focus cards share a row", () => {
  function render3(priorities: ProgressCoachingPriority[]) {
    const progress = { ...baseProgress, coachingPriorities: priorities };
    render(<ParentSwimmerProgressContent swimmer={swimmer} progress={progress} categories={[]} />);
  }

  it("with 1 priority: both subtrees mark card-count=1 so the single card fills its row", () => {
    render3([priority("a", "A")]);
    for (const list of screen.getAllByTestId("parent-coach-focus-list")) {
      expect(list.getAttribute("data-card-count")).toBe("1");
    }
  });

  it("with 2 priorities: card-count=2 — cards share a row 50/50, no third-column gap", () => {
    render3([priority("a", "A"), priority("b", "B")]);
    for (const list of screen.getAllByTestId("parent-coach-focus-list")) {
      expect(list.getAttribute("data-card-count")).toBe("2");
    }
  });

  it("with 3 priorities: card-count=3 — never two + one wrap", () => {
    render3([priority("a", "A"), priority("b", "B"), priority("c", "C")]);
    for (const list of screen.getAllByTestId("parent-coach-focus-list")) {
      expect(list.getAttribute("data-card-count")).toBe("3");
    }
  });
});
