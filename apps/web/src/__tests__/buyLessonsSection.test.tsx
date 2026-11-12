// ADR 036 Phase 8 Part B Stop 3 piece 8: /account/balance replaces
// the "add credit for one lesson" tile with a quantity-aware buy
// form (length + swimmers + quantity 1..20). These tests pin the
// surface behavior: the live total line, the quantity bounds, the
// package nudge thresholds, and the quantity threaded through to
// the server action.

import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const { startLessonTopupMock } = vi.hoisted(() => ({
  startLessonTopupMock: vi.fn(),
}));

vi.mock("@/content/AccountBalanceContent/actions", () => ({
  startPackageCheckoutAction: vi.fn(),
  startLessonTopupAction: (...args: Parameters<typeof startLessonTopupMock>) =>
    startLessonTopupMock(...args),
  fetchMoreHistoryAction: vi.fn(),
  refreshBalanceAction: vi.fn().mockResolvedValue(null),
}));

import AccountBalanceContent from "@/content/AccountBalanceContent/AccountBalanceContent";

const emptyHistory = { entries: [], nextCursor: null };

function renderAt(swimmerCount: 1 | 2 | 3 | 4 = 1) {
  render(
    <AccountBalanceContent
      balance={{ balanceCents: 10_000, approximatePrivateHours: 0.5 }}
      initialHistory={emptyHistory}
      activeSwimmerCount={swimmerCount}
      topupState={null}
      resumeBookingReturnTo={null}
    />,
  );
}

function pickDuration(label: RegExp) {
  fireEvent.click(screen.getByRole("radio", { name: label }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Buy single lessons — quantity-aware form", () => {
  it("renders the live total as 'N × D-minute lessons for S swimmer = $X'", () => {
    renderAt(1);
    // Default: 30-minute, 1 swimmer, quantity 1 → $60.00
    const total = screen.getByTestId("buy-lessons-total");
    expect(total.textContent?.replace(/\s+/g, " ").trim()).toBe(
      "1 × 30-minute lesson for 1 swimmer = $60.00",
    );
  });

  it("updates the total when the parent bumps quantity and length", () => {
    renderAt(1);
    pickDuration(/45 min/);
    const input = screen.getByTestId("buy-lessons-quantity") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "4" } });
    // 4 × 45 min × 1 swimmer × $120/h = $360
    expect(screen.getByTestId("buy-lessons-total").textContent).toMatch(
      /4 × 45-minute lessons for 1 swimmer =\s*\$360\.00/,
    );
  });

  it("clamps quantity to 1..20 via the + / − buttons", () => {
    renderAt(1);
    const input = screen.getByTestId("buy-lessons-quantity") as HTMLInputElement;
    const dec = screen.getByRole("button", { name: /decrease quantity/i });
    const inc = screen.getByRole("button", { name: /increase quantity/i });

    // Starts at 1 — decrement is disabled.
    expect((dec as HTMLButtonElement).disabled).toBe(true);

    // Clamp above max via direct entry.
    fireEvent.change(input, { target: { value: "50" } });
    expect(input.value).toBe("20");
    // At the ceiling, increment is disabled.
    expect((inc as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the Cannonball nudge with the package's credit + price at ≥10 hours and <20 hours", () => {
    // Cannonball at 1 swimmer: creditCents = 10 hours × $120 = $1,200;
    // priceCents = $1,200 × 0.9 = $1,080. Copy is factual about the
    // package itself — not about the parent's current cart total —
    // so landing on 10, 15, or 19 hours all surface the same line.
    renderAt(1);
    pickDuration(/60 min/);
    fireEvent.change(screen.getByTestId("buy-lessons-quantity"), {
      target: { value: "10" },
    });
    const nudge = screen.getByTestId("buy-lessons-package-nudge");
    expect(nudge.textContent?.replace(/\s+/g, " ").trim()).toBe(
      "Buying 10+ hours? Cannonball gets you $1,200.00 of credit for $1,080.00.",
    );

    // Bump to 15 hours (9 × 60 + still Cannonball territory): same
    // copy, regardless of exact total.
    fireEvent.change(screen.getByTestId("buy-lessons-quantity"), {
      target: { value: "15" },
    });
    expect(
      screen.getByTestId("buy-lessons-package-nudge").textContent?.replace(/\s+/g, " ").trim(),
    ).toBe("Buying 10+ hours? Cannonball gets you $1,200.00 of credit for $1,080.00.");
  });

  it("switches the nudge to Deep End at ≥20 hours", () => {
    // Deep End at 1 swimmer: creditCents = 20 hours × $120 = $2,400;
    // priceCents = $2,400 × 0.8 = $1,920.
    renderAt(1);
    pickDuration(/60 min/);
    fireEvent.change(screen.getByTestId("buy-lessons-quantity"), {
      target: { value: "20" },
    });
    const nudge = screen.getByTestId("buy-lessons-package-nudge");
    expect(nudge.textContent?.replace(/\s+/g, " ").trim()).toBe(
      "Buying 20+ hours? Deep End gets you $2,400.00 of credit for $1,920.00.",
    );
  });

  it("hides the nudge below 10 hours", () => {
    renderAt(1);
    // 5 × 60-min = 5 hours at 1 swimmer → nudge should be absent.
    pickDuration(/60 min/);
    fireEvent.change(screen.getByTestId("buy-lessons-quantity"), {
      target: { value: "5" },
    });
    expect(screen.queryByTestId("buy-lessons-package-nudge")).toBeNull();
  });

  it("threads the current quantity into startLessonTopupAction on submit", async () => {
    startLessonTopupMock.mockResolvedValue({ kind: "redirect", url: "https://example/" });
    Object.defineProperty(window, "location", {
      writable: true,
      value: { href: "" } as Location,
    });
    renderAt(2);
    pickDuration(/45 min/);
    fireEvent.change(screen.getByTestId("buy-lessons-quantity"), {
      target: { value: "3" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("buy-lessons-submit"));
    });
    expect(startLessonTopupMock).toHaveBeenCalledWith(45, 2, 3, "/account/balance");
  });
});
