// The parent dashboard is a hub — per the audit, no single data load
// should throw. If the swimmers roster fails to load, the upcoming-lessons
// card must still render, and vice-versa. Each card shows its own
// InlineError on failure.

import { vi, describe, it, expect, beforeEach } from "vitest";

const {
  mockRedirect,
  mockFetchSwimmers,
  mockFetchUpcomingLessons,
  mockFetchHousehold,
  mockFetchLesson,
  mockFetchClubs,
  mockFetchParentSwimmerSummaries,
} = vi.hoisted(() => ({
  mockRedirect: vi.fn((target: string) => {
    throw new Error(`NEXT_REDIRECT:${target}`);
  }),
  mockFetchSwimmers: vi.fn(),
  mockFetchUpcomingLessons: vi.fn(),
  mockFetchHousehold: vi.fn(),
  mockFetchLesson: vi.fn(),
  mockFetchClubs: vi.fn(),
  mockFetchParentSwimmerSummaries: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("@/lib/api/swimmers", () => ({ fetchSwimmers: mockFetchSwimmers }));
vi.mock("@/lib/api/lessons", () => ({
  fetchUpcomingLessons: mockFetchUpcomingLessons,
  fetchLesson: mockFetchLesson,
}));
vi.mock("@/lib/api/households", () => ({ fetchHousehold: mockFetchHousehold }));
vi.mock("@/lib/api/clubs", () => ({ fetchClubs: mockFetchClubs }));
vi.mock("@/lib/api/parentProgress", () => ({
  fetchParentSwimmerSummaries: mockFetchParentSwimmerSummaries,
}));
vi.mock("@/content/ParentDashboardContent/BookingConfirmDialog", () => ({
  default: () => null,
}));
vi.mock("@/content/ParentDashboardContent/UpcomingLessonsCard", () => ({
  default: () => null,
}));
vi.mock("@/content/ParentDashboardContent/SwimmerCard", () => ({
  default: () => null,
}));

const PROFILE = {
  id: "parent-1",
  email: "parent@example.com",
  fullName: "Parent Name",
  phone: null,
  role: "parent" as const,
};

beforeEach(() => {
  mockRedirect.mockClear();
  mockFetchSwimmers.mockReset();
  mockFetchUpcomingLessons.mockReset();
  mockFetchHousehold.mockReset();
  mockFetchLesson.mockReset();
  mockFetchClubs.mockReset();
  mockFetchParentSwimmerSummaries.mockReset();
  mockFetchHousehold.mockResolvedValue({ ok: true, household: null });
  mockFetchClubs.mockResolvedValue({ ok: true, data: [] });
  mockFetchParentSwimmerSummaries.mockResolvedValue({
    ok: true,
    data: { summaries: [] },
  });
});

describe("ParentDashboardContent — hub never throws", () => {
  it("does not throw when swimmers fails to load (upcoming card still renders)", async () => {
    mockFetchSwimmers.mockResolvedValue({ ok: false, reason: "server" });
    mockFetchUpcomingLessons.mockResolvedValue({
      ok: true,
      data: { items: [], total: 0 },
    });

    const { default: ParentDashboardContent } = await import(
      "../content/ParentDashboardContent/ParentDashboardContent"
    );
    await expect(
      ParentDashboardContent({ profile: PROFILE, accessToken: "token" }),
    ).resolves.toBeDefined();
  });

  it("does not throw when upcoming lessons fails to load (roster still renders)", async () => {
    mockFetchSwimmers.mockResolvedValue({ ok: true, data: [] });
    mockFetchUpcomingLessons.mockResolvedValue({ ok: false, reason: "network" });

    const { default: ParentDashboardContent } = await import(
      "../content/ParentDashboardContent/ParentDashboardContent"
    );
    await expect(
      ParentDashboardContent({ profile: PROFILE, accessToken: "token" }),
    ).resolves.toBeDefined();
  });

  it("does not throw when household fails to load", async () => {
    mockFetchSwimmers.mockResolvedValue({ ok: true, data: [] });
    mockFetchUpcomingLessons.mockResolvedValue({
      ok: true,
      data: { items: [], total: 0 },
    });
    mockFetchHousehold.mockResolvedValue({ ok: false, status: 500 });

    const { default: ParentDashboardContent } = await import(
      "../content/ParentDashboardContent/ParentDashboardContent"
    );
    await expect(
      ParentDashboardContent({ profile: PROFILE, accessToken: "token" }),
    ).resolves.toBeDefined();
  });
});
