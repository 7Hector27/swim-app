import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import type {
  CoachBookingWarnings,
  CoachHouseholdSearchResult,
  LessonLocation,
} from "@swim-app/shared";
import {
  computeInitialSwimmerIds,
  laDateTimeToUtcIso,
  todayLA,
} from "../content/CoachBookLessonContent/helpers";

// jsdom doesn't ship HTMLDialogElement methods or Element.scrollIntoView.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  vi.clearAllMocks();
  // Default to empty array so the overlap useEffect doesn't call
  // setWeekLessons(undefined) in tests that don't care about it.
  fetchCoachWeekLessonsSpy.mockResolvedValue([]);
});

// ── Mocks ─────────────────────────────────────────────────────────────────────

const searchHouseholdsSpy = vi.fn();
const submitCoachBookingSpy = vi.fn();
const fetchCoachRangeSpy = vi.fn();
const fetchCoachWeekLessonsSpy = vi.fn();
const fetchHouseholdByIdSpy = vi.fn();

vi.mock("@/content/CoachBookLessonContent/actions", () => ({
  searchHouseholdsAction: (...args: unknown[]) => searchHouseholdsSpy(...args),
  submitCoachBookingAction: (...args: unknown[]) => submitCoachBookingSpy(...args),
  fetchCoachRangeAction: (...args: unknown[]) => fetchCoachRangeSpy(...args),
  fetchCoachWeekLessonsAction: (...args: unknown[]) =>
    fetchCoachWeekLessonsSpy(...args),
  fetchHouseholdByIdAction: (...args: unknown[]) => fetchHouseholdByIdSpy(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

import CoachBookLessonContent from "../content/CoachBookLessonContent/CoachBookLessonContent";
import ConfirmBookingDialog from "../content/CoachBookLessonContent/ConfirmBookingDialog";
import Step2TimePicker from "../content/CoachBookLessonContent/Step2TimePicker";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000001";
const SWIMMER_ID = "00000000-0000-0000-0000-000000000011";
const HOME_POOL_ID = "00000000-0000-0000-0000-000000000021";
const NAMED_POOL_ID = "00000000-0000-0000-0000-000000000031";

const HOUSEHOLD: CoachHouseholdSearchResult = {
  householdId: HOUSEHOLD_ID,
  householdName: "Smith household",
  memberFullNames: ["Jane Smith"],
  swimmers: [
    { id: SWIMMER_ID, firstName: "Alex", lastName: "Smith", isArchived: false },
  ],
  homePoolLocationId: HOME_POOL_ID,
};

const NAMED_POOLS: LessonLocation[] = [
  {
    id: NAMED_POOL_ID,
    name: "Egret Park",
    address: "45 Ovation",
    city: "Irvine",
    state: "CA",
    zip: "92620",
    isHomePool: false,
    isActive: true,
    sortOrder: 0,
  },
];

const EMPTY_WARNINGS: CoachBookingWarnings = {
  outsideHours: false,
  maxAdvanceExceeded: false,
  travelBufferViolated: false,
  dailyCapExceeded: false,
  blockedTimeOverlap: false,
};

// Build a minimal available-range week response the Step2TimePicker consumes.
function emptyWeek(dateStr: string) {
  return {
    needsApproval: false,
    days: Array.from({ length: 7 }, (_, index) => ({
      date: `${dateStr.slice(0, 8)}${String(Number(dateStr.slice(8)) + index).padStart(2, "0")}`,
      dayState: "closed" as const,
      openCount: 0,
      totalCount: 0,
      teachingWindows: [],
      slots: [],
    })),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CoachBookLessonContent", () => {
  it("skips step 1 when pre-filled from /coach/swimmers/[id]", async () => {
    fetchCoachRangeSpy.mockResolvedValue(emptyWeek("2026-10-22"));
    render(
      <CoachBookLessonContent
        initialHousehold={HOUSEHOLD}
        initialSwimmerIds={[SWIMMER_ID]}
        namedPools={NAMED_POOLS}
        bookingMaxAdvanceWeeks={10}
      />,
    );
    // Step 2 markers.
    expect(await screen.findByText(/booking for/i)).toBeInTheDocument();
    expect(screen.getByText(/Smith household/i)).toBeInTheDocument();
    // No household search input visible.
    expect(screen.queryByPlaceholderText(/search by swimmer/i)).not.toBeInTheDocument();
  });

  it("starts on step 1 with no pre-fill", () => {
    render(
      <CoachBookLessonContent
        initialHousehold={null}
        initialSwimmerIds={[]}
        namedPools={NAMED_POOLS}
        bookingMaxAdvanceWeeks={10}
      />,
    );
    expect(screen.getByPlaceholderText(/search by swimmer/i)).toBeInTheDocument();
    // Next button disabled until a swimmer is picked.
    const next = screen.getByRole("button", { name: /^next$/i });
    expect(next).toBeDisabled();
  });
});

describe("ConfirmBookingDialog warnings + 409 flow", () => {
  const summary = {
    householdName: "Smith household",
    swimmerFirstNames: ["Alex"],
    locationName: "Egret Park",
    startsAtUtc: "2026-11-01T18:00:00.000Z",
    durationMinutes: 30 as const,
    overrideWindow: true,
  };

  it("renders a checkbox per TRUE warning and disables submit until all are checked", () => {
    const onSubmit = vi.fn();
    render(
      <ConfirmBookingDialog
        open
        summary={summary}
        warnings={{
          ...EMPTY_WARNINGS,
          outsideHours: true,
          dailyCapExceeded: true,
        }}
        bookingMaxAdvanceWeeks={10}
        isSubmitting={false}
        errorMessage={null}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    const alerts = screen.getAllByRole("alert", { hidden: true });
    const warningsAlert = alerts.find((element) =>
      /outside your teaching hours/i.test(element.textContent ?? ""),
    );
    expect(warningsAlert).toBeDefined();
    expect(warningsAlert!).toHaveTextContent(/outside your teaching hours/i);
    expect(warningsAlert!).toHaveTextContent(/daily lesson cap/i);

    const checkboxes = screen.getAllByRole("checkbox", { hidden: true });
    expect(checkboxes).toHaveLength(2);
    for (const checkbox of checkboxes) {
      expect(checkbox).not.toBeChecked();
    }

    // Click the top-level Confirm (the dialog's "Book anyway" button) —
    // acknowledgements are missing, so onSubmit should not fire.
    fireEvent.click(screen.getByRole("button", { name: /book anyway/i, hidden: true }));
    expect(onSubmit).not.toHaveBeenCalled();

    // Check both.
    for (const checkbox of checkboxes) {
      fireEvent.click(checkbox);
    }

    fireEvent.click(screen.getByRole("button", { name: /book anyway/i, hidden: true }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submittedAck = onSubmit.mock.calls[0]![0] as CoachBookingWarnings;
    expect(submittedAck.outsideHours).toBe(true);
    expect(submittedAck.dailyCapExceeded).toBe(true);
    // Flags the server didn't flag stay false.
    expect(submittedAck.travelBufferViolated).toBe(false);
  });

  it("renders the insufficient-balance panel + 'Book as free lesson' when the server rejects the charge", () => {
    const onBookAsFree = vi.fn();
    render(
      <ConfirmBookingDialog
        open
        summary={summary}
        warnings={null}
        balanceShortfall={{
          balanceCents: 2000,
          priceCents: 6000,
          shortfallCents: 4000,
        }}
        bookingMaxAdvanceWeeks={10}
        isSubmitting={false}
        errorMessage={null}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
        onBookAsFree={onBookAsFree}
      />,
    );
    const panel = screen.getByTestId("coach-balance-shortfall");
    expect(panel.textContent).toMatch(/Balance.*\$20\.00/);
    expect(panel.textContent).toMatch(/Lesson.*\$60\.00/);
    expect(panel.textContent).toMatch(/Short by.*\$40\.00/);

    const freeBtn = screen.getByTestId("coach-book-as-free");
    fireEvent.click(freeBtn);
    expect(onBookAsFree).toHaveBeenCalledTimes(1);
  });

  it("surfaces slot_unavailable error without closing the dialog", () => {
    const onCancel = vi.fn();
    const { rerender } = render(
      <ConfirmBookingDialog
        open
        summary={summary}
        warnings={null}
        bookingMaxAdvanceWeeks={10}
        isSubmitting={false}
        errorMessage={null}
        onCancel={onCancel}
        onSubmit={vi.fn()}
      />,
    );
    // Dialog still open; error prop surfaces inline.
    rerender(
      <ConfirmBookingDialog
        open
        summary={summary}
        warnings={null}
        bookingMaxAdvanceWeeks={10}
        isSubmitting={false}
        errorMessage="That time isn't available anymore. Pick another one."
        onCancel={onCancel}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText(/isn't available anymore/i, { exact: false })).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe("Step2TimePicker custom-time overlap across all pools", () => {
  // Freeze "now" so the default custom-time (today at 16:00 LA) is in the
  // future and the time dropdown includes it. 2026-11-02T18:00:00Z is
  // 10:00 AM PST on a Monday in LA — well before 4 PM.
  const FROZEN_NOW = new Date("2026-11-02T18:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(FROZEN_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flags overlap when another lesson exists at a different pool at the chosen time, and disables Confirm", async () => {
    // Compute today's 16:00 LA (the picker's default) as UTC. Any lesson
    // starting at that same instant must trigger the overlap guard —
    // regardless of its location, matching the server's hard-reject rule.
    const todayStr = todayLA();
    const overlappingStart = laDateTimeToUtcIso(todayStr, "16:00");

    fetchCoachRangeSpy.mockResolvedValue({
      needsApproval: false,
      days: Array.from({ length: 7 }, (_, index) => ({
        date: todayStr.slice(0, 8) + String(Number(todayStr.slice(8)) + index).padStart(2, "0"),
        dayState: "closed" as const,
        openCount: 0,
        totalCount: 0,
        teachingWindows: [],
        slots: [],
      })),
    });

    // The booking is being made for NAMED_POOLS[0] (Egret Park) via the
    // household's home pool, but the conflicting lesson is at a DIFFERENT
    // pool. The server rejects any time overlap at any pool; so should
    // the client.
    fetchCoachWeekLessonsSpy.mockResolvedValue([
      {
        startsAtUtc: overlappingStart,
        durationMinutes: 30,
        locationName: "Swallows Park",
      },
    ]);

    const onConfirm = vi.fn();
    render(
      <Step2TimePicker
        household={HOUSEHOLD}
        swimmerIds={[SWIMMER_ID]}
        namedPools={NAMED_POOLS}
        onConfirm={onConfirm}
        onBack={vi.fn()}
      />,
    );

    // Let both useEffect fetches resolve.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Open the custom-time picker. Default: today at 16:00 LA.
    fireEvent.click(screen.getByRole("button", { name: /pick a custom time/i }));

    // Let the overlap useMemo recompute.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // The overlap error names the OTHER pool.
    const overlapText = await screen.findByText(/overlaps the/i);
    expect(overlapText.textContent).toMatch(/swallows park/i);

    // Confirm is disabled.
    const confirmButton = screen.getByRole("button", { name: /^confirm$/i });
    expect(confirmButton).toBeDisabled();

    expect(onConfirm).not.toHaveBeenCalled();
  });
});

// Regression test for the Phase-3 follow-up: when the range-availability
// fetch returns null, Step2TimePicker must render its "Couldn't load
// availability" card with a retry button and NOT render the WeekGrid (which
// could still be showing stale open/closed state and look like "no
// availability").
describe("Step2TimePicker — availability fetch failure", () => {
  it("renders the error card with a Retry button (not the week grid) on failure", async () => {
    fetchCoachRangeSpy.mockResolvedValue(null);

    render(
      <Step2TimePicker
        household={HOUSEHOLD}
        swimmerIds={[SWIMMER_ID]}
        namedPools={NAMED_POOLS}
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.getByText(/could not load availability/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^retry$/i }),
    ).toBeInTheDocument();
  });

  it("retry re-invokes the range action", async () => {
    // First call fails, second call succeeds with an empty week.
    const todayStr = todayLA();
    fetchCoachRangeSpy
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        needsApproval: false,
        days: Array.from({ length: 7 }, (_, index) => ({
          date:
            todayStr.slice(0, 8) +
            String(Number(todayStr.slice(8)) + index).padStart(2, "0"),
          dayState: "closed" as const,
          openCount: 0,
          totalCount: 0,
          teachingWindows: [],
          slots: [],
        })),
      });

    render(
      <Step2TimePicker
        household={HOUSEHOLD}
        swimmerIds={[SWIMMER_ID]}
        namedPools={NAMED_POOLS}
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // First call recorded. Clicking Retry fires a second call.
    expect(fetchCoachRangeSpy).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /^retry$/i }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(fetchCoachRangeSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

// Exercises the exact pre-fill resolver that /coach/book/page.tsx (a
// server component) calls. If this helper slips back into a "use client"
// module, the page crashes on load — this test is the regression guard.
describe("computeInitialSwimmerIds (server-safe pre-fill helper)", () => {
  const ACTIVE_ID = "00000000-0000-0000-0000-000000000011";
  const ARCHIVED_ID = "00000000-0000-0000-0000-000000000012";
  const UNKNOWN_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";
  const HOUSEHOLD_FOR_PREFILL: CoachHouseholdSearchResult = {
    householdId: "00000000-0000-0000-0000-000000000001",
    householdName: "Smith household",
    memberFullNames: [],
    swimmers: [
      { id: ACTIVE_ID, firstName: "Alex", lastName: "Smith", isArchived: false },
      {
        id: ARCHIVED_ID,
        firstName: "Ghost",
        lastName: "Smith",
        isArchived: true,
      },
    ],
    homePoolLocationId: null,
  };

  it("returns the active swimmer when the pre-fill id matches", () => {
    expect(computeInitialSwimmerIds(HOUSEHOLD_FOR_PREFILL, ACTIVE_ID)).toEqual([ACTIVE_ID]);
  });

  it("returns [] when no household is pre-filled", () => {
    expect(computeInitialSwimmerIds(null, ACTIVE_ID)).toEqual([]);
  });

  it("returns [] when no swimmer is pre-filled", () => {
    expect(computeInitialSwimmerIds(HOUSEHOLD_FOR_PREFILL, undefined)).toEqual([]);
  });

  it("returns [] when the pre-fill swimmer isn't in this household", () => {
    expect(computeInitialSwimmerIds(HOUSEHOLD_FOR_PREFILL, UNKNOWN_ID)).toEqual([]);
  });

  it("returns [] when the pre-fill swimmer is archived", () => {
    expect(computeInitialSwimmerIds(HOUSEHOLD_FOR_PREFILL, ARCHIVED_ID)).toEqual([]);
  });
});
