"use client";

import { formatWeekLabel, addDaysToDateStr, getMondayOfWeek } from "./helpers";

interface Props {
  mondayStr: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  todayStr: string;
}

export default function WeekNav({ mondayStr, onPrev, onNext, onToday, todayStr }: Props) {
  const sundayStr = addDaysToDateStr(mondayStr, 6);
  const todayMonday = getMondayOfWeek(todayStr);
  const isCurrentWeek = mondayStr === todayMonday;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        type="button"
        onClick={onPrev}
        aria-label="Previous week"
        className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-button border border-border text-text hover:bg-surface-soft transition-colors duration-150"
      >
        ‹
      </button>
      <button
        type="button"
        onClick={onNext}
        aria-label="Next week"
        className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-button border border-border text-text hover:bg-surface-soft transition-colors duration-150"
      >
        ›
      </button>
      <span className="text-sm font-semibold text-heading flex-1 text-center tablet:text-left">
        {formatWeekLabel(mondayStr)}
      </span>
      <button
        type="button"
        onClick={onToday}
        disabled={isCurrentWeek}
        className="min-h-[44px] px-4 rounded-button border border-border text-sm text-text hover:bg-surface-soft transition-colors duration-150 disabled:opacity-40 disabled:cursor-default"
      >
        Today
      </button>
      <span className="sr-only">{`Week of ${mondayStr} through ${sundayStr}`}</span>
    </div>
  );
}
