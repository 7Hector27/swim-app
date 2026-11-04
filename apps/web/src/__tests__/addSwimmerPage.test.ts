// Add Swimmer page is a write page — same rule as the edit page. If the
// clubs catalog fails to load, throw so the error boundary renders instead
// of showing the form with an empty club dropdown (the parent would "pick
// none" and lose the chance to tag their swimmer).

import { vi, describe, it, expect, beforeEach } from "vitest";

const { mockRedirect, mockRequireAuth, mockFetchClubs } = vi.hoisted(() => ({
  mockRedirect: vi.fn((target: string) => {
    throw new Error(`NEXT_REDIRECT:${target}`);
  }),
  mockRequireAuth: vi.fn(),
  mockFetchClubs: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("@/lib/requireAuth", () => ({ requireAuth: mockRequireAuth }));
vi.mock("@/lib/api/clubs", () => ({ fetchClubs: mockFetchClubs }));
vi.mock("@/content/AddSwimmerContent", () => ({ default: () => null }));

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
  mockFetchClubs.mockReset();
  mockRequireAuth.mockResolvedValue(PARENT_AUTH);
});

describe("/dashboard/swimmers/new page", () => {
  it("throws when the clubs catalog fails to load (never renders form with empty clubs)", async () => {
    mockFetchClubs.mockResolvedValue({ ok: false, reason: "server" });
    const { default: AddSwimmerPage } = await import(
      "../app/dashboard/swimmers/new/page"
    );
    await expect(AddSwimmerPage()).rejects.toThrow(/Failed to load clubs/);
  });

  it("renders on the happy path", async () => {
    mockFetchClubs.mockResolvedValue({ ok: true, data: [] });
    const { default: AddSwimmerPage } = await import(
      "../app/dashboard/swimmers/new/page"
    );
    await expect(AddSwimmerPage()).resolves.toBeDefined();
  });
});
