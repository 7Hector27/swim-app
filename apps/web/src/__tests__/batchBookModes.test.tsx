import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

import type { ParentSwimmer } from "@swim-app/shared";

// Freeze "now" to a point before every slot in the fixture (which sits
// on 2026-11-02 and later). Without this, the real wall clock creeps
// toward the fixture week, interacts with maxBookableDateLA(Date.now())
// inside BookCalendarContent, and shifts classifyBatchPick's past-slot
// cutoff between runs — a classic nondeterminism source. Only Date is
// faked so testing-library's waitFor keeps running real setTimeout
// (the preview debounce still fires naturally).
const FROZEN_NOW = new Date("2026-10-20T18:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FROZEN_NOW);
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
  // Default preview resolution so a test that never customizes the mock
  // (e.g., the taken-by-picks tests, which only read client-side
  // classification state) does not crash when the 350ms debounced
  // previewBatchAction fires and `await mock()` returns `undefined`.
  // The `.kind === "ok"` branch takes an empty picks array, so no
  // flagged state leaks into the DOM.
  mockPreview.mockResolvedValue({
    kind: "ok",
    data: { picks: [], needsApproval: false, holdId: null },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const { mockFetchRange, mockFirstAvail, mockPreview, mockSubmit } = vi.hoisted(() => ({
  mockFetchRange: vi.fn(),
  mockFirstAvail: vi.fn(),
  mockPreview: vi.fn(),
  mockSubmit: vi.fn(),
}));

vi.mock("../content/BookCalendarContent/actions", () => ({
  fetchRangeAction: mockFetchRange,
  fetchMonthRangeAction: vi.fn(),
  findFirstAvailableDayAction: mockFirstAvail,
  createBookingAction: vi.fn(),
  previewBatchAction: mockPreview,
  submitBatchAction: mockSubmit,
}));

import BookCalendarContent from "../content/BookCalendarContent";

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

// 2026-11-02 (Mon) 3:00 PM PST = 2026-11-02T23:00:00Z
// 2026-11-02 (Mon) 3:15 PM PST = 2026-11-02T23:15:00Z
// 2026-11-02 (Mon) 3:30 PM PST = 2026-11-02T23:30:00Z
// 2026-11-02 (Mon) 3:45 PM PST = 2026-11-02T23:45:00Z
// 2026-11-02 (Mon) 4:00 PM PST = 2026-11-03T00:00:00Z
// 2026-11-04 (Wed) 3:00 PM PST = 2026-11-04T23:00:00Z
// 2026-11-09 (Mon) 3:00 PM PST = 2026-11-09T23:00:00Z
// 2026-11-11 (Wed) 3:00 PM PST = 2026-11-11T23:00:00Z
const WEEK_DATA = {
  needsApproval: false,
  maxDailyLessonMinutes: 240,
  bookingMaxAdvanceWeeks: 52,
  days: [
    {
      date: "2026-11-02",
      dayState: "open" as const,
      openCount: 5,
      totalCount: 5,
      teachingWindows: [{ start: "15:00", end: "17:00" }],
      slots: [
        { startsAt: "2026-11-02T23:00:00.000Z", state: "available" as const },
        { startsAt: "2026-11-02T23:15:00.000Z", state: "available" as const },
        { startsAt: "2026-11-02T23:30:00.000Z", state: "available" as const },
        { startsAt: "2026-11-02T23:45:00.000Z", state: "available" as const },
        { startsAt: "2026-11-03T00:00:00.000Z", state: "available" as const },
      ],
    },
    {
      date: "2026-11-04",
      dayState: "open" as const,
      openCount: 1,
      totalCount: 1,
      teachingWindows: [{ start: "15:00", end: "17:00" }],
      slots: [{ startsAt: "2026-11-04T23:00:00.000Z", state: "available" as const }],
    },
    {
      date: "2026-11-09",
      dayState: "open" as const,
      openCount: 1,
      totalCount: 1,
      teachingWindows: [{ start: "15:00", end: "17:00" }],
      slots: [{ startsAt: "2026-11-09T23:00:00.000Z", state: "available" as const }],
    },
    {
      date: "2026-11-11",
      dayState: "open" as const,
      openCount: 1,
      totalCount: 1,
      teachingWindows: [{ start: "15:00", end: "17:00" }],
      slots: [{ startsAt: "2026-11-11T23:00:00.000Z", state: "available" as const }],
    },
  ],
};

async function renderCalendar() {
  mockFirstAvail.mockResolvedValue({
    firstAvailableDate: "2026-11-02",
    weekData: WEEK_DATA,
  });
  mockFetchRange.mockResolvedValue(WEEK_DATA);
  const utils = render(
    <BookCalendarContent
      householdId={HOUSEHOLD_ID}
      locations={locations}
      swimmers={swimmers}
      isViewer={false}
    />,
  );
  await screen.findAllByRole(
    "button",
    { name: /3:00 PM/i },
    { timeout: 5000 },
  );
  return utils;
}

// Helper: inside a day column (desktop WeekGrid), find the slot button at a
// specific label. Returns the first match from WeekGrid (hidden tablet-up
// renders only; mobile PhoneTimeList also renders but has its own class).
function firstSlotButton(timeLabel: RegExp): HTMLElement {
  const matches = screen.getAllByRole("button", { name: timeLabel });
  return matches[0]!;
}

// ── mode switch ─────────────────────────────────────────────────────────────

describe("BookCalendarContent — mode switch", () => {
  it("defaults to Single and switches to Multiple / Recurring", async () => {
    await renderCalendar();
    expect(screen.getByTestId("mode-single").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByTestId("mode-multiple"));
    expect(screen.getByTestId("mode-multiple").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByTestId("mode-recurring"));
    expect(screen.getByTestId("mode-recurring").getAttribute("aria-checked")).toBe("true");
  });

  it("asks for confirmation when switching modes with picks in progress", async () => {
    await renderCalendar();
    fireEvent.click(screen.getByTestId("mode-multiple"));
    const slot = firstSlotButton(/3:00 PM/i);
    fireEvent.click(slot);
    // Bar now shows "1 lesson" + the Show-picks toggle.
    expect(screen.getByTestId("review-multiple")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("mode-recurring"));
    // ConfirmDiscardDialog now routes through the shared ConfirmDialog, so the
    // dialog is identified by its title / confirm label rather than a bespoke
    // test id.
    const discardHeading = screen.getByText("Switch booking mode?");
    const discardDialog = discardHeading.closest("dialog");
    expect(discardDialog).toHaveAttribute("open");
    expect(screen.getByTestId("mode-multiple").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Switch and clear" }));
    expect(screen.getByTestId("mode-recurring").getAttribute("aria-checked")).toBe("true");
  });
});

// ── Full-span highlighting ──────────────────────────────────────────────────

describe("Full-span highlighting", () => {
  it("30-min pick highlights 2 adjacent 15-min cells", async () => {
    await renderCalendar();
    fireEvent.click(screen.getByTestId("mode-multiple"));
    fireEvent.click(firstSlotButton(/^3:00 PM$/i));
    const picks = screen
      .getAllByRole("button")
      .filter((btn) => btn.getAttribute("data-your-pick") === "true");
    const labels = picks.map((p) => p.textContent?.trim());
    expect(labels).toContain("3:00 PM");
    expect(labels).toContain("3:15 PM");
    expect(labels).not.toContain("3:30 PM");
  });

  it("45-min pick highlights 3 adjacent 15-min cells", async () => {
    await renderCalendar();
    fireEvent.click(screen.getByTestId("mode-multiple"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /45 min/i }));
    });
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /3:00 PM/i }).length).toBeGreaterThan(0),
    );
    fireEvent.click(firstSlotButton(/^3:00 PM$/i));
    const picks = screen
      .getAllByRole("button")
      .filter((btn) => btn.getAttribute("data-your-pick") === "true");
    const labels = picks.map((p) => p.textContent?.trim());
    expect(labels).toContain("3:00 PM");
    expect(labels).toContain("3:15 PM");
    expect(labels).toContain("3:30 PM");
    expect(labels).not.toContain("3:45 PM");
  });

  it("60-min pick highlights 4 adjacent 15-min cells", async () => {
    await renderCalendar();
    fireEvent.click(screen.getByTestId("mode-multiple"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /60 min/i }));
    });
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /3:00 PM/i }).length).toBeGreaterThan(0),
    );
    fireEvent.click(firstSlotButton(/^3:00 PM$/i));
    const picks = screen
      .getAllByRole("button")
      .filter((btn) => btn.getAttribute("data-your-pick") === "true");
    const labels = picks.map((p) => p.textContent?.trim());
    expect(labels).toContain("3:00 PM");
    expect(labels).toContain("3:15 PM");
    expect(labels).toContain("3:30 PM");
    expect(labels).toContain("3:45 PM");
    expect(labels).not.toContain("4:00 PM");
  });
});

