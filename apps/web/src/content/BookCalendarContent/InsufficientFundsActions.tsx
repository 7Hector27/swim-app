"use client";

// Shared button stack for every "not enough balance" surface in the
// booking flow: the standalone InsufficientBalanceModal and the
// ReviewSheet footer (Single / Multiple / Recurring). Keeps the order,
// copy, and refund-policy link identical so the two can't drift.
//
// Order is: Add $X of credit → Buy a package → Not now, with the
// Payments & Refund Policy line pinned directly under the buttons so
// it's always visible without scrolling.

import { formatDollars } from "@/lib/formatDollars";

interface Props {
  addCreditCents: number;
  isAddingCredit: boolean;
  onAddCredit: () => void;
  onBuyPackage: () => void;
  onNotNow: () => void;
  // Optional: callers can hide the Add-credit button entirely when the
  // feature doesn't apply (e.g. a review set with no priceable picks).
  // Default is to show it.
  showAddCredit?: boolean;
  // Test hook so each caller can scope its own data-testids without
  // the parent having to re-implement the button stack.
  testIdPrefix?: string;
}

export default function InsufficientFundsActions({
  addCreditCents,
  isAddingCredit,
  onAddCredit,
  onBuyPackage,
  onNotNow,
  showAddCredit = true,
  testIdPrefix,
}: Props) {
  const scoped = (suffix: string) =>
    testIdPrefix !== undefined ? `${testIdPrefix}-${suffix}` : undefined;
  return (
    <>
      <div className="flex flex-col gap-3">
        {showAddCredit && (
          <button
            type="button"
            onClick={onAddCredit}
            disabled={isAddingCredit}
            {...(scoped("add-credit") !== undefined && {
              "data-testid": scoped("add-credit"),
            })}
            className="w-full min-h-[52px] rounded-full bg-accent text-on-accent font-body font-bold text-base disabled:opacity-60"
          >
            {isAddingCredit
              ? "Starting checkout…"
              : `Add ${formatDollars(addCreditCents)} of credit`}
          </button>
        )}
        <button
          type="button"
          onClick={onBuyPackage}
          {...(scoped("buy-package") !== undefined && {
            "data-testid": scoped("buy-package"),
          })}
          className="w-full min-h-[52px] rounded-full border-2 border-button-outline text-button-outline font-body font-bold text-base"
        >
          Buy a package · save up to 20%
        </button>
        <button
          type="button"
          onClick={onNotNow}
          {...(scoped("not-now") !== undefined && {
            "data-testid": scoped("not-now"),
          })}
          className="w-full min-h-[44px] font-body text-sm text-text-secondary"
        >
          Not now
        </button>
      </div>

      <PolicyQuietLine />
    </>
  );
}

// One-line footer used by every "not enough balance" surface AND by the
// Review sheet's normal (non-short) Book button — keeps the two on the
// same bottom-line text so the design doesn't drift between states.
export function PolicyQuietLine() {
  return (
    <p className="font-body text-xs text-text-secondary mt-4 text-center">
      Credit never expires ·{" "}
      <a href="/refund-policy" className="text-link underline hover:text-link-hover">
        Payments &amp; Refund Policy
      </a>
    </p>
  );
}
