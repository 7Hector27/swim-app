import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type {
  CoachSwimmerDetail,
  GetEvaluationsItem,
} from "@swim-app/shared";

// SiteNav is a server component in production; the Evaluations list page's
// client content doesn't render it, but a few of the mounted contents do.
vi.mock("@/components/SiteNav", () => ({ default: () => <nav /> }));
vi.mock("@/components/AddNoteForm", () => ({ default: () => <div data-testid="add-note-form" /> }));
vi.mock("@/content/CoachSwimmerDetailContent/HidePublicButton", () => ({
  default: () => <button>Hide</button>,
}));
vi.mock("@/content/CoachSwimmerDetailContent/SwimmerSkillsHistory", () => ({
  default: () => <div data-testid="skills-history" />,
}));
vi.mock("@/content/CoachSwimmerDetailContent/SwimmerTimeline", () => ({
  default: () => <div data-testid="swimmer-timeline" />,
}));

import EvaluationsList from "../components/EvaluationsList";
import CoachSwimmerDetailContent from "../content/CoachSwimmerDetailContent/CoachSwimmerDetailContent";
import CoachEvaluationsContent from "../content/CoachEvaluationsContent/CoachEvaluationsContent";
import { fetchSwimmerEvaluations } from "../lib/api/evaluations";

const SWIMMER_ID = "aaaa0000-0000-0000-0000-000000000001";

const SWIMMER: CoachSwimmerDetail = {
  id: SWIMMER_ID,
  firstName: "Maya",
  lastName: "Rivera",
  age: 12,
  sex: "female",
  isPublic: false,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  birthDate: "2012-01-01",
  householdId: "00000000-0000-0000-0000-000000000ff0",
  currentLeagues: [],
  clubs: [],
  memberNames: [],
  lastLesson: null,
  members: [],
  homePool: null,
};

function makeItem(options: {
  sessionId: string;
  sessionDate?: string;
  edited?: boolean;
  ratingCount?: number;
  coachingPriority?: string | null;
  screenName?: string;
}): GetEvaluationsItem {
  return {
    sessionId: options.sessionId,
    screenSlug: "freestyle",
    screenName: options.screenName ?? "Freestyle",
    sessionDate: options.sessionDate ?? "2026-10-25",
    context: "practice",
    coachingPriority: options.coachingPriority ?? null,
    ratingCount: options.ratingCount ?? 7,
    edited: options.edited ?? false,
    editedAt: options.edited ? "2026-10-26T18:00:00.000Z" : null,
    createdAt: `${options.sessionDate ?? "2026-10-25"}T18:00:00.000Z`,
  };
}

// ── EvaluationsList ───────────────────────────────────────────────────────────

describe("EvaluationsList", () => {
  it("renders a row per evaluation with date, screen name, and rating count", () => {
    const items = [
      makeItem({ sessionId: "11111111-1111-1111-1111-111111111111", ratingCount: 7 }),
      makeItem({ sessionId: "22222222-2222-2222-2222-222222222222", sessionDate: "2026-10-11", ratingCount: 1 }),
    ];
    render(<EvaluationsList swimmerId={SWIMMER_ID} evaluations={items} returnTo="/coach/swimmers/x" />);
    expect(screen.getAllByTestId("evaluations-list-row")).toHaveLength(2);
    expect(screen.getByText("7 ratings")).toBeInTheDocument();
    expect(screen.getByText("1 rating")).toBeInTheDocument();
    // Screen name chip renders.
    expect(screen.getAllByText("Freestyle").length).toBeGreaterThanOrEqual(2);
  });

  it("shows a neutral Edited pill only when edited is true", () => {
    const items = [
      makeItem({ sessionId: "11111111-1111-1111-1111-111111111111", edited: false }),
      makeItem({ sessionId: "22222222-2222-2222-2222-222222222222", sessionDate: "2026-10-11", edited: true }),
    ];
    render(<EvaluationsList swimmerId={SWIMMER_ID} evaluations={items} returnTo="/coach/swimmers/x" />);
    const pills = screen.getAllByTestId("evaluations-list-edited-pill");
    expect(pills).toHaveLength(1);
    expect(pills[0]).toHaveTextContent("Edited");
  });

  it("Edit link href includes editSession and the sanitized returnTo", () => {
    const items = [makeItem({ sessionId: "11111111-1111-1111-1111-111111111111" })];
    const returnTo = `/coach/swimmers/${SWIMMER_ID}`;
    render(<EvaluationsList swimmerId={SWIMMER_ID} evaluations={items} returnTo={returnTo} />);
    const link = screen.getByTestId("evaluations-list-edit-link");
    const href = link.getAttribute("href") ?? "";
    expect(href).toContain(`/coach/swimmers/${SWIMMER_ID}/evaluate`);
    expect(href).toContain("editSession=11111111-1111-1111-1111-111111111111");
    expect(href).toContain(`returnTo=${encodeURIComponent(returnTo)}`);
  });

  it("renders the coaching priority preview when present", () => {
    const items = [makeItem({ sessionId: "11111111-1111-1111-1111-111111111111", coachingPriority: "Fix the kick" })];
    render(<EvaluationsList swimmerId={SWIMMER_ID} evaluations={items} returnTo="/x" />);
    expect(screen.getByText("Fix the kick")).toBeInTheDocument();
  });
});

// ── CoachSwimmerDetailContent — Evaluations section ────────────────────────────