// ── Overlap: taken-by-picks is non-interactive ──────────────────────────────

describe("Taken-by-picks", () => {
  it("a slot that would overlap an existing pick becomes untappable and dim", async () => {
    await renderCalendar();
    fireEvent.click(screen.getByTestId("mode-multiple"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /60 min/i }));
    });
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /3:00 PM/i }).length).toBeGreaterThan(0),
    );
    // Pick 3:30 PM for 60 min: span 3:30-4:30. A new 60-min lesson at 3:00
    // would run 3:00-4:00 and overlap. The 3:00 cell is NOT in the pick's
    // own span, so it should render as taken-by-picks (non-button).
    fireEvent.click(firstSlotButton(/^3:30 PM$/i));
    await waitFor(() => {
      const taken = document.querySelectorAll('[data-taken-by-picks="true"]');
      expect(taken.length).toBeGreaterThan(0);
    });
    const takenEls = Array.from(
      document.querySelectorAll('[data-taken-by-picks="true"]'),
    ) as HTMLElement[];
    const target = takenEls.find((el) => el.textContent?.trim() === "3:00 PM");
    expect(target).toBeDefined();
    expect(target!.tagName).toBe("DIV");
  });

  it("a new 45-min slot that would overlap a 30-min pick's span is marked taken-by-picks", async () => {
    await renderCalendar();
    fireEvent.click(screen.getByTestId("mode-multiple"));
    // Default chip is 30 min. Tap 3:15 PM so the first pick is 3:15..3:45
    // at 30 min.
    fireEvent.click(firstSlotButton(/^3:15 PM$/i));
    // Switch the chip to 45 min — this only affects NEW picks; the existing
    // 30-min pick keeps its 3:15..3:45 span. A new 45-min lesson starting
    // at 3:00 would run 3:00..3:45 and overlap the pick, so the 3:00 cell
    // becomes untappable.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /45 min/i }));
    });
    await waitFor(() => {
      const taken = document.querySelectorAll('[data-taken-by-picks="true"]');
      expect(taken.length).toBeGreaterThan(0);
    });
    const takenEls = Array.from(
      document.querySelectorAll('[data-taken-by-picks="true"]'),
    ) as HTMLElement[];
    const target = takenEls.find((el) => el.textContent?.trim() === "3:00 PM");
    expect(target).toBeDefined();
    expect(target!.tagName).toBe("DIV");
  });
});

