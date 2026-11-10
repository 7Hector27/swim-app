import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

import type { ParentSwimmer } from "@swim-app/shared";

// Freeze "now" before the fixture week so booking-window math is stable.
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
  window.sessionStorage.clear();
  // Stub window.location so navigation-based assertions don't blow up.
  Object.defineProperty(window, "location", {
    writable: true,
    value: { href: "", search: "" } as unknown as Location,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const { mockFetchRange, mockFirstAvail, mockPreview, mockSubmit, mockTopup } =
  vi.hoisted(() => ({
    mockFetchRange: vi.fn(),
    mockFirstAvail: vi.fn(),
    mockPreview: vi.fn(),
    mockSubmit: vi.fn(),
    mockTopup: vi.fn(),
  }));

vi.mock("../content/BookCalendarContent/actions", () => ({
  fetchRangeAction: mockFetchRange,
  fetchMonthRangeAction: vi.fn(),
  findFirstAvailableDayAction: mockFirstAvail,
  createBookingAction: vi.fn(),
  previewBatchAction: mockPreview,
  submitBatchAction: mockSubmit,
}));

vi.mock("@/content/AccountBalanceContent/actions", () => ({
  startBookingShortfallTopupAction: (
    ...args: Parameters<typeof mockTopup>
  ) => mockTopup(...args),
}));

import BookCalendarContent from "../content/BookCalendarContent";
import {
  readPendingBooking,
  stashPendingBooking,
} from "../content/BookCalendarContent/InsufficientBalanceModal";

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

function firstSlotButton(timeLabel: RegExp): HTMLElement {
  const matches = screen.getAllByRole("button", { name: timeLabel });
  return matches[0]!;
}

async function renderCalendar(opts: {
  balanceCents: number | null;
  resume?: boolean;
}) {
  mockFirstAvail.mockResolvedValue({
    firstAvailableDate: "2026-11-02",
    weekData: WEEK_DATA,
  });
  mockFetchRange.mockResolvedValue(WEEK_DATA);
  if (opts.resume === true) {
    // The resume useEffect reads window.location.search on mount.
    Object.defineProperty(window, "location", {
      writable: true,
      value: { href: "", search: "?resume=1" } as unknown as Location,
    });
  }
  const utils = render(
    <BookCalendarContent
      householdId={HOUSEHOLD_ID}
      locations={locations}
      swimmers={swimmers}
      isViewer={false}
      balanceCents={opts.balanceCents}
    />,
  );
  await screen.findAllByRole(
    "button",
    { name: /3:00 PM/i },
    { timeout: 5000 },
  );
  return utils;
}

// ── Multiple: stash on both paths ──────────────────────────────────────────

describe("Multiple mode — stash on 'Buy a package' and 'Add credit'", () => {
  it("'Buy a package' stashes the full multiple state (mode, pool, picks with kids + lengths) and navigates to /account/balance?resume=book", async () => {
    // Balance $50 ⇒ two 30-min picks ($120) exceeds balance ⇒ review sheet
    // flips into the insufficient-funds view with the two buttons.
    await renderCalendar({ balanceCents: 5000 });
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
    const buyPackage = await screen.findByTestId("review-buy-package");
    fireEvent.click(buyPackage);

    const stashed = readPendingBooking();
    expect(stashed).toMatchObject({
      mode: "multiple",
      locationId: LOCATION_ID,
      picks: [
        {
          startsAt: "2026-11-02T23:00:00.000Z",
          durationMinutes: 30,
          swimmerIds: [SWIMMER_ID],
        },
        {
          startsAt: "2026-11-02T23:30:00.000Z",
          durationMinutes: 30,
          swimmerIds: [SWIMMER_ID],
        },
      ],
    });
    // stashedAt gives us the TTL hook.
    expect(typeof stashed?.stashedAt).toBe("string");
    // Navigation aimed at the balance page with the booking-return marker.
    expect(window.location.href).toBe("/account/balance?resume=book");
  });

  it("'Add credit' stashes the full multiple state AND calls the top-up action with the booking return path", async () => {
    mockTopup.mockResolvedValue({
      kind: "redirect",
      url: "https://checkout.stripe.test/sess_m",
    });
    await renderCalendar({ balanceCents: 5000 });
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
    const addCredit = await screen.findByTestId("review-add-credit");
    await act(async () => {
      fireEvent.click(addCredit);
    });

    // Stashed before the Stripe hop so /dashboard/book?resume=1 has the data.
    const stashed = readPendingBooking();
    expect(stashed).toMatchObject({
      mode: "multiple",
      locationId: LOCATION_ID,
      picks: expect.arrayContaining([
        expect.objectContaining({
          startsAt: "2026-11-02T23:00:00.000Z",
          durationMinutes: 30,
          swimmerIds: [SWIMMER_ID],
        }),
      ]),
    });
    // Top-up uses the per-lesson config (largest in the batch — here both
    // picks are 30 min / 1 swimmer) and returns back to the booking resume.
    expect(mockTopup).toHaveBeenCalledWith(30, 1, "/dashboard/book?resume=1");
    expect(window.location.href).toBe("https://checkout.stripe.test/sess_m");
  });
});

// ── Multiple: resume restores state ────────────────────────────────────────

describe("Multiple mode — resume restores the full state and opens the review sheet", () => {
  it("resume=1 + stashed multiple state restores mode, pool, and picks, and opens the review sheet without auto-booking", async () => {
    // Write the stash BEFORE mount so the resume useEffect picks it up.
    stashPendingBooking({
      mode: "multiple",
      stashedAt: new Date().toISOString(),
      locationId: LOCATION_ID,
      picks: [
        {
          startsAt: "2026-11-02T23:00:00.000Z",
          durationMinutes: 30,
          swimmerIds: [SWIMMER_ID],
        },
        {
          startsAt: "2026-11-02T23:30:00.000Z",
          durationMinutes: 30,
          swimmerIds: [SWIMMER_ID],
        },
      ],
    });
    // Server preview is clean — all picks available post-topup.
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
    // Enough balance now, like after a successful top-up.
    await renderCalendar({ balanceCents: 50000, resume: true });

    // Mode flipped to Multiple on mount.
    await waitFor(() => {
      expect(screen.getByTestId("mode-multiple").getAttribute("aria-checked")).toBe(
        "true",
      );
    });
    // Review sheet is open, and Book is the primary action — not auto-tapped.
    const sheet = await screen.findByTestId("review-sheet");
    expect(sheet).toHaveAttribute("open");
    await waitFor(() => {
      expect(screen.getByTestId("review-book")).toBeInTheDocument();
    });
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("if a resumed pick is now unavailable, the normal flagged-pick UI shows (preview routes the flag, not a special case)", async () => {
    stashPendingBooking({
      mode: "multiple",
      stashedAt: new Date().toISOString(),
      locationId: LOCATION_ID,
      picks: [
        {
          startsAt: "2026-11-02T23:00:00.000Z",
          durationMinutes: 30,
          swimmerIds: [SWIMMER_ID],
        },
        {
          startsAt: "2026-11-02T23:30:00.000Z",
          durationMinutes: 30,
          swimmerIds: [SWIMMER_ID],
        },
      ],
    });
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
            reason: "slot_taken_since_resume",
          },
        ],
      },
    });
    await renderCalendar({ balanceCents: 50000, resume: true });

    await screen.findByTestId("review-sheet");
    await waitFor(() => {
      expect(screen.getByTestId("review-book-disabled-reason").textContent).toMatch(
        /fix\s*1\s*flagged/i,
      );
    });
  });
});

