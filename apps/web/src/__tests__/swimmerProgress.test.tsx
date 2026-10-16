import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CoachSwimmerDetail, SwimmerProgressResponse, CategoriesResponse } from "@swim-app/shared";

vi.mock("@/components/SiteNav", () => ({ default: () => <nav /> }));

import SwimmerProgressContent from "../content/SwimmerProgressContent/SwimmerProgressContent";

const SWIMMER_ID = "aaaa0000-0000-0000-0000-000000000001";
const SKILL_ID = "bbbb0000-0000-0000-0000-000000000001";
const CAT_ID = "cccc0000-0000-0000-0000-000000000001";

const swimmer: CoachSwimmerDetail = {
  id: SWIMMER_ID,
  firstName: "Maya",
  lastName: "Rivera",
  age: 12,
  sex: "female",
  isPublic: false,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  birthDate: "2012-01-01",
  currentLeagues: [],
  clubs: [],
  memberNames: [],
  members: [],
  homePool: null,
};

const emptyProgress: SwimmerProgressResponse = {
  skills: [],
  startProgress: [],
  headPositionOverall: null,
  coachingPriorities: [],
};

const categories: CategoriesResponse = [];

describe("SwimmerProgressContent", () => {
  it("shows empty state when no evaluations", () => {
    render(
      <SwimmerProgressContent
        swimmer={swimmer}
        progress={emptyProgress}
        categories={categories}
      />,
    );
    expect(screen.getByText(/no evaluations recorded yet/i)).toBeInTheDocument();
  });

  it("shows skill current level", () => {
    const progress: SwimmerProgressResponse = {
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
      <SwimmerProgressContent
        swimmer={swimmer}
        progress={progress}
        categories={categories}
      />,
    );
    expect(screen.getByText("Freestyle Kick")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("shows Not legal in danger style", () => {
    const progress: SwimmerProgressResponse = {
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
      <SwimmerProgressContent
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
      <SwimmerProgressContent
        swimmer={swimmer}
        progress={emptyProgress}
        categories={cats}
      />,
    );
    expect(screen.getByText("Freestyle Kick")).toBeInTheDocument();
    expect(screen.getAllByText("Not assessed").length).toBeGreaterThan(0);
  });

  it("shows start grade section", () => {
    const progress: SwimmerProgressResponse = {
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
      <SwimmerProgressContent
        swimmer={swimmer}
        progress={progress}
        categories={categories}
      />,
    );
    expect(screen.getByText("Track Start")).toBeInTheDocument();
    expect(screen.getAllByText("4").length).toBeGreaterThan(0);
  });

  it("shows L and R badges for side-rated skills", () => {
    const SIDED_ID = "dddd0000-0000-0000-0000-000000000001";
    const progress: SwimmerProgressResponse = {
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
      <SwimmerProgressContent
        swimmer={swimmer}
        progress={progress}
        categories={categories}
      />,
    );
    expect(screen.getByText("Freestyle Breathing")).toBeInTheDocument();
    expect(screen.getByText("L 3")).toBeInTheDocument();
    expect(screen.getByText("R 4")).toBeInTheDocument();
  });

  it("shows coaching priority with chain names", () => {
    const progress: SwimmerProgressResponse = {
      ...emptyProgress,
      coachingPriorities: [
        {
          targetSlug: "freestyle-stroke",
          targetName: "Freestyle Stroke",
          chain: [
            { slug: "freestyle-stroke", name: "Freestyle Stroke", notAssessed: false },
            { slug: "core-stability", name: "Core Stability", notAssessed: true },
          ],
        },
      ],
    };
    render(
      <SwimmerProgressContent
        swimmer={swimmer}
        progress={progress}
        categories={categories}
      />,
    );
    expect(screen.getByText(/what to work on next/i)).toBeInTheDocument();
    expect(screen.getAllByText("Freestyle Stroke").length).toBeGreaterThan(0);
    expect(screen.getByText(/not assessed yet/i)).toBeInTheDocument();
  });
});
