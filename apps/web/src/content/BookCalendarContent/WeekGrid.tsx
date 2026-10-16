"use client";

import type { WeekDayAvailability } from "@swim-app/shared";
import { buildGridRows, formatHHMM, isHourMark } from "./helpers";
import DayColumn from "./DayColumn";

interface Props {
  days: WeekDayAvailability[];
  durationMinutes: 30 | 45 | 60;
  selectedStartsAt: string | null;
  todayStr: string;
  onSlotClick: (slot: { startsAt: string; state: string }) => void;
}

export default function WeekGrid({
  days,
  durationMinutes,
  selectedStartsAt,
  todayStr,
  onSlotClick,
}: Props) {
  const gridRows = buildGridRows(days);

  if (gridRows.length === 0) {
    return (
      <p className="text-sm text-text-secondary py-8 text-center">
        No available slots this week.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-[480px]">
        {/* Time column */}
        <div className="flex flex-col w-16 flex-shrink-0">
          <div className="h-[72px] border-b border-border" />
          {gridRows.map((rowHHMM) => (
            <div
              key={rowHHMM}
              className={`min-h-[40px] flex items-center justify-end pr-2 text-xs ${
                isHourMark(rowHHMM)
                  ? "font-bold text-text"
                  : "text-text-secondary"
              }`}
            >
              {isHourMark(rowHHMM) ? formatHHMM(rowHHMM) : rowHHMM.slice(3)}
            </div>
          ))}
        </div>

        {days.map((day) => (
          <DayColumn
            key={day.date}
            day={day}
            gridRows={gridRows}
            durationMinutes={durationMinutes}
            selectedStartsAt={selectedStartsAt}
            todayStr={todayStr}
            onSlotClick={onSlotClick}
          />
        ))}
      </div>
    </div>
  );
}
