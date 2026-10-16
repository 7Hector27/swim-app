"use client";

import MonthDayCell from "./MonthDayCell";
import type { MonthDayCellData, MonthDayCellState } from "./MonthDayCell";

interface MonthDayRaw {
  date: string;
  dayState: "open" | "closed" | "past" | "not_open_yet";
  openCount: number;
  totalCount: number;
}

interface Props {
  /** ISO "YYYY-MM" string for the month being displayed */
  monthStr: string;
  days: MonthDayRaw[];
  todayStr: string;
  onDayClick: (date: string) => void;
}

const DOW_HEADERS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

function buildGridCells(monthStr: string, days: MonthDayRaw[]): MonthDayCellData[] {
  const [yearStr, monthIndexStr] = monthStr.split("-");
  const year = Number(yearStr);
  const month = Number(monthIndexStr) - 1; // 0-indexed

  // First day of month
  const firstDay = new Date(year, month, 1);
  // Monday=0 … Sunday=6 offset
  const firstDow = firstDay.getDay(); // 0=Sun, 1=Mon, …
  const leadingCount = firstDow === 0 ? 6 : firstDow - 1;

  // Last day of month
  const lastDay = new Date(year, month + 1, 0);
  const lastDow = lastDay.getDay();
  const trailingCount = lastDow === 0 ? 0 : 7 - lastDow;

  const totalCells = leadingCount + lastDay.getDate() + trailingCount;

  const daysByDate = new Map<string, MonthDayRaw>();
  for (const day of days) {
    daysByDate.set(day.date, day);
  }

  function toDateStr(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  const cells: MonthDayCellData[] = [];

  for (let cellIndex = 0; cellIndex < totalCells; cellIndex++) {
    const offset = cellIndex - leadingCount;
    const cellDate = new Date(year, month, 1 + offset);
    const dateStr = toDateStr(cellDate);
    const isCurrentMonth = cellDate.getMonth() === month;
    const raw = daysByDate.get(dateStr);

    const state: MonthDayCellState = raw?.dayState ?? "past";

    cells.push({
      date: dateStr,
      state,
      openCount: raw?.openCount ?? 0,
      totalCount: raw?.totalCount ?? 0,
      isCurrentMonth,
    });
  }

  return cells;
}

export default function MonthGrid({ monthStr, days, todayStr, onDayClick }: Props) {
  const cells = buildGridCells(monthStr, days);

  return (
    <div className="rounded-card border border-border bg-background overflow-hidden">
      <p className="px-4 pt-4 pb-2 text-sm text-text-secondary">
        Pick a day to see its open times.
      </p>

      {/* DOW headers */}
      <div className="grid grid-cols-7 border-b border-border">
        {DOW_HEADERS.map((dow) => (
          <div
            key={dow}
            className="py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-text-secondary"
          >
            {dow}
          </div>
        ))}
      </div>

      {/* Day cells — gap-px trick with bg-border as the grid background */}
      <div className="grid grid-cols-7 gap-px bg-border">
        {cells.map((cell) => (
          <MonthDayCell
            key={cell.date}
            cell={cell}
            todayStr={todayStr}
            onDayClick={onDayClick}
          />
        ))}
      </div>
    </div>
  );
}

export type { MonthDayCellData };
