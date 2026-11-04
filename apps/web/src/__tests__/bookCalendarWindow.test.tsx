import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { ParentSwimmer, WeekAvailabilityResponse } from "@swim-app/shared";

import { maxBookableDateLA } from "../content/BookCalendarContent/helpers";
import { maxRecurringWeeksInWindow } from "../content/BookCalendarContent/batchHelpers";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
  if (typeof Element.prototype.scrollIntoView !== "function") {
    Element.prototype.scrollIntoView = vi.fn();
  }
  vi.clearAllMocks();
  mockPreview.mockResolvedValue({
    kind: "ok",
    data: { needsApproval: false, picks: [] },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const { mockFetchRange, mockFetchMonthRange, mockFirstAvail, mockPreview } = vi.hoisted(() => ({
  mockFetchRange: vi.fn(),
  mockFetchMonthRange: vi.fn(),
  mockFirstAvail: vi.fn(),
  mockPreview: vi.fn().mockResolvedValue({
    kind: "ok",
    data: { needsApproval: false, picks: [] },
  }),
}));

vi.mock("../content/BookCalendarContent/actions", () => ({
  fetchRangeAction: mockFetchRange,
  fetchMonthRangeAction: mockFetchMonthRange,
  findFirstAvailableDayAction: mockFirstAvail,
  createBookingAction: vi.fn(),
  previewBatchAction: mockPreview,
  submitBatchAction: vi.fn(),
}));

import BookCalendarContent from "../content/BookCalendarContent";

// ── Pure helpers ────────────────────────────────────────────────────────────

describe("maxBookableDateLA", () => {
  it("returns the Sunday of week N counting the current LA week as week 1", () => {
    // 2026-10-26 Monday 10:00 LA = 2026-10-26T17:00:00Z (PDT, UTC-7).
    // Week 1 = Mon 2026-10-26 → Sun 2026-11-01. Week 2 Sun = 2026-11-08.
    const nowMs = Date.parse("2026-10-26T17:00:00Z");
    expect(maxBookableDateLA(2, nowMs)).toBe("2026-11-08");
  });
});

describe("maxRecurringWeeksInWindow", () => {
  it("caps weeks by the window when the pattern fits", () => {
    // start Mon 2026-11-02, max Sun 2026-11-15 (two full weeks).
    // Pattern [Mon] → firstOffset=0; weeks that fit = 2 (Nov 2, Nov 9).
    expect(
      maxRecurringWeeksInWindow({
        pattern: [{ weekday: 1, timeOfDay: "15:00", durationMinutes: 30, swimmerIds: ["00000000-0000-4000-8000-000000000001"] }],
        startDate: "2026-11-02",
        maxAdvanceDateLA: "2026-11-15",
        maxLessons: 20,
      }),
    ).toBe(2);
  });

  it("caps weeks by the 20-lesson limit when the pattern has many pairs", () => {
    // 5-pair pattern = 5 lessons per week → cap at floor(20/5) = 4 weeks.
    expect(
      maxRecurringWeeksInWindow({
        pattern: [
          { weekday: 1, timeOfDay: "15:00", durationMinutes: 30, swimmerIds: ["00000000-0000-4000-8000-000000000001"] },
          { weekday: 2, timeOfDay: "15:00", durationMinutes: 30, swimmerIds: ["00000000-0000-4000-8000-000000000001"] },
          { weekday: 3, timeOfDay: "15:00", durationMinutes: 30, swimmerIds: ["00000000-0000-4000-8000-000000000001"] },
          { weekday: 4, timeOfDay: "15:00", durationMinutes: 30, swimmerIds: ["00000000-0000-4000-8000-000000000001"] },
          { weekday: 5, timeOfDay: "15:00", durationMinutes: 30, swimmerIds: ["00000000-0000-4000-8000-000000000001"] },
        ],
        startDate: "2026-11-02",
        maxAdvanceDateLA: "2027-02-01",
        maxLessons: 20,
      }),
    ).toBe(4);
  });

  it("accounts for first-week offset when the pattern starts later than the start date", () => {
    // startDate = Mon 2026-11-02, pattern Thu → firstOffset=3 days.
    // maxAdvance = 2026-11-05 (Thu). Week 1 Thu is Nov 5 → fits. Week 2 is Nov 12 → doesn't.
    expect(
      maxRecurringWeeksInWindow({
        pattern: [{ weekday: 4, timeOfDay: "15:00", durationMinutes: 30, swimmerIds: ["00000000-0000-4000-8000-000000000001"] }],
        startDate: "2026-11-02",
        maxAdvanceDateLA: "2026-11-05",
        maxLessons: 20,
      }),
    ).toBe(1);
  });

  it("returns the lesson cap when the pattern is empty", () => {
    expect(
      maxRecurringWeeksInWindow({
        pattern: [],
        startDate: "2026-11-02",
        maxAdvanceDateLA: "2027-02-01",
        maxLessons: 20,
      }),
    ).toBe(20);
  });
});

// ── Integration ─────────────────────────────────────────────────────────────

const HOUSEHOLD_ID = "11111111-1111-1111-1111-111111111111";
const LOCATION_ID = "33333333-3333-3333-3333-333333333333";

const swimmers: ParentSwimmer[] = [
  {
    id: "22222222-2222-2222-2222-222222222222",
    firstName: "Alex",
    lastName: "Smith",
    birthDate: "2016-01-01",
    sex: "female",
    isPublic: false,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    clubs: [],
    currentLeagues: [],
  },
];

const locations = [{ id: LOCATION_ID, name: "Egret Park", isHomePool: true }];

// With bookingMaxAdvanceWeeks=3 and now=2026-10-26T17:00Z (Mon of week 1),
// week 3 ends Sun 2026-11-15. The week of Nov 9-15 is the last fully in-window
// week; the following week (Nov 16-22) is entirely past.
const WEEK_NOV_02: WeekAvailabilityResponse = {
  needsApproval: false,
  maxDailyLessonMinutes: 240,
  bookingMaxAdvanceWeeks: 3,
  bookingMinAdvanceHours: 16,
  days: [
    {
      date: "2026-11-02",
      dayState: "open",
      openCount: 2,
      totalCount: 2,
      teachingWindows: [{ start: "15:00", end: "15:30" }],
      slots: [
        { startsAt: "2026-11-02T23:00:00.000Z", state: "available" },
        { startsAt: "2026-11-02T23:15:00.000Z", state: "available" },
      ],
    },
  ],
};

const WEEK_NOV_09_PARTIAL: WeekAvailabilityResponse = {
  needsApproval: false,
  maxDailyLessonMinutes: 240,
  bookingMaxAdvanceWeeks: 3,
  bookingMinAdvanceHours: 16,
  days: [
    {
      date: "2026-11-09",
      dayState: "open",
      openCount: 1,
      totalCount: 2,
      teachingWindows: [{ start: "15:00", end: "15:30" }],
      slots: [
        { startsAt: "2026-11-09T23:00:00.000Z", state: "available" },
        // Second slot in the same day lands past the LA window end — the
        // server marks it not_open_yet. Mirrors the shape the server emits
        // when a teaching window's late slot slips past the Sunday boundary.
        { startsAt: "2026-11-09T23:15:00.000Z", state: "not_open_yet" },
      ],
    },
  ],
};

async function renderCalendar(firstWeek: WeekAvailabilityResponse) {
  mockFirstAvail.mockResolvedValue({
    firstAvailableDate: firstWeek.days[0]?.date ?? null,
    weekData: firstWeek,
  });
  mockFetchRange.mockResolvedValue(firstWeek);
  const utils = render(
    <BookCalendarContent
      householdId={HOUSEHOLD_ID}
      locations={locations}
      swimmers={swimmers}
      isViewer={false}
    />,
  );
  await screen.findByLabelText(/Next week/i);
  return utils;
}

describe("Booking window — week arrow", () => {
  it("disables the next-week arrow once the following week falls entirely past the window", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T17:00:00Z"));

    // Load week of 2026-11-09 — the Monday of week 3 (last in-window week) for
    // a 3-week window starting Mon 2026-10-26. Next Monday Nov 16 falls past
    // the window end (Sun Nov 15).
    mockFetchRange.mockResolvedValueOnce(WEEK_NOV_09_PARTIAL);
    await renderCalendar(WEEK_NOV_09_PARTIAL);

    const nextBtn = screen.getByLabelText(/Next week/i) as HTMLButtonElement;
    expect(nextBtn.disabled).toBe(true);
  });

  it("keeps the next-week arrow enabled when the next week still has in-window days", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T17:00:00Z"));

    await renderCalendar(WEEK_NOV_02);

    const nextBtn = screen.getByLabelText(/Next week/i) as HTMLButtonElement;
    expect(nextBtn.disabled).toBe(false);
  });

  it("stops week navigation at week 10 for the production bookingMaxAdvanceWeeks", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T17:00:00Z"));
    // Today Mon 2026-10-26 = Mon of week 1. Week 10 Sun = 2027-01-03.
    // Loading the Monday of week 10 (2026-12-28) must leave next-week disabled.
    const WEEK_10_START: WeekAvailabilityResponse = {
      needsApproval: false,
      maxDailyLessonMinutes: 240,
      bookingMaxAdvanceWeeks: 10,
      bookingMinAdvanceHours: 16,
      days: [
        {
          date: "2026-12-28",
          dayState: "open",
          openCount: 1,
          totalCount: 1,
          teachingWindows: [{ start: "15:00", end: "15:30" }],
          slots: [{ startsAt: "2026-12-28T23:00:00.000Z", state: "available" }],
        },
      ],
    };
    mockFetchRange.mockResolvedValueOnce(WEEK_10_START);
    await renderCalendar(WEEK_10_START);

    const nextBtn = screen.getByLabelText(/Next week/i) as HTMLButtonElement;
    expect(nextBtn.disabled).toBe(true);
  });
});

