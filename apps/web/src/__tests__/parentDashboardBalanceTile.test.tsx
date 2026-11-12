// ADR 036 Phase 8 Part B Stop 3 piece 4: the parent dashboard sidebar
// gets a balance tile that renders dollars + approximate private hours
// and links to /account/balance. Visibility is scoped to owners and
// managers; viewers see no tile at all (they can't book or add funds
// anyway, so showing the balance would just be noise).

import { vi, describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const {
  mockRedirect,
  mockFetchSwimmers,
  mockFetchUpcomingLessons,
  mockFetchHousehold,
  mockFetchLesson,
  mockFetchClubs,
  mockFetchParentSwimmerSummaries,
  mockFetchBalance,
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
  mockFetchBalance: vi.fn(),
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
vi.mock("@/lib/api/balance", () => ({ fetchBalance: mockFetchBalance }));
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

const OWNER_HOUSEHOLD = {
  id: "household-1",
  name: "Carbajal",
  myRole: "owner" as const,
  members: [],
};

const MANAGER_HOUSEHOLD = { ...OWNER_HOUSEHOLD, myRole: "manager" as const };
const VIEWER_HOUSEHOLD = { ...OWNER_HOUSEHOLD, myRole: "viewer" as const };

beforeEach(() => {
  mockRedirect.mockClear();
  mockFetchSwimmers.mockResolvedValue({ ok: true, data: [] });
  mockFetchUpcomingLessons.mockResolvedValue({
    ok: true,
    data: { items: [], total: 0 },
  });
  mockFetchLesson.mockReset();
  mockFetchClubs.mockResolvedValue({ ok: true, data: [] });
  mockFetchParentSwimmerSummaries.mockResolvedValue({
    ok: true,
    data: { summaries: [] },
  });
  mockFetchBalance.mockResolvedValue({
    balanceCents: 12_000,
    approximatePrivateHours: 1,
  });
});

async function renderDashboard() {
  const { default: ParentDashboardContent } = await import(
    "../content/ParentDashboardContent/ParentDashboardContent"
  );
  const element = await ParentDashboardContent({
    profile: PROFILE,
    accessToken: "token",
  });
  return render(element);
}

// ADR 036 Phase 8 Part B Stop 3 piece 9: the balance tile renders
// twice in the DOM — once in a `tablet:hidden` block above the
// two-column layout for mobile, and once inside the `hidden
// tablet:block` sidebar wrapper for tablet+. Both carry the same
// testid, so the tests assert visibility via `queryAllByTestId`
// instead of matching a single element.

describe("Parent dashboard balance tile", () => {
  it("renders dollars + approximate hours + link to /account/balance for an owner", async () => {
    mockFetchHousehold.mockResolvedValue({ ok: true, household: OWNER_HOUSEHOLD });
    const { queryAllByTestId, getAllByText } = await renderDashboard();
    const tiles = queryAllByTestId("dashboard-balance-tile");
    expect(tiles.length).toBeGreaterThan(0);
    const dollars = queryAllByTestId("dashboard-balance-dollars");
    expect(dollars[0]?.textContent).toBe("$120.00");
    const hours = queryAllByTestId("dashboard-balance-hours");
    expect(hours[0]?.textContent).toBe("≈ 1 hour of private lessons");
    // Link to /account/balance for history + top-ups.
    const link = getAllByText("Add funds and see history")[0]!;
    expect(link.getAttribute("href")).toBe("/account/balance");
  });

  it("renders the tile for a manager", async () => {
    mockFetchHousehold.mockResolvedValue({ ok: true, household: MANAGER_HOUSEHOLD });
    const { queryAllByTestId } = await renderDashboard();
    expect(queryAllByTestId("dashboard-balance-tile").length).toBeGreaterThan(0);
  });

  it("hides the tile for a viewer", async () => {
    mockFetchHousehold.mockResolvedValue({ ok: true, household: VIEWER_HOUSEHOLD });
    const { queryAllByTestId } = await renderDashboard();
    expect(queryAllByTestId("dashboard-balance-tile")).toHaveLength(0);
  });

  it("hides the tile when the balance fetch fails (fetchBalance → null)", async () => {
    mockFetchHousehold.mockResolvedValue({ ok: true, household: OWNER_HOUSEHOLD });
    mockFetchBalance.mockResolvedValue(null);
    const { queryAllByTestId } = await renderDashboard();
    expect(queryAllByTestId("dashboard-balance-tile")).toHaveLength(0);
  });

  it("hides the tile when the household lookup fails (defense-in-depth viewer default)", async () => {
    mockFetchHousehold.mockResolvedValue({ ok: false, status: 500 });
    const { queryAllByTestId } = await renderDashboard();
    expect(queryAllByTestId("dashboard-balance-tile")).toHaveLength(0);
  });
});
