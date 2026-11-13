"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import type { BalanceHistoryEntry, BalanceHistoryResponse } from "@swim-app/shared";

import { fetchMoreHistoryAction } from "@/content/AccountBalanceContent/actions";
import { HistoryRow } from "@/content/AccountBalanceContent/HistoryRow";

interface BalanceHistoryContentProps {
  initial: BalanceHistoryResponse | null;
}

// ADR 036 Phase 8 Part B Stop 3 piece 7: full transaction history at
// /account/balance/history. The API already returns 20 rows per page
// anchored to the ledger's temporal boundary, so running balances stay
// correct across pages — no client-side summing. See
// apps/api/src/routes/payments.ts HISTORY_PAGE_SIZE for the page size.
export default function BalanceHistoryContent({ initial }: BalanceHistoryContentProps) {
  const [entries, setEntries] = useState<BalanceHistoryEntry[]>(initial?.entries ?? []);
  const [cursor, setCursor] = useState<string | null>(initial?.nextCursor ?? null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleLoadMore() {
    if (!cursor) return;
    setError(null);
    startTransition(async () => {
      const result = await fetchMoreHistoryAction(cursor);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setEntries((prev) => [...prev, ...result.data.entries]);
      setCursor(result.data.nextCursor);
    });
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-[720px] px-4 py-8 tablet:py-12">
        <Link
          href="/account/balance"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-link hover:text-link-hover transition-colors duration-150"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M10 12L6 8l4-4"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Back to balance
        </Link>

        <h1 className="text-text font-heading text-[2.125rem] tablet:text-[2.5rem] leading-tight mt-4 mb-6">
          Transaction history
        </h1>

        {entries.length === 0 ? (
          <p className="font-body text-sm text-text-secondary">
            No transactions yet.
          </p>
        ) : (
          <ul
            data-testid="balance-history-list"
            className="rounded-card border border-border bg-background divide-y divide-border"
          >
            {entries.map((entry) => (
              <HistoryRow key={entry.id} entry={entry} />
            ))}
          </ul>
        )}

        {cursor ? (
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={pending}
            data-testid="balance-history-load-more"
            className="mt-4 w-full min-h-[44px] rounded-full border-2 border-button-outline text-button-outline font-body font-bold text-sm disabled:opacity-60"
          >
            {pending ? "Loading…" : "Load more"}
          </button>
        ) : null}

        {error ? (
          <p role="alert" className="font-body text-sm text-danger mt-2">
            {error}
          </p>
        ) : null}
      </div>
    </main>
  );
}
