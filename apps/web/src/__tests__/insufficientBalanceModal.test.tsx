import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// Mock the server action — we assert how the modal calls it, not that
// the real API gets hit.
const mockStartBookingShortfallTopupAction = vi.fn();
vi.mock("@/content/AccountBalanceContent/actions", () => ({
  startBookingShortfallTopupAction: (
    ...args: Parameters<typeof mockStartBookingShortfallTopupAction>
  ) => mockStartBookingShortfallTopupAction(...args),
}));

import InsufficientBalanceModal, {
  clearPendingBooking,
  readPendingBooking,
  stashPendingBooking,
} from "@/content/BookCalendarContent/InsufficientBalanceModal";

const attempt = {
  startsAt: "2026-12-02T20:30:00.000Z",
  durationMinutes: 30 as const,
  locationId: "11111111-1111-1111-1111-111111111111",
  swimmerIds: ["22222222-2222-2222-2222-222222222222"],
};

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  // jsdom doesn't implement location.href-driven navigation; stub so
  // the "redirect" branch doesn't try to navigate for real.
  Object.defineProperty(window, "location", {
    writable: true,
    value: { href: "" } as Location,
  });
});

describe("sessionStorage helpers", () => {
  it("roundtrips a single-mode booking through sessionStorage with a stashedAt timestamp", () => {
    stashPendingBooking(attempt);
    expect(readPendingBooking()).toMatchObject({
      mode: "single",
      startsAt: attempt.startsAt,
      durationMinutes: attempt.durationMinutes,
      locationId: attempt.locationId,
      swimmerIds: attempt.swimmerIds,
    });
    // stashedAt is set when written and is a valid ISO date string.
    const read = readPendingBooking();
    expect(read).not.toBeNull();
    expect(typeof read!.stashedAt).toBe("string");
    expect(Number.isFinite(Date.parse(read!.stashedAt))).toBe(true);
  });

  it("returns null when no pending booking is stashed", () => {
    expect(readPendingBooking()).toBeNull();
  });

  it("returns null when the stashed value is malformed", () => {
    window.sessionStorage.setItem("axiom:pending-booking", "{not json");
    expect(readPendingBooking()).toBeNull();
  });

  it("clears the pending booking", () => {
    stashPendingBooking(attempt);
    clearPendingBooking();
    expect(readPendingBooking()).toBeNull();
  });

  it("drops a stash whose stashedAt is more than an hour old", () => {
    const oneHourAnd1MsAgo = new Date(Date.now() - 60 * 60 * 1000 - 1).toISOString();
    window.sessionStorage.setItem(
      "axiom:pending-booking",
      JSON.stringify({
        mode: "single",
        stashedAt: oneHourAnd1MsAgo,
        ...attempt,
      }),
    );
    expect(readPendingBooking()).toBeNull();
    // Stale entry is cleaned up so the next read doesn't keep paying the parse cost.
    expect(window.sessionStorage.getItem("axiom:pending-booking")).toBeNull();
  });
});

describe("InsufficientBalanceModal", () => {
  it("renders nothing when open=false", () => {
    const { container } = render(
      <InsufficientBalanceModal
        open={false}
        balanceCents={1_000}
        priceCents={6_000}
        shortfallCents={5_000}
        attempt={attempt}
        onClose={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows the price, balance, and the Add-credit + Buy-a-package CTAs", () => {
    render(
      <InsufficientBalanceModal
        open={true}
        balanceCents={1_000}
        priceCents={6_000}
        shortfallCents={5_000}
        attempt={attempt}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/not enough balance/i)).toBeInTheDocument();
    // Price + balance appear verbatim.
    expect(screen.getByText(/this lesson costs/i)).toHaveTextContent("$60.00");
    expect(screen.getByText(/this lesson costs/i)).toHaveTextContent("$10.00");
    expect(
      screen.getByRole("button", { name: /add \$60\.00 of credit/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /buy a package/i })).toBeInTheDocument();
  });

  it("stashes the booking + calls the topup action with the booking return path on Add credit", async () => {
    mockStartBookingShortfallTopupAction.mockResolvedValue({
      kind: "redirect",
      url: "https://checkout.stripe.test/sess_abc",
    });

    render(
      <InsufficientBalanceModal
        open={true}
        balanceCents={1_000}
        priceCents={6_000}
        shortfallCents={5_000}
        attempt={attempt}
        onClose={() => {}}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add \$60\.00 of credit/i }));
    });

    // The pending booking lands in sessionStorage so /dashboard/book?resume=1
    // can rehydrate it.
    expect(readPendingBooking()).toMatchObject({ mode: "single", ...attempt });
    // Server action was called with the attempted duration + swimmer
    // count + the booking return path.
    expect(mockStartBookingShortfallTopupAction).toHaveBeenCalledTimes(1);
    expect(mockStartBookingShortfallTopupAction).toHaveBeenCalledWith(
      30,
      1,
      "/dashboard/book?resume=1",
    );
    // Window redirected to the Stripe URL.
    expect(window.location.href).toBe("https://checkout.stripe.test/sess_abc");
  });

  it("Buy a package stashes the booking AND navigates to /account/balance?resume=book so the return URL flows back to the pending lesson", () => {
    render(
      <InsufficientBalanceModal
        open={true}
        balanceCents={1_000}
        priceCents={6_000}
        shortfallCents={5_000}
        attempt={attempt}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /buy a package/i }));

    // The booking is stashed in sessionStorage so the eventual
    // Stripe-return-to-/book?resume=1 picks it up.
    expect(readPendingBooking()).toMatchObject({ mode: "single", ...attempt });
    // resume=book tells the balance page to wire the Checkout
    // success_url back at /dashboard/book?resume=1 instead of back at
    // itself. Regression guard for the "manual navigation" path.
    expect(window.location.href).toBe("/account/balance?resume=book");
  });

  it("calls onClose when 'Not now' is clicked without stashing", () => {
    const onClose = vi.fn();
    render(
      <InsufficientBalanceModal
        open={true}
        balanceCents={1_000}
        priceCents={6_000}
        shortfallCents={5_000}
        attempt={attempt}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /not now/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(readPendingBooking()).toBeNull();
  });
});
