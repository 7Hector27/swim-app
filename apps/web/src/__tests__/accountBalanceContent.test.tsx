import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

// Mock the server actions so the render doesn't try to reach the DB.
// Checkout + history actions are not exercised in these tests — they
// run in integration against the real API. Formatters + rendering are
// what we assert here.
vi.mock("@/content/AccountBalanceContent/actions", () => ({
  startPackageCheckoutAction: vi.fn(),
  startLessonTopupAction: vi.fn(),
  fetchMoreHistoryAction: vi.fn(),
  refreshBalanceAction: vi.fn().mockResolvedValue(null),
}));

// Pin prefers-reduced-motion to `matches: true` for this test file so
// the balance card's useCountUp jumps straight to the target value on
// mount instead of animating from 0 across multiple rAF ticks. The
// animation itself is tested at the visual level; these specs assert
// content + branching copy.
beforeAll(() => {
  window.matchMedia = (query: string) => ({
    matches: query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList;
});

import AccountBalanceContent from "@/content/AccountBalanceContent/AccountBalanceContent";

beforeEach(() => {
  vi.clearAllMocks();
});

const emptyHistory = { entries: [], nextCursor: null };

describe("AccountBalanceContent — balance card", () => {
  it("renders the balance in dollars with the approximate hours line", () => {
    render(
      <AccountBalanceContent
        balance={{ balanceCents: 24_000, approximatePrivateHours: 2 }}
        initialHistory={emptyHistory}
        activeSwimmerCount={1}
        topupState={null}
        resumeBookingReturnTo={null}
      />,
    );
    expect(screen.getByText("$240.00")).toBeInTheDocument();
    expect(screen.getByText(/≈ 2 hours of private lessons/)).toBeInTheDocument();
  });

  it("handles a null balance by rendering $0.00", () => {
    render(
      <AccountBalanceContent
        balance={null}
        initialHistory={emptyHistory}
        activeSwimmerCount={1}
        topupState={null}
        resumeBookingReturnTo={null}
      />,
    );
    expect(screen.getByText("$0.00")).toBeInTheDocument();
  });
});

// Hours line threshold: below the cheapest private lesson ($60 = 30
// min × 1 swimmer) we drop the "≈ N hours" line in favor of an
// actionable sentence. The hours figure always rounds DOWN (the API's
// approximatePrivateHours already floors to the nearest half-hour),
// so a balance that could cover 0.5 hours exactly shows 0.5, and a
// balance a cent short shows the "not quite enough" copy.
describe("AccountBalanceContent — hours line threshold", () => {
  it("at $45 (below one 30-minute lesson) shows the 'not quite enough' copy, not an hours estimate", () => {
    render(
      <AccountBalanceContent
        balance={{ balanceCents: 4_500, approximatePrivateHours: 0 }}
        initialHistory={emptyHistory}
        activeSwimmerCount={1}
        topupState={null}
        resumeBookingReturnTo={null}
      />,
    );
    expect(screen.getByText("$45.00")).toBeInTheDocument();
    expect(
      screen.getByText("Not quite enough for a 30-minute lesson"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/of private lessons/)).toBeNull();
  });

  it("at $60 (exactly one 30-minute lesson) shows ≈ 0.5 hours", () => {
    render(
      <AccountBalanceContent
        balance={{ balanceCents: 6_000, approximatePrivateHours: 0.5 }}
        initialHistory={emptyHistory}
        activeSwimmerCount={1}
        topupState={null}
        resumeBookingReturnTo={null}
      />,
    );
    // $60.00 appears both in the balance card and in the default
    // buy-lessons total (one 30-min × 1 swimmer lesson), so assert
    // via the balance card's hours-line testid. formatApproxHours's
    // output is a separate text node from " of private lessons";
    // assert on textContent instead of a regex against one node.
    expect(screen.getByTestId("balance-hours-line").textContent?.replace(/\s+/g, " ").trim()).toBe(
      "≈ 0.5 hours of private lessons",
    );
    expect(screen.queryByTestId("balance-not-enough")).toBeNull();
  });

  it("at $130 (one 60-minute lesson plus change) shows ≈ 1 hour, floored", () => {
    render(
      <AccountBalanceContent
        balance={{ balanceCents: 13_000, approximatePrivateHours: 1 }}
        initialHistory={emptyHistory}
        activeSwimmerCount={1}
        topupState={null}
        resumeBookingReturnTo={null}
      />,
    );
    expect(screen.getByText("$130.00")).toBeInTheDocument();
    expect(screen.getByTestId("balance-hours-line").textContent?.replace(/\s+/g, " ").trim()).toBe(
      "≈ 1 hour of private lessons",
    );
    expect(screen.queryByTestId("balance-not-enough")).toBeNull();
  });
});

describe("AccountBalanceContent — history signs", () => {
  it("renders a package_purchase row with a + prefix (money arriving)", () => {
    render(
      <AccountBalanceContent
        balance={{ balanceCents: 10_800, approximatePrivateHours: 1 }}
        initialHistory={{
          entries: [
            {
              id: "e1",
              entryType: "package_purchase",
              amountCents: 10_800,
              runningBalanceCents: 10_800,
              createdAt: "2026-11-09T18:00:00+00:00",
              displayType: "Package purchased",
            },
          ],
          nextCursor: null,
        }}
        activeSwimmerCount={1}
        topupState={null}
        resumeBookingReturnTo={null}
      />,
    );
    // The row label survives, and the amount renders as +$108.00 — not
    // -$108.00 (regression guard for the sign of balance entries).
    expect(screen.getByText("Package purchased")).toBeInTheDocument();
    expect(screen.getByText("+$108.00")).toBeInTheDocument();
    expect(screen.queryByText("-$108.00")).not.toBeInTheDocument();
  });

  it("renders a lesson_charge with a bare - prefix (money leaving)", () => {
    render(
      <AccountBalanceContent
        balance={{ balanceCents: 0, approximatePrivateHours: 0 }}
        initialHistory={{
          entries: [
            {
              id: "e2",
              entryType: "lesson_charge",
              amountCents: -6_000,
              runningBalanceCents: 0,
              createdAt: "2026-11-09T18:00:00+00:00",
              displayType: "Lesson",
            },
          ],
          nextCursor: null,
        }}
        activeSwimmerCount={1}
        topupState={null}
        resumeBookingReturnTo={null}
      />,
    );
    expect(screen.getByText("Lesson")).toBeInTheDocument();
    expect(screen.getByText("-$60.00")).toBeInTheDocument();
  });

  it("renders a refund_to_balance with a + prefix", () => {
    render(
      <AccountBalanceContent
        balance={{ balanceCents: 6_000, approximatePrivateHours: 0.5 }}
        initialHistory={{
          entries: [
            {
              id: "e3",
              entryType: "refund_to_balance",
              amountCents: 6_000,
              runningBalanceCents: 6_000,
              createdAt: "2026-11-09T18:00:00+00:00",
              displayType: "Refund",
            },
          ],
          nextCursor: null,
        }}
        activeSwimmerCount={1}
        topupState={null}
        resumeBookingReturnTo={null}
      />,
    );
    expect(screen.getByText("Refund")).toBeInTheDocument();
    expect(screen.getByText("+$60.00")).toBeInTheDocument();
  });

  it("shows the empty-state copy when there are no entries", () => {
    render(
      <AccountBalanceContent
        balance={{ balanceCents: 0, approximatePrivateHours: 0 }}
        initialHistory={emptyHistory}
        activeSwimmerCount={1}
        topupState={null}
        resumeBookingReturnTo={null}
      />,
    );
    expect(screen.getByText(/nothing yet/i)).toBeInTheDocument();
  });
});

describe("AccountBalanceContent — topup result banner", () => {
  it("shows the success banner when topupState is 'success'", () => {
    render(
      <AccountBalanceContent
        balance={{ balanceCents: 10_800, approximatePrivateHours: 1 }}
        initialHistory={emptyHistory}
        activeSwimmerCount={1}
        topupState="success"
        resumeBookingReturnTo={null}
      />,
    );
    expect(screen.getByText(/thanks — your balance is refreshing/i)).toBeInTheDocument();
  });

  it("shows the cancelled banner when topupState is 'cancelled'", () => {
    render(
      <AccountBalanceContent
        balance={{ balanceCents: 0, approximatePrivateHours: 0 }}
        initialHistory={emptyHistory}
        activeSwimmerCount={1}
        topupState="cancelled"
        resumeBookingReturnTo={null}
      />,
    );
    expect(screen.getByText(/checkout cancelled/i)).toBeInTheDocument();
    expect(screen.getByText(/your balance is unchanged/i)).toBeInTheDocument();
  });
});

describe("AccountBalanceContent — package swimmer-count highlight", () => {
  it("marks the household's active swimmer count as the default on every package card", () => {
    render(
      <AccountBalanceContent
        balance={{ balanceCents: 0, approximatePrivateHours: 0 }}
        initialHistory={emptyHistory}
        activeSwimmerCount={2}
        topupState={null}
        resumeBookingReturnTo={null}
      />,
    );
    // Each package card (Cannonball + Deep End) renders its own
    // swimmer-count radiogroup with the household's count pre-checked.
    const groups = screen.getAllByRole("radiogroup", { name: /Swimmer count for/i });
    expect(groups.length).toBe(2);
    for (const group of groups) {
      const selected = within(group).getByRole("radio", { checked: true });
      expect(selected.textContent?.trim()).toBe("2");
    }
  });
});

describe("AccountBalanceContent — resume-booking banner", () => {
  it("shows the resume-aware status copy when resumeBookingReturnTo is set", () => {
    render(
      <AccountBalanceContent
        balance={{ balanceCents: 0, approximatePrivateHours: 0 }}
        initialHistory={emptyHistory}
        activeSwimmerCount={1}
        topupState={null}
        resumeBookingReturnTo="/dashboard/book?resume=1"
      />,
    );
    expect(screen.getByText(/add credit, then finish your booking/i)).toBeInTheDocument();
    expect(
      screen.getByText(/after checkout we.ll bring you back to your pending lesson/i),
    ).toBeInTheDocument();
  });

  it("does not render the resume banner when resumeBookingReturnTo is null", () => {
    render(
      <AccountBalanceContent
        balance={{ balanceCents: 0, approximatePrivateHours: 0 }}
        initialHistory={emptyHistory}
        activeSwimmerCount={1}
        topupState={null}
        resumeBookingReturnTo={null}
      />,
    );
    expect(screen.queryByText(/add credit, then finish your booking/i)).not.toBeInTheDocument();
  });
});
