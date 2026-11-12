// Presentational row for the balance history list. Pure render — no
// state or hooks — so it slots into either the 5-row preview on
// /account/balance or the paginated list on /account/balance/history
// without a client boundary.

import type { BalanceHistoryEntry } from "@swim-app/shared";

import { formatDollars, formatHistoryDate, formatSignedDollars } from "./formatters";

export function HistoryRow({ entry }: { entry: BalanceHistoryEntry }) {
  return (
    <li className="flex items-center justify-between gap-4 px-4 py-3 min-h-[56px]">
      <div className="flex-1 min-w-0">
        <p className="font-body text-sm font-semibold text-text truncate">
          {entry.displayType}
        </p>
        <p className="font-body text-xs text-text-secondary">
          {formatHistoryDate(entry.createdAt)}
        </p>
      </div>
      <div className="text-right">
        <p
          className={`font-body text-sm font-bold ${
            entry.amountCents > 0
              ? "text-success"
              : entry.amountCents < 0
                ? "text-text"
                : "text-text-secondary"
          }`}
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {formatSignedDollars(entry.amountCents)}
        </p>
        <p
          className="font-body text-xs text-text-secondary"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {formatDollars(entry.runningBalanceCents)}
        </p>
      </div>
    </li>
  );
}
