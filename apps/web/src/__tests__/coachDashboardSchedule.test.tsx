import { vi, describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/api/lessons", () => ({
  fetchCoachSchedule: vi.fn(),
}));

import TodayScheduleCard from "../content/CoachDashboardContent/TodayScheduleCard";
import type { ScheduleItem } from "@swim-app/shared";

const TODAY = "2025-06-01";
const ACCESS_TOKEN = "test-token";

// 10:00 AM and 11:00 AM PT on a fixed date (2025-06-01 UTC offsets are PDT = -7h)
const AT_10AM = "2025-06-01T17:00:00.000Z"; // 10:00 AM PDT
const AT_11AM = "2025-06-01T18:00:00.000Z"; // 11:00 AM PDT
const AT_1130AM = "2025-06-01T18:30:00.000Z"; // 11:30 AM PDT

const lessonItem: ScheduleItem = {
  type: "lesson",
  locationName: "Egret Park",
  lesson: {
    id: "lesson-001",
    householdId: "hh-001",
    locationId: "loc-001",
    startsAt: AT_10AM,
    durationMinutes: 60,
    type: "private",
    status: "approved",
    swimmers: [
      { swimmerId: "sw-001", firstName: "Morgan", lastName: "Lee" },
    ],
    expiresAt: null,
    approvedAt: AT_10AM,
    declinedAt: null,
    declineReason: null,
    createdAt: AT_10AM,
  },
};

const travelItem: ScheduleItem = {
  type: "travel_buffer",
  startsAt: AT_11AM,
  endsAt: AT_1130AM,
  fromLocationName: "Egret Park",
  toLocationName: "Riverside Pool",
};

const openSlotItem: ScheduleItem = {
  type: "open_slot",
  startsAt: AT_1130AM,
  endsAt: AT_11AM, // intentionally earlier so duration is negative — only "until" time matters here
};

function renderCard(items: ScheduleItem[]) {
  render(
    <TodayScheduleCard initialItems={items} today={TODAY} accessToken={ACCESS_TOKEN} />,
  );
}

describe("TodayScheduleCard — empty state", () => {
  it("shows a no-lessons message when items list is empty", () => {
    renderCard([]);
    expect(screen.getByText("No lessons scheduled.")).toBeInTheDocument();
  });
});

describe("TodayScheduleCard — day navigation", () => {
  it("shows Today label on initial render", () => {
    renderCard([]);
    expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();
  });

  it("renders prev and next day buttons", () => {
    renderCard([]);
    expect(screen.getByRole("button", { name: "Previous day" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next day" })).toBeInTheDocument();
  });

  it("Full schedule link includes the current date", () => {
    renderCard([]);
    const link = screen.getByRole("link", { name: "Full schedule" });
    expect(link).toHaveAttribute("href", `/coach/schedule?date=${TODAY}`);
  });
});

describe("TodayScheduleCard — lesson row (phone layout)", () => {
  it("renders the swimmer name", () => {
    renderCard([lessonItem]);
    expect(screen.getByText(/Morgan/)).toBeInTheDocument();
  });

  it("renders the lesson duration", () => {
    renderCard([lessonItem]);
    expect(screen.getByText(/60 min/)).toBeInTheDocument();
  });

  it("renders the lesson type and pool", () => {
    renderCard([lessonItem]);
    expect(screen.getByText(/Private lesson/)).toBeInTheDocument();
    expect(screen.getByText(/Egret Park/)).toBeInTheDocument();
  });

  it("renders the Open swimmer button", () => {
    renderCard([lessonItem]);
    expect(screen.getByRole("button", { name: "Open swimmer" })).toBeInTheDocument();
  });

  it("time is rendered as a separate element from the lesson detail", () => {
    renderCard([lessonItem]);
    const timeEl = screen.getByText("10:00 AM");
    const nameEl = screen.getByText(/Morgan.*60 min/);
    expect(timeEl).not.toBe(nameEl);
  });
});

describe("TodayScheduleCard — travel buffer row", () => {
  it("renders travel buffer with duration", () => {
    renderCard([travelItem]);
    expect(screen.getByText(/Travel buffer, 30 min/)).toBeInTheDocument();
  });

  it("renders the not-bookable note", () => {
    renderCard([travelItem]);
    expect(screen.getByText(/Blocked automatically/)).toBeInTheDocument();
  });

  it("renders the time on its own", () => {
    renderCard([travelItem]);
    expect(screen.getByText("11:00 AM")).toBeInTheDocument();
  });
});

describe("TodayScheduleCard — open slot row", () => {
  it("renders the open-until text", () => {
    renderCard([openSlotItem]);
    expect(screen.getByText(/Open until/)).toBeInTheDocument();
  });
});

describe("TodayScheduleCard — mixed schedule", () => {
  it("renders all three row types together", () => {
    renderCard([lessonItem, travelItem, openSlotItem]);
    expect(screen.getByText(/Morgan/)).toBeInTheDocument();
    expect(screen.getByText(/Travel buffer/)).toBeInTheDocument();
    expect(screen.getByText(/Open until/)).toBeInTheDocument();
  });
});
