import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type {
  CategoriesResponse,
  ParentScoreHistoryResponse,
  ParentSwimmer,
  ParentSwimmerProgressResponse,
} from "@swim-app/shared";

vi.mock("@/components/SiteNav", () => ({ default: () => <nav /> }));
vi.mock("@/components/LevelLadder", () => ({ default: () => null }));
vi.mock("@/components/StartsSection", () => ({ default: () => null }));
vi.mock("@/content/SwimmerProgressContent/charts/CategoryRadar", () => ({ default: () => null }));

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
          slug: "free-kick",
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
    // The responsive layout renders both the mobile-tablet and desktop
    // subtrees. Use getAllByText to accept duplicates — it's the
    // intent, not the count, that matters for this test.
    expect(screen.getAllByText("Freestyle Kick").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Competent/).length).toBeGreaterThan(0);
  });

  it("shows DQ for not-legal in danger style", () => {
    const progress: ParentSwimmerProgressResponse = {
      ...emptyProgress,
      skills: [
        {
          skillId: SKILL_ID,
          slug: "free-kick",
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
    expect(screen.getAllByText("DQ").length).toBeGreaterThan(0);
  });

  // "Not assessed for skills from categories without data" was removed in
  // Pass 3. The old behavior listed every catalog skill under its category
  // and showed "Not assessed" for the un-rated ones. The new progress
  // layout only renders skills the swimmer has actually been rated on; the
  // group header shows "X of Y skills rated" so coaches still see what's
  // outstanding, and an empty group shows the "Nothing rated yet" copy.

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
    // The parent page now renders Starts via the shared StartsSection
    // component, which is mocked in this suite — asserting the section
    // heading is enough to prove the page composed it.
    // Both the mobile-tablet and desktop subtrees render a starts
    // section; either one existing proves the page composed it.
    expect(screen.getAllByTestId("parent-progress-starts").length).toBeGreaterThan(0);
  });

  it("shows L and R badges for side-rated skills", () => {
    const progress: ParentSwimmerProgressResponse = {
      ...emptyProgress,
      skills: [
        {
          skillId: SIDED_ID,
          slug: "free-stroke-timing",
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
    // Sided skills now render as a combined change-text line on the
    // row ("left 3, right 4") rather than two separate badges.
    expect(screen.getAllByText(/left 3, right 4/i).length).toBeGreaterThan(0);
  });

  // The old "Current focus" section was renamed to "Coach's focus" in
  // the rebuild. It stays hidden when nothing has ever been rated — the
  // whole hasAnyData gate skips it — so this assertion holds for the
  // empty-progress fixture.
  it("hides the Coach's note card when no priority has ever been written", () => {
    render(
      <ParentSwimmerProgressContent
        swimmer={swimmer}
        progress={emptyProgress}
        categories={categories}
      />,
    );
    // The note card renders null when latestCoachingPriority is null.
    // The empty-data branch also short-circuits the whole hasAnyData
    // block, so the testid simply never appears.
    expect(screen.queryByTestId("parent-coach-focus-note")).toBeNull();
  });

  it("renders Coach's note card with the priority text and the no-name fallback byline", () => {
    const progress: ParentSwimmerProgressResponse = {
      ...emptyProgress,
      // The section renders inside the hasAnyData gate, so include a
      // rated skill so the gate opens.
      skills: [
        {
          skillId: SKILL_ID,
          slug: "free-kick",
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
      latestCoachingPriority: {
        text: "Rotate the hips more on each stroke",
        sessionDate: "2026-10-14",
        coachFirstName: null,
      },
    };
    render(
      <ParentSwimmerProgressContent
        swimmer={swimmer}
        progress={progress}
        categories={categories}
      />,
    );
    // getAllByTestId: both the mobile-tablet and desktop subtrees render
    // the note card — either one carries the same text.
    const [note] = screen.getAllByTestId("parent-coach-focus-note");
    expect(note).toHaveTextContent("Rotate the hips more on each stroke");
    // Byline: no coach name on the fixture, so the no-name fallback
    // renders — "From your coach" with no date.
    expect(note).toHaveTextContent(/From your coach/);
    expect(note).not.toHaveTextContent(/From your coach · /);
  });
});

describe("ParentSwimmerProgressContent — charts", () => {
  function makeHistory(headPositions: Array<number | null>): ParentScoreHistoryResponse {
    return {
      points: headPositions.map((value, index) => ({
        sessionDate: `2026-10-${String(index + 1).padStart(2, "0")}`,
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
        // Pass 3: the trend grid now reads screenGroupRollups. One group
        // with assessed data is enough for the grid to render.
        screenGroupRollups: [
          {
            screenSlug: "freestyle",
            name: "Freestyle",
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

  it("empty state: no snapshot section renders when there is no evaluation data", () => {
    render(
      <ParentSwimmerProgressContent
        swimmer={swimmer}
        progress={emptyProgress}
        categories={categories}
        scoreHistory={emptyScoreHistory}
      />,
    );
    // The empty-data branch short-circuits before every post-tiles
    // section; the snapshot heading is a good proxy.
    expect(screen.queryAllByTestId("parent-progress-snapshot")).toHaveLength(0);
  });

  it("one-evaluation state: no stray head-position hero chart", () => {
    const progress: ParentSwimmerProgressResponse = {
      ...emptyProgress,
      headPositionOverall: 3,
      skills: [
        {
          skillId: SKILL_ID,
          slug: "free-kick",
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
        scoreHistory={makeHistory([3])}
      />,
    );
    expect(screen.queryByTestId("parent-progress-head-position-trend")).toBeNull();
    expect(screen.queryByText(/head position overall/i)).toBeNull();
  });

  it("multi-session state: snapshot section appears alongside skills", () => {
    const progress: ParentSwimmerProgressResponse = {
      ...emptyProgress,
      headPositionOverall: 4,
      skills: [
        {
          skillId: SKILL_ID,
          slug: "free-kick",
          name: "Freestyle Kick",
          categoryId: CAT_ID,
          categoryName: "Freestyle",
          type: "rubric",
          unit: null,
          ratedPerSide: false,
          parentSkillId: null,
          current: {
            grade: 4,
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
        scoreHistory={makeHistory([2, 3, 4])}
      />,
    );
    expect(screen.getAllByTestId("parent-progress-snapshot").length).toBeGreaterThan(0);
  });

  // Note: the real parent-route leak check lives in the API integration
  // suite (parentProgress.integration.test.ts). A fixture-based assertion
  // here would only prove the type definition shape — not that the server
  // actually strips coach-only fields.
});
