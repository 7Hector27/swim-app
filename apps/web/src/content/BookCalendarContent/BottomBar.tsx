"use client";

import PendingLabel from "@/components/PendingLabel";
import { lessonPrice } from "@/lib/pricing";
import { formatSlotRangeWithDate } from "./helpers";

interface Props {
  selectedStartsAt: string | null;
  tooSoon: boolean;
  durationMinutes: 30 | 45 | 60;
  swimmerIds: string[];
  needsApproval: boolean;
  onConfirm: () => void;
  isConfirming: boolean;
}

export default function BottomBar({
  selectedStartsAt,
  tooSoon,
  durationMinutes,
  swimmerIds,
  needsApproval,
  onConfirm,
  isConfirming,
}: Props) {
  const hasSelection = selectedStartsAt !== null;
  const hasSwimmers = swimmerIds.length > 0;
  const confirmEnabled = hasSelection && !tooSoon && !isConfirming;

  let timeLabel: string;
  let subLabel: string | null = null;
  let priceLabel: string | null = null;

  if (tooSoon) {
    timeLabel = "Less than 16 hours away";
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
    if (tooSoon) return "Less than 16 hours away.";
    if (!hasSwimmers) return "Pick who's swimming first.";
    return null;
  })();

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
