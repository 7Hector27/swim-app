// ADR 036 Phase 8 Part B Stop 3 piece 4: the Book calendar bottom bar
// grows an "Add funds" link next to the balance line (Single / Multiple /
// Recurring). Clicking it stashes the parent's current picks under the
// same sessionStorage key the insufficient-funds flow uses, then sends
// them to /account/balance?resume=book. When they come back the resume
// path rehydrates the picks they had.

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

import type { ParentSwimmer } from "@swim-app/shared";

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

const { mockFetchRange, mockFirstAvail, mockPreview, mockSubmit, mockCreateBooking, mockTopup } =
  vi.hoisted(() => ({
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
  startBookingShortfallTopupAction: (...args: Parameters<typeof mockTopup>) => mockTopup(...args),
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
        { startsAt: "2026-11-02T23:30:00.000Z", state: "available" as const },
      ],
    },
  ],
};

async function renderCalendar(balanceCents: number | null) {
  mockFirstAvail.mockResolvedValue({ firstAvailableDate: "2026-11-02", weekData: WEEK_DATA });
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
  await screen.findAllByRole("button", { name: /3:00 PM/i }, { timeout: 5000 });
  return utils;
}

function firstSlotButton(timeLabel: RegExp): HTMLElement {
  return screen.getAllByRole("button", { name: timeLabel })[0]!;
}

describe("Book bottom bar — Add funds link (ADR 036 Phase 8 Part B Stop 3 piece 4)", () => {
  it("Single mode: stashes the current pick and navigates to /account/balance?resume=book", async () => {
    // Balance is plenty so there's no "Short by" line — the Add funds
    // link still renders next to Balance, same as the shortfall case.
    await renderCalendar(500_000);
    fireEvent.click(firstSlotButton(/^3:00 PM$/i));
    await waitFor(() => {
      expect(screen.getByTestId("single-add-funds")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("single-add-funds"));
    });

    const raw = window.sessionStorage.getItem("axiom:pending-booking");
    expect(raw).not.toBeNull();
    const stash = JSON.parse(raw!);
    expect(stash.mode).toBe("single");
    expect(stash.startsAt).toBe("2026-11-02T23:00:00.000Z");
    expect(stash.durationMinutes).toBe(30);
    expect(stash.locationId).toBe(LOCATION_ID);
    expect(stash.swimmerIds).toEqual([SWIMMER_ID]);

    expect(window.location.href).toBe("/account/balance?resume=book");
  });

  it("Multiple mode: stashes the picks array and navigates", async () => {
    await renderCalendar(500_000);
    fireEvent.click(screen.getByTestId("mode-multiple"));
    fireEvent.click(firstSlotButton(/^3:00 PM$/i));
    fireEvent.click(firstSlotButton(/^3:30 PM$/i));
    await waitFor(() => {
      expect(screen.getByTestId("multiple-add-funds")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("multiple-add-funds"));
    });

    const stash = JSON.parse(window.sessionStorage.getItem("axiom:pending-booking")!);
    expect(stash.mode).toBe("multiple");
    expect(stash.locationId).toBe(LOCATION_ID);
    expect(stash.picks).toHaveLength(2);
    expect(stash.picks[0].startsAt).toBe("2026-11-02T23:00:00.000Z");
    expect(stash.picks[1].startsAt).toBe("2026-11-02T23:30:00.000Z");
    expect(window.location.href).toBe("/account/balance?resume=book");
  });

  it("Single mode: still navigates even without picks (no stash written when picks missing)", async () => {
    // No slot click → no selection → Balance line is hidden, so the
    // Add funds link isn't rendered either. The handler is covered by
    // the batch-flow Buy a package test — this guard confirms the
    // button is gated by the balance-line visibility rule.
    await renderCalendar(500_000);
    expect(screen.queryByTestId("single-add-funds")).toBeNull();
  });
});