// ── Live preview: length change flags a now-conflicting pick ────────────────

describe("Per-pick length change", () => {
  it("changing one pick's length to a value the server flags marks only that pick, leaves the others alone", async () => {
    await renderCalendar();
    fireEvent.click(screen.getByTestId("mode-multiple"));
    fireEvent.click(firstSlotButton(/^3:00 PM$/i));
    // 3:30 is still available for a 30-min pick.
    fireEvent.click(firstSlotButton(/^3:30 PM$/i));
    // Open the pick list so the per-pick length chips are in the DOM.
    fireEvent.click(screen.getByTestId("multiple-count-toggle"));

    // Server comes back with 3:30 blocked because its length changed to 45.
    mockPreview.mockResolvedValueOnce({
      kind: "ok",
      data: {
        needsApproval: false,
        picks: [
          {
            index: 0,
            startsAt: "2026-11-02T23:00:00.000Z",
            durationMinutes: 30,
            state: "available",
          },
          {
            index: 1,
            startsAt: "2026-11-02T23:30:00.000Z",
            durationMinutes: 45,
            state: "blocked_time",
            reason: "jason_unavailable",
          },
        ],
      },
    });

    // Flip only the second pick's length chip inside its row.
    const rows = screen.getAllByTestId("multiple-pick-row");
    const secondRowChip = rows[1]!.querySelectorAll('[role="radio"]')[1] as HTMLButtonElement;
    fireEvent.click(secondRowChip);

    await waitFor(() => {
      const flagged = document.querySelectorAll('[data-flagged="true"]');
      expect(flagged.length).toBeGreaterThan(0);
    });
    const flaggedEls = Array.from(
      document.querySelectorAll('[data-flagged="true"]'),
    ) as HTMLElement[];
    expect(flaggedEls.some((el) => el.textContent?.includes("3:30 PM"))).toBe(true);
    // The flagged count surfaces under the Review button — the first pick stays available.
    expect(screen.getByTestId("multiple-disabled-reason").textContent).toMatch(/1\s*needs/i);
  });
});

// ── Multiple bottom bar totals ──────────────────────────────────────────────

describe("Multiple bottom bar totals", () => {
  it("renders count, total time, and total price", async () => {
    await renderCalendar();
    fireEvent.click(screen.getByTestId("mode-multiple"));
    // Switch to 60 min — 1 swimmer × 60 min = $120 per lesson.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /60 min/i }));
    });
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /3:00 PM/i }).length).toBeGreaterThan(0),
    );
    fireEvent.click(firstSlotButton(/^3:00 PM$/i));
    // Second pick on a different day to avoid daily-cap or overlap.
    fireEvent.click(screen.getByRole("button", { name: /^Wednesday, November 4, 3:00 PM/i }));
    const totals = screen.getByTestId("multiple-totals").textContent ?? "";
    expect(totals).toMatch(/2\s*hr/i);
    expect(totals).toMatch(/\$240/);
    expect(totals).toMatch(/mixed lengths welcome/i);
  });
});

// ── Recurring bottom bar ────────────────────────────────────────────────────

describe("Recurring bottom bar", () => {
  it("builds a two-day pattern and weeks stepper updates total + price", async () => {
    await renderCalendar();
    fireEvent.click(screen.getByTestId("mode-recurring"));
    // Mon 3:00 PM
    fireEvent.click(firstSlotButton(/^3:00 PM$/i));
    expect(screen.getByTestId("recurring-pattern-label").textContent).toMatch(
      /Mon.*3:00 to 3:30 PM.*30 min/i,
    );
    // Wed 3:00 PM: find the Wednesday "3:00 PM" button via its aria-label.
    const wedSlot = screen.getByRole("button", { name: /^Wednesday, November 4, 3:00 PM/i });
    fireEvent.click(wedSlot);
    expect(screen.getByTestId("recurring-pattern-label").textContent).toMatch(
      /Wed.*3:00 to 3:30 PM.*30 min/i,
    );
    expect(screen.getByTestId("recurring-weeks-value").textContent).toContain("4 wks");
    // 2 pairs × 4 weeks = 8 lessons × 30 min = 240 min = 4 hr. 1 swimmer × 30 min = $60/each × 8 = $480.
    expect(screen.getByTestId("recurring-total").textContent).toMatch(/8\s*lessons/i);
    expect(screen.getByTestId("recurring-total").textContent).toMatch(/4\s*hr/i);
    expect(screen.getByTestId("recurring-total").textContent).toMatch(/\$480/);
    fireEvent.click(screen.getByTestId("recurring-weeks-plus"));
    expect(screen.getByTestId("recurring-total").textContent).toMatch(/10\s*lessons/i);
  });

  it("clamps the stepper when adding a pair would push total lessons past 20", async () => {
    await renderCalendar();
    fireEvent.click(screen.getByTestId("mode-recurring"));
    fireEvent.click(firstSlotButton(/^3:00 PM$/i));
    // Push the single-pair stepper up (clamped by the window to its max).
    for (let i = 0; i < 16; i++) fireEvent.click(screen.getByTestId("recurring-weeks-plus"));
    const wedSlot = screen.getByRole("button", { name: /^Wednesday, November 4, 3:00 PM/i });
    fireEvent.click(wedSlot);
    // 2 pairs → stepper max is floor(20 / 2) = 10; effect clamps weeks down.
    await waitFor(() => {
      expect(screen.getByTestId("recurring-weeks-value").textContent).toContain("10 wks");
    });
    expect(screen.getByTestId("recurring-total").textContent).toMatch(/20\s*lessons/i);
    expect((screen.getByTestId("recurring-weeks-plus") as HTMLButtonElement).disabled).toBe(true);
  });
});

