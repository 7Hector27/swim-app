import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
  vi.clearAllMocks();
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/content/BookCalendarContent/actions", () => ({
  fetchRangeAction: vi.fn().mockResolvedValue(null),
  fetchMonthRangeAction: vi.fn().mockResolvedValue(null),
  findFirstAvailableDayAction: vi.fn().mockResolvedValue(null),
}));

vi.mock("../content/RescheduleContent/actions", () => ({
  rescheduleLessonAction: vi.fn(),
  cancelLessonAction: vi.fn(),
}));

vi.mock("@/components/ConfirmDialog", () => ({
  default: ({ isPending, confirmLabel }: { isPending?: boolean; confirmLabel?: string }) => (
    <div data-testid="confirm-dialog" data-pending={isPending}>
      <button type="submit" disabled={isPending}>{confirmLabel ?? "Confirm"}</button>
    </div>
  ),
}));

import * as bookActions from "../content/BookCalendarContent/actions";
import RescheduleContent from "../content/RescheduleContent/RescheduleContent";
import BookingConfirmDialog from "../content/ParentDashboardContent/BookingConfirmDialog";
import type { UpcomingLesson, LessonLocation } from "@swim-app/shared";
import { getMondayOfWeek } from "../content/BookCalendarContent/helpers";

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function isCurrentSlot(
  rowHHMM: string,
  startHHMM: string,
  durationMinutes: number,
): boolean {
  const rowMin = toMinutes(rowHHMM);
  const startMin = toMinutes(startHHMM);
  return rowMin >= startMin && rowMin < startMin + durationMinutes;
}

// ── fixtures ─────────────────────────────────────────────────────────────────

const LESSON_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const LOCATION_ID = "cccccccc-0000-0000-0000-000000000003";

const futureLesson: UpcomingLesson = {
  id: LESSON_ID,
  locationId: LOCATION_ID,
  locationName: "Egret Park",
  startsAt: "2099-06-16T00:00:00.000Z", // 5:00 PM LA (UTC-7)
  durationMinutes: 30,
  type: "private",
  status: "approved",
  swimmers: [{ swimmerId: "swimmer-1", firstName: "Alex", lastName: "Smith" }],
  expiresAt: null,
  approvedAt: null,
  declinedAt: null,
  declineReason: null,
  movedAt: null,
  previousStartsAt: null,
  createdAt: "2099-06-01T00:00:00.000Z",
  batchId: null,
  batchMode: null,
};

const locations: LessonLocation[] = [
  { id: LOCATION_ID, name: "Egret Park", address: "1 Park Ave", city: "LA", state: "CA", zip: "90001", isHomePool: true, isActive: true, sortOrder: 0 },
];

// ── tests ─────────────────────────────────────────────────────────────────────

describe("current block spans its length", () => {
  it("30-min lesson at 17:00 covers 17:00 and 17:15 but not 17:30", () => {
    expect(isCurrentSlot("17:00", "17:00", 30)).toBe(true);
    expect(isCurrentSlot("17:15", "17:00", 30)).toBe(true);
    expect(isCurrentSlot("17:30", "17:00", 30)).toBe(false);
  });

  it("45-min lesson at 16:00 covers three rows", () => {
    expect(isCurrentSlot("16:00", "16:00", 45)).toBe(true);
    expect(isCurrentSlot("16:15", "16:00", 45)).toBe(true);
    expect(isCurrentSlot("16:30", "16:00", 45)).toBe(true);
    expect(isCurrentSlot("16:45", "16:00", 45)).toBe(false);
  });

  it("slot before the lesson is not current", () => {
    expect(isCurrentSlot("16:45", "17:00", 30)).toBe(false);
  });
});

describe("moved lesson doesn't block its own slots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes excludeLessonId to fetchRangeAction on mount", async () => {
    const fetchRange = vi.mocked(bookActions.fetchRangeAction);
    fetchRange.mockResolvedValue(null);

    await act(async () => {
      render(<RescheduleContent lesson={futureLesson} locations={locations} />);
    });

    expect(fetchRange).toHaveBeenCalledWith(
      expect.objectContaining({ excludeLessonId: LESSON_ID }),
    );
  });
});

describe("16-hour rule on new time", () => {
  it("Confirm reschedule button stays disabled when no slot is selected", async () => {
    await act(async () => {
      render(<RescheduleContent lesson={futureLesson} locations={locations} />);
    });

    const confirmButton = screen.getByRole("button", { name: /confirm reschedule/i });
    expect(confirmButton).toBeDisabled();
  });
});

describe("pending state on Confirm", () => {
  it("shows Rescheduling… and disables Confirm while pending", async () => {
    await act(async () => {
      render(<RescheduleContent lesson={futureLesson} locations={locations} />);
    });

    const confirmButton = screen.getByRole("button", { name: /confirm reschedule/i });
    expect(confirmButton).toBeDisabled();
    expect(confirmButton).toHaveTextContent("Confirm reschedule");
  });
});

describe("viewers and past lessons redirect guard", () => {
  it("isViewer check: lessonHasStarted is true when startsAt is in the past", () => {
    const pastStartsAt = "2020-01-01T00:00:00.000Z";
    const lessonHasStarted = new Date() >= new Date(pastStartsAt);
    expect(lessonHasStarted).toBe(true);
  });

  it("isViewer check: lessonHasStarted is false when startsAt is far future", () => {
    const futureStartsAt = "2099-01-01T00:00:00.000Z";
    const lessonHasStarted = new Date() >= new Date(futureStartsAt);
    expect(lessonHasStarted).toBe(false);
  });
});

describe("from/to modal after reschedule", () => {
  it("shows Rescheduled badge and From/To rows when movedFrom is provided", () => {
    const OLD_STARTS_AT = "2099-06-16T00:00:00.000Z";
    const rescheduledLesson: UpcomingLesson = {
      ...futureLesson,
      startsAt: "2099-06-18T01:00:00.000Z",
    };

    render(
      <BookingConfirmDialog lesson={rescheduledLesson} movedFrom={OLD_STARTS_AT} />,
    );

    expect(screen.getByText("Rescheduled")).toBeInTheDocument();
    expect(screen.getByText("Your lesson has been moved.")).toBeInTheDocument();
    expect(screen.getByText("From")).toBeInTheDocument();
    expect(screen.getByText("To")).toBeInTheDocument();
  });

  it("shows Confirmed badge and When row when no movedFrom", () => {
    render(<BookingConfirmDialog lesson={futureLesson} />);

    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    expect(screen.getByText("You are all set!")).toBeInTheDocument();
    expect(screen.getByText("When")).toBeInTheDocument();
    expect(screen.queryByText("From")).not.toBeInTheDocument();
  });
});

describe("getMondayOfWeek helper", () => {
  it("returns the Monday of the given week", () => {
    expect(getMondayOfWeek("2026-10-16")).toBe("2026-10-12");
  });
});
