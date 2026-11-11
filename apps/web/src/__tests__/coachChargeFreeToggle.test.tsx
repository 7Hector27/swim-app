import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import type {
  CoachBookingWarnings,
  CoachCreateLessonBody,
} from "@swim-app/shared";

import ConfirmBookingDialog from "../content/CoachBookLessonContent/ConfirmBookingDialog";

const EMPTY_WARNINGS: CoachBookingWarnings = {
  outsideHours: false,
  maxAdvanceExceeded: false,
  travelBufferViolated: false,
  dailyCapExceeded: false,
  blockedTimeOverlap: false,
};

const SUMMARY = {
  householdName: "Smith household",
  swimmerFirstNames: ["Alex"],
  locationName: "Egret Park",
  startsAtUtc: "2026-11-02T23:00:00.000Z",
  durationMinutes: 30 as const,
  overrideWindow: false,
};

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
});

function renderDialog(
  overrides: Partial<
    React.ComponentProps<typeof ConfirmBookingDialog>
  > = {},
) {
  const defaults: React.ComponentProps<typeof ConfirmBookingDialog> = {
    open: true,
    summary: SUMMARY,
    warnings: null,
    balanceShortfall: null,
    balanceCents: 10_000,
    priceCents: 6_000,
    chargeType: "balance",
    onChangeChargeType: vi.fn(),
    bookingMaxAdvanceWeeks: 10,
    isSubmitting: false,
    errorMessage: null,
    onCancel: vi.fn(),
    onSubmit: vi.fn(),
    onBookAsFree: vi.fn(),
  };
  return render(<ConfirmBookingDialog {...defaults} {...overrides} />);
}

describe("Coach booking Charge balance / Free lesson toggle", () => {
  it("renders the toggle and the balance/lesson line when priceCents is known", () => {
    renderDialog();
    const toggle = screen.getByTestId("coach-charge-toggle");
    expect(toggle).toBeInTheDocument();
    expect(toggle.textContent).toMatch(/Lesson:\s*\$60\.00/);
    expect(toggle.textContent).toMatch(/Balance:\s*\$100\.00/);
    expect(screen.getByTestId("coach-charge-balance")).toBeInTheDocument();
    expect(screen.getByTestId("coach-charge-free")).toBeInTheDocument();
  });

  it("defaults to Charge balance and reflects chargeType via aria-checked", () => {
    renderDialog({ chargeType: "balance" });
    expect(
      screen.getByTestId("coach-charge-balance").getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen.getByTestId("coach-charge-free").getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("calls onChangeChargeType('free') when the Free lesson option is tapped", () => {
    const onChange = vi.fn();
    renderDialog({ onChangeChargeType: onChange });
    fireEvent.click(screen.getByTestId("coach-charge-free"));
    expect(onChange).toHaveBeenCalledWith("free");
  });

  it("disables Charge balance when the family can't cover the lesson AND shows a shortfall hint", () => {
    renderDialog({ balanceCents: 1_000, priceCents: 6_000 });
    const charge = screen.getByTestId("coach-charge-balance") as HTMLButtonElement;
    expect(charge.disabled).toBe(true);
    const hint = screen.getByTestId("coach-charge-short-hint");
    expect(hint.textContent).toMatch(/short by\s*\$50\.00/i);
    // Free lesson stays interactive.
    expect(
      (screen.getByTestId("coach-charge-free") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("does NOT disable Charge balance when balance is unknown — the server's 422 fallback is the backstop", () => {
    renderDialog({ balanceCents: null, priceCents: 6_000 });
    const charge = screen.getByTestId("coach-charge-balance") as HTMLButtonElement;
    expect(charge.disabled).toBe(false);
    expect(screen.queryByTestId("coach-charge-short-hint")).toBeNull();
  });

  it("hides the whole toggle when priceCents is null (dialog not yet priced)", () => {
    renderDialog({ priceCents: null });
    expect(screen.queryByTestId("coach-charge-toggle")).toBeNull();
  });

  it("swaps the in-dialog toggle for the shortfall panel when the server has rejected the charge", () => {
    renderDialog({
      balanceShortfall: {
        balanceCents: 2_000,
        priceCents: 6_000,
        shortfallCents: 4_000,
      },
    });
    // The regular toggle is suppressed while the shortfall panel takes over —
    // the two can't both be the primary action at the same time.
    expect(screen.queryByTestId("coach-charge-toggle")).toBeNull();
    const shortfall = screen.getByTestId("coach-balance-shortfall");
    expect(shortfall.textContent).toMatch(/Family can.{0,3}t cover/i);
    expect(screen.getByTestId("coach-book-as-free")).toBeInTheDocument();
  });

  it("'Book as free lesson' calls onBookAsFree", () => {
    const onBookAsFree = vi.fn();
    renderDialog({
      balanceShortfall: {
        balanceCents: 2_000,
        priceCents: 6_000,
        shortfallCents: 4_000,
      },
      onBookAsFree,
    });
    fireEvent.click(screen.getByTestId("coach-book-as-free"));
    expect(onBookAsFree).toHaveBeenCalledTimes(1);
  });

  it("the underlying onSubmit remains wired to the dialog's primary Book button", () => {
    const onSubmit = vi.fn();
    renderDialog({ onSubmit });
    fireEvent.click(
      screen.getByRole("button", { name: /book lesson/i, hidden: true }),
    );
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submittedAck = onSubmit.mock.calls[0]![0] as CoachBookingWarnings;
    // The acknowledgements map is defaulted empty when no server warnings
    // are showing — the chargeType selection flows through separately.
    expect(submittedAck).toEqual(EMPTY_WARNINGS);
  });

  // Type guard — `chargeType` is the exact union from the shared schema.
  it("accepts the shared CoachCreateLessonBody['chargeType'] union without casting", () => {
    const value: CoachCreateLessonBody["chargeType"] = "free";
    renderDialog({ chargeType: value });
    expect(
      screen.getByTestId("coach-charge-free").getAttribute("aria-checked"),
    ).toBe("true");
  });
});
