// The coach dashboard never throws on a data load. A roster outage must
// not hide today's schedule or booking requests — each card renders its
// own InlineError when its fetch failed.

import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@swim-app/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@swim-app/shared")>();
  return { ...actual, todayLA: vi.fn().mockReturnValue("2026-06-01") };
});

vi.mock("@/lib/api/lessons", () => ({
  fetchCoachSchedule: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  coachGetPendingLessons: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  fetchCoachStats: vi.fn().mockResolvedValue({ ok: true, data: { lessonsToday: 0, pendingRequests: 0, activeSwimmers: 0, lessonsThisWeek: 0 } }),
}));

const { mockFetchCoachSwimmers } = vi.hoisted(() => ({
  mockFetchCoachSwimmers: vi.fn(),
}));
vi.mock("@/lib/api/coachSwimmers", () => ({
  fetchCoachSwimmers: mockFetchCoachSwimmers,
}));

vi.mock("@/content/CoachDashboardContent/TodayScheduleCard", () => ({
  default: () => <div data-testid="today-schedule-card" />,
}));

vi.mock("@/content/CoachDashboardContent/BookingRequestsCard", () => ({
  default: () => <div data-testid="booking-requests-card" />,
}));

vi.mock("@/content/CoachDashboardContent/SwimmersTable", () => ({
  default: () => <div data-testid="swimmers-table" />,
}));

vi.mock("@/components/Placeholder", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import CoachDashboardContent from "../content/CoachDashboardContent/CoachDashboardContent";

beforeEach(() => {
  mockFetchCoachSwimmers.mockReset();
});

async function renderDashboard() {
  const node = await CoachDashboardContent({ accessToken: "token" });
  render(node as React.ReactElement);
}

describe("CoachDashboardContent — hub never throws on roster failure", () => {
  it("renders TodayScheduleCard and BookingRequestsCard when swimmers failed to load", async () => {
    mockFetchCoachSwimmers.mockResolvedValue({ ok: false, reason: "server" });

    await renderDashboard();

    // Other cards must still render — a roster outage can't black out the
    // schedule or booking requests.
    expect(screen.getByTestId("today-schedule-card")).toBeInTheDocument();
    expect(screen.getByTestId("booking-requests-card")).toBeInTheDocument();
    // Roster slot shows the error, not the table.
    expect(
      screen.getByTestId("coach-dashboard-swimmers-error"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("swimmers-table")).toBeNull();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/couldn't load the roster/i);
  });

  it("renders the table on the happy path (no error)", async () => {
    mockFetchCoachSwimmers.mockResolvedValue({ ok: true, data: [] });

    await renderDashboard();

    expect(screen.getByTestId("swimmers-table")).toBeInTheDocument();
    expect(
      screen.queryByTestId("coach-dashboard-swimmers-error"),
    ).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