// ── Review sheet (still works) ──────────────────────────────────────────────

describe("Review sheet", () => {
  it("opens the sheet, flags a bad pick, suggestion resolves it", async () => {
    await renderCalendar();
    fireEvent.click(screen.getByTestId("mode-multiple"));
    fireEvent.click(firstSlotButton(/^3:00 PM$/i));
    fireEvent.click(firstSlotButton(/^3:30 PM$/i));

    mockPreview.mockResolvedValue({
      kind: "ok",
      data: {
        needsApproval: false,
        picks: [
          { index: 0, startsAt: "2026-11-02T23:00:00.000Z", durationMinutes: 30, state: "available" },
          {
            index: 1,
            startsAt: "2026-11-02T23:30:00.000Z",
            durationMinutes: 30,
            state: "blocked_time",
            reason: "coach_vacation",
            suggestions: [{ startsAt: "2026-11-02T23:45:00.000Z" }],
          },
        ],
      },
    });

    fireEvent.click(screen.getByTestId("review-multiple"));
    const sheet = await screen.findByTestId("review-sheet");
    expect(sheet).toHaveAttribute("open");

    const suggestionWrapper = await screen.findByTestId("suggestions-1");
    expect((screen.getByTestId("review-book") as HTMLButtonElement).disabled).toBe(true);

    mockPreview.mockResolvedValueOnce({
      kind: "ok",
      data: {
        needsApproval: false,
        picks: [
          { index: 0, startsAt: "2026-11-02T23:00:00.000Z", durationMinutes: 30, state: "available" },
          { index: 1, startsAt: "2026-11-02T23:45:00.000Z", durationMinutes: 30, state: "available" },
        ],
      },
    });

    fireEvent.click(suggestionWrapper.querySelector("button") as HTMLButtonElement);
    await waitFor(() => {
      expect((screen.getByTestId("review-book") as HTMLButtonElement).disabled).toBe(false);
    });
  });

  it("422 conflict re-renders the sheet with flagged picks and keeps Book disabled", async () => {
    await renderCalendar();
    fireEvent.click(screen.getByTestId("mode-multiple"));
    fireEvent.click(firstSlotButton(/^3:00 PM$/i));
    fireEvent.click(firstSlotButton(/^3:30 PM$/i));
    mockPreview.mockResolvedValue({
      kind: "ok",
      data: {
        needsApproval: false,
        picks: [
          { index: 0, startsAt: "2026-11-02T23:00:00.000Z", durationMinutes: 30, state: "available" },
          { index: 1, startsAt: "2026-11-02T23:30:00.000Z", durationMinutes: 30, state: "available" },
        ],
      },
    });
    fireEvent.click(screen.getByTestId("review-multiple"));
    const bookBtn = await screen.findByTestId("review-book");
    await waitFor(() => {
      expect((bookBtn as HTMLButtonElement).disabled).toBe(false);
    });
    mockSubmit.mockResolvedValueOnce({
      kind: "conflict",
      data: {
        error: "picks_conflict" as const,
        conflicts: [
          {
            index: 1,
            startsAt: "2026-11-02T23:30:00.000Z",
            state: "unavailable",
            reason: "slot_taken_since_preview",
          },
        ],
      },
    });
    await act(async () => {
      fireEvent.click(bookBtn);
    });
    await screen.findByText(/no longer available/i);
    expect((screen.getByTestId("review-book") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Changing settings keeps the current week", () => {
  it("navigates three weeks ahead, changes length, stays on that week and refetches it", async () => {
    await renderCalendar();

    // Jump three weeks forward: Nov 2 → Nov 9 → Nov 16 → Nov 23. Each
    // click fires fetchRangeAction; the mock resolves to WEEK_DATA, so
    // the slot grid stays populated and the week label advances.
    const nextWeek = screen.getByLabelText(/Next week/i);
    await act(async () => {
      fireEvent.click(nextWeek);
    });
    await act(async () => {
      fireEvent.click(nextWeek);
    });
    await act(async () => {
      fireEvent.click(nextWeek);
    });
    await waitFor(() => {
      expect(screen.getByText(/Nov 23 \u2013 29, 2026/)).toBeInTheDocument();
    });

    // Clear call history so the next assertion only sees the chip-change
    // fetch and nothing from the three navigation clicks above.
    mockFetchRange.mockClear();

    // Change the length chip. The handler must refetch the CURRENT week
    // (Nov 23), not reset back to the first available week (Nov 2).
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /45 min/i }));
    });

    await waitFor(() => {
      expect(mockFetchRange).toHaveBeenCalled();
    });
    // The duration change must refetch the CURRENT week at the new length.
    // There are also fire-and-forget prefetches for the ±7 adjacent weeks,
    // so match by content rather than by position.
    expect(mockFetchRange).toHaveBeenCalledWith(
      expect.objectContaining({
        view: "week",
        date: "2026-11-23",
        durationMinutes: 45,
      }),
    );
    // The visible week label still shows Nov 23, not Nov 2.
    expect(screen.getByText(/Nov 23 \u2013 29, 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/Nov 2 \u2013 8, 2026/)).toBeNull();
    // "Find first available" was not re-invoked for the chip change.
    expect(mockFirstAvail).toHaveBeenCalledTimes(1);
  });
});