describe("Previous-week arrow", () => {
  it("is disabled when the calendar is on the current LA week and enabled a week later", async () => {
    // 2026-11-02T18:00:00Z is Mon Nov 2 10:00 LA. Today's monday is the
    // same day, so initial currentDate's monday === today's monday.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-02T18:00:00Z"));

    await renderCalendar(WEEK_NOV_02);

    const prevBtn = screen.getByLabelText(/Previous week/i) as HTMLButtonElement;
    expect(prevBtn.disabled).toBe(true);

    // Clicking Next week moves to a future monday. The prev arrow then
    // enables, confirming the disable is scoped to the current week only.
    const nextBtn = screen.getByLabelText(/Next week/i) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(nextBtn);
    });
    await waitFor(() => {
      expect(prevBtn.disabled).toBe(false);
    });
  });

  it("clamps a deep link pointing at a past week to the current week on mount", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-02T18:00:00Z"));

    mockFirstAvail.mockResolvedValue({
      firstAvailableDate: "2026-11-02",
      weekData: WEEK_NOV_02,
    });
    mockFetchRange.mockResolvedValue(WEEK_NOV_02);
    render(
      <BookCalendarContent
        householdId={HOUSEHOLD_ID}
        locations={locations}
        swimmers={swimmers}
        isViewer={false}
        initialDate="2026-09-21"
      />,
    );
    await screen.findByLabelText(/Previous week/i);

    // Even though initialDate pointed at a past week, the week nav shows
    // the current (today's) week range.
    expect(screen.getByText(/Nov 2 \u2013 8, 2026/)).toBeInTheDocument();
    const prevBtn = screen.getByLabelText(/Previous week/i) as HTMLButtonElement;
    expect(prevBtn.disabled).toBe(true);
  });
});

