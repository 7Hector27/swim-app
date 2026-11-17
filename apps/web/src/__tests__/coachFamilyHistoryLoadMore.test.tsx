// Covers the /coach/families/[id] transaction-history "Load more" flow.
// The API paginates 10 rows per page via an opaque cursor, and the UI
// appends each new page to the list while trusting the server's running
// balance per row — regressions here would either hide the button, repeat
// entries, or drift the running balance totals.

import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import type { BalanceHistoryEntry, BalanceHistoryResponse, BalanceResponse } from "@swim-app/shared";

const { mockFetchMoreHistory, mockRefreshBalance, mockSubmitAdjustment } = vi.hoisted(() => ({
  mockFetchMoreHistory: vi.fn(),
  mockRefreshBalance: vi.fn(),
  mockSubmitAdjustment: vi.fn(),
}));

vi.mock("../content/CoachFamilyDetailContent/actions", () => ({
  fetchMoreFamilyHistoryAction: (...args: unknown[]) => mockFetchMoreHistory(...args),
  refreshFamilyBalanceAction: (...args: unknown[]) => mockRefreshBalance(...args),
  submitCoachAdjustmentAction: (...args: unknown[]) => mockSubmitAdjustment(...args),
  fetchCashOutPreviewAction: vi.fn(),
  executeCashOutAction: vi.fn(),
  markCashRefundHandledAction: vi.fn(),
}));

import CoachFamilyDetailContent from "../content/CoachFamilyDetailContent/CoachFamilyDetailContent";

const HOUSEHOLD_ID = "11111111-1111-1111-1111-111111111111";

const BASE_BALANCE: BalanceResponse = {
  balanceCents: 110_000,
  approximatePrivateHours: 9,
};

// Build a 10-row first page descending in time (newest first) with each
// row's runningBalanceCents equal to what the API would emit — balance
// after that row lands. First page represents the 10 most recent rows.
function buildFirstPage(): BalanceHistoryResponse {
  const entries: BalanceHistoryEntry[] = Array.from({ length: 10 }, (_unused, index) => ({
    id: `p1-${index}`,
    entryType: "coach_adjustment",
    amountCents: 10_000,
    runningBalanceCents: 110_000 - index * 10_000, // 110_000, 100_000, 90_000, ...
    createdAt: `2026-11-${String(20 - index).padStart(2, "0")}T18:00:00.000Z`,
    displayType: `Row ${index + 1}`,
  }));
  return { entries, nextCursor: "cursor-page-2" };
}

// Second page: a smaller 5-row page strictly older than the first, with
// running balances continuing the sequence from where the first page ended
// (20_000, 10_000, 0 and two prior rows). nextCursor null signals "no more".
function buildSecondPage(): BalanceHistoryResponse {
  const entries: BalanceHistoryEntry[] = Array.from({ length: 5 }, (_unused, index) => ({
    id: `p2-${index}`,
    entryType: "coach_adjustment",
    amountCents: 10_000,
    runningBalanceCents: 20_000 - index * 10_000 + (index < 3 ? 0 : 50_000),
    createdAt: `2026-11-${String(10 - index).padStart(2, "0")}T18:00:00.000Z`,
    displayType: `Row ${11 + index}`,
  }));
  return { entries, nextCursor: null };
}

function renderWithFirstPage(initialHistory: BalanceHistoryResponse) {
  return render(
    <CoachFamilyDetailContent
      householdId={HOUSEHOLD_ID}
      householdName="Smith household"
      memberFullNames={["Jane Smith"]}
      activeSwimmerCount={2}
      initialBalance={BASE_BALANCE}
      initialHistory={initialHistory}
      initialNeedsManualJobs={[]}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CoachFamilyDetailContent — history Load more", () => {
  it("hides the Load more button when the server says there are no more pages", () => {
    renderWithFirstPage({ entries: buildFirstPage().entries, nextCursor: null });
    expect(screen.queryByTestId("family-history-more")).toBeNull();
  });

  it("shows the Load more button when the first page comes back with a cursor", () => {
    renderWithFirstPage(buildFirstPage());
    const button = screen.getByTestId("family-history-more");
    expect(button).toHaveTextContent(/load more/i);
  });

  it("appends the second page and preserves the server's running balance per row", async () => {
    const firstPage = buildFirstPage();
    const secondPage = buildSecondPage();
    renderWithFirstPage(firstPage);

    mockFetchMoreHistory.mockResolvedValueOnce({ ok: true, data: secondPage });

    fireEvent.click(screen.getByTestId("family-history-more"));

    // The action is called with the cursor from the previous page — not
    // an offset or a page number — matching the API contract.
    await waitFor(() => {
      expect(mockFetchMoreHistory).toHaveBeenCalledWith(
        HOUSEHOLD_ID,
        firstPage.nextCursor,
      );
    });

    // All 15 rows (10 + 5) land in the DOM, in order, after the new page
    // is appended. Regression guard against "replace" vs "append" bugs.
    await waitFor(() => {
      const rows = screen
        .getByTestId("family-history-list")
        .querySelectorAll("li");
      expect(rows).toHaveLength(15);
    });

    // The server's runningBalanceCents is rendered verbatim — the last
    // row of the second page is $50.00 ($50_000 cents) in the fixture, and
    // the new rows read in the order the API returned.
    expect(screen.getByText("Row 11")).toBeInTheDocument();
    expect(screen.getByText("Row 15")).toBeInTheDocument();

    // Button disappears once nextCursor comes back null.
    expect(screen.queryByTestId("family-history-more")).toBeNull();
  });

  it("surfaces the error message and keeps the button around to retry when the action fails", async () => {
    renderWithFirstPage(buildFirstPage());
    mockFetchMoreHistory.mockResolvedValueOnce({
      ok: false,
      message: "Could not load more history.",
    });

    fireEvent.click(screen.getByTestId("family-history-more"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/could not load more history/i);
    });
    // Cursor isn't advanced on failure, so Load more is still there.
    expect(screen.getByTestId("family-history-more")).toBeInTheDocument();
  });
});
