import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

import type { ParentSwimmer } from "@swim-app/shared";

// Freeze "now" before every fixture slot so the booking-window and
// too-soon math behave deterministically across runs (same pattern as
// batchBookModes.test.tsx).
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
  mockPreview.mockResolvedValue({
    kind: "ok",
    data: { picks: [], needsApproval: false, holdId: null },
  });
  // Default: give sessionStorage / location stubs so modal navigation
  // doesn't blow up when a test exercises the "Add credit" flow.
  Object.defineProperty(window, "location", {
    writable: true,
    value: { href: "" } as Location,
  });
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const {
  mockFetchRange,
  mockFirstAvail,
  mockPreview,
  mockSubmit,
  mockCreateBooking,
  mockTopup,
} = vi.hoisted(() => ({
  mockFetchRange: vi.fn(),
  mockFirstAvail: vi.fn(),
  mockPreview: vi.fn(),
  mockSubmit: vi.fn(),
  mockCreateBooking: vi.fn(),
  mockTopup: vi.fn(),
}));

vi.mock("../content/BookCalendarContent/actions", () => ({
  fetchRangeAction: mockFetchRange,
  fetchMonthRangeAction: vi.fn(),
  findFirstAvailableDayAction: mockFirstAvail,
  createBookingAction: mockCreateBooking,
  previewBatchAction: mockPreview,
  submitBatchAction: mockSubmit,
}));

vi.mock("@/content/AccountBalanceContent/actions", () => ({
  startBookingShortfallTopupAction: (
    ...args: Parameters<typeof mockTopup>
  ) => mockTopup(...args),
}));

import BookCalendarContent from "../content/BookCalendarContent";

const HOUSEHOLD_ID = "11111111-1111-1111-1111-111111111111";
const LOCATION_ID = "33333333-3333-3333-3333-333333333333";
const SWIMMER_ID = "22222222-2222-2222-2222-222222222222";

const swimmers: ParentSwimmer[] = [
  {
    id: SWIMMER_ID,
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
  ],
};

async function renderCalendar(balanceCents: number | null) {
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
      balanceCents={balanceCents}
    />,
  );
  await screen.findAllByRole(
    "button",
    { name: /3:00 PM/i },
    { timeout: 5000 },
  );
  return utils;
}

function firstSlotButton(timeLabel: RegExp): HTMLElement {
  const matches = screen.getAllByRole("button", { name: timeLabel });
  return matches[0]!;
}

// ── Single mode ────────────────────────────────────────────────────────────

describe("Single mode balance + insufficient-funds", () => {
  it("shows the balance line and 'Short by' copy in the bottom bar when the lesson costs more than the balance", async () => {
    // 1-swimmer 30-min lesson = $60 ($6000c). Balance $20 → short by $40.
    await renderCalendar(2000);
    fireEvent.click(firstSlotButton(/^3:00 PM$/i));
    await waitFor(() => {
      expect(screen.getByTestId("single-balance-line")).toBeInTheDocument();
    });
    const line = screen.getByTestId("single-balance-line").textContent ?? "";
    expect(line).toMatch(/Balance:\s*\$20\.00/);
    expect(line).toMatch(/Short by\s*\$40\.00/);
  });

  it("opens the insufficient-funds modal preemptively instead of calling the API when balance is short", async () => {
    await renderCalendar(2000);
    fireEvent.click(firstSlotButton(/^3:00 PM$/i));
    await act(async () => {
      fireEvent.click(screen.getByTestId("confirm-single"));
    });
    // Modal should open without hitting the server.
    expect(mockCreateBooking).not.toHaveBeenCalled();
    expect(screen.getByText(/not enough balance/i)).toBeInTheDocument();
    expect(screen.getByText(/this lesson costs/i)).toHaveTextContent("$60.00");
    expect(screen.getByText(/this lesson costs/i)).toHaveTextContent("$20.00");
  });

  it("maps a 422 insufficient_balance from the server to the modal (not to a generic error)", async () => {
    // Balance unknown locally → the client doesn't preempt. Server returns
    // insufficient_balance; the state returned by createBookingAction already
    // lives in the "insufficient_balance" branch of mapBookingApiResponse.
    await renderCalendar(null);
    mockCreateBooking.mockResolvedValueOnce({
      status: "insufficient_balance",
      balanceCents: 1000,
      priceCents: 6000,
      shortfallCents: 5000,
      attempt: {
        startsAt: "2026-11-02T23:00:00.000Z",
        durationMinutes: 30,
        locationId: LOCATION_ID,
        swimmerIds: [SWIMMER_ID],
      },
    });
    fireEvent.click(firstSlotButton(/^3:00 PM$/i));
    await act(async () => {
      fireEvent.click(screen.getByTestId("confirm-single"));
    });
    await waitFor(() => {
      expect(screen.getByText(/not enough balance/i)).toBeInTheDocument();
    });
  });
});

// ── Multiple mode ──────────────────────────────────────────────────────────