describe("CoachSwimmerDetailContent — Evaluations section", () => {
  function baseProps() {
    return {
      swimmer: SWIMMER,
      grades: {},
      startGrades: {},
      coachingPriorities: [],
      categories: [],
      timelineItems: [],
      swims: [],
      personalBests: [],
      meets: [],
      drafts: [],
      golfScoreTrends: [],
    };
  }

  it("renders the Evaluations section with the list when evaluations exist", () => {
    const items = [
      makeItem({ sessionId: "11111111-1111-1111-1111-111111111111" }),
      makeItem({ sessionId: "22222222-2222-2222-2222-222222222222", sessionDate: "2026-10-11", edited: true }),
    ];
    render(<CoachSwimmerDetailContent {...baseProps()} evaluationsResult={{ ok: true, data: items }} />);
    const section = screen.getByTestId("coach-detail-evaluations-section");
    expect(within(section).getByRole("heading", { name: /evaluations/i })).toBeInTheDocument();
    expect(within(section).getAllByTestId("evaluations-list-row")).toHaveLength(2);
    expect(within(section).getByTestId("coach-detail-see-all-evaluations"))
      .toHaveAttribute("href", `/coach/swimmers/${SWIMMER_ID}/evaluations`);
  });

  it("shows an empty state and hides the See all link when evaluations is empty", () => {
    render(<CoachSwimmerDetailContent {...baseProps()} />);
    const section = screen.getByTestId("coach-detail-evaluations-section");
    expect(within(section).getByText(/no evaluations yet/i)).toBeInTheDocument();
    expect(within(section).queryByTestId("coach-detail-see-all-evaluations")).toBeNull();
  });

  it("shows an inline error (not the empty state) when the evaluations fetch failed", () => {
    render(<CoachSwimmerDetailContent {...baseProps()} evaluationsResult={{ ok: false }} />);
    const section = screen.getByTestId("coach-detail-evaluations-section");
    // The failure branch replaces the empty-state copy with a role="alert"
    // — this is the audit's bug class: a 500 must never look like "nothing
    // here yet."
    expect(within(section).queryByText(/no evaluations yet/i)).toBeNull();
    const alert = within(section).getByRole("alert");
    expect(alert).toHaveTextContent(/couldn't load evaluations/i);
    expect(within(alert).getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(within(section).queryByTestId("coach-detail-see-all-evaluations")).toBeNull();
  });

  it("shows the empty-state copy (not the error) when evaluations fetched successfully but is empty", () => {
    render(
      <CoachSwimmerDetailContent {...baseProps()} evaluationsResult={{ ok: true, data: [] }} />,
    );
    const section = screen.getByTestId("coach-detail-evaluations-section");
    expect(within(section).getByText(/no evaluations yet/i)).toBeInTheDocument();
    expect(within(section).queryByRole("alert")).toBeNull();
  });

  it("Edit links in the detail list carry a returnTo back to the swimmer page", () => {
    const items = [makeItem({ sessionId: "11111111-1111-1111-1111-111111111111" })];
    render(<CoachSwimmerDetailContent {...baseProps()} evaluationsResult={{ ok: true, data: items }} />);
    const link = screen.getByTestId("evaluations-list-edit-link");
    const href = link.getAttribute("href") ?? "";
    expect(href).toContain(`returnTo=${encodeURIComponent(`/coach/swimmers/${SWIMMER_ID}`)}`);
  });
});

// ── CoachEvaluationsContent — pagination (Load more) ──────────────────────────

vi.mock("../lib/api/evaluations", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    fetchSwimmerEvaluations: vi.fn(),
  };
});

describe("CoachEvaluationsContent — pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("hides the Load more button when there is no next cursor", () => {
    const initial = [makeItem({ sessionId: "11111111-1111-1111-1111-111111111111" })];
    render(
      <CoachEvaluationsContent
        swimmer={SWIMMER}
        accessToken="tok"
        initialEvaluations={initial}
        initialNextCursor={null}
      />,
    );
    expect(screen.queryByTestId("coach-evaluations-load-more")).toBeNull();
  });

  it("clicking Load more appends the next page and uses the returned cursor", async () => {
    const initial = [makeItem({ sessionId: "11111111-1111-1111-1111-111111111111" })];
    const nextPage = [
      makeItem({ sessionId: "22222222-2222-2222-2222-222222222222", sessionDate: "2026-10-11" }),
      makeItem({ sessionId: "33333333-3333-3333-3333-333333333333", sessionDate: "2026-10-04" }),
    ];
    vi.mocked(fetchSwimmerEvaluations).mockResolvedValueOnce({
      ok: true,
      data: { evaluations: nextPage, nextCursor: null },
    });

    render(
      <CoachEvaluationsContent
        swimmer={SWIMMER}
        accessToken="tok"
        initialEvaluations={initial}
        initialNextCursor="CURSOR-A"
      />,
    );

    expect(screen.getAllByTestId("evaluations-list-row")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("coach-evaluations-load-more"));

    await waitFor(() => {
      expect(screen.getAllByTestId("evaluations-list-row")).toHaveLength(3);
    });
    // The fetcher was called with the current cursor.
    expect(fetchSwimmerEvaluations).toHaveBeenCalledWith(SWIMMER_ID, "tok", {
      cursor: "CURSOR-A",
      limit: 20,
    });
    // Button disappeared because nextCursor is null.
    expect(screen.queryByTestId("coach-evaluations-load-more")).toBeNull();
  });

  it("surfaces an inline error when the next page fetch fails", async () => {
    vi.mocked(fetchSwimmerEvaluations).mockResolvedValueOnce({ ok: false, status: 500 });
    render(
      <CoachEvaluationsContent
        swimmer={SWIMMER}
        accessToken="tok"
        initialEvaluations={[makeItem({ sessionId: "11111111-1111-1111-1111-111111111111" })]}
        initialNextCursor="CURSOR-A"
      />,
    );
    fireEvent.click(screen.getByTestId("coach-evaluations-load-more"));
    await waitFor(() => {
      expect(screen.getByText(/couldn't load more/i)).toBeInTheDocument();
    });
  });
});
