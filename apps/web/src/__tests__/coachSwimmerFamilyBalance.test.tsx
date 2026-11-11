import { vi, describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";

// Mirror the stubs from coachSwimmerDetail.test.tsx so this test loads
// the same CoachSwimmerDetailContent without pulling in SiteNav /
// AddNoteForm / SwimmerSkillsHistory / SwimmerTimeline.
vi.mock("@/components/SiteNav", () => ({ default: () => <nav /> }));
vi.mock("@/components/AddNoteForm", () => ({ default: () => <div /> }));
vi.mock("@/content/CoachSwimmerDetailContent/HidePublicButton", () => ({
  default: () => <button>Hide</button>,
}));
vi.mock("@/content/CoachSwimmerDetailContent/SwimmerSkillsHistory", () => ({
  default: () => <div data-testid="skills-history" />,
}));
vi.mock("@/content/CoachSwimmerDetailContent/SwimmerTimeline", () => ({
  default: () => <div data-testid="swimmer-timeline" />,
}));

import CoachSwimmerDetailContent from "../content/CoachSwimmerDetailContent/CoachSwimmerDetailContent";

const HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000ff0";

const SWIMMER = {
  id: "00000000-0000-0000-aaaa-000000000001",
  firstName: "Alex",
  lastName: "Smith",
  age: 12,
  sex: "male" as const,
  isPublic: false,
  birthDate: "2013-01-01",
  householdId: HOUSEHOLD_ID,
  currentLeagues: [],
  clubs: [],
  members: [{ fullName: "Jane Smith", phone: "555-1234" }],
  memberNames: ["Jane Smith"],
  lastLesson: null,
  homePool: null,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

function renderDetail(familyBalanceCents: number | null) {
  return render(
    <CoachSwimmerDetailContent
      swimmer={SWIMMER}
      grades={{}}
      startGrades={{}}
      coachingPriorities={[]}
      categories={[]}
      timelineItems={[]}
      swims={[]}
      personalBests={[]}
      meets={[]}
      drafts={[]}
      golfScoreTrends={[]}
      familyBalanceCents={familyBalanceCents}
    />,
  );
}

describe("Swimmer detail — family balance card", () => {
  it("renders the current balance with a tabular-nums formatted dollar amount", () => {
    renderDetail(12_345);
    const card = screen.getByTestId("coach-swimmer-family-balance");
    expect(card.textContent).toMatch(/\$123\.45/);
  });

  it("shows the 'Low' badge when the family is under one lesson's balance", () => {
    renderDetail(5_000); // $50 → under the $60 one-lesson threshold.
    const card = screen.getByTestId("coach-swimmer-family-balance");
    expect(within(card).getByText(/^low$/i)).toBeInTheDocument();
  });

  it("hides the 'Low' badge when the family is at or above one lesson's balance", () => {
    renderDetail(6_000); // $60 → at the threshold, not low.
    const card = screen.getByTestId("coach-swimmer-family-balance");
    expect(within(card).queryByText(/^low$/i)).toBeNull();
  });

  it("falls back to an em-dash when the balance fetch failed (null) — no misleading 'Low' badge", () => {
    renderDetail(null);
    const card = screen.getByTestId("coach-swimmer-family-balance");
    expect(card.textContent).toMatch(/—/);
    expect(within(card).queryByText(/^low$/i)).toBeNull();
  });

  it("links through to /coach/families/[householdId] on 'Open family'", () => {
    renderDetail(10_000);
    const card = screen.getByTestId("coach-swimmer-family-balance");
    const link = within(card).getByRole("link", { name: /open family/i });
    expect(link.getAttribute("href")).toBe(`/coach/families/${HOUSEHOLD_ID}`);
  });

  it("renders alongside the existing Household contacts card without replacing it", () => {
    renderDetail(10_000);
    expect(screen.getByTestId("coach-swimmer-family-balance")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Household" }),
    ).toBeInTheDocument();
  });
});