describe("Booking window — slot past window", () => {
  it("renders a slot one day past the window as 'Not open yet' and non-interactive", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T17:00:00Z"));

    await renderCalendar(WEEK_NOV_09_PARTIAL);
    // Wait for the week fetch's available slot to render first — then the
    // not_open_yet slot on the same day is already in the DOM too.
    await screen.findAllByRole("button", { name: /3:00 PM/i });

    // The not_open_yet slot shows the time but is a <div>, not a button.
    const nodes = Array.from(
      document.querySelectorAll('[data-not-open-yet="true"]'),
    ) as HTMLElement[];
    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) {
      expect(node.tagName).toBe("DIV");
      expect(node.getAttribute("title")).toBe("Not open yet");
    }
  });
});

describe("Booking window — recurring stepper", () => {
  it("caps the stepper max at the number of in-window weeks for a pattern starting this week", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T17:00:00Z"));

    await renderCalendar(WEEK_NOV_02);

    fireEvent.click(screen.getByTestId("mode-recurring"));
    // Tap Mon 3:00 PM to build a one-pair pattern starting this week.
    const slots = screen.getAllByRole("button", { name: /3:00 PM/i });
    fireEvent.click(slots[0]!);

    // With bookingMaxAdvanceWeeks=3 and today 2026-10-26 (Mon of week 1),
    // window ends Sun 2026-11-15. Pattern [Mon] from today → Mondays Oct 26,
    // Nov 2, Nov 9 fit; Nov 16 doesn't. Default stepper is 4; the clamp caps
    // it at 3.
    await waitFor(() => {
      expect(screen.getByTestId("recurring-weeks-value").textContent).toContain("3 wks");
    });

    const plusBtn = screen.getByTestId("recurring-weeks-plus") as HTMLButtonElement;
    expect(plusBtn.disabled).toBe(true);
  });
});