describe("Batch success refreshes the calendar", () => {
  it("the booked slot in the visible week flips to unavailable without a reload, and a slot in a different week flips too after navigating", async () => {
    await renderCalendar();
    fireEvent.click(screen.getByTestId("mode-multiple"));
    // Pick two slots in the visible week (Nov 2).
    fireEvent.click(firstSlotButton(/^3:00 PM$/i));
    fireEvent.click(firstSlotButton(/^3:30 PM$/i));

    mockPreview.mockResolvedValue({
      kind: "ok",
      data: {
        needsApproval: false,
        picks: [
          {
            index: 0,
            startsAt: "2026-11-02T23:00:00.000Z",
            durationMinutes: 30,
            state: "available",
          },
          {
            index: 1,
            startsAt: "2026-11-02T23:30:00.000Z",
            durationMinutes: 30,
            state: "available",
          },
        ],
      },
    });

    fireEvent.click(screen.getByTestId("review-multiple"));
    await screen.findByTestId("review-sheet");

    // After submit, the component bumps fetchSpec to refetch the visible
    // week. Return a WEEK_DATA where the two booked slots are now
    // unavailable; this is what fresh server data would look like after
    // the writes committed.
    const WEEK_DATA_AFTER = {
      needsApproval: false,
      maxDailyLessonMinutes: 240,
      bookingMaxAdvanceWeeks: 52,
      days: WEEK_DATA.days.map((day) =>
        day.date !== "2026-11-02"
          ? day
          : {
              ...day,
              openCount: 3,
              totalCount: 5,
              slots: day.slots.map((slot) => {
                if (
                  slot.startsAt === "2026-11-02T23:00:00.000Z" ||
                  slot.startsAt === "2026-11-02T23:30:00.000Z"
                ) {
                  return { ...slot, state: "unavailable" as const };
                }
                return slot;
              }),
            },
      ),
    };
    mockFetchRange.mockResolvedValueOnce(WEEK_DATA_AFTER);

    mockSubmit.mockResolvedValueOnce({
      kind: "ok",
      data: {
        batchId: "11111111-2222-3333-4444-555555555555",
        mode: "manual" as const,
        lessonIds: ["l1", "l2"],
        confirmedCount: 2,
        pendingCount: 0,
      },
    });

    const bookBtn = await screen.findByTestId("review-book");
    await waitFor(() => {
      expect((bookBtn as HTMLButtonElement).disabled).toBe(false);
    });
    await act(async () => {
      fireEvent.click(bookBtn);
    });
    await screen.findByTestId("batch-success");

    // The fresh fetch should have landed; the previously-booked slot in
    // the visible week now renders as a non-tappable "unavailable" cell
    // (SlotCell for state === "unavailable" is a <div> with line-through).
    await waitFor(() => {
      const unavailable = Array.from(
        document.querySelectorAll("div.line-through"),
      ) as HTMLElement[];
      const booked = unavailable.find((el) => el.textContent?.trim() === "3:00 PM");
      expect(booked).toBeDefined();
    });

    // The visible 3:00 PM is a <div>, not a tappable <button>: no element
    // with the "3:00 PM" accessible name remains clickable.
    const stillAButton = screen
      .queryAllByRole("button", { name: /^Monday, November 2, 3:00 PM/ })
      .filter((el) => el.tagName === "BUTTON");
    expect(stillAButton).toHaveLength(0);

    // Dismiss the sheet so navigation is unblocked.
    fireEvent.click(screen.getByRole("button", { name: /Back to calendar/i }));

    // Simulate booking a lesson that also lives in week B (not on screen).
    // Navigate forward one week; the component always refetches on
    // navigation, so the next-week slot must also come back unavailable
    // to prove the "different week than the one on screen" case.
    const WEEK_DATA_B = {
      needsApproval: false,
      maxDailyLessonMinutes: 240,
      bookingMaxAdvanceWeeks: 52,
      days: [
        {
          date: "2026-11-09",
          dayState: "open" as const,
          openCount: 0,
          totalCount: 1,
          teachingWindows: [{ start: "15:00", end: "15:30" }],
          slots: [
            // Simulated: parent booked this slot in the same batch, so
            // week B's view also comes back with it marked unavailable.
            { startsAt: "2026-11-09T23:00:00.000Z", state: "unavailable" as const },
          ],
        },
      ],
    };
    mockFetchRange.mockResolvedValueOnce(WEEK_DATA_B);

    fireEvent.click(screen.getByLabelText(/Next week/i));
    await waitFor(() => {
      const unavailable = Array.from(
        document.querySelectorAll("div.line-through"),
      ) as HTMLElement[];
      const booked = unavailable.find((el) => el.textContent?.trim() === "3:00 PM");
      expect(booked).toBeDefined();
    });
    const stillAButtonB = screen
      .queryAllByRole("button", { name: /^Monday, November 9, 3:00 PM/ })
      .filter((el) => el.tagName === "BUTTON");
    expect(stillAButtonB).toHaveLength(0);
  });
});

