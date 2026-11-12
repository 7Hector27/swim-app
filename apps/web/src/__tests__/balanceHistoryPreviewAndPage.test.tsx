// ADR 036 Phase 8 Part B Stop 3 piece 7:
//   - /account/balance shows a preview of the latest 5 transactions
//     with a "View all transactions" link, hidden when the household
//     has 5 or fewer entries total.
//   - /account/balance/history renders the full history with the
//     existing cursor-based "Load more" affordance.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { BalanceHistoryEntry, BalanceHistoryResponse } from "@swim-app/shared";

const { fetchMoreHistoryMock } = vi.hoisted(() => ({
  fetchMoreHistoryMock: vi.fn(),
}));

vi.mock("@/content/AccountBalanceContent/actions", () => ({
  startPackageCheckoutAction: vi.fn(),
  startLessonTopupAction: vi.fn(),
  refreshBalanceAction: vi.fn().mockResolvedValue(null),
  fetchMoreHistoryAction: (...args: Parameters<typeof fetchMoreHistoryMock>) =>
    fetchMoreHistoryMock(...args),
}));

import AccountBalanceContent from "@/content/AccountBalanceContent/AccountBalanceContent";
import BalanceHistoryContent from "@/content/BalanceHistoryContent/BalanceHistoryContent";

function makeEntry(index: number): BalanceHistoryEntry {
  // Walk back from 2026-11-30 so the fixture stays in a single valid
  // calendar month even when the test renders 25+ rows.
  const day = 30 - (index % 30);
  return {
    id: `entry-${index}`,
    entryType: "coach_adjustment",
    amountCents: 100,
    runningBalanceCents: (index + 1) * 100,
    createdAt: `2026-11-${String(day).padStart(2, "0")}T18:00:00+00:00`,
    displayType: `Entry ${index}`,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AccountBalanceContent — history preview", () => {
  function renderWith(history: BalanceHistoryResponse | null) {
    render(
      <AccountBalanceContent
        balance={{ balanceCents: 10_000, approximatePrivateHours: 1 }}
        initialHistory={history}
        activeSwimmerCount={1}
        topupState={null}
        resumeBookingReturnTo={null}
      />,
    );
  }

  it("hides the 'View all transactions' link when the household has 5 or fewer entries", () => {
    renderWith({
      entries: [makeEntry(0), makeEntry(1), makeEntry(2)],
      nextCursor: null,
    });
    // All 3 render; no overflow link.
    expect(screen.getByText("Entry 0")).toBeInTheDocument();
    expect(screen.getByText("Entry 2")).toBeInTheDocument();
    expect(screen.queryByTestId("view-all-transactions")).toBeNull();
  });

  it("hides the link at exactly 5 entries with no next cursor", () => {
    const entries = Array.from({ length: 5 }, (_, index) => makeEntry(index));
    renderWith({ entries, nextCursor: null });
    expect(screen.getByText("Entry 4")).toBeInTheDocument();
    expect(screen.queryByTestId("view-all-transactions")).toBeNull();
  });

  it("shows the link and caps to 5 rows when the first page exceeded 5 entries", () => {
    // First page returned 7 — the preview caps at 5 and the link appears.
    const entries = Array.from({ length: 7 }, (_, index) => makeEntry(index));
    renderWith({ entries, nextCursor: null });
    expect(screen.getByText("Entry 4")).toBeInTheDocument();
    expect(screen.queryByText("Entry 5")).toBeNull();
    const link = screen.getByTestId("view-all-transactions");
    expect(link.getAttribute("href")).toBe("/account/balance/history");
  });

  it("shows the link when the first page is full (5) but a next cursor exists", () => {
    const entries = Array.from({ length: 5 }, (_, index) => makeEntry(index));
    renderWith({ entries, nextCursor: "cursor-abc" });
    expect(screen.getByTestId("view-all-transactions")).toBeInTheDocument();
  });
});

describe("BalanceHistoryContent — full page with Load more", () => {
  it("renders the first page of entries and the Load more button when there's a next cursor", () => {
    const entries = Array.from({ length: 20 }, (_, index) => makeEntry(index));
    render(<BalanceHistoryContent initial={{ entries, nextCursor: "cursor-page-2" }} />);
    const list = screen.getByTestId("balance-history-list");
    expect(list.children.length).toBe(20);
    expect(screen.getByTestId("balance-history-load-more")).toBeInTheDocument();
  });

  it("hides Load more when the first page has no next cursor", () => {
    render(
      <BalanceHistoryContent
        initial={{ entries: [makeEntry(0)], nextCursor: null }}
      />,
    );
    expect(screen.queryByTestId("balance-history-load-more")).toBeNull();
  });

  it("appends the next page and preserves the server-sent runningBalanceCents across pages", async () => {
    const page1Entries = Array.from({ length: 20 }, (_, index) => makeEntry(index));
    const page2Entries = Array.from({ length: 5 }, (_, index) => {
      const base = makeEntry(index + 20);
      // The API anchors each page's running balance to the ledger
      // boundary, so page 2's first row carries a sum that already
      // accounts for all older entries — the client never recomputes.
      // Pick values that don't collide with page-1 running balances
      // (which run 100..2000) so the assertion targets the right row.
      return { ...base, runningBalanceCents: 2100 + index * 100 };
    });
    fetchMoreHistoryMock.mockResolvedValueOnce({
      ok: true,
      data: { entries: page2Entries, nextCursor: null },
    });

    render(
      <BalanceHistoryContent initial={{ entries: page1Entries, nextCursor: "cursor-page-2" }} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("balance-history-load-more"));
    });
    expect(fetchMoreHistoryMock).toHaveBeenCalledWith("cursor-page-2");

    const list = screen.getByTestId("balance-history-list");
    expect(list.children.length).toBe(25);
    // Running balance on the appended page is the value the server
    // sent — never rebuilt from the previous page's total.
    expect(screen.getByText("$21.00")).toBeInTheDocument();
    expect(screen.queryByTestId("balance-history-load-more")).toBeNull();
  });

  it("surfaces an error message when fetchMoreHistoryAction fails", async () => {
    const entries = Array.from({ length: 20 }, (_, index) => makeEntry(index));
    fetchMoreHistoryMock.mockResolvedValueOnce({
      ok: false,
      message: "Couldn't load more. Try again.",
    });
    render(
      <BalanceHistoryContent initial={{ entries, nextCursor: "cursor-page-2" }} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("balance-history-load-more"));
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      /couldn't load more/i,
    );
  });
});
