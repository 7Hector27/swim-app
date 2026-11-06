import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

vi.mock("@/content/CoachDashboardContent/actions", () => ({
  getCoachScheduleAction: vi.fn().mockResolvedValue({ ok: true, items: [] }),
}));
vi.mock("@/components/CoachLessonRow/actions", () => ({
  approveLessonAction: vi.fn().mockResolvedValue({ status: "idle" }),
  declineLessonAction: vi.fn().mockResolvedValue({ status: "idle" }),
}));
import TodayScheduleCard from "../content/CoachDashboardContent/TodayScheduleCard";
import DashboardLessonRow from "../content/CoachDashboardContent/DashboardLessonRow";
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

describe("TodayScheduleCard — lesson row", () => {
  it("renders the swimmer name", () => {
    renderCard([lessonItem]);
    expect(screen.getByText("Morgan")).toBeInTheDocument();
  });

  it("renders the pool name", () => {
    renderCard([lessonItem]);
    expect(screen.getByText(/Egret Park/)).toBeInTheDocument();
  });

  it("renders the Open lesson link pointing to the lesson page", () => {
    renderCard([lessonItem]);
    const link = screen.getByRole("link", { name: "Open lesson" });
    expect(link).toHaveAttribute("href", "/coach/lessons/lesson-001");
  });

  it("time is rendered as a separate element from the swimmer name", () => {
    renderCard([lessonItem]);
    const timeEl = screen.getByText("10:00 AM");
    const nameEl = screen.getByText("Morgan");
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

describe("TodayScheduleCard — club name", () => {
  it("does not show club name even when swimmer has one", () => {
    const withClub: CoachScheduleItem = {
      ...lessonItem,
      lesson: {
        ...lessonItem.lesson,
        swimmers: [{ swimmerId: "sw-001", firstName: "Morgan", lastName: "Lee", clubName: "NCAP" }],
      },
    };
    renderCard([withClub]);
    expect(screen.queryByText("NCAP")).toBeNull();
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
  it("renders lessons and travel buffers, suppresses open slots", () => {
    renderCard([lessonItem, travelItem, openSlotItem]);
    expect(screen.getByText("Morgan")).toBeInTheDocument();
    expect(screen.getByText(/Travel buffer/)).toBeInTheDocument();
    expect(screen.queryByText(/Open until/)).toBeNull();
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
    expect(screen.getByText("Morgan")).toBeInTheDocument();

    await act(async () => {
      resolveFirst({ ok: true, items: [] });
    });
    expect(screen.getByText("Morgan")).toBeInTheDocument();
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
      expect(screen.getByText("Morgan")).toBeInTheDocument();
    });
  });
});

describe("DashboardLessonRow — in-progress state", () => {
  // AT_10AM lesson runs 10:00 AM–11:00 AM PDT; grace period ends 11:15 AM PDT
  const nowInProgress = new Date("2025-06-01T17:30:00.000Z").getTime(); // 10:30 AM PDT
  const nowAfterGrace = new Date("2025-06-01T18:16:00.000Z").getTime(); // 11:16 AM PDT

  it("shows Now badge when lesson is in progress", () => {
    render(<DashboardLessonRow item={lessonItem} now={nowInProgress} />);
    expect(screen.getByText("Now")).toBeInTheDocument();
  });

  it("shows Evaluate link for each swimmer when in progress", () => {
    render(<DashboardLessonRow item={lessonItem} now={nowInProgress} />);
    expect(screen.getByRole("link", { name: "Evaluate Morgan" })).toBeInTheDocument();
  });

  it("does not show Now badge after the 15-minute grace period ends", () => {
    render(<DashboardLessonRow item={lessonItem} now={nowAfterGrace} />);
    expect(screen.queryByText("Now")).toBeNull();
  });

  it("does not show Now badge when now is null (SSR)", () => {
    render(<DashboardLessonRow item={lessonItem} now={null} />);
    expect(screen.queryByText("Now")).toBeNull();
  });

  it("does not show Evaluate links when now is null", () => {
    render(<DashboardLessonRow item={lessonItem} now={null} />);
    expect(screen.queryByRole("link", { name: "Evaluate Morgan" })).toBeNull();
  });
});

describe("DashboardLessonRow — anonymized (deleted-family) row", () => {
  // Household deletion leaves future rows at status='canceled' with
  // swimmers=[] and anonymizedAt set. The today-card must show
  // "Deleted family" and skip the Now badge + Evaluate affordances
  // even if the lesson's time window is currently active.
  const ANONYMIZED_AT = "2025-05-28T00:00:00.000Z";
  const nowInProgress = new Date("2025-06-01T17:30:00.000Z").getTime();
  const anonymizedItem: CoachScheduleItem = {
    ...lessonItem,
    householdName: "Deleted family",
    locationName: "Home pool",
    lesson: {
      ...lessonItem.lesson,
      status: "canceled",
      swimmers: [],
      anonymizedAt: ANONYMIZED_AT,
      locationSnapshot: "Home pool",
      swimmerCount: 1,
    },
  };

  it("renders 'Deleted family' in place of the swimmer list", () => {
    render(<DashboardLessonRow item={anonymizedItem} now={nowInProgress} />);
    expect(screen.getByText("Deleted family")).toBeInTheDocument();
    expect(screen.queryByText("No swimmers")).toBeNull();
  });

  it("does not show the Now badge for an anonymized row", () => {
    render(<DashboardLessonRow item={anonymizedItem} now={nowInProgress} />);
    expect(screen.queryByText("Now")).toBeNull();
  });

  it("does not show Evaluate links for an anonymized row", () => {
    render(<DashboardLessonRow item={anonymizedItem} now={nowInProgress} />);
    expect(screen.queryByRole("link", { name: /^Evaluate / })).toBeNull();
  });
});
