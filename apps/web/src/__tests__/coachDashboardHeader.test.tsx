import { vi, describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/dashboard",
}));

vi.mock("@swim-app/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@swim-app/shared")>();
  return { ...actual, todayLA: vi.fn().mockReturnValue("2025-06-01") };
});

vi.mock("@/lib/api/lessons", () => ({
  fetchCoachSchedule: vi.fn().mockResolvedValue([]),
  coachGetPendingLessons: vi.fn().mockResolvedValue([]),
  fetchCoachStats: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/api/coachSwimmers", () => ({
  fetchCoachSwimmers: vi.fn().mockResolvedValue([]),
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

describe("CoachDashboardContent — header buttons removed", () => {
  async function renderDashboard() {
    render(await CoachDashboardContent({ accessToken: "test-token" }));
  }

  it("does not render a Log a time button", async () => {
    await renderDashboard();
    expect(screen.queryByText("Log a time")).not.toBeInTheDocument();
  });

  it("does not render an Edit availability button", async () => {
    await renderDashboard();
    expect(screen.queryByText("Edit availability")).not.toBeInTheDocument();
  });

  it("does not render an Add swimmer button", async () => {
    await renderDashboard();
    expect(screen.queryByText("Add swimmer")).not.toBeInTheDocument();
  });
});