describe("Month view — Previous-month arrow", () => {
  it("is disabled on the current LA month and enables after navigating to a future month", async () => {
    // Today Mon Nov 2 2026, 10:00 LA. 52-week window keeps the next-month
    // arrow enabled so we can scrub forward and confirm the prev arrow
    // enables once we leave the current month.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-02T18:00:00Z"));

    const MONTH_NOV: import("@swim-app/shared").MonthAvailabilityResponse = {
      needsApproval: false,
      maxDailyLessonMinutes: 240,
      bookingMaxAdvanceWeeks: 52,
      bookingMinAdvanceHours: 16,
      days: [
        {
          date: "2026-11-02",
          dayState: "open",
          openCount: 1,
          totalCount: 1,
          teachingWindows: [{ start: "15:00", end: "15:30" }],
        },
      ],
    };
    mockFetchMonthRange.mockResolvedValue(MONTH_NOV);

    render(
      <BookCalendarContent
        householdId={HOUSEHOLD_ID}
        locations={locations}
        swimmers={swimmers}
        isViewer={false}
        initialView="month"
      />,
    );
    const prevBtn = (await screen.findByLabelText(/Previous month/i)) as HTMLButtonElement;
    expect(prevBtn.disabled).toBe(true);

    const nextBtn = screen.getByLabelText(/Next month/i) as HTMLButtonElement;
    expect(nextBtn.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(nextBtn);
    });
    await waitFor(() => {
      expect(prevBtn.disabled).toBe(false);
    });
  });

  it("clamps a deep link pointing at a past month to the current month on mount", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-02T18:00:00Z"));

    const MONTH_NOV: import("@swim-app/shared").MonthAvailabilityResponse = {
      needsApproval: false,
      maxDailyLessonMinutes: 240,
      bookingMaxAdvanceWeeks: 52,
      bookingMinAdvanceHours: 16,
      days: [
        {
          date: "2026-11-02",
          dayState: "open",
          openCount: 1,
          totalCount: 1,
          teachingWindows: [{ start: "15:00", end: "15:30" }],
        },
      ],
    };
    mockFetchMonthRange.mockResolvedValue(MONTH_NOV);

    render(
      <BookCalendarContent
        householdId={HOUSEHOLD_ID}
        locations={locations}
        swimmers={swimmers}
        isViewer={false}
        initialView="month"
        initialDate="2026-07-15"
      />,
    );

    // Even though initialDate pointed at a past month, the header shows
    // November 2026 and prev is disabled.
    expect(await screen.findByText(/November 2026/)).toBeInTheDocument();
    const prevBtn = screen.getByLabelText(/Previous month/i) as HTMLButtonElement;
    expect(prevBtn.disabled).toBe(true);
  });
});

describe("Month view — Next-month arrow", () => {
  it("is disabled once the next month has no days inside the booking window", async () => {
    // Today Nov 2 2026, 2-week window → max advance = Nov 16 2026.
    // Dec 1 2026 > max → every day of December is past the window, so
    // the next-month arrow is disabled from November.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-02T18:00:00Z"));

    const MONTH_NOV: import("@swim-app/shared").MonthAvailabilityResponse = {
      needsApproval: false,
      maxDailyLessonMinutes: 240,
      bookingMaxAdvanceWeeks: 2,
      bookingMinAdvanceHours: 16,
      days: [
        {
          date: "2026-11-02",
          dayState: "open",
          openCount: 1,
          totalCount: 1,
          teachingWindows: [{ start: "15:00", end: "15:30" }],
        },
      ],
    };
    mockFetchMonthRange.mockResolvedValue(MONTH_NOV);

    render(
      <BookCalendarContent
        householdId={HOUSEHOLD_ID}
        locations={locations}
        swimmers={swimmers}
        isViewer={false}
        initialView="month"
      />,
    );
    const nextBtn = (await screen.findByLabelText(/Next month/i)) as HTMLButtonElement;
    expect(nextBtn.disabled).toBe(true);
  });
});
