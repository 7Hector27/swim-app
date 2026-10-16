import { vi, describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("../content/BookCalendarContent/actions", () => ({
  fetchRangeAction: vi.fn().mockResolvedValue(null),
  findFirstAvailableDayAction: vi.fn().mockResolvedValue(null),
  createBookingAction: vi.fn(),
}));

import MonthGrid from "../content/BookCalendarContent/MonthGrid";

// Helpers
function makeDay(
  date: string,
  dayState: "open" | "closed" | "past" | "not_open_yet" = "open",
  openCount = 4,
  totalCount = 8,
) {
  return { date, dayState, openCount, totalCount };
}

// October 2026: 31 days; starts Thursday (DOW 4, Mon-indexed = 3 leading cells)
// With Monday-start grid: leading = 3 (Mon 28 Sep, Tue 29 Sep, Wed 30 Sep)
// trailing depends on last day (Sat 31): lastDow=6, trailing = 7-6=1 (Sun 1 Nov)
// Total cells = 3 + 31 + 1 = 35
const OCTOBER_DAYS = [
  "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05",
  "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10",
  "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15",
  "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20",
  "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25",
  "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30",
  "2026-10-31",
].map((date) => makeDay(date));

// ---------------------------------------------------------------------------
// 1. MonthGrid renders one cell per date in the grid (including leading/trailing)
// ---------------------------------------------------------------------------
describe("MonthGrid", () => {
  it("renders one cell per date in the grid including leading and trailing month days", () => {
    const { getAllByRole } = render(
      <MonthGrid
        monthStr="2026-10"
        days={OCTOBER_DAYS}
        todayStr="2026-10-15"
        onDayClick={() => {}}
      />,
    );
    // October 2026: 3 leading + 31 + 1 trailing = 35 cells
    const buttons = getAllByRole("button");
    expect(buttons).toHaveLength(35);
  });

  // ---------------------------------------------------------------------------
  // 2. Open day shows "N of M open"
  // ---------------------------------------------------------------------------
  it("shows '9 of 16 open' for a day with openCount=9 and totalCount=16", () => {
    const days = OCTOBER_DAYS.map((day) =>
      day.date === "2026-10-12"
        ? makeDay("2026-10-12", "open", 9, 16)
        : day,
    );
    render(
      <MonthGrid
        monthStr="2026-10"
        days={days}
        todayStr="2026-10-15"
        onDayClick={() => {}}
      />,
    );
    expect(screen.getByText("9 of 16 open")).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // 3. Closed day shows "Closed" with no fill bar that is filled
  // ---------------------------------------------------------------------------
  it("shows 'Closed' for a closed day", () => {
    const days = OCTOBER_DAYS.map((day) =>
      day.date === "2026-10-14"
        ? makeDay("2026-10-14", "closed", 0, 0)
        : day,
    );
    render(
      <MonthGrid
        monthStr="2026-10"
        days={days}
        todayStr="2026-10-15"
        onDayClick={() => {}}
      />,
    );
    expect(screen.getByText("Closed")).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // 4. Past day shows "Past"
  // ---------------------------------------------------------------------------
  it("shows 'Past' for a past day with aria-label containing 'Past'", () => {
    const days = OCTOBER_DAYS.map((day) =>
      day.date === "2026-10-01"
        ? makeDay("2026-10-01", "past", 0, 0)
        : day,
    );
    render(
      <MonthGrid
        monthStr="2026-10"
        days={days}
        todayStr="2026-10-15"
        onDayClick={() => {}}
      />,
    );
    // The aria-label for the past day includes "Past"
    const pastButton = screen.getByRole("button", { name: /2026-10-01.*Past/i });
    expect(pastButton).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // 5. Clicking a day calls onDayClick with the correct date
  // ---------------------------------------------------------------------------
  it("calls onDayClick with the correct date when a day is clicked", () => {
    const handler = vi.fn();
    render(
      <MonthGrid
        monthStr="2026-10"
        days={OCTOBER_DAYS}
        todayStr="2026-10-15"
        onDayClick={handler}
      />,
    );
    // Find the button for Oct 12 by aria-label
    const oct12Button = screen.getByRole("button", {
      name: /2026-10-12/,
    });
    fireEvent.click(oct12Button);
    expect(handler).toHaveBeenCalledWith("2026-10-12");
  });

  // ---------------------------------------------------------------------------
  // 6. Today's cell has accent ring class
  // ---------------------------------------------------------------------------
  it("today's cell has ring-accent in its className", () => {
    render(
      <MonthGrid
        monthStr="2026-10"
        days={OCTOBER_DAYS}
        todayStr="2026-10-15"
        onDayClick={() => {}}
      />,
    );
    const todayButton = screen.getByRole("button", {
      name: /2026-10-15.*today/i,
    });
    expect(todayButton.className).toContain("ring-accent");
  });
});
