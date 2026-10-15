"use client";

import { lessonPrice } from "@/lib/pricing";
import { formatSlotRange } from "./helpers";

interface Props {
  selectedStartsAt: string | null;
  tooSoon: boolean;
  durationMinutes: 30 | 45 | 60;
  swimmerIds: string[];
  needsApproval: boolean;
  onConfirm: () => void;
  isConfirming: boolean;
  errorMessage: string | null;
}

export default function BottomBar({
  selectedStartsAt,
  tooSoon,
  durationMinutes,
  swimmerIds,
  needsApproval,
  onConfirm,
  isConfirming,
  errorMessage,
}: Props) {
  const hasSelection = selectedStartsAt !== null;
  const hasSwimmers = swimmerIds.length > 0;
  const confirmEnabled = hasSelection && hasSwimmers && !tooSoon && !isConfirming;

  let timeLabel: string;
  let subLabel: string | null = null;
  let priceLabel: string | null = null;

  if (tooSoon) {
    timeLabel = "Less than 16 hours away";
    subLabel = "Text Jason to book this one.";
  } else if (hasSelection) {
    timeLabel = formatSlotRange(selectedStartsAt, durationMinutes);
    subLabel = `${durationMinutes} min · ${swimmerIds.length} swimmer${swimmerIds.length === 1 ? "" : "s"}`;
    if (hasSwimmers) {
      const price = lessonPrice(durationMinutes, swimmerIds.length);
      priceLabel = `$${price}`;
    }
  } else {
    timeLabel = "SELECTED TIME";
    subLabel = "No time picked yet";
  }

  return (
    <div
      role="region"
      aria-label="Booking selection"
      className="sticky bottom-0 z-10 bg-background border-t border-border px-page py-3 flex items-center gap-4"
    >
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold truncate ${hasSelection && !tooSoon ? "text-heading" : "text-text-secondary"}`}>
          {timeLabel}
        </p>
        {subLabel !== null && (
          <p className="text-xs text-text-secondary mt-0.5">{subLabel}</p>
        )}
        {priceLabel !== null && (
          <p className="text-xs text-text-secondary">{priceLabel}</p>
        )}
        {needsApproval && hasSelection && !tooSoon && (
          <p className="text-xs text-text-secondary mt-0.5">Jason will confirm this one.</p>
        )}
        {errorMessage !== null && (
          <p role="alert" className="text-xs text-danger mt-1">{errorMessage}</p>
        )}
      </div>

      <button
        type="button"
        onClick={onConfirm}
        disabled={!confirmEnabled}
        className="min-h-[44px] px-5 rounded-button bg-button-primary-background text-button-primary-text text-sm font-semibold transition-opacity hover:opacity-90 active:scale-[0.97] disabled:opacity-40 disabled:cursor-default flex-shrink-0"
      >
        {isConfirming ? "Booking…" : "Book lesson"}
      </button>
    </div>
  );
}