describe("Canonical lesson formatter", () => {
  it("Multiple pick list rows read the same as the review sheet rows", async () => {
    await renderCalendar();
    fireEvent.click(screen.getByTestId("mode-multiple"));
    fireEvent.click(firstSlotButton(/^3:00 PM$/i));
    fireEvent.click(firstSlotButton(/^3:30 PM$/i));
    // Show the Multiple pick list so the first pick is rendered.
    fireEvent.click(screen.getByTestId("multiple-count-toggle"));
    const pickRow = screen.getAllByTestId("multiple-pick-row")[0]!;
    expect(pickRow.textContent).toMatch(/Mon.*Nov 2.*3:00 to 3:30 PM.*30 min/i);

    // Open the review sheet; the heading in each PickRow uses the same format.
    mockPreview.mockResolvedValue({
      kind: "ok",
      data: {
        needsApproval: false,
        picks: [
          {
            index: 0,
            startsAt: "2026-11-02T23:00:00.000Z",
            durationMinutes: 30,
            state: "available",
          },
          {
            index: 1,
            startsAt: "2026-11-02T23:30:00.000Z",
            durationMinutes: 30,
            state: "available",
          },
        ],
      },
    });
    fireEvent.click(screen.getByTestId("review-multiple"));
    const sheet = await screen.findByTestId("review-sheet");
    await waitFor(() => {
      expect(sheet.textContent).toMatch(/Mon.*Nov 2.*3:00 to 3:30 PM.*30 min/i);
    });
    expect(sheet.textContent).toMatch(/Mon.*Nov 2.*3:30 to 4:00 PM.*30 min/i);
  });

  it("Recurring pattern list rows use the canonical weekday + range + length format", async () => {
    await renderCalendar();
    fireEvent.click(screen.getByTestId("mode-recurring"));
    fireEvent.click(firstSlotButton(/^3:00 PM$/i));
    // Pattern summary line in the bar uses the canonical format.
    expect(screen.getByTestId("recurring-pattern-label").textContent).toMatch(
      /Mon.*3:00 to 3:30 PM.*30 min/i,
    );
    // The expanded pattern list row too.
    fireEvent.click(screen.getByTestId("recurring-pattern-toggle"));
    const row = screen.getAllByTestId("recurring-pattern-row")[0]!;
    expect(row.textContent).toMatch(/Mon.*3:00 to 3:30 PM.*30 min/i);
  });
});

describe("Viewer", () => {
  it("shows the viewer message when isViewer=true", () => {
    render(
      <BookCalendarContent
        householdId={HOUSEHOLD_ID}
        locations={locations}
        swimmers={swimmers}
        isViewer={true}
      />,
    );
    expect(screen.getByText(/Booking is for household owners and managers/i)).toBeInTheDocument();
    expect(screen.queryByTestId("mode-switch")).not.toBeInTheDocument();
  });
});

// ── Bug #5: changing the recurring pattern clears stale state ───────────────

describe("Recurring: pattern change clears stale preview + skips", () => {
  it("flagged count from the previous pattern disappears as soon as the pattern changes", async () => {
    await renderCalendar();
    await act(async () => {
      fireEvent.click(screen.getByTestId("mode-recurring"));
    });

    // Pattern A: Mon 3:00 PM. Server flags all 4 expanded weeks as blocked.
    mockPreview.mockResolvedValue({
      kind: "ok",
      data: {
        needsApproval: false,
        picks: [
          { index: 0, startsAt: "2026-11-02T23:00:00.000Z", durationMinutes: 30, state: "blocked_time", reason: "x" },
          { index: 1, startsAt: "2026-11-09T23:00:00.000Z", durationMinutes: 30, state: "blocked_time", reason: "x" },
          { index: 2, startsAt: "2026-11-16T23:00:00.000Z", durationMinutes: 30, state: "blocked_time", reason: "x" },
          { index: 3, startsAt: "2026-11-23T23:00:00.000Z", durationMinutes: 30, state: "blocked_time", reason: "x" },
        ],
      },
    });

    const monSlot = (await screen.findAllByRole("button", { name: /^3:00 PM$/i }))[0]!;
    await act(async () => {
      fireEvent.click(monSlot);
    });

    // Wait for the live preview to resolve: Review button shows "4 need attention."
    await waitFor(() => {
      expect(screen.getByTestId("recurring-disabled-reason").textContent).toMatch(/4\s*need/i);
    });

    // Pattern B: swap Mon for Wed via the pattern list's Remove button, then
    // click a new Wed slot. The clear-on-pattern-change effect wipes
    // previewPicks synchronously — the stale "N need attention" copy must
    // disappear before the debounced preview resolves again.
    await act(async () => {
      fireEvent.click(screen.getByTestId("recurring-pattern-toggle"));
    });
    const patternRow = screen.getAllByTestId("recurring-pattern-row")[0]!;
    const removeBtn = patternRow.querySelector('button[aria-label^="Remove"]') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(removeBtn);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Wednesday, November 4, 3:00 PM/i }));
    });

    await waitFor(() => {
      const reasonEl = screen.queryByTestId("recurring-disabled-reason");
      // After pattern change the stale "N need attention" copy must be gone.
      expect(reasonEl?.textContent ?? "").not.toMatch(/need\s+attention/i);
    });
  });
});

// ── Bug #6: BATCH_LESSON_MIN = 1 allows a single-lesson batch ───────────────

