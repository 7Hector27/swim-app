"use client";

import { useRef, useEffect } from "react";
import type { WeekDayAvailability } from "@swim-app/shared";

// pb-4 (16 px) clears the native horizontal scrollbar on Windows (≤17 px); pt/px-1 protect the focus ring.
const STRIP_PADDING = "pt-1 pb-4 px-1" as const;

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

function isUnavailable(day: WeekDayAvailability): boolean {
  if (day.dayState === "past" || day.dayState === "closed" || day.dayState === "not_open_yet") {
    return true;
  }
  return day.openCount === 0;
}

export default function PhoneDayStrip({
  days,
  selectedDayDate,
  todayStr,
  onDaySelect,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isFirstScrollRef = useRef(true);

  useEffect(() => {
    if (!selectedDayDate || !containerRef.current) return;
    const btn = containerRef.current.querySelector<HTMLElement>(
      `[data-date="${selectedDayDate}"]`,
    );
    const isFirst = isFirstScrollRef.current;
    isFirstScrollRef.current = false;
    // "auto" on mount avoids a visible scroll animation on every page load.
    btn?.scrollIntoView({ behavior: isFirst ? "auto" : "smooth", inline: "center", block: "nearest" });
  }, [selectedDayDate]);

  return (
    <div ref={containerRef} className={`flex overflow-x-auto gap-2 snap-x snap-mandatory scroll-pl-1 ${STRIP_PADDING}`}>
      {days.map((day) => {
        const isSelected = day.date === selectedDayDate;
        const isToday = day.date === todayStr;
        const unavailable = isUnavailable(day);

        const base =
          "relative min-h-[64px] min-w-[64px] flex flex-col items-center justify-center gap-0.5 rounded-[14px] border px-2 py-1.5 text-xs flex-shrink-0 snap-start transition-colors duration-100 motion-reduce:transition-none";

        let stateClasses: string;
        if (isSelected) {
          stateClasses = "border-accent bg-accent/10 text-accent";
        } else if (unavailable) {
          stateClasses = "border-border bg-surface-soft text-text-secondary";
        } else {
          stateClasses = "border-border text-text hover:bg-surface-soft";
        }

        return (
          <button
            key={day.date}
            type="button"
            data-date={day.date}
            onClick={() => onDaySelect(day.date)}
            aria-current={isToday ? "date" : undefined}
            aria-pressed={isSelected}
            className={`${base} ${stateClasses}`}
          >
            <span className={`font-semibold ${isSelected ? "text-accent" : unavailable ? "text-text-secondary" : "text-text-secondary"}`}>
              {getDowAbbr(day.date)}
            </span>
            <span
              className={`text-lg font-bold leading-none tabular-nums ${
                isSelected ? "text-accent" : unavailable ? "text-text-secondary" : "text-heading"
              }`}
            >
              {getDayNumber(day.date)}
            </span>
            <span className="text-[10px]">{openLabel(day)}</span>
            {isToday && !isSelected && (
              <span
                aria-hidden="true"
                className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-accent"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
