import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

import type {
  BalanceHistoryResponse,
  BalanceResponse,
} from "@swim-app/shared";

// Mock the Server Actions module — tests drive the modal's state machine
// without touching the real Supabase/REST wiring.
const { mockSubmitAdjustment, mockRefreshBalance, mockFetchMoreHistory } =
  vi.hoisted(() => ({
    mockSubmitAdjustment: vi.fn(),
    mockRefreshBalance: vi.fn(),
    mockFetchMoreHistory: vi.fn(),
  }));

vi.mock("../content/CoachFamilyDetailContent/actions", () => ({
  submitCoachAdjustmentAction: (...args: unknown[]) =>
    mockSubmitAdjustment(...args),
  refreshFamilyBalanceAction: (...args: unknown[]) =>
    mockRefreshBalance(...args),
  fetchMoreFamilyHistoryAction: (...args: unknown[]) =>
    mockFetchMoreHistory(...args),
}));

import CoachFamilyDetailContent from "../content/CoachFamilyDetailContent/CoachFamilyDetailContent";

const HOUSEHOLD_ID = "11111111-1111-1111-1111-111111111111";

const BASE_BALANCE: BalanceResponse = {
  balanceCents: 10_000, // $100
  approximatePrivateHours: 0.5,
};

const BASE_HISTORY: BalanceHistoryResponse = {
  entries: [
    {
      id: "e1",
      entryType: "card_topup",
      amountCents: 10_000,
      runningBalanceCents: 10_000,
      createdAt: "2026-11-01T18:00:00.000Z",
      displayType: "Added credit",
    },
  ],
  nextCursor: null,
};

