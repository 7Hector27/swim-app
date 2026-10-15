import { vi, describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/SiteNav", () => ({ default: () => <nav /> }));
vi.mock("@/components/SiteFooter", () => ({ default: () => <footer /> }));
vi.mock("@/content/CoachSwimmerDetailContent/HidePublicButton", () => ({
  default: () => <button>Hide</button>,
}));
vi.mock("@/content/CoachSwimmerDetailContent/SwimmerSkillsHistory", () => ({
  default: (props: { swimmerId: string }) => (
    <div data-testid="skills-history" data-swimmer-id={props.swimmerId} />
  ),
}));

import CoachSwimmerDetailContent from "../content/CoachSwimmerDetailContent/CoachSwimmerDetailContent";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SWIMMER_ID = "00000000-0000-0000-aaaa-000000000001";
const CAT_ID = "00000000-0000-0000-bbbb-000000000001";
const SKILL_ID = "00000000-0000-0000-cccc-000000000001";

const TEST_CATEGORIES = [
  {
    id: CAT_ID,
    slug: "freestyle",
    name: "Freestyle",
    sortOrder: 1,
    skills: [
      {
        id: SKILL_ID,
        slug: "flutter-kick",
        name: "Flutter Kick",
        type: "rubric" as const,
        unit: null,
        ratedPerSide: false,
        notLegalAllowed: false,
        parentSkillId: null,
        sortOrder: 1,
        faultTags: [],
      },
    ],
  },
];

const TEST_SWIMMER = {
  id: SWIMMER_ID,
  firstName: "Alex",
  lastName: "Smith",
  age: 12,
  sex: "male" as const,
  isPublic: false,
  birthDate: "2013-01-01",
  currentLeagues: [],
  clubs: [],
  members: [{ fullName: "Jane Smith", phone: "555-1234" }],
  memberNames: ["Jane Smith"],
  homePool: null,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

const TEST_GRADES: Record<string, number | "not_legal" | "no_concept"> = {
  "flutter-kick": 3,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CoachSwimmerDetailContent", () => {
  it("renders the Evaluate link pointing to the evaluate route", () => {
    render(
      <CoachSwimmerDetailContent
        swimmer={TEST_SWIMMER}
        accessToken="test-token"
        grades={{}}
        startGrades={{}}
        coachingPriorities={[]}
        categories={[]}
        timelineItems={[]}
      />,
    );
    const link = screen.getByRole("link", { name: /evaluate alex/i });
    expect(link).toHaveAttribute(
      "href",
      `/coach/swimmers/${SWIMMER_ID}/evaluate`,
    );
  });

  it("shows current levels grade for a rated skill", () => {
    render(
      <CoachSwimmerDetailContent
        swimmer={TEST_SWIMMER}
        accessToken="test-token"
        grades={TEST_GRADES}
        startGrades={{}}
        coachingPriorities={[]}
        categories={TEST_CATEGORIES}
        timelineItems={[]}
      />,
    );
    // Grade "3" should appear inside Current Levels
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it('shows "Household" heading instead of "Guardians"', () => {
    render(
      <CoachSwimmerDetailContent
        swimmer={TEST_SWIMMER}
        accessToken="test-token"
        grades={{}}
        startGrades={{}}
        coachingPriorities={[]}
        categories={[]}
        timelineItems={[]}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Household" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Guardians" })).toBeNull();
  });

  it("passes swimmerId to SwimmerSkillsHistory", () => {
    render(
      <CoachSwimmerDetailContent
        swimmer={TEST_SWIMMER}
        accessToken="test-token"
        grades={TEST_GRADES}
        startGrades={{}}
        coachingPriorities={[]}
        categories={TEST_CATEGORIES}
        timelineItems={[]}
      />,
    );
    const history = screen.getByTestId("skills-history");
    expect(history).toHaveAttribute("data-swimmer-id", SWIMMER_ID);
  });
});
