"use client";

import type { WeekDayAvailability } from "@swim-app/shared";
import {
  buildGridRows,
  formatHHMM,
  isHourMark,
  getSlotHHMM,
  isSlotInSelection,
} from "@/content/BookCalendarContent/helpers";
import SlotCell from "@/content/BookCalendarContent/SlotCell";

interface CurrentLesson {
  date: string;
  startHHMM: string;
  durationMinutes: number;
}

interface WeekGridProps {
  days: WeekDayAvailability[];
  durationMinutes: 30 | 45 | 60;
  selectedStartsAt: string | null;
  todayStr: string;
  currentLesson: CurrentLesson;
  onSlotClick: (slot: { startsAt: string; state: string }) => void;
}

interface DayColumnProps {
  day: WeekDayAvailability;
  gridRows: string[];
  durationMinutes: 30 | 45 | 60;
  selectedStartsAt: string | null;
  todayStr: string;
  currentLesson: CurrentLesson;
  onSlotClick: (slot: { startsAt: string; state: string }) => void;
}

const DOW_ABBRS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function getDowAbbr(dateStr: string): string {
  const dow = new Date(`${dateStr}T12:00:00`).getDay();
  return DOW_ABBRS[dow] ?? "";
}

function getDayNumber(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00`).getDate();
}

function dayStateLabel(
  dayState: WeekDayAvailability["dayState"],
  openCount: number,
): string | null {
  if (dayState === "past") return "Past";
  if (dayState === "closed") return "Closed";
  if (dayState === "not_open_yet") return "Not open";
  if (openCount === 0) return "Full";
  return `${openCount} open`;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function isCurrentSlot(rowHHMM: string, currentLesson: CurrentLesson, dayDate: string): boolean {
  if (dayDate !== currentLesson.date) return false;
  const rowMin = toMinutes(rowHHMM);
  const startMin = toMinutes(currentLesson.startHHMM);
  return rowMin >= startMin && rowMin < startMin + currentLesson.durationMinutes;
}

function RescheduleDayColumn({
  day,
  gridRows,
  durationMinutes,
  selectedStartsAt,
  todayStr,
  currentLesson,
  onSlotClick,
}: DayColumnProps) {
  const isToday = day.date === todayStr;
  const label = dayStateLabel(day.dayState, day.openCount);
  const isInactive =
    day.dayState === "closed" ||
    day.dayState === "past" ||
    day.dayState === "not_open_yet";

  const slotsByHHMM = new Map<string, WeekDayAvailability["slots"][number]>();
  for (const slot of day.slots) {
    slotsByHHMM.set(getSlotHHMM(slot.startsAt), slot);
  }

  return (
    <div className="flex flex-col flex-1 min-w-[80px]">
      <div
        className={`flex flex-col items-center py-2 border-b border-border text-xs font-semibold ${isToday ? "text-accent" : "text-text-secondary"}`}
        aria-current={isToday ? "date" : undefined}
      >
        <span>{getDowAbbr(day.date)}</span>
        <span className={`text-base font-bold ${isToday ? "text-accent" : "text-heading"}`}>
          {getDayNumber(day.date)}
        </span>
        {label !== null && (
          <span className="text-[10px] text-text-secondary mt-0.5">{label}</span>
        )}
      </div>

      {isInactive ? (
        <div className="flex-1 flex items-center justify-center text-xs text-text-secondary opacity-50 min-h-[44px]">
          {day.dayState === "closed" ? "Closed" : ""}
        </div>
      ) : (
        <div className="flex flex-col gap-[2px] pt-[2px]">
          {gridRows.map((rowHHMM) => {
            if (isCurrentSlot(rowHHMM, currentLesson, day.date)) {
              return (
                <div
                  key={rowHHMM}
                  className="min-h-[40px] w-full flex items-center justify-center text-xs rounded-[4px] border-2 border-dashed border-accent text-accent font-semibold"
                  aria-label={`Current lesson at ${rowHHMM}`}
                >
                  Current
                </div>
              );
            }

            const slot = slotsByHHMM.get(rowHHMM) ?? null;
            const isYourPick =
              selectedStartsAt !== null &&
              slot !== null &&
              isSlotInSelection(slot.startsAt, selectedStartsAt, durationMinutes);

            return (
              <SlotCell
                key={rowHHMM}
                slot={slot}
                rowHHMM={rowHHMM}
                dayDate={day.date}
                isYourPick={isYourPick}
                durationMinutes={durationMinutes}
                onSlotClick={onSlotClick}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function RescheduleWeekGrid({
  days,
  durationMinutes,
  selectedStartsAt,
  todayStr,
  currentLesson,
  onSlotClick,
}: WeekGridProps) {
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
        <div className="flex flex-col w-16 flex-shrink-0">
          <div className="h-[72px] border-b border-border" />
          {gridRows.map((rowHHMM) => (
            <div
              key={rowHHMM}
              className={`min-h-[40px] flex items-center justify-end pr-2 text-xs ${
                isHourMark(rowHHMM) ? "font-bold text-text" : "text-text-secondary"
              }`}
            >
              {isHourMark(rowHHMM) ? formatHHMM(rowHHMM) : rowHHMM.slice(3)}
            </div>
          ))}
        </div>

        {days.map((day) => (
          <RescheduleDayColumn
            key={day.date}
            day={day}
            gridRows={gridRows}
            durationMinutes={durationMinutes}
            selectedStartsAt={selectedStartsAt}
            todayStr={todayStr}
            currentLesson={currentLesson}
            onSlotClick={onSlotClick}
          />
        ))}
      </div>
    </div>
  );
}