describe("Batch of 1 is allowed", () => {
  it("Review stays enabled with a single pick in Multiple mode", async () => {
    await renderCalendar();
    fireEvent.click(screen.getByTestId("mode-multiple"));
    fireEvent.click(firstSlotButton(/^3:00 PM$/i));

    const reviewBtn = screen.getByTestId("review-multiple") as HTMLButtonElement;
    expect(reviewBtn.disabled).toBe(false);
  });

  it("Book stays enabled in the review sheet when only one lesson remains", async () => {
    await renderCalendar();
    fireEvent.click(screen.getByTestId("mode-multiple"));
    fireEvent.click(firstSlotButton(/^3:00 PM$/i));

    mockPreview.mockResolvedValue({
      kind: "ok",
      data: {
        needsApproval: false,
        picks: [
          { index: 0, startsAt: "2026-11-02T23:00:00.000Z", durationMinutes: 30, state: "available" },
        ],
      },
    });

    fireEvent.click(screen.getByTestId("review-multiple"));
    await screen.findByTestId("review-sheet");

    await waitFor(() => {
      expect((screen.getByTestId("review-book") as HTMLButtonElement).disabled).toBe(false);
    });
  });
});

// ── Bug #7: disabled-reason copy next to Review / Book ──────────────────────

describe("Disabled reasons surface next to Review and Book", () => {
  it("shows 'Add at least one lesson' as the review reason before any picks exist", async () => {
    await renderCalendar();
    fireEvent.click(screen.getByTestId("mode-multiple"));
    expect(screen.getByTestId("multiple-disabled-reason").textContent).toMatch(
      /add at least one lesson/i,
    );
  });

  it("shows 'need attention' as the review reason when the preview flags a pick", async () => {
    await renderCalendar();
    fireEvent.click(screen.getByTestId("mode-multiple"));

    mockPreview.mockResolvedValue({
      kind: "ok",
      data: {
        needsApproval: false,
        picks: [
          { index: 0, startsAt: "2026-11-02T23:00:00.000Z", durationMinutes: 30, state: "available" },
          {
            index: 1,
            startsAt: "2026-11-02T23:30:00.000Z",
            durationMinutes: 30,
            state: "blocked_time",
            reason: "coach_vacation",
          },
        ],
      },
    });

    fireEvent.click(firstSlotButton(/^3:00 PM$/i));
    fireEvent.click(firstSlotButton(/^3:30 PM$/i));

    await waitFor(() => {
      expect(screen.getByTestId("multiple-disabled-reason").textContent).toMatch(/1\s*needs/i);
    });
  });

  it("shows the Book disabled reason inside the review sheet when picks are unresolved", async () => {
    await renderCalendar();
    fireEvent.click(screen.getByTestId("mode-multiple"));
    fireEvent.click(firstSlotButton(/^3:00 PM$/i));
    fireEvent.click(firstSlotButton(/^3:30 PM$/i));

    mockPreview.mockResolvedValue({
      kind: "ok",
      data: {
        needsApproval: false,
        picks: [
          { index: 0, startsAt: "2026-11-02T23:00:00.000Z", durationMinutes: 30, state: "available" },
          {
            index: 1,
            startsAt: "2026-11-02T23:30:00.000Z",
            durationMinutes: 30,
            state: "blocked_time",
            reason: "coach_vacation",
          },
        ],
      },
    });

    fireEvent.click(screen.getByTestId("review-multiple"));
    await screen.findByTestId("review-sheet");

    await waitFor(() => {
      const reason = screen.getByTestId("review-book-disabled-reason");
      expect(reason.textContent).toMatch(/fix\s*1\s*flagged/i);
    });
  });
});

// ── Bug #8: no-swimmer Review scrolls + highlights the swimmer picker ───────