describe("Multiple mode balance + insufficient-funds", () => {
  it("shows the balance / short-by line in the Multiple bottom bar when total exceeds balance", async () => {
    // Two 30-min picks × $60 = $120 total. Balance $50 → short by $70.
    await renderCalendar(5000);
    fireEvent.click(screen.getByTestId("mode-multiple"));
    fireEvent.click(firstSlotButton(/^3:00 PM$/i));
    fireEvent.click(firstSlotButton(/^3:30 PM$/i));
    await waitFor(() => {
      expect(screen.getByTestId("multiple-balance-line")).toBeInTheDocument();
    });
    const line = screen.getByTestId("multiple-balance-line").textContent ?? "";
    expect(line).toMatch(/Balance:\s*\$50\.00/);
    expect(line).toMatch(/Short by\s*\$70\.00/);
  });

  it("review sheet shows the insufficient-funds options instead of the Book button when total > balance", async () => {
    await renderCalendar(5000);
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
    await screen.findByTestId("review-sheet");

    await waitFor(() => {
      expect(screen.getByTestId("review-insufficient-balance")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("review-book")).toBeNull();
    expect(screen.getByTestId("review-buy-package")).toBeInTheDocument();
    const summary = screen.getByTestId("review-insufficient-balance").textContent ?? "";
    expect(summary).toMatch(/Balance.*\$50\.00/);
    expect(summary).toMatch(/Total.*\$120\.00/);
    expect(summary).toMatch(/Short by.*\$70\.00/);
  });

  it("maps a 422 insufficient_balance from the batch API to the review-sheet insufficient-funds view — not to 'Some lessons are no longer available'", async () => {
    // Balance is enough locally so the client doesn't preempt; the server
    // returns 422 insufficient_balance (race between preview and submit).
    await renderCalendar(20000);
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
      kind: "insufficient_balance",
      balanceCents: 5000,
      priceCents: 12000,
      shortfallCents: 7000,
    });
    await act(async () => {
      fireEvent.click(bookBtn);
    });
    await waitFor(() => {
      expect(screen.getByTestId("review-insufficient-balance")).toBeInTheDocument();
    });
    const summary = screen.getByTestId("review-insufficient-balance").textContent ?? "";
    expect(summary).toMatch(/Short by.*\$70\.00/);
    // Should NOT fall through to the availability copy.
    expect(screen.queryByText(/no longer available/i)).toBeNull();
    // And Book is no longer rendered — only the insufficient-funds view.
    expect(screen.queryByTestId("review-book")).toBeNull();
  });
});

// ── Recurring mode ─────────────────────────────────────────────────────────

describe("Recurring mode balance + insufficient-funds", () => {
  it("shows the balance / short-by line in the Recurring bottom bar when the expanded total exceeds balance", async () => {
    // Pattern Mon 3:00 PM × default 4 weeks × $60 = $240. Balance $100 → short by $140.
    await renderCalendar(10000);
    fireEvent.click(screen.getByTestId("mode-recurring"));
    fireEvent.click(firstSlotButton(/^3:00 PM$/i));
    await waitFor(() => {
      expect(screen.getByTestId("recurring-balance-line")).toBeInTheDocument();
    });
    const line = screen.getByTestId("recurring-balance-line").textContent ?? "";
    expect(line).toMatch(/Balance:\s*\$100\.00/);
    expect(line).toMatch(/Short by\s*\$140\.00/);
  });

  it("maps a 422 insufficient_balance from the batch API to the review-sheet insufficient-funds view for recurring", async () => {
    // $300 client-side balance comfortably covers the preview (4 × $60 = $240).
    // The server then claims the real balance is only $100 (race between
    // preview and submit), returning 422 insufficient_balance.
    await renderCalendar(30000);
    fireEvent.click(screen.getByTestId("mode-recurring"));
    fireEvent.click(firstSlotButton(/^3:00 PM$/i));
    // Default is 4 weeks expansion. Preview resolves for 4 picks.
    mockPreview.mockResolvedValue({
      kind: "ok",
      data: {
        needsApproval: false,
        picks: [
          { index: 0, startsAt: "2026-11-02T23:00:00.000Z", durationMinutes: 30, state: "available" },
          { index: 1, startsAt: "2026-11-09T23:00:00.000Z", durationMinutes: 30, state: "available" },
          { index: 2, startsAt: "2026-11-16T23:00:00.000Z", durationMinutes: 30, state: "available" },
          { index: 3, startsAt: "2026-11-23T23:00:00.000Z", durationMinutes: 30, state: "available" },
        ],
      },
    });
    fireEvent.click(screen.getByTestId("review-recurring"));
    const bookBtn = await screen.findByTestId("review-book");
    await waitFor(() => {
      expect((bookBtn as HTMLButtonElement).disabled).toBe(false);
    });
    mockSubmit.mockResolvedValueOnce({
      kind: "insufficient_balance",
      balanceCents: 10000,
      priceCents: 24000,
      shortfallCents: 14000,
    });
    await act(async () => {
      fireEvent.click(bookBtn);
    });
    await waitFor(() => {
      expect(screen.getByTestId("review-insufficient-balance")).toBeInTheDocument();
    });
    expect(screen.queryByText(/no longer available/i)).toBeNull();
    const summary = screen.getByTestId("review-insufficient-balance").textContent ?? "";
    expect(summary).toMatch(/Short by.*\$140\.00/);
  });
});
