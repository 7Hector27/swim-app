"use client";

import type { WeekDayAvailability } from "@swim-app/shared";
import { getSlotHHMM, isSlotInSelection } from "./helpers";
import SlotCell from "./SlotCell";

interface Props {
  day: WeekDayAvailability;
  gridRows: string[];
  durationMinutes: 30 | 45 | 60;
  selectedStartsAt: string | null;
  todayStr: string;
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

export default function DayColumn({
  day,
  gridRows,
  durationMinutes,
  selectedStartsAt,
  todayStr,
  onSlotClick,
}: Props) {
  const isToday = day.date === todayStr;
  const label = dayStateLabel(day.dayState, day.openCount);
  const isInactive =
    day.dayState === "closed" || day.dayState === "past" || day.dayState === "not_open_yet";

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
        <span className="text-base font-bold text-heading">{getDayNumber(day.date)}</span>
        {label !== null && (
          <span className="text-[10px] text-text-secondary mt-0.5">{label}</span>
        )}
      </div>

      {isInactive ? (
        <div className="flex-1 flex items-center justify-center text-xs text-text-secondary opacity-50 min-h-[44px]">
          {day.dayState === "closed" ? "Closed" : day.dayState === "not_open_yet" ? "" : ""}
        </div>
      ) : (
        <div className="flex flex-col">
          {gridRows.map((rowHHMM) => {
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