describe("No-swimmer Review feedback", () => {
  const multiSwimmers: ParentSwimmer[] = [
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
    {
      id: "22222222-2222-2222-2222-222222222223",
      firstName: "Jamie",
      lastName: "Smith",
      birthDate: "2018-01-01",
      sex: "male",
      isPublic: false,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
      clubs: [],
      currentLeagues: [],
    },
  ];

  it("scrolls to the Who's swimming picker, highlights it, and shows the error copy", async () => {
    mockFirstAvail.mockResolvedValue({
      firstAvailableDate: "2026-11-02",
      weekData: WEEK_DATA,
    });
    mockFetchRange.mockResolvedValue(WEEK_DATA);
    render(
      <BookCalendarContent
        householdId={HOUSEHOLD_ID}
        locations={locations}
        swimmers={multiSwimmers}
        isViewer={false}
      />,
    );
    await screen.findAllByRole("button", { name: /3:00 PM/i }, { timeout: 5000 });

    // Two swimmers → neither is auto-selected (auto-select only runs when
    // there's exactly one swimmer).
    fireEvent.click(screen.getByTestId("mode-multiple"));
    fireEvent.click(firstSlotButton(/^3:00 PM$/i));

    const picker = screen.getByTestId("swimmer-picker");
    const scrollSpy = vi.fn();
    picker.scrollIntoView = scrollSpy;
    expect(picker.getAttribute("data-highlight")).toBeNull();

    fireEvent.click(screen.getByTestId("review-multiple"));

    await waitFor(() => {
      expect(picker.getAttribute("data-highlight")).toBe("true");
    });
    expect(scrollSpy).toHaveBeenCalled();
    expect(screen.getByTestId("swimmer-error").textContent).toMatch(
      /pick who['\u2019]s swimming first\./i,
    );
    // The review sheet is always mounted but should not have been opened.
    const sheet = screen.getByTestId("review-sheet") as HTMLDialogElement;
    expect(sheet.hasAttribute("open")).toBe(false);
  });

  // Dev-feedback-2: Confirm / Review tapped repeatedly with no swimmer must
  // replay the scroll + highlight each time, not just the first. The nonce-
  // based effect in CalendarConfigRow re-fires on every bump; a boolean
  // flag would make the useEffect dep set stable after the first tap.
  it("replays scroll + highlight on every Review tap, not just the first", async () => {
    mockFirstAvail.mockResolvedValue({
      firstAvailableDate: "2026-11-02",
      weekData: WEEK_DATA,
    });
    mockFetchRange.mockResolvedValue(WEEK_DATA);
    render(
      <BookCalendarContent
        householdId={HOUSEHOLD_ID}
        locations={locations}
        swimmers={multiSwimmers}
        isViewer={false}
      />,
    );
    await screen.findAllByRole("button", { name: /3:00 PM/i }, { timeout: 5000 });

    await act(async () => {
      fireEvent.click(screen.getByTestId("mode-multiple"));
    });

    const picker = screen.getByTestId("swimmer-picker");
    const scrollSpy = vi.fn();
    picker.scrollIntoView = scrollSpy;

    // Three taps on Review with no swimmer selected. Each must land a fresh
    // scroll call — the previous assertion was that the spy was called ≥ 1,
    // which the first-tap-only bug would pass.
    for (let tap = 1; tap <= 3; tap++) {
      await act(async () => {
        fireEvent.click(screen.getByTestId("review-multiple"));
      });
      expect(scrollSpy).toHaveBeenCalledTimes(tap);
    }

    // The error copy stays visible across repeated taps so the parent sees
    // the same signal every time.
    expect(screen.getByTestId("swimmer-error").textContent).toMatch(
      /pick who['\u2019]s swimming first\./i,
    );
  });
});

// ── Dev-feedback-2: per-pick swimmers ──────────────────────────────────────

describe("Per-pick swimmers in Multiple mode", () => {
  const twoSwimmers: ParentSwimmer[] = [
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
    {
      id: "22222222-2222-2222-2222-222222222223",
      firstName: "Jamie",
      lastName: "Smith",
      birthDate: "2018-01-01",
      sex: "male",
      isPublic: false,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
      clubs: [],
      currentLeagues: [],
    },
  ];

  // The old batch-wide swimmer model booked every lesson under whichever kid
  // was selected on the top-level chip at submit time; changing the chip
  // between picks silently rewrote the first pick too. This test proves the
  // per-pick capture: each pick keeps the swimmers it was tapped with.
  it("changing the chip between picks does not rewrite existing picks", async () => {
    mockFirstAvail.mockResolvedValue({
      firstAvailableDate: "2026-11-02",
      weekData: WEEK_DATA,
    });
    mockFetchRange.mockResolvedValue(WEEK_DATA);
    render(
      <BookCalendarContent
        householdId={HOUSEHOLD_ID}
        locations={locations}
        swimmers={twoSwimmers}
        isViewer={false}
      />,
    );
    await screen.findAllByRole("button", { name: /3:00 PM/i }, { timeout: 5000 });
    await act(async () => {
      fireEvent.click(screen.getByTestId("mode-multiple"));
    });

    // Pick Alex on the top-level chip, then click a slot.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Alex Smith$/ }));
    });
    await act(async () => {
      fireEvent.click(firstSlotButton(/^3:00 PM$/i));
    });

    // Swap the chip to Jamie, then click a second slot on a different day.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Alex Smith$/ })); // off
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Jamie Smith$/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Wednesday, November 4, 3:00 PM/i }));
    });

    // Expand the pick list so we can read each pick's swimmer label.
    await act(async () => {
      fireEvent.click(screen.getByTestId("multiple-count-toggle"));
    });
    const rows = screen.getAllByTestId("multiple-pick-row");
    expect(rows).toHaveLength(2);

    // Row 0 (Mon 3:00) kept Alex despite the chip flipping to Jamie after.
    // Row 1 (Wed 3:00) got Jamie because that was the chip at tap time.
    // The per-row chips reflect each pick's own swimmer set.
    const row0Alex = rows[0]!.querySelector(
      'button[aria-pressed="true"]',
    ) as HTMLButtonElement;
    expect(row0Alex?.textContent).toContain("Alex");
    const row1Jamie = rows[1]!.querySelector(
      'button[aria-pressed="true"]',
    ) as HTMLButtonElement;
    expect(row1Jamie?.textContent).toContain("Jamie");

    // The preview request body carries per-pick swimmerIds (not a shared
    // batch field). Trigger a preview and inspect the mock call.
    mockPreview.mockResolvedValue({
      kind: "ok",
      data: {
        needsApproval: false,
        picks: [
          {
            index: 0,
            startsAt: "2026-11-02T23:00:00.000Z",
            durationMinutes: 30,
            swimmerIds: [twoSwimmers[0]!.id],
            state: "available",
          },
          {
            index: 1,
            startsAt: "2026-11-04T23:00:00.000Z",
            durationMinutes: 30,
            swimmerIds: [twoSwimmers[1]!.id],
            state: "available",
          },
        ],
      },
    });

    await waitFor(() => {
      expect(mockPreview).toHaveBeenCalled();
    });
    const lastCall = mockPreview.mock.calls.at(-1)!;
    const sentBody = lastCall[0] as {
      mode: string;
      picks?: Array<{ startsAt: string; swimmerIds: string[] }>;
    };
    expect(sentBody.mode).toBe("manual");
    expect(sentBody.picks?.[0]?.swimmerIds).toEqual([twoSwimmers[0]!.id]);
    expect(sentBody.picks?.[1]?.swimmerIds).toEqual([twoSwimmers[1]!.id]);
    // The old shape would have sent a single batch-wide swimmerIds here.
    expect("swimmerIds" in sentBody).toBe(false);
  });
});
