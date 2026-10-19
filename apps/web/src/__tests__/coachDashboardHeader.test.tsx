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

describe("CoachDashboardContent — schedule card full width on phones", () => {
  it("today schedule card renders inside a w-full column (stretches to full width on mobile)", async () => {
    const { container } = render(await CoachDashboardContent({ accessToken: "test-token" }));
    const card = container.querySelector('[data-testid="today-schedule-card"]');
    expect(card).not.toBeNull();
    // The immediate parent column must have w-full so on phones it is not width-constrained
    expect(card?.parentElement?.className).toContain("w-full");
  });

  it("two-column container does not apply items-start without tablet: prefix", async () => {
    const { container } = render(await CoachDashboardContent({ accessToken: "test-token" }));
    const card = container.querySelector('[data-testid="today-schedule-card"]');
    const twoCol = card?.parentElement?.parentElement;
    // bare items-start would prevent the column from stretching to full width on mobile
    expect(twoCol?.className).not.toMatch(/(?<![:\w])items-start/);
  });
});

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
