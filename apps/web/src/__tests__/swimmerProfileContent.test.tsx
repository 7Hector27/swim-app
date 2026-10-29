import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import type {
  Club,
  HouseholdRole,
  ParentPersonalBestsResponse,
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

function render_(
  overrides: {
    householdRole?: HouseholdRole;
    swimmer?: ParentSwimmer;
    clubs?: Club[];
    progress?:
      | { ok: true; data: ParentSwimmerProgressResponse }
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

  it("shows 'No evaluations recorded yet' when progress has no priority or notes", () => {
    render_();
    expect(screen.getByText(/No evaluations recorded yet/i)).toBeInTheDocument();
  });

  it("shows 'No meet times recorded yet' when there are no personal bests", () => {
    render_();
    expect(screen.getByText(/No meet times recorded yet/i)).toBeInTheDocument();
  });

  it("shows a 'No lessons scheduled yet' empty state in the lessons list", () => {
    render_();
    expect(screen.getByText(/No lessons scheduled yet/i)).toBeInTheDocument();
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

describe("SwimmerProfileContent — current focus card", () => {
  it("renders the latest coach-written priority with its date", () => {
    const progress: ParentSwimmerProgressResponse = {
      ...emptyProgress,
      latestCoachingPriority: {
        text: "Steady exhale under water",
        sessionDate: "2026-10-14",
      },
    };
    render_({ progress: { ok: true, data: progress } });
    const card = screen.getByTestId("current-focus-priority");
    expect(card).toHaveTextContent("Steady exhale under water");
    expect(card).toHaveTextContent(/From/i);
  });

  it("renders nothing in the card body when the swimmer has no priority ever", () => {
    render_(); // emptyProgress has latestCoachingPriority: null
    expect(screen.queryByTestId("current-focus-priority")).toBeNull();
    // The card falls back to the 'No evaluations recorded yet' empty state.
    expect(screen.getByText(/No evaluations recorded yet/i)).toBeInTheDocument();
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

  it("renders Upcoming and Recent eyebrow headings for the tablet two-column layout", () => {
    render_({
      upcomingLessons: { ok: true, data: [upcomingLesson, upcomingLesson] },
      pastLessons: { ok: true, data: [pastLesson] },
    });
    // These are hidden on mobile via `hidden tablet:block` but always rendered
    // in the DOM so the layout can switch purely in CSS. Confirming they exist
    // keeps the two-column structure wired up.
    expect(screen.getByRole("heading", { name: /^upcoming$/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^recent$/i })).toBeInTheDocument();
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

  it("groups next-lesson, focus, personal bests, and lessons together in the main group DOM wrapper for the desktop grid", () => {
    render(
      <SwimmerProfileContent
        swimmer={baseSwimmer}
        householdRole="owner"
        clubs={baseClubs}
        progress={{ ok: true, data: emptyProgress }}
        personalBests={{ ok: true, data: emptyPersonalBests }}
        upcomingLessons={{ ok: true, data: [upcomingLesson, upcomingLesson] }}
        pastLessons={{ ok: true, data: [pastLesson] }}
      />,
    );
    const nextLessonSection = screen.getByLabelText("Next lesson");
    const focusHeading = screen.getByRole("heading", { name: /^current focus$/i });
    const pbsHeading = screen.getByRole("heading", { name: /^personal bests$/i });
    const lessonsHeading = screen.getByRole("heading", { name: /^lessons$/i });

    function nearestWrapper(el: HTMLElement): HTMLElement | null {
      // Walk up until we find the <section> parent's enclosing wrapper <div>.
      let cursor: HTMLElement | null = el.closest("section");
      cursor = cursor ? cursor.parentElement : null;
      return cursor;
    }
    const nextWrapper = nearestWrapper(nextLessonSection as HTMLElement);
    const focusWrapper = nearestWrapper(focusHeading as HTMLElement);
    const pbsWrapper = nearestWrapper(pbsHeading as HTMLElement);
    const lessonsWrapper = nearestWrapper(lessonsHeading as HTMLElement);
    expect(nextWrapper).not.toBeNull();
    expect(focusWrapper).not.toBeNull();
    expect(pbsWrapper).not.toBeNull();
    expect(lessonsWrapper).not.toBeNull();
    // All four wrappers share the same parent (the main group).
    expect(nextWrapper!.parentElement).toBe(focusWrapper!.parentElement);
    expect(focusWrapper!.parentElement).toBe(pbsWrapper!.parentElement);
    expect(pbsWrapper!.parentElement).toBe(lessonsWrapper!.parentElement);
  });

  it("groups stats and the public toggle together in the sidebar group DOM wrapper", () => {
    render(
      <SwimmerProfileContent
        swimmer={baseSwimmer}
        householdRole="owner"
        clubs={baseClubs}
        progress={{ ok: true, data: emptyProgress }}
        personalBests={{ ok: true, data: emptyPersonalBests }}
        upcomingLessons={{ ok: true, data: [upcomingLesson] }}
        pastLessons={{ ok: true, data: [pastLesson] }}
      />,
    );
    const toggleHeading = screen.getByRole("heading", {
      name: /show on public leaderboards/i,
    });
    // Each stat tile has an "Age" label; grab the first one and climb up.
    const ageLabels = screen.getAllByText(/^age$/i);
    const ageLabel = ageLabels[0]!;

    // Both the StatTiles <section> and the PublicToggleSection <section> live
    // inside their own wrapper div, which in turn lives inside the sidebar
    // group wrapper div. Compare the grandparents of the section elements.
    const statsSection = ageLabel.closest("section");
    const toggleSection = (toggleHeading as HTMLElement).closest("section");
    expect(statsSection).not.toBeNull();
    expect(toggleSection).not.toBeNull();
    const statsGroup = statsSection!.parentElement?.parentElement;
    const toggleGroup = toggleSection!.parentElement?.parentElement;
    expect(statsGroup).not.toBeNull();
    expect(toggleGroup).not.toBeNull();
    expect(statsGroup).toBe(toggleGroup);
  });
});
