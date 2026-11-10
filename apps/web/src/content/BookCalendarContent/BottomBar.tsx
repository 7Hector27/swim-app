"use client";

import PendingLabel from "@/components/PendingLabel";
import { lessonPrice } from "@/lib/pricing";
import { formatSlotRangeWithDate } from "./helpers";
import { formatDollars } from "@/content/AccountBalanceContent/formatters";

interface Props {
  selectedStartsAt: string | null;
  tooSoon: boolean;
  durationMinutes: 30 | 45 | 60;
  swimmerIds: string[];
  needsApproval: boolean;
  bookingMinAdvanceHours: number | null;
  // Household balance in cents, authoritative server value. `null` when
  // the server fetch failed — the bar hides the balance line rather than
  // guessing.
  balanceCents?: number | null;
  // Server-pricing total for the current selection in cents. Zero when
  // the parent hasn't picked a swimmer or slot yet.
  totalPriceCents?: number;
  onConfirm: () => void;
  isConfirming: boolean;
}

export default function BottomBar({
  selectedStartsAt,
  tooSoon,
  durationMinutes,
  swimmerIds,
  needsApproval,
  bookingMinAdvanceHours,
  balanceCents = null,
  totalPriceCents = 0,
  onConfirm,
  isConfirming,
}: Props) {
  const hasSelection = selectedStartsAt !== null;
  const hasSwimmers = swimmerIds.length > 0;
  const confirmEnabled = hasSelection && !tooSoon && !isConfirming;
  // No number echoed on the current response → drop the hour count from
  // the label rather than falling back to a stale default.
  const tooSoonLabel =
    bookingMinAdvanceHours === null
      ? "Too close to the lesson"
      : `Less than ${bookingMinAdvanceHours} ${bookingMinAdvanceHours === 1 ? "hour" : "hours"} away`;

  let timeLabel: string;
  let subLabel: string | null = null;
  let priceLabel: string | null = null;

  if (tooSoon) {
    timeLabel = tooSoonLabel;
    subLabel = "Text Jason to book this one.";
  } else if (hasSelection) {
    timeLabel = formatSlotRangeWithDate(selectedStartsAt, durationMinutes);
    subLabel = `${swimmerIds.length} swimmer${swimmerIds.length === 1 ? "" : "s"}`;
    if (hasSwimmers) {
      const price = lessonPrice(durationMinutes, swimmerIds.length);
      priceLabel = `$${price}`;
    }
  } else {
    timeLabel = "SELECTED TIME";
    subLabel = "No time picked yet";
  }

  // Soft hint shown next to the Confirm button. When no swimmer is picked
  // the button stays enabled; clicking scrolls to Who's swimming instead.
  const reason: string | null = (() => {
    if (isConfirming) return null;
    if (!hasSelection) return "Pick a time first.";
    if (tooSoon) return `${tooSoonLabel}.`;
    if (!hasSwimmers) return "Pick who's swimming first.";
    return null;
  })();

  // Pre-submit shortfall guard. When balance is known and the current
  // selection already exceeds it, show the "short by" line; the server
  // still gets the final say via 422 insufficient_balance, which opens
  // the modal.
  const showBalanceLine =
    balanceCents !== null && hasSelection && !tooSoon && hasSwimmers;
  const isShort =
    showBalanceLine && totalPriceCents > (balanceCents ?? 0);
  const shortfallCents = isShort
    ? totalPriceCents - (balanceCents ?? 0)
    : 0;

  return (
    <div
      role="region"
      aria-label="Booking selection"
      className="sticky bottom-[calc(var(--tab-bar-height)_+_env(safe-area-inset-bottom,_0px)_+_1rem)] tablet:bottom-4 z-10 mx-4 tablet:mx-0"
    >
      <div className="bg-heading text-background rounded-[16px] px-5 py-4 flex items-center gap-4 transition-colors duration-200 motion-reduce:transition-none shadow-lg">
        <div className="flex-1 min-w-0">
          <p
            className={`text-sm font-semibold truncate ${
              hasSelection && !tooSoon ? "text-background" : "opacity-60"
            }`}
          >
            {timeLabel}
          </p>
          {subLabel !== null && (
            <p className="text-xs opacity-70 mt-0.5">{subLabel}</p>
          )}
          {priceLabel !== null && (
            <p className="text-xs opacity-70">{priceLabel}</p>
          )}
          {showBalanceLine && (
            <p
              className="text-xs opacity-70 mt-0.5"
              data-testid="single-balance-line"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              Balance: {formatDollars(balanceCents ?? 0)}
              {isShort && (
                <>
                  {" · "}
                  <span className="font-semibold">
                    Short by {formatDollars(shortfallCents)}
                  </span>
                </>
              )}
            </p>
          )}
          {needsApproval && hasSelection && !tooSoon && (
            <p className="text-xs opacity-70 mt-0.5">Jason will confirm this one.</p>
          )}
        </div>

        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <button
            type="button"
            onClick={onConfirm}
            disabled={!confirmEnabled}
            data-testid="confirm-single"
            className="min-h-[44px] px-5 rounded-button bg-button-primary-background text-button-primary-text text-sm font-semibold transition-opacity hover:opacity-90 active:scale-[0.97] transition-[opacity,transform] motion-reduce:transform-none disabled:opacity-40 disabled:cursor-default"
          >
            <PendingLabel
              isPending={isConfirming}
              label="Confirm booking"
              pendingLabel="Booking…"
            />
          </button>
          {reason !== null && (
            <p
              className="text-[11px] text-background/70 text-right max-w-[12rem]"
              data-testid="single-disabled-reason"
            >
              {reason}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
