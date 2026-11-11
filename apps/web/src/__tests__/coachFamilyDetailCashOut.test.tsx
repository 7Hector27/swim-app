import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

import type {
  BalanceHistoryResponse,
  BalanceResponse,
  NeedsManualRefundJob,
} from "@swim-app/shared";

// All server actions driving the family-detail page are mocked so the
// modal state machines are driven synchronously from the test.
const {
  mockFetchCashOutPreview,
  mockExecuteCashOut,
  mockMarkHandled,
  mockRefreshBalance,
  mockFetchMoreHistory,
  mockSubmitAdjustment,
} = vi.hoisted(() => ({
  mockFetchCashOutPreview: vi.fn(),
  mockExecuteCashOut: vi.fn(),
  mockMarkHandled: vi.fn(),
  mockRefreshBalance: vi.fn(),
  mockFetchMoreHistory: vi.fn(),
  mockSubmitAdjustment: vi.fn(),
}));

vi.mock("../content/CoachFamilyDetailContent/actions", () => ({
  fetchCashOutPreviewAction: (...args: unknown[]) =>
    mockFetchCashOutPreview(...args),
  executeCashOutAction: (...args: unknown[]) => mockExecuteCashOut(...args),
  markCashRefundHandledAction: (...args: unknown[]) =>
    mockMarkHandled(...args),
  refreshFamilyBalanceAction: (...args: unknown[]) =>
    mockRefreshBalance(...args),
  fetchMoreFamilyHistoryAction: (...args: unknown[]) =>
    mockFetchMoreHistory(...args),
  submitCoachAdjustmentAction: (...args: unknown[]) =>
    mockSubmitAdjustment(...args),
}));

import CoachFamilyDetailContent from "../content/CoachFamilyDetailContent/CoachFamilyDetailContent";

const HOUSEHOLD_ID = "11111111-1111-1111-1111-111111111111";
const JOB_ID = "22222222-2222-2222-2222-222222222222";

const BASE_BALANCE: BalanceResponse = {
  balanceCents: 10_000, // $100 → refund button visible
  approximatePrivateHours: 0.5,
};
const BASE_HISTORY: BalanceHistoryResponse = {
  entries: [],
  nextCursor: null,
};

function renderDetail(args: {
  balanceCents?: number;
  needsManualJobs?: NeedsManualRefundJob[];
} = {}) {
  return render(
    <CoachFamilyDetailContent
      householdId={HOUSEHOLD_ID}
      householdName="Smith household"
      memberFullNames={["Jane Smith"]}
      activeSwimmerCount={1}
      initialBalance={{
        ...BASE_BALANCE,
        balanceCents: args.balanceCents ?? BASE_BALANCE.balanceCents,
      }}
      initialHistory={BASE_HISTORY}
      initialNeedsManualJobs={args.needsManualJobs ?? []}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRefreshBalance.mockResolvedValue({ ok: false });
  mockFetchMoreHistory.mockResolvedValue({ ok: false });
});

describe("CoachFamilyDetailContent — Refund leftover balance", () => {
  it("shows the Refund leftover balance button only when balance > 0", () => {
    renderDetail({ balanceCents: 0 });
    expect(screen.queryByTestId("refund-leftover-open")).toBeNull();
  });

  it("opens the preview modal and renders the breakdown on positive balance", async () => {
    mockFetchCashOutPreview.mockResolvedValue({
      ok: true,
      data: {
        totalCardPaidCents: 10_000,
        totalCashRefundedCents: 0,
        netLessonSpendingCents: 0,
        currentBalanceCents: 10_000,
        refundableCents: 7_500,
        writeOffCents: 2_500,
      },
    });
    renderDetail();
    await act(async () => {
      fireEvent.click(screen.getByTestId("refund-leftover-open"));
    });
    await waitFor(() => {
      expect(screen.getByTestId("cash-out-breakdown")).toBeInTheDocument();
    });
    expect(screen.getByTestId("cash-out-refundable")).toHaveTextContent("$75.00");
    expect(screen.getByTestId("cash-out-writeoff")).toHaveTextContent("$25.00");
  });

  it("confirm issues the refund and shows the success copy with the refunded amount", async () => {
    mockFetchCashOutPreview.mockResolvedValue({
      ok: true,
      data: {
        totalCardPaidCents: 10_000,
        totalCashRefundedCents: 0,
        netLessonSpendingCents: 0,
        currentBalanceCents: 10_000,
        refundableCents: 10_000,
        writeOffCents: 0,
      },
    });
    mockExecuteCashOut.mockResolvedValue({
      ok: true,
      data: {
        breakdown: {
          totalCardPaidCents: 10_000,
          totalCashRefundedCents: 0,
          netLessonSpendingCents: 0,
          currentBalanceCents: 10_000,
          refundableCents: 10_000,
          writeOffCents: 0,
        },
        refundJobCount: 1,
        needsManualHandlingCents: 0,
      },
    });
    renderDetail();
    await act(async () => {
      fireEvent.click(screen.getByTestId("refund-leftover-open"));
    });
    await waitFor(() => {
      expect(screen.getByTestId("cash-out-breakdown")).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("cash-out-confirm"));
    });
    await waitFor(() => {
      expect(screen.getByTestId("cash-out-done")).toBeInTheDocument();
    });
    expect(screen.getByTestId("cash-out-done")).toHaveTextContent("$100.00");
    expect(mockExecuteCashOut).toHaveBeenCalledWith(HOUSEHOLD_ID);
  });
});

describe("CoachFamilyDetailContent — Needs-manual-handling banner", () => {
  const sampleJob: NeedsManualRefundJob = {
    id: JOB_ID,
    amountCents: 7_500,
    reason: "No matching card payment",
    createdAt: "2026-11-01T12:00:00.000Z",
  };

  it("renders the banner with one entry when the initial list is non-empty", () => {
    renderDetail({ needsManualJobs: [sampleJob] });
    expect(screen.getByTestId("family-needs-manual-banner")).toBeInTheDocument();
    const entry = screen.getByTestId("family-needs-manual-entry");
    expect(entry).toHaveTextContent("$75.00");
    expect(entry).toHaveTextContent("No matching card payment");
  });

  it("opens the mark-handled modal and requires a note before submit", () => {
    renderDetail({ needsManualJobs: [sampleJob] });
    fireEvent.click(screen.getByTestId("family-needs-manual-mark"));
    expect(screen.getByTestId("mark-handled-modal")).toBeInTheDocument();
    // Submit is disabled until the note has content.
    const submit = screen.getByTestId("mark-handled-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("mark-handled-note"), {
      target: { value: "Refunded via Venmo." },
    });
    expect(submit.disabled).toBe(false);
  });

  it("posts the note to the action and removes the entry on success", async () => {
    mockMarkHandled.mockResolvedValue({ kind: "ok" });
    renderDetail({ needsManualJobs: [sampleJob] });
    fireEvent.click(screen.getByTestId("family-needs-manual-mark"));
    fireEvent.change(screen.getByTestId("mark-handled-note"), {
      target: { value: "Refunded via Venmo." },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("mark-handled-submit"));
    });
    expect(mockMarkHandled).toHaveBeenCalledWith(JOB_ID, {
      note: "Refunded via Venmo.",
    });
    await waitFor(() => {
      expect(screen.queryByTestId("family-needs-manual-banner")).toBeNull();
    });
  });
});
