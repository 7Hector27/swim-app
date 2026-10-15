import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("../content/BookCalendarContent/actions", () => ({
  fetchRangeAction: vi.fn().mockResolvedValue(null),
  createBookingAction: vi.fn(),
}));

import * as actions from "../content/BookCalendarContent/actions";

import {
  getMondayOfWeek,
  formatWeekLabel,
  isHourMark,
  buildGridRows,
  isInSelectionSpan,
} from "../content/BookCalendarContent/helpers";
import { lessonPrice, PRICING_ROWS } from "../lib/pricing";
import type { WeekDayAvailability } from "@swim-app/shared";

// ---------------------------------------------------------------------------
// pricing.ts
// ---------------------------------------------------------------------------

describe("lessonPrice", () => {
  it("30 min · 1 swimmer = $60", () => {
    expect(lessonPrice(30, 1)).toBe(60);
  });

  it("45 min · 1 swimmer = $90", () => {
    expect(lessonPrice(45, 1)).toBe(90);
  });

  it("60 min · 1 swimmer = $120", () => {
    expect(lessonPrice(60, 1)).toBe(120);
  });

  it("60 min · 2 swimmers = $180", () => {
    expect(lessonPrice(60, 2)).toBe(180);
  });

  it("PRICING_ROWS has 4 rows", () => {
    expect(PRICING_ROWS).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// helpers.ts
// ---------------------------------------------------------------------------

describe("getMondayOfWeek", () => {
  it("Wednesday returns the Monday of that week", () => {
    expect(getMondayOfWeek("2026-10-14")).toBe("2026-10-12");
  });

  it("Monday returns itself", () => {
    expect(getMondayOfWeek("2026-10-12")).toBe("2026-10-12");
  });

  it("Sunday returns the Monday of the same ISO week", () => {
    expect(getMondayOfWeek("2026-10-18")).toBe("2026-10-12");
  });
});

describe("formatWeekLabel", () => {
  it("formats a week range correctly", () => {
    expect(formatWeekLabel("2026-10-12")).toBe("Oct 12 \u2013 18, 2026");
  });
});

describe("isHourMark", () => {
  it("returns true for xx:00", () => {
    expect(isHourMark("16:00")).toBe(true);
  });

  it("returns false for xx:15", () => {
    expect(isHourMark("16:15")).toBe(false);
  });
});

describe("buildGridRows", () => {
  it("returns empty array when no days", () => {
    expect(buildGridRows([])).toEqual([]);
  });

  it("returns 15-min slots within a teaching window", () => {
    const day: WeekDayAvailability = {
      date: "2026-10-12",
      dayState: "open",
      openCount: 4,
      totalCount: 4,
      teachingWindows: [{ start: "16:00", end: "17:00" }],
      slots: [],
    };
    expect(buildGridRows([day])).toEqual(["16:00", "16:15", "16:30", "16:45"]);
  });
});

describe("isInSelectionSpan", () => {
  it("start of span is included", () => {
    expect(isInSelectionSpan("16:15", "16:15", 30)).toBe(true);
  });

  it("middle of span is included", () => {
    expect(isInSelectionSpan("16:30", "16:15", 30)).toBe(true);
  });

  it("exclusive end is not included", () => {
    expect(isInSelectionSpan("16:45", "16:15", 30)).toBe(false);
  });

  it("before span is not included", () => {
    expect(isInSelectionSpan("16:00", "16:15", 30)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BottomBar
// ---------------------------------------------------------------------------

import BottomBar from "../content/BookCalendarContent/BottomBar";

describe("BottomBar", () => {
  const noop = () => {};

  it("shows 'No time picked yet' and disabled button when no selection", () => {
    render(
      <BottomBar
        selectedStartsAt={null}
        tooSoon={false}
        durationMinutes={30}
        swimmerIds={[]}
        needsApproval={false}
        onConfirm={noop}
        isConfirming={false}
        errorMessage={null}
      />,
    );
    expect(screen.getByText("No time picked yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /book lesson/i })).toBeDisabled();
  });

  it("shows too-soon message and disabled button when tooSoon=true", () => {
    render(
      <BottomBar
        selectedStartsAt={null}
        tooSoon={true}
        durationMinutes={30}
        swimmerIds={[]}
        needsApproval={false}
        onConfirm={noop}
        isConfirming={false}
        errorMessage={null}
      />,
    );
    expect(screen.getByText(/Less than 16 hours away/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /book lesson/i })).toBeDisabled();
  });

  it("shows formatted time but disabled button when selection + no swimmers", () => {
    render(
      <BottomBar
        selectedStartsAt="2026-10-14T23:15:00.000Z"
        tooSoon={false}
        durationMinutes={30}
        swimmerIds={[]}
        needsApproval={false}
        onConfirm={noop}
        isConfirming={false}
        errorMessage={null}
      />,
    );
    expect(screen.getByRole("button", { name: /book lesson/i })).toBeDisabled();
  });

  it("shows price and enabled button when selection + swimmers", () => {
    render(
      <BottomBar
        selectedStartsAt="2026-10-14T23:15:00.000Z"
        tooSoon={false}
        durationMinutes={30}
        swimmerIds={["s-1"]}
        needsApproval={false}
        onConfirm={noop}
        isConfirming={false}
        errorMessage={null}
      />,
    );
    expect(screen.getByText("$60")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /book lesson/i })).not.toBeDisabled();
  });

  it("shows day and date in time label when selection present", () => {
    // 2026-10-12T23:00:00.000Z = Mon Oct 12 4:00 PM PDT
    render(
      <BottomBar
        selectedStartsAt="2026-10-12T23:00:00.000Z"
        tooSoon={false}
        durationMinutes={60}
        swimmerIds={["s-1"]}
        needsApproval={false}
        onConfirm={noop}
        isConfirming={false}
        errorMessage={null}
      />,
    );
    expect(screen.getByText(/Mon/)).toBeInTheDocument();
    expect(screen.getByText(/Oct 12/)).toBeInTheDocument();
  });

  it("shows 'Jason will confirm' when needsApproval=true and selection present", () => {
    render(
      <BottomBar
        selectedStartsAt="2026-10-14T23:15:00.000Z"
        tooSoon={false}
        durationMinutes={30}
        swimmerIds={["s-1"]}
        needsApproval={true}
        onConfirm={noop}
        isConfirming={false}
        errorMessage={null}
      />,
    );
    expect(screen.getByText(/Jason will confirm/)).toBeInTheDocument();
  });

  it("button is disabled and shows pending label while isConfirming=true", () => {
    render(
      <BottomBar
        selectedStartsAt="2026-10-14T23:15:00.000Z"
        tooSoon={false}
        durationMinutes={30}
        swimmerIds={["s-1"]}
        needsApproval={false}
        onConfirm={noop}
        isConfirming={true}
        errorMessage={null}
      />,
    );
    const btn = screen.getByRole("button", { name: /booking/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent("Booking…");
  });

  it("does not show 'Jason will confirm' when needsApproval=false", () => {
    render(
      <BottomBar
        selectedStartsAt="2026-10-14T23:15:00.000Z"
        tooSoon={false}
        durationMinutes={30}
        swimmerIds={["s-1"]}
        needsApproval={false}
        onConfirm={noop}
        isConfirming={false}
        errorMessage={null}
      />,
    );
    expect(screen.queryByText(/Jason will confirm/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// WeekGrid
// ---------------------------------------------------------------------------

import WeekGrid from "../content/BookCalendarContent/WeekGrid";

function makeDay(
  date: string,
  overrides: Partial<WeekDayAvailability> = {},
): WeekDayAvailability {
  return {
    date,
    dayState: "open",
    openCount: 1,
    totalCount: 1,
    teachingWindows: [{ start: "16:00", end: "16:15" }],
    slots: [
      {
        startsAt: `${date}T23:00:00.000Z`,
        state: "available",
      },
    ],
    ...overrides,
  };
}

const SEVEN_DAYS = [
  "2026-10-12",
  "2026-10-13",
  "2026-10-14",
  "2026-10-15",
  "2026-10-16",
  "2026-10-17",
  "2026-10-18",
].map((date, index) =>
  index === 0 ? makeDay(date) : makeDay(date, { dayState: "closed", openCount: 0, totalCount: 0, teachingWindows: [], slots: [] }),
);

describe("WeekGrid", () => {
  it("renders available slot as a button", () => {
    render(
      <WeekGrid
        days={SEVEN_DAYS}
        durationMinutes={30}
        selectedStartsAt={null}
        todayStr="2026-10-14"
        onSlotClick={() => {}}
      />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("no cell has a title attribute", () => {
    const { container } = render(
      <WeekGrid
        days={SEVEN_DAYS}
        durationMinutes={30}
        selectedStartsAt={null}
        todayStr="2026-10-14"
        onSlotClick={() => {}}
      />,
    );
    const withTitle = container.querySelectorAll("[title]");
    expect(withTitle).toHaveLength(0);
  });

  it("clicking available slot calls onSlotClick", () => {
    const handler = vi.fn();
    render(
      <WeekGrid
        days={SEVEN_DAYS}
        durationMinutes={30}
        selectedStartsAt={null}
        todayStr="2026-10-14"
        onSlotClick={handler}
      />,
    );
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[0]!);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("selected slot has aria-pressed=true", () => {
    const selectedIso = "2026-10-12T23:00:00.000Z";
    render(
      <WeekGrid
        days={SEVEN_DAYS}
        durationMinutes={30}
        selectedStartsAt={selectedIso}
        todayStr="2026-10-14"
        onSlotClick={() => {}}
      />,
    );
    const pressed = screen.getAllByRole("button").filter(
      (btn) => btn.getAttribute("aria-pressed") === "true",
    );
    expect(pressed.length).toBeGreaterThan(0);
  });

  it("picking Monday slot does not highlight the same clock time on other days", () => {
    // Mon and Tue both have a slot at 23:00 UTC (same LA clock time, different dates)
    const monSlot = "2026-10-12T23:00:00.000Z";
    const tueSlot = "2026-10-13T23:00:00.000Z";
    const twoDays = [
      makeDay("2026-10-12", { teachingWindows: [{ start: "16:00", end: "17:00" }], slots: [{ startsAt: monSlot, state: "available" }] }),
      makeDay("2026-10-13", { teachingWindows: [{ start: "16:00", end: "17:00" }], slots: [{ startsAt: tueSlot, state: "available" }] }),
      ...["2026-10-14","2026-10-15","2026-10-16","2026-10-17","2026-10-18"].map((d) =>
        makeDay(d, { dayState: "closed", openCount: 0, totalCount: 0, teachingWindows: [], slots: [] }),
      ),
    ];
    render(
      <WeekGrid
        days={twoDays}
        durationMinutes={60}
        selectedStartsAt={monSlot}
        todayStr="2026-10-14"
        onSlotClick={() => {}}
      />,
    );
    const pressed = screen.getAllByRole("button").filter(
      (btn) => btn.getAttribute("aria-pressed") === "true",
    );
    // Only Monday's slot should be pressed, not Tuesday's
    expect(pressed).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// CalendarConfigRow
// ---------------------------------------------------------------------------

import CalendarConfigRow from "../content/BookCalendarContent/CalendarConfigRow";

const LOCATIONS = [
  { id: "loc-1", name: "Sunset Pool", isHomePool: true },
  { id: "loc-2", name: "Oak Park Pool", isHomePool: false },
];
const SWIMMERS = [
  {
    id: "s-1",
    firstName: "Maya",
    lastName: "Smith",
    birthDate: "2015-03-10",
    sex: "female" as const,
    isPublic: false,
    publicConsentAt: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    clubs: [],
    currentLeagues: [] as ("club" | "summer_league")[],
  },
  {
    id: "s-2",
    firstName: "Kai",
    lastName: "Smith",
    birthDate: "2017-06-22",
    sex: "male" as const,
    isPublic: false,
    publicConsentAt: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    clubs: [],
    currentLeagues: [] as ("club" | "summer_league")[],
  },
];

describe("CalendarConfigRow", () => {
  it("renders all location names when multiple locations", () => {
    render(
      <CalendarConfigRow
        locations={LOCATIONS}
        swimmers={SWIMMERS}
        locationId="loc-1"
        durationMinutes={30}
        swimmerIds={[]}
        isLoading={false}
        onLocationChange={() => {}}
        onDurationChange={() => {}}
        onSwimmersChange={() => {}}
      />,
    );
    expect(screen.getByText("Sunset Pool")).toBeInTheDocument();
    expect(screen.getByText("Oak Park Pool")).toBeInTheDocument();
  });

  it("renders all swimmer names", () => {
    render(
      <CalendarConfigRow
        locations={LOCATIONS}
        swimmers={SWIMMERS}
        locationId="loc-1"
        durationMinutes={30}
        swimmerIds={[]}
        isLoading={false}
        onLocationChange={() => {}}
        onDurationChange={() => {}}
        onSwimmersChange={() => {}}
      />,
    );
    expect(screen.getByText("Maya Smith")).toBeInTheDocument();
    expect(screen.getByText("Kai Smith")).toBeInTheDocument();
  });

  it("calls onDurationChange when duration button clicked", () => {
    const handler = vi.fn();
    render(
      <CalendarConfigRow
        locations={LOCATIONS}
        swimmers={SWIMMERS}
        locationId="loc-1"
        durationMinutes={30}
        swimmerIds={[]}
        isLoading={false}
        onLocationChange={() => {}}
        onDurationChange={handler}
        onSwimmersChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "45 min" }));
    expect(handler).toHaveBeenCalledWith(45);
  });

  it("duration buttons are disabled when isLoading=true", () => {
    render(
      <CalendarConfigRow
        locations={LOCATIONS}
        swimmers={SWIMMERS}
        locationId="loc-1"
        durationMinutes={30}
        swimmerIds={[]}
        isLoading={true}
        onLocationChange={() => {}}
        onDurationChange={() => {}}
        onSwimmersChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "30 min" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "45 min" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "60 min" })).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// BookCalendarContent
// ---------------------------------------------------------------------------

import BookCalendarContent from "../content/BookCalendarContent/BookCalendarContent";

describe("BookCalendarContent", () => {
  beforeEach(() => {
    vi.mocked(actions.fetchRangeAction).mockResolvedValue(null);
  });

  it("calls fetchRangeAction without swimmers when rendered with no swimmerIds", async () => {
    await act(async () => {
      render(
        <BookCalendarContent
          locations={LOCATIONS}
          swimmers={[]}
          isViewer={false}
        />,
      );
    });
    expect(actions.fetchRangeAction).toHaveBeenCalledWith(
      expect.objectContaining({ locationId: "loc-1" }),
    );
  });

  it("shows viewer message when isViewer=true", async () => {
    await act(async () => {
      render(
        <BookCalendarContent
          locations={LOCATIONS}
          swimmers={SWIMMERS}
          isViewer={true}
        />,
      );
    });
    expect(
      screen.getByText(/Booking is for household owners and managers/),
    ).toBeInTheDocument();
  });

  it("shows no-pools message when locations=[]", () => {
    render(
      <BookCalendarContent
        locations={[]}
        swimmers={SWIMMERS}
        isViewer={false}
      />,
    );
    expect(screen.getByText(/No pools configured/)).toBeInTheDocument();
  });
});
