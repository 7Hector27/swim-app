// Covers the merged GET /lessons response shape ({ items, total }) for the
// filter=past branch after /lessons/count was absorbed. The parse used to be
// UpcomingLessonSchema.array(); if it ever regresses, past lessons silently
// stop appearing on the parent lessons page and the swimmer profile — both
// of which are smoke-tested at the render level below.

import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import type { UpcomingLesson } from "@swim-app/shared";

const mockFetch = vi.fn();
global.fetch = mockFetch;

process.env["NEXT_PUBLIC_API_URL"] = "http://localhost:3001";

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

// SwimmerProfileContent toggles via a server action and useActionState; stub
// both so the render test doesn't drag the server-action module in.
const { mockUseActionState } = vi.hoisted(() => ({ mockUseActionState: vi.fn() }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, useActionState: mockUseActionState };
});
vi.mock("@/content/EditSwimmerContent/actions", () => ({
  toggleSwimmerPublic: vi.fn(),
}));

import { fetchPastLessons } from "../lib/api/lessons";
import ParentLessonsContent from "../content/ParentLessonsContent/ParentLessonsContent";
import SwimmerProfileContent from "../content/SwimmerProfileContent/SwimmerProfileContent";

const SWIMMER_ID = "11111111-1111-4111-8111-111111111111";

const PAST_LESSON_ID = "22222222-2222-4222-8222-222222222222";

const pastLesson: UpcomingLesson = {
  id: PAST_LESSON_ID,
  locationId: "33333333-3333-4333-8333-333333333333",
  locationName: "Rose Bowl Aquatics Center",
  startsAt: "2026-10-14T16:30:00-07:00",
  durationMinutes: 45,
  type: "private",
  status: "completed",
  swimmers: [{ swimmerId: SWIMMER_ID, firstName: "Maya", lastName: "Rivera" }],
  expiresAt: null,
  approvedAt: null,
  declinedAt: null,
  declineReason: null,
  movedAt: null,
  previousStartsAt: null,
  createdAt: "2026-10-10T09:00:00-07:00",
  batchId: null,
  batchMode: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUseActionState.mockReturnValue([{ status: "idle" }, vi.fn(), false]);
});

describe("fetchPastLessons — parses the merged { items, total } response", () => {
  it("extracts items from a real { items, total } body for filter=past", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [pastLesson], total: 1 }),
    });

    const result = await fetchPastLessons("tok");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0]?.id).toBe(PAST_LESSON_ID);
    }
    // Confirms the fetcher really hit the filter=past branch of the merged endpoint.
    const [calledUrl] = mockFetch.mock.calls[0] ?? [];
    expect(String(calledUrl)).toContain("/lessons?filter=past");
  });

  it("returns a schema error when the server emits the legacy array shape (regression guard)", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [pastLesson],
    });

    const result = await fetchPastLessons("tok");

    // The old shape no longer parses — the schema-error branch kicks in,
    // which is exactly how a schema mismatch surfaces today.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("schema");
  });
});

describe("fetchPastLessons — error branches", () => {
  it("returns a server error on a non-2xx response", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    const result = await fetchPastLessons("tok");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("server");
  });
});

describe("Past lessons render on the parent lessons page", () => {
  it("renders a past lesson row under the Past section", () => {
    render(
      <ParentLessonsContent
        initialLessons={[]}
        initialHasMore={false}
        past={[pastLesson]}
      />,
    );
    expect(screen.getByRole("heading", { name: /^past$/i })).toBeInTheDocument();
    // The row links to /dashboard/lessons/:id. Finding the one with THIS
    // lesson's id proves the past row rendered (not an empty-state fallback).
    const row = screen
      .getAllByRole("link")
      .find((link) => link.getAttribute("href") === `/dashboard/lessons/${pastLesson.id}`);
    expect(row).toBeDefined();
    // Swimmer name appears in the row metadata.
    expect(row?.textContent).toMatch(/Maya/);
    expect(screen.queryByText(/No past lessons yet/i)).toBeNull();
  });
});

describe("Past lessons render on the swimmer profile page", () => {
  const baseSwimmer = {
    id: SWIMMER_ID,
    firstName: "Maya",
    lastName: "Rivera",
    birthDate: "2015-04-18",
    sex: "female" as const,
    isPublic: false,
    createdAt: "2024-01-10T12:00:00-08:00",
    updatedAt: "2026-10-10T12:00:00-07:00",
    clubs: [],
    currentLeagues: [],
  };

  const emptyProgress = {
    skills: [],
    startProgress: [],
    headPositionOverall: null,
    coachingPriorities: [],
    latestCoachingNotes: [],
    latestCoachingPriority: null,
  };

  it("includes the past lesson in the Recent column", () => {
    render(
      <SwimmerProfileContent
        swimmer={baseSwimmer}
        householdRole="owner"
        clubsResult={{ ok: true, data: [] }}
        progress={{ ok: true, data: emptyProgress }}
        scoreHistory={{ ok: true, data: { points: [], recentChanges: [], milestones: [], measurements: [] } }}
        personalBests={{ ok: true, data: { personalBests: [] } }}
        upcomingLessons={{ ok: true, data: [] }}
        pastLessons={{ ok: true, data: [pastLesson] }}
      />,
    );
    expect(screen.getByRole("heading", { name: /^recent$/i })).toBeInTheDocument();
    // The row links to /dashboard/lessons/:id — finding that href proves the
    // past lesson actually rendered instead of the empty-state message.
    const rows = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("href") === `/dashboard/lessons/${pastLesson.id}`);
    expect(rows.length).toBeGreaterThan(0);
    expect(screen.queryByText(/No lessons scheduled yet/i)).toBeNull();
  });
});
