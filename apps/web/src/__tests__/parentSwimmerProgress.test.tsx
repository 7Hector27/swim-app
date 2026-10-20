import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ParentSwimmer, ParentSwimmerProgressResponse, CategoriesResponse } from "@swim-app/shared";

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
};

const categories: CategoriesResponse = [];

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
});
