// @vitest-environment node
import { vi, it, expect, describe, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { MeResponse, UpcomingLesson, ParentSwimmer } from "@swim-app/shared";

const { mockFetchMe, mockFetchUpcomingLessons, mockFetchSwimmers, mockFetchHousehold, mockRedirect } =
  vi.hoisted(() => ({
    mockFetchMe: vi.fn(),
    mockFetchUpcomingLessons: vi.fn(),
    mockFetchSwimmers: vi.fn(),
    mockFetchHousehold: vi.fn(),
    mockRedirect: vi.fn((url: string) => {
      const err = new Error(`NEXT_REDIRECT:${url}`);
      throw err;
    }),
  }));

vi.mock("react", async (importOriginal) => {
  const original = await importOriginal<typeof import("react")>();
  return { ...original, cache: (fn: unknown) => fn };
});

vi.mock("@/lib/api/me", () => ({ fetchMe: mockFetchMe }));
vi.mock("@/lib/api/lessons", () => ({ fetchUpcomingLessons: mockFetchUpcomingLessons, fetchLesson: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/api/swimmers", () => ({ fetchSwimmers: mockFetchSwimmers }));
vi.mock("@/lib/api/households", () => ({ fetchHousehold: mockFetchHousehold }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

// removeSwimmer server action is not under test here; stub it to avoid the supabase import.
vi.mock("@/content/ParentDashboardContent/actions", () => ({
  removeSwimmer: vi.fn(),
}));

import DashboardPage from "../app/dashboard/page";

const PARENT: MeResponse = {
  email: "hector@mail.com",
  fullName: "Hector Carbajal",
  phone: "555-0100",
  role: "parent",
};

const LESSON: UpcomingLesson = {
  id: "les-001",
  locationId: "loc-001",
  locationName: "Egret Park",
  startsAt: "2026-10-21T18:00:00.000Z",
  durationMinutes: 45,
  type: "private",
  status: "approved",
  swimmers: [{ swimmerId: "sw-001", firstName: "Alex", lastName: "Smith" }],
  expiresAt: null,
  approvedAt: "2026-10-15T10:00:00.000Z",
  declinedAt: null,
  declineReason: null,
  movedAt: null,
  previousStartsAt: null,
  createdAt: "2026-10-14T10:00:00.000Z",
};

const SWIMMER: ParentSwimmer = {
  id: "sw-001",
  firstName: "Alex",
  lastName: "Smith",
  sex: "male",
  birthDate: "2014-05-10",
  isPublic: false,
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
  clubs: [],
  currentLeagues: [],
};

beforeEach(() => {
  mockFetchMe.mockReset();
  mockFetchUpcomingLessons.mockReset();
  mockFetchSwimmers.mockReset();
  mockFetchHousehold.mockReset();
  mockRedirect.mockClear();

  // Default stubs for calls not under test
  mockFetchSwimmers.mockResolvedValue([]);
  mockFetchHousehold.mockResolvedValue(null);
});

describe("Parent dashboard — upcoming lessons load", () => {
  it("calls fetchUpcomingLessons with the session token", async () => {
    mockFetchMe.mockResolvedValue({ ok: true, profile: PARENT, accessToken: "parent-tok" });
    mockFetchUpcomingLessons.mockResolvedValue([LESSON]);

    await DashboardPage({ searchParams: Promise.resolve({}) });

    expect(mockFetchUpcomingLessons).toHaveBeenCalledWith("parent-tok");
  });

  it("renders upcoming lesson location when lessons are returned", async () => {
    mockFetchMe.mockResolvedValue({ ok: true, profile: PARENT, accessToken: "parent-tok" });
    mockFetchUpcomingLessons.mockResolvedValue([LESSON]);

    const rendered = await DashboardPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(rendered);

    expect(html).toContain("Egret Park");
  });

  it("renders empty-state message when no upcoming lessons", async () => {
    mockFetchMe.mockResolvedValue({ ok: true, profile: PARENT, accessToken: "parent-tok" });
    mockFetchUpcomingLessons.mockResolvedValue([]);

    const rendered = await DashboardPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(rendered);

    expect(html).toContain("No upcoming lessons booked yet");
  });

  it("also calls fetchSwimmers with the session token", async () => {
    mockFetchMe.mockResolvedValue({ ok: true, profile: PARENT, accessToken: "parent-tok" });
    mockFetchUpcomingLessons.mockResolvedValue([]);
    mockFetchSwimmers.mockResolvedValue([SWIMMER]);

    await DashboardPage({ searchParams: Promise.resolve({}) });

    expect(mockFetchSwimmers).toHaveBeenCalledWith("parent-tok");
  });

  it("redirects to /login when the session is forbidden", async () => {
    mockFetchMe.mockResolvedValue({ ok: false, status: 403 });

    await expect(DashboardPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "NEXT_REDIRECT:/login",
    );
    expect(mockFetchUpcomingLessons).not.toHaveBeenCalled();
  });
});
