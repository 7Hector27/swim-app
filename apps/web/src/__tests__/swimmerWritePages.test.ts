// Covers the Phase 3 "write pages treat all data as primary" rule for
// pages that save something: evaluate (coach), swimmer edit (parent),
// and coach evaluations (treated as primary list). Each must throw on any
// secondary failure so the route error boundary renders — never a form on
// top of a partially-loaded page.

import { vi, describe, it, expect, beforeEach } from "vitest";

const {
  mockNotFound,
  mockRedirect,
  mockRequireAuth,
  mockFetchCoachSwimmerDetail,
  mockFetchScreens,
  mockFetchSwimmerSkills,
  mockFetchSession,
  mockFetchSwimmer,
  mockFetchHousehold,
  mockFetchClubs,
  mockFetchSwimmerEvaluations,
} = vi.hoisted(() => ({
  mockNotFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  mockRedirect: vi.fn((target: string) => {
    throw new Error(`NEXT_REDIRECT:${target}`);
  }),
  mockRequireAuth: vi.fn(),
  mockFetchCoachSwimmerDetail: vi.fn(),
  mockFetchScreens: vi.fn(),
  mockFetchSwimmerSkills: vi.fn(),
  mockFetchSession: vi.fn(),
  mockFetchSwimmer: vi.fn(),
  mockFetchHousehold: vi.fn(),
  mockFetchClubs: vi.fn(),
  mockFetchSwimmerEvaluations: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: mockNotFound,
  redirect: mockRedirect,
}));
vi.mock("@/lib/requireAuth", () => ({ requireAuth: mockRequireAuth }));
vi.mock("@/lib/api/coachSwimmers", () => ({
  fetchCoachSwimmerDetail: mockFetchCoachSwimmerDetail,
}));
vi.mock("@/lib/api/evaluations", () => ({
  fetchScreens: mockFetchScreens,
  fetchSwimmerSkills: mockFetchSwimmerSkills,
  fetchSession: mockFetchSession,
  fetchSwimmerEvaluations: mockFetchSwimmerEvaluations,
}));
vi.mock("@/lib/api/swimmers", () => ({
  fetchSwimmer: mockFetchSwimmer,
}));
vi.mock("@/lib/api/households", () => ({
  fetchHousehold: mockFetchHousehold,
}));
vi.mock("@/lib/api/clubs", () => ({
  fetchClubs: mockFetchClubs,
}));
vi.mock("@/lib/env", () => ({
  publicEnv: { siteUrl: "http://localhost:3000" },
}));
vi.mock("@/components/AccountInactiveScreen", () => ({ default: () => null }));
vi.mock("@/content/EvaluateContent", () => ({ default: () => null }));
vi.mock("@/content/EditSwimmerContent", () => ({ default: () => null }));
vi.mock("@/content/CoachEvaluationsContent", () => ({ default: () => null }));

const SWIMMER_ID = "11111111-1111-1111-1111-111111111111";

const COACH_AUTH = {
  profile: {
    id: "coach-1",
    email: "jason@example.com",
    fullName: "Jason",
    phone: null,
    role: "coach" as const,
  },
  accessToken: "token-xyz",
};

const PARENT_AUTH = {
  ...COACH_AUTH,
  profile: { ...COACH_AUTH.profile, role: "parent" as const },
};

beforeEach(() => {
  mockNotFound.mockClear();
  mockRedirect.mockClear();
  mockRequireAuth.mockReset();
  mockFetchCoachSwimmerDetail.mockReset();
  mockFetchScreens.mockReset();
  mockFetchSwimmerSkills.mockReset();
  mockFetchSession.mockReset();
  mockFetchSwimmer.mockReset();
  mockFetchHousehold.mockReset();
  mockFetchClubs.mockReset();
  mockFetchSwimmerEvaluations.mockReset();
});

