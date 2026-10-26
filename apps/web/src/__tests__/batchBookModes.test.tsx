import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

import type { ParentSwimmer } from "@swim-app/shared";

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
    expect(screen.getByTestId("confirm-discard-dialog")).toHaveAttribute("open");
    expect(screen.getByTestId("mode-multiple").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByTestId("confirm-discard-ok"));
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
    // The flagged count surfaces exactly 1 — the first pick stays available.
    expect(screen.getByTestId("multiple-flagged-count").textContent).toMatch(/1\s*needs/i);
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
    expect(screen.getByTestId("recurring-pattern-label").textContent).toMatch(/Mon 3:00 PM/i);
    // Wed 3:00 PM — find the Wednesday "3:00 PM" button via its aria-label.
    const wedSlot = screen.getByRole("button", { name: /^Wednesday, November 4, 3:00 PM/i });
    fireEvent.click(wedSlot);
    expect(screen.getByTestId("recurring-pattern-label").textContent).toMatch(/Wed 3:00 PM/i);
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
          { index: 0, startsAt: "2026-11-02T23:00:00.000Z", state: "available" },
          {
            index: 1,
            startsAt: "2026-11-02T23:30:00.000Z",
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
          { index: 0, startsAt: "2026-11-02T23:00:00.000Z", state: "available" },
          { index: 1, startsAt: "2026-11-02T23:45:00.000Z", state: "available" },
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
          { index: 0, startsAt: "2026-11-02T23:00:00.000Z", state: "available" },
          { index: 1, startsAt: "2026-11-02T23:30:00.000Z", state: "available" },
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
