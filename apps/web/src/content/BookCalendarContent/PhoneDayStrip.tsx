"use client";

import type { WeekDayAvailability } from "@swim-app/shared";

interface Props {
  days: WeekDayAvailability[];
  selectedDayDate: string | null;
  todayStr: string;
  onDaySelect: (date: string) => void;
}

const DOW_ABBRS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getDowAbbr(dateStr: string): string {
  const dow = new Date(`${dateStr}T12:00:00`).getDay();
  return DOW_ABBRS[dow] ?? "";
}

function getDayNumber(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00`).getDate();
}

function openLabel(day: WeekDayAvailability): string {
  if (day.dayState === "past") return "Past";
  if (day.dayState === "closed") return "Closed";
  if (day.dayState === "not_open_yet") return "Not open";
  if (day.openCount === 0) return "Full";
  return `${day.openCount} open`;
}

export default function PhoneDayStrip({ days, selectedDayDate, todayStr, onDaySelect }: Props) {
  return (
    <div className="flex overflow-x-auto gap-2 pb-1">
      {days.map((day) => {
        const isSelected = day.date === selectedDayDate;
        const isToday = day.date === todayStr;

        return (
          <button
            key={day.date}
            type="button"
            onClick={() => onDaySelect(day.date)}
            aria-current={isToday ? "date" : undefined}
            aria-pressed={isSelected}
            className={`min-h-[44px] min-w-[60px] flex flex-col items-center justify-center rounded-button border px-2 py-1 text-xs flex-shrink-0 transition-colors duration-150 ${
              isSelected ? "border-accent text-accent" : "border-border text-text-secondary hover:bg-surface-soft"
            }`}
          >
            <span className="font-semibold">{getDowAbbr(day.date)}</span>
            <span className={`text-base font-bold ${isSelected ? "text-accent" : "text-heading"}`}>
              {getDayNumber(day.date)}
            </span>
            <span className="text-[10px]">{openLabel(day)}</span>
          </button>
        );
      })}
    </div>
  );
}
