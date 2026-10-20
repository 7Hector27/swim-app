import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

vi.mock("@/content/CoachDashboardContent/actions", () => ({
  getCoachScheduleAction: vi.fn().mockResolvedValue({ ok: true, items: [] }),
  approveLessonAction: vi.fn().mockResolvedValue({ status: "idle" }),
  declineLessonAction: vi.fn().mockResolvedValue({ status: "idle" }),
}));

import TodayScheduleCard from "../content/CoachDashboardContent/TodayScheduleCard";
import type { CoachScheduleItem } from "@swim-app/shared";
import { getCoachScheduleAction } from "../content/CoachDashboardContent/actions";

const TODAY = "2025-06-01";

// 10:00 AM and 11:00 AM PT on a fixed date (2025-06-01 UTC offsets are PDT = -7h)
const AT_10AM = "2025-06-01T17:00:00.000Z"; // 10:00 AM PDT
const AT_11AM = "2025-06-01T18:00:00.000Z"; // 11:00 AM PDT
const AT_1130AM = "2025-06-01T18:30:00.000Z"; // 11:30 AM PDT

const lessonItem: CoachScheduleItem = {
  type: "lesson",
  householdId: "hh-001",
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
      { swimmerId: "sw-001", firstName: "Morgan", lastName: "Lee", clubName: null },
    ],
    expiresAt: null,
    approvedAt: AT_10AM,
    declinedAt: null,
    declineReason: null,
    movedAt: null,
    previousStartsAt: null,
    createdAt: AT_10AM,
  },
};

const travelItem: CoachScheduleItem = {
  type: "travel_buffer",
  startsAt: AT_11AM,
  endsAt: AT_1130AM,
  fromLocationName: "Egret Park",
  toLocationName: "Riverside Pool",
};

const openSlotItem: CoachScheduleItem = {
  type: "open_slot",
  startsAt: AT_1130AM,
  endsAt: AT_11AM, // intentionally earlier so duration is negative — only "until" time matters here
};

function renderCard(items: CoachScheduleItem[]) {
  render(
    <TodayScheduleCard initialItems={items} today={TODAY} />,
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

  it("renders the Open swimmer link pointing to the swimmer profile", () => {
    renderCard([lessonItem]);
    const link = screen.getByRole("link", { name: "Open swimmer" });
    expect(link).toHaveAttribute("href", "/coach/swimmers/sw-001");
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

describe("TodayScheduleCard — club name in lesson row", () => {
  it("shows swimmer name without parens when clubName is null", () => {
    renderCard([lessonItem]);
    expect(screen.getByText(/Morgan, 60 min/)).toBeInTheDocument();
    expect(screen.queryByText(/Morgan \(/)).toBeNull();
  });

  it("shows club name in parens when clubName is present", () => {
    const withClub: CoachScheduleItem = {
      ...lessonItem,
      lesson: {
        ...lessonItem.lesson,
        swimmers: [{ swimmerId: "sw-001", firstName: "Morgan", lastName: "Lee", clubName: "NCAP" }],
      },
    };
    renderCard([withClub]);
    expect(screen.getByText(/Morgan \(NCAP\)/)).toBeInTheDocument();
  });
});

describe("TodayScheduleCard — approve and decline on pending lesson", () => {
  const pendingItem: CoachScheduleItem = {
    ...lessonItem,
    lesson: {
      ...lessonItem.lesson,
      status: "pending",
      approvedAt: null,
    },
  };

  it("shows Approve and Decline buttons for a pending lesson", () => {
    renderCard([pendingItem]);
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument();
  });

  it("does not show Approve or Decline for an approved lesson", () => {
    renderCard([lessonItem]);
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
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

describe("TodayScheduleCard — stale-response guard", () => {
  beforeEach(() => {
    vi.mocked(getCoachScheduleAction).mockResolvedValue({ ok: true, items: [] });
  });

  it("discards a slow first response when a second navigation finishes first", async () => {
    let resolveFirst!: (v: { ok: true; items: CoachScheduleItem[] }) => void;
    let resolveSecond!: (v: { ok: true; items: CoachScheduleItem[] }) => void;
    const firstPromise = new Promise<{ ok: true; items: CoachScheduleItem[] }>((r) => { resolveFirst = r; });
    const secondPromise = new Promise<{ ok: true; items: CoachScheduleItem[] }>((r) => { resolveSecond = r; });

    vi.mocked(getCoachScheduleAction)
      .mockReturnValueOnce(firstPromise)
      .mockReturnValueOnce(secondPromise);

    renderCard([]);

    fireEvent.click(screen.getByRole("button", { name: "Next day" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous day" }));

    await act(async () => {
      resolveSecond({ ok: true, items: [lessonItem] });
    });
    expect(screen.getByText(/Morgan/)).toBeInTheDocument();

    await act(async () => {
      resolveFirst({ ok: true, items: [] });
    });
    expect(screen.getByText(/Morgan/)).toBeInTheDocument();
  });
});

describe("TodayScheduleCard — fetch error", () => {
  beforeEach(() => {
    vi.mocked(getCoachScheduleAction).mockResolvedValue({ ok: true, items: [] });
  });

  it("shows the error message and Retry button when action returns ok: false", async () => {
    vi.mocked(getCoachScheduleAction).mockResolvedValueOnce({
      ok: false,
      error: "Could not load schedule. Please try again.",
    });
    renderCard([]);
    fireEvent.click(screen.getByRole("button", { name: "Next day" }));
    await waitFor(() => {
      expect(screen.getByText("Could not load schedule. Please try again.")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("Retry re-triggers the navigation and shows updated items", async () => {
    vi.mocked(getCoachScheduleAction)
      .mockResolvedValueOnce({ ok: false, error: "Could not load schedule. Please try again." })
      .mockResolvedValueOnce({ ok: true, items: [lessonItem] });
    renderCard([]);
    fireEvent.click(screen.getByRole("button", { name: "Next day" }));
    await waitFor(() => screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(screen.getByText(/Morgan/)).toBeInTheDocument();
    });
  });
});
