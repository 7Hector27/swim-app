import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import type {
  Club,
  HouseholdRole,
  ParentPersonalBestsResponse,
  ParentSwimmer,
  ParentSwimmerProgressResponse,
  ParentScoreHistoryResponse,
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

// The leaderboard toggle calls a server action; stubbing the whole module
// keeps us from pulling the server action into the test runtime.
vi.mock("@/content/EditSwimmerContent/actions", () => ({
  toggleSwimmerPublic: vi.fn(),
}));

import SwimmerProfileContent from "../content/SwimmerProfileContent/SwimmerProfileContent";

beforeEach(() => {
  mockUseActionState.mockReturnValue([{ status: "idle" }, vi.fn(), false]);
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SWIMMER_ID = "11111111-1111-4111-8111-111111111111";

const baseSwimmer: ParentSwimmer = {
  id: SWIMMER_ID,
  firstName: "Maya",
  lastName: "Rivera",
  birthDate: "2015-04-18",
  sex: "female",
  isPublic: false,
  createdAt: "2024-01-10T12:00:00-08:00",
  updatedAt: "2026-10-10T12:00:00-07:00",
  clubs: [],
  currentLeagues: [],
};

const baseClubs: Club[] = [];

const emptyProgress: ParentSwimmerProgressResponse = {
  skills: [],
  startProgress: [],
  headPositionOverall: null,
  coachingPriorities: [],
  latestCoachingNotes: [],
  latestCoachingPriority: null,
};

const emptyPersonalBests: ParentPersonalBestsResponse = { personalBests: [] };

const emptyScoreHistory: ParentScoreHistoryResponse = {
  points: [],
  recentChanges: [],
  milestones: [],
  measurements: [],
};

function render_(
  overrides: {
    householdRole?: HouseholdRole;
    swimmer?: ParentSwimmer;
    clubs?: Club[];
    progress?:
      | { ok: true; data: ParentSwimmerProgressResponse }
      | { ok: false };
    scoreHistory?:
      | { ok: true; data: ParentScoreHistoryResponse }
      | { ok: false };
    personalBests?:
      | { ok: true; data: ParentPersonalBestsResponse }
      | { ok: false };
    upcomingLessons?:
      | { ok: true; data: UpcomingLesson[] }
      | { ok: false };
    pastLessons?: { ok: true; data: UpcomingLesson[] } | { ok: false };
  } = {},
): void {
  render(
    <SwimmerProfileContent
      swimmer={overrides.swimmer ?? baseSwimmer}
      householdRole={overrides.householdRole ?? "owner"}
      clubs={overrides.clubs ?? baseClubs}
      progress={overrides.progress ?? { ok: true, data: emptyProgress }}
      scoreHistory={overrides.scoreHistory ?? { ok: true, data: emptyScoreHistory }}
      personalBests={overrides.personalBests ?? { ok: true, data: emptyPersonalBests }}
      upcomingLessons={overrides.upcomingLessons ?? { ok: true, data: [] }}
      pastLessons={overrides.pastLessons ?? { ok: true, data: [] }}
    />,
  );
}

describe("SwimmerProfileContent — empty states", () => {
  it("shows a Book a lesson CTA when there are no upcoming lessons (owner)", () => {
    render_({ householdRole: "owner" });
    // Both the header and the next-lesson section expose Book links. Pick the one in the empty-state block.
    const nextLessonSection = screen.getByLabelText("Next lesson");
    const bookLink = nextLessonSection.querySelector('a[href="/dashboard/book"]');
    expect(bookLink).not.toBeNull();
    expect(nextLessonSection.textContent).toMatch(/No upcoming lessons/i);
  });

  it("shows 'No evaluations yet' in the Progress card when the swimmer has no evaluations", () => {
    render_();
    // Scoped to the Progress card — the "Last evaluated" stat tile shows the
    // same copy, so an unscoped query matches twice.
    const progressHeading = screen.getByRole("heading", { name: /^progress$/i });
    const progressCard = progressHeading.closest("section");
    expect(progressCard).not.toBeNull();
    expect(progressCard!.textContent).toMatch(/No evaluations yet/i);
    expect(screen.queryByTestId("progress-radar-link")).toBeNull();
    expect(screen.queryByTestId("progress-card-cta")).toBeNull();
  });

  it("shows 'No meet times recorded yet' when there are no personal bests", () => {
    render_();
    expect(screen.getByText(/No meet times recorded yet/i)).toBeInTheDocument();
  });

  it("shows 'No lesson history yet' when there are neither upcoming nor past lessons", () => {
    render_();
    // The next-lesson dark card already surfaces "no upcoming" + a Book
    // button, so the lessons section no longer duplicates either message.
    expect(screen.getByText(/No lesson history yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/No lessons scheduled yet/i)).toBeNull();
  });

  it("renders a 'Couldn't load' message for progress when the fetch failed", () => {
    render_({ progress: { ok: false } });
    expect(screen.getByText(/Couldn't load progress/i)).toBeInTheDocument();
  });

  it("renders a 'Couldn't load' message for personal bests when the fetch failed", () => {
    render_({ personalBests: { ok: false } });
    expect(screen.getByText(/Couldn't load personal bests/i)).toBeInTheDocument();
  });

  it("renders a 'Couldn't load' message in the next-lesson block when upcoming fetch failed", () => {
    render_({ upcomingLessons: { ok: false } });
    const nextLessonSection = screen.getByLabelText("Next lesson");
    expect(nextLessonSection.textContent).toMatch(/Couldn't load the next lesson/i);
  });

  it("renders a bothFailed message when upcoming and past both failed", () => {
    render_({
      upcomingLessons: { ok: false },
      pastLessons: { ok: false },
    });
    expect(screen.getByText(/Couldn't load lessons/i)).toBeInTheDocument();
  });
});

describe("SwimmerProfileContent — error vs empty (audit bug #1)", () => {
  it("personal bests: a 500 renders an error state with a retry button, not the empty copy", () => {
    render_({ personalBests: { ok: false } });
    // Empty-state copy must not appear.
    expect(screen.queryByText(/No meet times recorded yet/i)).toBeNull();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/Couldn't load personal bests/i);
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("personal bests: an empty (but ok) response renders the empty state, not the error", () => {
    render_({ personalBests: { ok: true, data: emptyPersonalBests } });
    expect(screen.getByText(/No meet times recorded yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("progress: a 500 renders an error state with a retry button, not 'No evaluations yet'", () => {
    render_({ progress: { ok: false } });
    const progressHeading = screen.getByRole("heading", { name: /^progress$/i });
    const progressCard = progressHeading.closest("section")!;
    expect(progressCard.textContent).not.toMatch(/No evaluations yet/i);
    const alert = progressCard.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toMatch(/Couldn't load progress/i);
  });

  it("lessons: both-failed path renders the error state (not 'No lesson history yet')", () => {
    render_({
      upcomingLessons: { ok: false },
      pastLessons: { ok: false },
    });
    expect(screen.queryByText(/No lesson history yet/i)).toBeNull();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/Couldn't load lessons/i);
  });
});

describe("SwimmerProfileContent — Progress card", () => {
  const scoreHistoryWithRollups: ParentScoreHistoryResponse = {
    points: [
      {
        sessionDate: "2026-10-14",
        headPositionOverall: 3,
        categoryRollups: [
          {
            categoryId: "cat-free",
            categorySlug: "freestyle",
            categoryName: "Freestyle",
            average: 3.2,
            assessedCount: 4,
            totalCount: 6,
          },
          {
            categoryId: "cat-fly",
            categorySlug: "butterfly",
            categoryName: "Butterfly",
            average: 2.1,
            assessedCount: 2,
            totalCount: 5,
          },
        ],
        starts: [],
        counts: { level1: 0, level2: 2, level3: 2, level4: 2, level5: 0, notLegal: 0, noConcept: 0 },
        totalLevelsGained: 4,
        skillsMastered: 0,
        skillsLearned: 6,
      },
    ],
    recentChanges: [],
    milestones: [],
    measurements: [],
  };

  it("renders the title, radar, and View progress button when evaluations exist", () => {
    render_({
      progress: { ok: true, data: emptyProgress },
      scoreHistory: { ok: true, data: scoreHistoryWithRollups },
    });
    expect(screen.getByRole("heading", { name: /^progress$/i })).toBeInTheDocument();
    // Focus text and last-evaluated line are no longer part of the Progress
    // card; only the title + radar + CTA remain.
    expect(screen.queryByTestId("progress-card-priority")).toBeNull();
    expect(screen.queryByTestId("progress-card-focus-set")).toBeNull();
    expect(screen.queryByTestId("progress-card-last-evaluated")).toBeNull();
    const radarLink = screen.getByTestId("progress-radar-link");
    expect(radarLink.getAttribute("href")).toBe(
      `/dashboard/swimmers/${SWIMMER_ID}/progress`,
    );
    const cta = screen.getByTestId("progress-card-cta");
    expect(cta.getAttribute("href")).toBe(
      `/dashboard/swimmers/${SWIMMER_ID}/progress`,
    );
  });

  it("shows 'No evaluations yet' with no radar and no CTA when the swimmer is unevaluated", () => {
    render_(); // emptyProgress + emptyScoreHistory
    const progressHeading = screen.getByRole("heading", { name: /^progress$/i });
    const progressCard = progressHeading.closest("section");
    expect(progressCard).not.toBeNull();
    expect(progressCard!.textContent).toMatch(/No evaluations yet/i);
    expect(screen.queryByTestId("progress-radar-link")).toBeNull();
    expect(screen.queryByTestId("progress-card-cta")).toBeNull();
    expect(screen.queryByTestId("progress-card-priority")).toBeNull();
  });

  it("falls back to a 'Couldn't load progress' message when the progress fetch failed", () => {
    render_({ progress: { ok: false } });
    expect(screen.getByText(/Couldn't load progress/i)).toBeInTheDocument();
  });
});

describe("SwimmerProfileContent — viewer role", () => {
  it("viewer sees no Book or Edit buttons in the header", () => {
    render_({ householdRole: "viewer" });
    // No book link anywhere on the page (neither header nor empty-state).
    expect(screen.queryByRole("link", { name: /book a lesson/i })).toBeNull();
    // No edit link in the header.
    expect(screen.queryByRole("link", { name: /edit maya/i })).toBeNull();
  });

  it("viewer sees no Book button in the empty-state next-lesson block", () => {
    render_({ householdRole: "viewer", upcomingLessons: { ok: true, data: [] } });
    const nextLessonSection = screen.getByLabelText("Next lesson");
    const bookLink = nextLessonSection.querySelector('a[href="/dashboard/book"]');
    expect(bookLink).toBeNull();
  });

  it("manager sees both Book and Edit", () => {
    render_({ householdRole: "manager" });
    expect(screen.getAllByRole("link", { name: /book a lesson/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /edit maya/i })).toBeInTheDocument();
  });

  it("owner sees both Book and Edit", () => {
    render_({ householdRole: "owner" });
    expect(screen.getAllByRole("link", { name: /book a lesson/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /edit maya/i })).toBeInTheDocument();
  });
});

describe("SwimmerProfileContent — wide-layout structure", () => {
  const upcomingLesson: UpcomingLesson = {
    id: "lesson-upcoming-1",
    locationId: "loc-1",
    startsAt: "2026-11-04T16:30:00-08:00",
    durationMinutes: 45,
    type: "private",
    status: "approved",
    swimmers: [{ swimmerId: SWIMMER_ID, firstName: "Maya", lastName: "Rivera" }],
    expiresAt: null,
    approvedAt: null,
    declinedAt: null,
    declineReason: null,
    movedAt: null,
    previousStartsAt: null,
    createdAt: "2026-10-20T09:00:00-07:00",
    locationName: "Rose Bowl Aquatics Center",
    batchId: null,
    batchMode: null,
  };
  const pastLesson: UpcomingLesson = {
    ...upcomingLesson,
    id: "lesson-past-1",
    startsAt: "2026-10-14T16:30:00-07:00",
    status: "completed",
  };

  it("renders the Upcoming eyebrow for the tablet two-column layout, regardless of whether a next lesson is already shown", () => {
    render_({
      upcomingLessons: { ok: true, data: [upcomingLesson, upcomingLesson] },
      pastLessons: { ok: true, data: [pastLesson] },
    });
    expect(screen.getByRole("heading", { name: /^upcoming$/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^after that$/i })).toBeNull();
    expect(screen.getByRole("heading", { name: /^recent$/i })).toBeInTheDocument();
  });

  it("Recent column caps at 3 rows and renders the See all lessons link when there are more", () => {
    const extraPast: UpcomingLesson[] = [1, 2, 3, 4, 5].map((offset) => ({
      ...pastLesson,
      id: `past-${offset}`,
      // All in the past; order doesn't matter for the slice test — we just
      // need > 3 rows to exceed the cap.
      startsAt: `2026-10-${String(offset).padStart(2, "0")}T16:30:00-07:00`,
    }));
    render_({
      upcomingLessons: { ok: true, data: [] },
      pastLessons: { ok: true, data: extraPast },
    });
    // See-all link renders in the header.
    const seeAll = screen.getByTestId("see-all-lessons-link");
    expect(seeAll.getAttribute("href")).toBe("/dashboard/lessons");
    // Exactly 3 lesson rows render (each row's anchor targets /dashboard/lessons/:id).
    const lessonRows = screen
      .getAllByRole("link")
      .filter((link) => (link.getAttribute("href") ?? "").startsWith("/dashboard/lessons/past-"));
    expect(lessonRows).toHaveLength(3);
    // The See-all-lessons link is the only "there's more" affordance; the
    // "Showing the 3 most recent" text was removed to keep the column calm.
    expect(screen.queryByText(/Showing the 3 most recent/i)).toBeNull();
  });

  it("Upcoming column is dropped when the next-lesson card already covers the empty state", () => {
    render_({
      upcomingLessons: { ok: true, data: [] },
      pastLessons: { ok: true, data: [pastLesson] },
    });
    // Only the Recent eyebrow heading remains at tablet+.
    expect(screen.queryByRole("heading", { name: /^upcoming$/i })).toBeNull();
    expect(screen.getByRole("heading", { name: /^recent$/i })).toBeInTheDocument();
    // The dark Book card still carries the "no upcoming" message.
    const nextLessonSection = screen.getByLabelText("Next lesson");
    expect(nextLessonSection.textContent).toMatch(/No upcoming lessons/i);
    // The redundant "Nothing else scheduled" tile is gone.
    expect(screen.queryByText(/Nothing else scheduled/i)).toBeNull();
  });

  it("no longer renders the four stat tiles (Age, Last evaluated, Upcoming, Leaderboards)", () => {
    render_({
      upcomingLessons: { ok: true, data: [] },
      pastLessons: { ok: true, data: [pastLesson, pastLesson] },
    });
    // The four labels used by StatTiles must not appear anywhere on the
    // profile. Last evaluated moved into the Progress card as a sentence,
    // not a tile with that exact label.
    expect(screen.queryByText(/^Age$/)).toBeNull();
    expect(screen.queryByText(/^Last evaluated$/)).toBeNull();
    expect(screen.queryByText(/^Upcoming$/)).toBeNull();
    expect(screen.queryByText(/^Leaderboards$/)).toBeNull();
    expect(screen.queryByText(/^Lessons so far$/)).toBeNull();
  });

  it("per-column failed state scopes the Couldn't load message to that column", () => {
    render_({
      upcomingLessons: { ok: false },
      pastLessons: { ok: true, data: [pastLesson] },
    });
    expect(screen.getByText(/couldn't load upcoming lessons/i)).toBeInTheDocument();
    expect(screen.queryByText(/couldn't load recent lessons/i)).toBeNull();
  });

  it("single Lessons heading remains above the two-column grid", () => {
    render_({
      upcomingLessons: { ok: true, data: [upcomingLesson, upcomingLesson] },
      pastLessons: { ok: true, data: [pastLesson] },
    });
    // Lessons h2 above the columns; Upcoming/Recent are h3 inside them.
    const lessonsHeadings = screen.getAllByRole("heading", { name: /^lessons$/i });
    expect(lessonsHeadings).toHaveLength(1);
  });

  it("groups next-lesson, Lessons, and Personal bests together in the main group DOM wrapper", () => {
    render(
      <SwimmerProfileContent
        swimmer={baseSwimmer}
        householdRole="owner"
        clubs={baseClubs}
        progress={{ ok: true, data: emptyProgress }}
        scoreHistory={{ ok: true, data: emptyScoreHistory }}
        personalBests={{ ok: true, data: emptyPersonalBests }}
        upcomingLessons={{ ok: true, data: [upcomingLesson, upcomingLesson] }}
        pastLessons={{ ok: true, data: [pastLesson] }}
      />,
    );
    const nextLessonSection = screen.getByLabelText("Next lesson");
    const lessonsHeading = screen.getByRole("heading", { name: /^lessons$/i });
    const pbsHeading = screen.getByRole("heading", { name: /^personal bests$/i });

    function nearestWrapper(el: HTMLElement): HTMLElement | null {
      // Walk up until we find the <section> parent's enclosing wrapper <div>.
      let cursor: HTMLElement | null = el.closest("section");
      cursor = cursor ? cursor.parentElement : null;
      return cursor;
    }
    const nextWrapper = nearestWrapper(nextLessonSection as HTMLElement);
    const lessonsWrapper = nearestWrapper(lessonsHeading as HTMLElement);
    const pbsWrapper = nearestWrapper(pbsHeading as HTMLElement);
    expect(nextWrapper).not.toBeNull();
    expect(lessonsWrapper).not.toBeNull();
    expect(pbsWrapper).not.toBeNull();
    // All three main-column wrappers share the same parent (the main group).
    expect(nextWrapper!.parentElement).toBe(lessonsWrapper!.parentElement);
    expect(lessonsWrapper!.parentElement).toBe(pbsWrapper!.parentElement);
  });

  it("groups Progress and the public toggle in the sidebar group DOM wrapper", () => {
    render(
      <SwimmerProfileContent
        swimmer={baseSwimmer}
        householdRole="owner"
        clubs={baseClubs}
        progress={{ ok: true, data: emptyProgress }}
        scoreHistory={{ ok: true, data: emptyScoreHistory }}
        personalBests={{ ok: true, data: emptyPersonalBests }}
        upcomingLessons={{ ok: true, data: [upcomingLesson] }}
        pastLessons={{ ok: true, data: [pastLesson] }}
      />,
    );
    const toggleHeading = screen.getByRole("heading", {
      name: /show on public leaderboards/i,
    });
    const progressHeading = screen.getByRole("heading", { name: /^progress$/i });

    // Each section lives in its own <section> inside a wrapper div inside
    // the sidebar group div. Compare the grandparents.
    const progressSection = (progressHeading as HTMLElement).closest("section");
    const toggleSection = (toggleHeading as HTMLElement).closest("section");
    expect(progressSection).not.toBeNull();
    expect(toggleSection).not.toBeNull();
    const progressGroup = progressSection!.parentElement?.parentElement;
    const toggleGroup = toggleSection!.parentElement?.parentElement;
    expect(progressGroup).not.toBeNull();
    expect(toggleGroup).not.toBeNull();
    expect(progressGroup).toBe(toggleGroup);
  });
});