function renderDetail(initialBalance: BalanceResponse = BASE_BALANCE) {
  return render(
    <CoachFamilyDetailContent
      householdId={HOUSEHOLD_ID}
      householdName="Smith household"
      memberFullNames={["Jane Smith"]}
      activeSwimmerCount={1}
      initialBalance={initialBalance}
      initialHistory={BASE_HISTORY}
      initialNeedsManualJobs={[]}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Adjust balance modal — opening + validation", () => {
  it("opens from the 'Adjust balance' button on the family card", () => {
    renderDetail();
    expect(screen.queryByTestId("adjust-balance-modal")).toBeNull();
    fireEvent.click(screen.getByTestId("adjust-balance-open"));
    expect(screen.getByTestId("adjust-balance-modal")).toBeInTheDocument();
  });

  it("keeps Continue disabled until amount AND reason are both filled", () => {
    renderDetail();
    fireEvent.click(screen.getByTestId("adjust-balance-open"));
    const cont = screen.getByTestId("adjust-continue") as HTMLButtonElement;
    expect(cont.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("adjust-amount"), {
      target: { value: "25" },
    });
    expect(cont.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("adjust-reason"), {
      target: { value: "Thanks for the referral" },
    });
    expect(cont.disabled).toBe(false);
  });

  it("keeps Continue disabled when the amount is zero or non-numeric", () => {
    renderDetail();
    fireEvent.click(screen.getByTestId("adjust-balance-open"));
    fireEvent.change(screen.getByTestId("adjust-reason"), {
      target: { value: "Reason text" },
    });
    const cont = screen.getByTestId("adjust-continue") as HTMLButtonElement;
    fireEvent.change(screen.getByTestId("adjust-amount"), {
      target: { value: "0" },
    });
    expect(cont.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("adjust-amount"), {
      target: { value: "abc" },
    });
    expect(cont.disabled).toBe(true);
  });

  it("keeps Continue disabled when the reason is whitespace only", () => {
    renderDetail();
    fireEvent.click(screen.getByTestId("adjust-balance-open"));
    fireEvent.change(screen.getByTestId("adjust-amount"), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByTestId("adjust-reason"), {
      target: { value: "   " },
    });
    expect(
      (screen.getByTestId("adjust-continue") as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe("Adjust balance modal — confirm step shows the new balance", () => {
  it("renders current balance, direction, amount, new balance, and reason on confirm", () => {
    // $100 starting balance, +$25 credit → $125 new balance.
    renderDetail();
    fireEvent.click(screen.getByTestId("adjust-balance-open"));
    fireEvent.change(screen.getByTestId("adjust-amount"), {
      target: { value: "25" },
    });
    fireEvent.change(screen.getByTestId("adjust-reason"), {
      target: { value: "Birthday credit" },
    });
    fireEvent.click(screen.getByTestId("adjust-continue"));

    const summary = screen.getByTestId("adjust-confirm-summary");
    expect(summary.textContent).toMatch(/Current balance:\s*\$100\.00/);
    expect(summary.textContent).toMatch(/Credit:\s*\$25\.00/);
    expect(summary.textContent).toMatch(/New balance:\s*\$125\.00/);
    expect(summary.textContent).toMatch(/Birthday credit/);
  });

  it("flips the arithmetic sign for a debit — new balance is current − amount", () => {
    renderDetail();
    fireEvent.click(screen.getByTestId("adjust-balance-open"));
    fireEvent.click(screen.getByTestId("adjust-direction-debit"));
    fireEvent.change(screen.getByTestId("adjust-amount"), {
      target: { value: "30" },
    });
    fireEvent.change(screen.getByTestId("adjust-reason"), {
      target: { value: "Correction" },
    });
    fireEvent.click(screen.getByTestId("adjust-continue"));

    const summary = screen.getByTestId("adjust-confirm-summary");
    expect(summary.textContent).toMatch(/Current balance:\s*\$100\.00/);
    expect(summary.textContent).toMatch(/Debit:\s*\$30\.00/);
    expect(summary.textContent).toMatch(/New balance:\s*\$70\.00/);
  });
});

describe("Adjust balance modal — overdraft returns to form with a shortfall message", () => {
  it("sends a cents-signed body, and on 422 returns to the form step with the overdraft line", async () => {
    mockSubmitAdjustment.mockResolvedValueOnce({
      kind: "insufficient_balance",
      balanceCents: 10_000,
      priceCents: 50_000,
      shortfallCents: 40_000,
    });
    renderDetail();
    fireEvent.click(screen.getByTestId("adjust-balance-open"));
    fireEvent.click(screen.getByTestId("adjust-direction-debit"));
    fireEvent.change(screen.getByTestId("adjust-amount"), {
      target: { value: "500" },
    });
    fireEvent.change(screen.getByTestId("adjust-reason"), {
      target: { value: "Would overdraft" },
    });
    fireEvent.click(screen.getByTestId("adjust-continue"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("adjust-confirm"));
    });

    // Server got the signed amount in cents (-50_000) + reason.
    expect(mockSubmitAdjustment).toHaveBeenCalledWith(HOUSEHOLD_ID, {
      amountCents: -50_000,
      reason: "Would overdraft",
    });
    // Back on the form step with the "would drop below zero" line visible.
    expect(screen.getByTestId("adjust-amount")).toBeInTheDocument();
    expect(screen.queryByTestId("adjust-confirm")).toBeNull();
    const shortfall = await screen.findByTestId("adjust-shortfall");
    expect(shortfall.textContent).toMatch(/drop balance below zero/i);
    expect(shortfall.textContent).toMatch(/\$500\.00/);
  });
});

describe("Adjust balance modal — successful save updates the headline balance", () => {
  it("writes the new balance to the family card after a 201 response", async () => {
    mockSubmitAdjustment.mockResolvedValueOnce({
      kind: "ok",
      data: {
        balanceCents: 12_500,
        ledgerId: "l-new",
      },
    });
    // The post-commit history reload also runs — return the same history.
    mockFetchMoreHistory.mockResolvedValue({
      ok: true,
      data: BASE_HISTORY,
    });
    mockRefreshBalance.mockResolvedValue({
      ok: true,
      data: { balanceCents: 12_500, approximatePrivateHours: 0.5 },
    });

    renderDetail();
    fireEvent.click(screen.getByTestId("adjust-balance-open"));
    fireEvent.change(screen.getByTestId("adjust-amount"), {
      target: { value: "25" },
    });
    fireEvent.change(screen.getByTestId("adjust-reason"), {
      target: { value: "Thanks" },
    });
    fireEvent.click(screen.getByTestId("adjust-continue"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("adjust-confirm"));
    });

    // Modal closed + headline balance updated from $100 to $125.
    await waitFor(() => {
      expect(screen.queryByTestId("adjust-balance-modal")).toBeNull();
    });
    const card = screen.getByTestId("family-balance-card");
    expect(card.textContent).toMatch(/\$125\.00/);
  });
});
