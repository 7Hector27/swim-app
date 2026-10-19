import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/dashboard",
}));

vi.mock("@/lib/api/lessons", () => ({
  fetchCoachSchedule: vi.fn().mockResolvedValue([]),
  coachGetPendingLessons: vi.fn().mockResolvedValue([]),
  fetchCoachStats: vi.fn().mockResolvedValue(null),
}));

import TodayScheduleCard from "../content/CoachDashboardContent/TodayScheduleCard";

const TODAY = "2025-06-01";

describe("Dashboard header — buttons removed", () => {
  it("TodayScheduleCard does not render Log a time", () => {
    render(
      <TodayScheduleCard initialItems={[]} today={TODAY} accessToken="tok" />,
    );
    expect(screen.queryByText("Log a time")).not.toBeInTheDocument();
  });

  it("TodayScheduleCard does not render Edit availability", () => {
    render(
      <TodayScheduleCard initialItems={[]} today={TODAY} accessToken="tok" />,
    );
    expect(screen.queryByText("Edit availability")).not.toBeInTheDocument();
  });

  it("TodayScheduleCard does not render Add swimmer", () => {
    render(
      <TodayScheduleCard initialItems={[]} today={TODAY} accessToken="tok" />,
    );
    expect(screen.queryByText("Add swimmer")).not.toBeInTheDocument();
  });
});
