import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type {
  CategoriesResponse,
  ParentScoreHistoryResponse,
  ParentSwimmer,
  ParentSwimmerProgressResponse,
} from "@swim-app/shared";

vi.mock("@/components/SiteNav", () => ({ default: () => <nav /> }));
vi.mock("@/components/TrendLine", () => ({ default: () => null }));
vi.mock("@/components/SkillChart", () => ({ default: () => null }));

import ParentSwimmerProgressContent from "../content/ParentSwimmerProgressContent/ParentSwimmerProgressContent";

const SWIMMER_ID = "aaaa0000-0000-0000-0000-000000000001";
const SKILL_ID = "bbbb0000-0000-0000-0000-000000000001";
const SIDED_ID = "bbbb0000-0000-0000-0000-000000000002";
const CAT_ID = "cccc0000-0000-0000-0000-000000000001";

const swimmer: ParentSwimmer = {
  id: SWIMMER_ID,
  firstName: "Maya",
  lastName: "Rivera",
  birthDate: "2012-01-01",
  sex: "female",
  isPublic: false,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  clubs: [],
  currentLeagues: [],
};

const emptyProgress: ParentSwimmerProgressResponse = {
  skills: [],
  startProgress: [],
  headPositionOverall: null,
  coachingPriorities: [],
  latestCoachingNotes: [],
  latestCoachingPriority: null,
};

const categories: CategoriesResponse = [];
const emptyScoreHistory: ParentScoreHistoryResponse = {
  points: [],
  recentChanges: [],
  milestones: [],
  measurements: [],
};

