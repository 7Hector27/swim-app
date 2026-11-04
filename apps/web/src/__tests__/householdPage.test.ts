// /household must distinguish "parent has no household yet" (redirect to
// onboarding) from "the load failed" (throw so the error boundary renders).
// A failed load used to redirect to /dashboard — the parent would see no
// signal that anything went wrong, or worse, see the onboarding flow.

import { vi, describe, it, expect, beforeEach } from "vitest";

const {
  mockRedirect,
  mockRequireAuth,
  mockFetchHousehold,
  mockFetchPendingInvite,
} = vi.hoisted(() => ({
  mockRedirect: vi.fn((target: string) => {
    throw new Error(`NEXT_REDIRECT:${target}`);
  }),
  mockRequireAuth: vi.fn(),
  mockFetchHousehold: vi.fn(),
  mockFetchPendingInvite: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("@/lib/requireAuth", () => ({ requireAuth: mockRequireAuth }));
vi.mock("@/lib/api/households", () => ({
  fetchHousehold: mockFetchHousehold,
  fetchPendingInvite: mockFetchPendingInvite,
}));
vi.mock("@/content/HouseholdSettingsContent", () => ({ default: () => null }));

const PARENT_AUTH = {
  profile: {
    id: "parent-1",
    email: "parent@example.com",
    fullName: "Parent",
    phone: null,
    role: "parent" as const,
  },
  accessToken: "token",
};

beforeEach(() => {
  mockRedirect.mockClear();
  mockRequireAuth.mockReset();
  mockFetchHousehold.mockReset();
  mockFetchPendingInvite.mockReset();
  mockRequireAuth.mockResolvedValue(PARENT_AUTH);
  mockFetchPendingInvite.mockResolvedValue(null);
});

describe("/household page", () => {
  it("throws on a load failure (never redirects silently to /dashboard)", async () => {
    mockFetchHousehold.mockResolvedValue({ ok: false, status: 500 });
    const { default: HouseholdPage } = await import("../app/household/page");
    await expect(HouseholdPage()).rejects.toThrow(
      /Failed to load household \(status 500\)/,
    );
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("redirects to /dashboard only on a legitimate no-household (ok + null)", async () => {
    mockFetchHousehold.mockResolvedValue({ ok: true, household: null });
    const { default: HouseholdPage } = await import("../app/household/page");
    await expect(HouseholdPage()).rejects.toThrow(/NEXT_REDIRECT:\/dashboard/);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("renders when the household loaded ok", async () => {
    mockFetchHousehold.mockResolvedValue({
      ok: true,
      household: {
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        name: "Smith",
        myRole: "owner",
        members: [],
        swimmerIds: [],
      },
    });
    const { default: HouseholdPage } = await import("../app/household/page");
    await expect(HouseholdPage()).resolves.toBeDefined();
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