// ── Recurring: stash on both paths ─────────────────────────────────────────

describe("Recurring mode — stash on 'Buy a package' and 'Add credit'", () => {
  it("'Buy a package' stashes the full recurring state (pattern, weeks, startDate, pool)", async () => {
    await renderCalendar({ balanceCents: 5000 });
    fireEvent.click(screen.getByTestId("mode-recurring"));
    fireEvent.click(firstSlotButton(/^3:00 PM$/i));
    // Default 4 weeks of Mon 3:00 PM × $60 = $240. Balance $50 ⇒ short.
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
    const buyPackage = await screen.findByTestId("review-buy-package");
    fireEvent.click(buyPackage);

    const stashed = readPendingBooking();
    expect(stashed).toMatchObject({
      mode: "recurring",
      locationId: LOCATION_ID,
      // Monday = 1 (ISO weekday).
      pattern: [
        {
          weekday: 1,
          timeOfDay: "15:00",
          durationMinutes: 30,
          swimmerIds: [SWIMMER_ID],
        },
      ],
      weeks: 4,
    });
    expect(window.location.href).toBe("/account/balance?resume=book");
  });

  it("'Add credit' stashes the full recurring state and calls the top-up action", async () => {
    mockTopup.mockResolvedValue({
      kind: "redirect",
      url: "https://checkout.stripe.test/sess_r",
    });
    await renderCalendar({ balanceCents: 5000 });
    fireEvent.click(screen.getByTestId("mode-recurring"));
    fireEvent.click(firstSlotButton(/^3:00 PM$/i));
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
    const addCredit = await screen.findByTestId("review-add-credit");
    await act(async () => {
      fireEvent.click(addCredit);
    });

    const stashed = readPendingBooking();
    expect(stashed).toMatchObject({
      mode: "recurring",
      locationId: LOCATION_ID,
      weeks: 4,
    });
    expect(mockTopup).toHaveBeenCalledWith(30, 1, "/dashboard/book?resume=1");
    expect(window.location.href).toBe("https://checkout.stripe.test/sess_r");
  });
});

// ── Recurring: resume restores state ───────────────────────────────────────

describe("Recurring mode — resume restores the full state and opens the review sheet", () => {
  it("resume=1 + stashed recurring state restores mode, pool, pattern, and weeks", async () => {
    stashPendingBooking({
      mode: "recurring",
      stashedAt: new Date().toISOString(),
      locationId: LOCATION_ID,
      pattern: [
        {
          weekday: 1,
          timeOfDay: "15:00",
          durationMinutes: 30,
          swimmerIds: [SWIMMER_ID],
        },
      ],
      startDate: "2026-11-02",
      weeks: 3,
    });
    mockPreview.mockResolvedValue({
      kind: "ok",
      data: {
        needsApproval: false,
        picks: [
          { index: 0, startsAt: "2026-11-02T23:00:00.000Z", durationMinutes: 30, state: "available" },
          { index: 1, startsAt: "2026-11-09T23:00:00.000Z", durationMinutes: 30, state: "available" },
          { index: 2, startsAt: "2026-11-16T23:00:00.000Z", durationMinutes: 30, state: "available" },
        ],
      },
    });
    await renderCalendar({ balanceCents: 50000, resume: true });

    await waitFor(() => {
      expect(screen.getByTestId("mode-recurring").getAttribute("aria-checked")).toBe(
        "true",
      );
    });
    const sheet = await screen.findByTestId("review-sheet");
    expect(sheet).toHaveAttribute("open");
    // Weeks stepper reflects the stash.
    expect(screen.getByTestId("recurring-weeks-value").textContent).toContain(
      "3 wks",
    );
    // Not auto-booked.
    expect(mockSubmit).not.toHaveBeenCalled();
  });
});