describe("evaluate page — all data treated as primary", () => {
  it("throws when skills fetch fails (prev-grade chips would be silently wrong otherwise)", async () => {
    mockRequireAuth.mockResolvedValue(COACH_AUTH);
    mockFetchCoachSwimmerDetail.mockResolvedValue({
      ok: true,
      swimmer: { id: SWIMMER_ID, firstName: "Alex" },
    });
    mockFetchScreens.mockResolvedValue({ ok: true, screens: [] });
    mockFetchSwimmerSkills.mockResolvedValue({ ok: false, status: 500 });

    const { default: EvaluatePage } = await import(
      "../app/coach/swimmers/[id]/evaluate/page"
    );
    await expect(
      EvaluatePage({ params: Promise.resolve({ id: SWIMMER_ID }) }),
    ).rejects.toThrow(/Failed to load prior skills \(status 500\)/);
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  it("throws when screens fetch fails (existing primary)", async () => {
    mockRequireAuth.mockResolvedValue(COACH_AUTH);
    mockFetchCoachSwimmerDetail.mockResolvedValue({
      ok: true,
      swimmer: { id: SWIMMER_ID },
    });
    mockFetchScreens.mockResolvedValue({ ok: false, status: 503 });
    mockFetchSwimmerSkills.mockResolvedValue({ ok: true, data: { grades: {} } });

    const { default: EvaluatePage } = await import(
      "../app/coach/swimmers/[id]/evaluate/page"
    );
    await expect(
      EvaluatePage({ params: Promise.resolve({ id: SWIMMER_ID }) }),
    ).rejects.toThrow(/Failed to load screens \(status 503\)/);
  });

  it("calls notFound() on swimmer 404 (write pages still honor 404 for the primary record)", async () => {
    mockRequireAuth.mockResolvedValue(COACH_AUTH);
    mockFetchCoachSwimmerDetail.mockResolvedValue({ ok: false, status: 404 });
    mockFetchScreens.mockResolvedValue({ ok: true, screens: [] });
    mockFetchSwimmerSkills.mockResolvedValue({ ok: true, data: { grades: {} } });

    const { default: EvaluatePage } = await import(
      "../app/coach/swimmers/[id]/evaluate/page"
    );
    await expect(
      EvaluatePage({ params: Promise.resolve({ id: SWIMMER_ID }) }),
    ).rejects.toThrow(/NEXT_NOT_FOUND/);
    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });
});

describe("parent swimmer edit page — all data treated as primary", () => {
  it("throws when clubs fetch fails (write page can't submit without the dropdown)", async () => {
    mockRequireAuth.mockResolvedValue(PARENT_AUTH);
    mockFetchSwimmer.mockResolvedValue({
      ok: true,
      swimmer: { id: SWIMMER_ID },
    });
    mockFetchHousehold.mockResolvedValue({
      ok: true,
      household: { id: "h-1", myRole: "owner", members: [], swimmerIds: [] },
    });
    mockFetchClubs.mockResolvedValue({ ok: false, reason: "server" });

    const { default: EditPage } = await import(
      "../app/dashboard/swimmers/[id]/edit/page"
    );
    await expect(
      EditPage({ params: Promise.resolve({ id: SWIMMER_ID }) }),
    ).rejects.toThrow(/Failed to load clubs/);
  });

  it("does not throw on the happy path", async () => {
    mockRequireAuth.mockResolvedValue(PARENT_AUTH);
    mockFetchSwimmer.mockResolvedValue({
      ok: true,
      swimmer: { id: SWIMMER_ID },
    });
    mockFetchHousehold.mockResolvedValue({
      ok: true,
      household: { id: "h-1", myRole: "owner", members: [], swimmerIds: [] },
    });
    mockFetchClubs.mockResolvedValue({ ok: true, data: [] });

    const { default: EditPage } = await import(
      "../app/dashboard/swimmers/[id]/edit/page"
    );
    await expect(
      EditPage({ params: Promise.resolve({ id: SWIMMER_ID }) }),
    ).resolves.toBeDefined();
  });
});

describe("coach evaluations list page — primary (not fail-soft)", () => {
  it("throws when the evaluations list fetch fails (no silent empty list)", async () => {
    mockRequireAuth.mockResolvedValue(COACH_AUTH);
    mockFetchCoachSwimmerDetail.mockResolvedValue({
      ok: true,
      swimmer: { id: SWIMMER_ID },
    });
    mockFetchSwimmerEvaluations.mockResolvedValue({ ok: false, status: 500 });

    const { default: EvaluationsPage } = await import(
      "../app/coach/swimmers/[id]/evaluations/page"
    );
    await expect(
      EvaluationsPage({ params: Promise.resolve({ id: SWIMMER_ID }) }),
    ).rejects.toThrow(/Failed to load evaluations \(status 500\)/);
  });

  it("does not throw on an empty (but ok) evaluations response", async () => {
    mockRequireAuth.mockResolvedValue(COACH_AUTH);
    mockFetchCoachSwimmerDetail.mockResolvedValue({
      ok: true,
      swimmer: { id: SWIMMER_ID },
    });
    mockFetchSwimmerEvaluations.mockResolvedValue({
      ok: true,
      data: { evaluations: [], nextCursor: null },
    });

    const { default: EvaluationsPage } = await import(
      "../app/coach/swimmers/[id]/evaluations/page"
    );
    await expect(
      EvaluationsPage({ params: Promise.resolve({ id: SWIMMER_ID }) }),
    ).resolves.toBeDefined();
  });
});