describe("ParentSwimmerProgressContent", () => {
  it("shows empty state when no evaluations", () => {
    render(
      <ParentSwimmerProgressContent
        swimmer={swimmer}
        progress={emptyProgress}
        categories={categories}
      />,
    );
    expect(screen.getByText(/no evaluations recorded yet/i)).toBeInTheDocument();
  });

  it("shows skill current level with grade and level description", () => {
    const progress: ParentSwimmerProgressResponse = {
      ...emptyProgress,
      skills: [
        {
          skillId: SKILL_ID,
          slug: "freestyle-kick",
          name: "Freestyle Kick",
          categoryId: CAT_ID,
          categoryName: "Freestyle",
          type: "rubric",
          unit: null,
          ratedPerSide: false,
          parentSkillId: null,
          current: {
            grade: 3,
            notLegal: false,
            noConcept: false,
            capacityValue: null,
            capacityUnit: null,
            measurementValue: null,
            measurementUnit: null,
          },
          currentLeft: null,
          currentRight: null,
          history: [],
        },
      ],
    };
    render(
      <ParentSwimmerProgressContent
        swimmer={swimmer}
        progress={progress}
        categories={categories}
      />,
    );
    expect(screen.getByText("Freestyle Kick")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("shows DQ for not-legal in danger style", () => {
    const progress: ParentSwimmerProgressResponse = {
      ...emptyProgress,
      skills: [
        {
          skillId: SKILL_ID,
          slug: "freestyle-kick",
          name: "Freestyle Kick",
          categoryId: CAT_ID,
          categoryName: "Freestyle",
          type: "rubric",
          unit: null,
          ratedPerSide: false,
          parentSkillId: null,
          current: {
            grade: 2,
            notLegal: true,
            noConcept: false,
            capacityValue: null,
            capacityUnit: null,
            measurementValue: null,
            measurementUnit: null,
          },
          currentLeft: null,
          currentRight: null,
          history: [],
        },
      ],
    };
    render(
      <ParentSwimmerProgressContent
        swimmer={swimmer}
        progress={progress}
        categories={categories}
      />,
    );
    expect(screen.getByText("DQ")).toBeInTheDocument();
  });

  it("shows Not assessed for skills from categories without data", () => {
    const cats: CategoriesResponse = [
      {
        id: CAT_ID,
        slug: "freestyle",
        name: "Freestyle",
        sortOrder: 1,
        skills: [
          {
            id: SKILL_ID,
            slug: "freestyle-kick",
            name: "Freestyle Kick",
            type: "rubric",
            unit: null,
            stroke: null,
            ratedPerSide: false,
            notLegalAllowed: false,
            parentSkillId: null,
            sortOrder: 1,
            faultTags: [],
            descriptors: [],
          },
        ],
      },
    ];
    render(
      <ParentSwimmerProgressContent
        swimmer={swimmer}
        progress={emptyProgress}
        categories={cats}
      />,
    );
    expect(screen.getByText("Freestyle Kick")).toBeInTheDocument();
    expect(screen.getAllByText("Not assessed").length).toBeGreaterThan(0);
  });

  it("shows start grade section", () => {
    const progress: ParentSwimmerProgressResponse = {
      ...emptyProgress,
      startProgress: [
        {
          slug: "track-start",
          name: "Track Start",
          grade: { status: "graded", grade: 4 },
          components: [
            {
              slug: "reaction-time",
              name: "Reaction Time",
              current: {
                grade: 4,
                notLegal: false,
                noConcept: false,
                capacityValue: null,
                capacityUnit: null,
                measurementValue: null,
                measurementUnit: null,
              },
            },
          ],
        },
      ],
    };
    render(
      <ParentSwimmerProgressContent
        swimmer={swimmer}
        progress={progress}
        categories={categories}
      />,
    );
    expect(screen.getByText("Track Start")).toBeInTheDocument();
    expect(screen.getAllByText("4").length).toBeGreaterThan(0);
  });

  it("shows L and R badges for side-rated skills", () => {
    const progress: ParentSwimmerProgressResponse = {
      ...emptyProgress,
      skills: [
        {
          skillId: SIDED_ID,
          slug: "freestyle-breathing",
          name: "Freestyle Breathing",
          categoryId: CAT_ID,
          categoryName: "Freestyle",
          type: "rubric",
          unit: null,
          ratedPerSide: true,
          parentSkillId: null,
          current: null,
          currentLeft: {
            grade: 3,
            notLegal: false,
            noConcept: false,
            capacityValue: null,
            capacityUnit: null,
            measurementValue: null,
            measurementUnit: null,
          },
          currentRight: {
            grade: 4,
            notLegal: false,
            noConcept: false,
            capacityValue: null,
            capacityUnit: null,
            measurementValue: null,
            measurementUnit: null,
          },
          history: [],
        },
      ],
    };
    render(
      <ParentSwimmerProgressContent
        swimmer={swimmer}
        progress={progress}
        categories={categories}
      />,
    );
    expect(screen.getByText(/L 3/)).toBeInTheDocument();
    expect(screen.getByText(/R 4/)).toBeInTheDocument();
  });

  // Regression: when the API returns latestCoachingPriority = null (swimmer
  // has never had a priority written), the "Current focus" section is hidden
  // entirely. No placeholder, no empty box.
  it("hides Current focus when no priority has ever been written", () => {
    render(
      <ParentSwimmerProgressContent
        swimmer={swimmer}
        progress={emptyProgress}
        categories={categories}
      />,
    );
    expect(screen.queryByTestId("parent-progress-current-focus")).toBeNull();
  });

  it("renders Current focus with the coach's text and the evaluation date", () => {
    const progress: ParentSwimmerProgressResponse = {
      ...emptyProgress,
      latestCoachingPriority: {
        text: "Rotate the hips more on each stroke",
        sessionDate: "2026-10-14",
      },
    };
    render(
      <ParentSwimmerProgressContent
        swimmer={swimmer}
        progress={progress}
        categories={categories}
      />,
    );
    const section = screen.getByTestId("parent-progress-current-focus");
    expect(section).toHaveTextContent("Rotate the hips more on each stroke");
    // Date-string rendering uses the UTC-anchored formatter in helpers.ts so
    // the day is "Oct 14, 2026" regardless of the test runner's TZ.
    expect(section).toHaveTextContent(/From Oct 14, 2026/);
  });
});

describe("ParentSwimmerProgressContent — charts", () => {
  function makeHistory(headPositions: Array<number | null>): ParentScoreHistoryResponse {
    return {
      points: headPositions.map((value, index) => ({
        sessionDate: `2026-10-${String(index + 1).padStart(2, "0")}`,
        sessionId: `ssss0000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`,
        headPositionOverall: value,
        categoryRollups: [
          {
            categoryId: CAT_ID,
            categorySlug: "freestyle",
            categoryName: "Freestyle",
            average: value,
            assessedCount: value !== null ? 1 : 0,
            totalCount: 1,
          },
        ],
        starts: [],
        counts: { level1: 0, level2: 0, level3: 0, level4: 0, level5: 0, notLegal: 0, noConcept: 0 },
        totalLevelsGained: 0,
        skillsMastered: 0,
        skillsLearned: 0,
      })),
      recentChanges: [],
      milestones: [],
      measurements: [],
    };
  }

  it("empty state: no charts render when there is no evaluation data", () => {
    render(
      <ParentSwimmerProgressContent
        swimmer={swimmer}
        progress={emptyProgress}
        categories={categories}
        scoreHistory={emptyScoreHistory}
      />,
    );
    expect(screen.queryByTestId("parent-progress-head-position-trend")).toBeNull();
    expect(screen.queryByTestId("parent-progress-category-trends")).toBeNull();
  });

  it("one-evaluation state: no head-position section renders (hero chart removed)", () => {
    const progress: ParentSwimmerProgressResponse = {
      ...emptyProgress,
      headPositionOverall: 3,
    };
    render(
      <ParentSwimmerProgressContent
        swimmer={swimmer}
        progress={progress}
        categories={categories}
        scoreHistory={makeHistory([3])}
      />,
    );
    expect(screen.queryByTestId("parent-progress-head-position-trend")).toBeNull();
    // The old "trend unlocks after the second rating" hint was tied to the
    // deleted hero section; it must not render anywhere now.
    expect(screen.queryByText(/trend unlocks after the second rating/i)).toBeNull();
    expect(screen.queryByText(/head position overall/i)).toBeNull();
    expect(screen.queryByTestId("parent-progress-category-trends")).toBeNull();
  });

  it("multi-session state: still no head-position chart (hero removed) but category trends appear", () => {
    const progress: ParentSwimmerProgressResponse = {
      ...emptyProgress,
      headPositionOverall: 4,
    };
    render(
      <ParentSwimmerProgressContent
        swimmer={swimmer}
        progress={progress}
        categories={categories}
        scoreHistory={makeHistory([2, 3, 4])}
      />,
    );
    expect(screen.queryByTestId("parent-progress-head-position-trend")).toBeNull();
    expect(screen.queryByText(/head position overall/i)).toBeNull();
    expect(screen.getByTestId("parent-progress-category-trends")).toBeInTheDocument();
  });

  it("renders the category trends grid when there are two or more sessions", () => {
    render(
      <ParentSwimmerProgressContent
        swimmer={swimmer}
        progress={emptyProgress}
        categories={categories}
        scoreHistory={makeHistory([2, 3, 4])}
      />,
    );
    const grid = screen.getByTestId("parent-progress-category-trends");
    expect(grid).toBeInTheDocument();
    expect(grid.textContent).toMatch(/Freestyle/);
  });

  // Note: the real parent-route leak check lives in the API integration
  // suite (parentProgress.integration.test.ts). A fixture-based assertion
  // here would only prove the type definition shape — not that the server
  // actually strips coach-only fields.
});
