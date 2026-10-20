"use client";

import { formatSlotTime, formatSlotRangeWithDate } from "@/content/BookCalendarContent/helpers";

interface Props {
  oldStartsAt: string;
  newStartsAt: string | null;
  durationMinutes: 30 | 45 | 60;
  needsApproval: boolean;
  onConfirm: () => void;
  isConfirming: boolean;
}

export default function RescheduleBottomBar({
  oldStartsAt,
  newStartsAt,
  durationMinutes,
  needsApproval,
  onConfirm,
  isConfirming,
}: Props) {
  const fromLabel = formatSlotTime(oldStartsAt);
  const toLabel = newStartsAt
    ? formatSlotRangeWithDate(newStartsAt, durationMinutes)
    : "Pick a new time";
  const confirmEnabled = newStartsAt !== null && !isConfirming;

  return (
    <div role="region" aria-label="Reschedule selection" className="sticky bottom-[calc(var(--tab-bar-item-height)_+_env(safe-area-inset-bottom,_0px)_+_1rem)] tablet:bottom-4 z-10 mx-4 tablet:mx-0">
      <div className="bg-heading text-background rounded-[16px] px-5 py-4 flex items-center gap-4 shadow-lg">
        <div className="flex-1 min-w-0 flex items-center gap-3">
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-widest opacity-60">FROM</span>
            <span className="text-sm font-semibold truncate">{fromLabel}</span>
          </div>
          <span className="opacity-60 flex-shrink-0">→</span>
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-widest opacity-60">TO</span>
            <span className={`text-sm font-semibold truncate ${newStartsAt ? "text-background" : "opacity-50"}`}>
              {toLabel}
            </span>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          {needsApproval && newStartsAt !== null && (
            <span className="text-xs opacity-70">Jason will confirm this one.</span>
          )}
          <button
            type="button"
            onClick={onConfirm}
            disabled={!confirmEnabled}
            className="min-h-[44px] px-5 rounded-button bg-button-primary-background text-button-primary-text text-sm font-semibold transition-[opacity,transform] hover:opacity-90 active:scale-[0.97] motion-reduce:transform-none disabled:opacity-40 disabled:cursor-default"
          >
            {isConfirming ? "Rescheduling…" : "Confirm reschedule"}
          </button>
        </div>
      </div>
    </div>
  );
}
