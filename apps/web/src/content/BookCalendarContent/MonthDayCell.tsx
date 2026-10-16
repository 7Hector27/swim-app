"use client";

export type MonthDayCellState = "open" | "closed" | "past" | "not_open_yet";

export interface MonthDayCellData {
  date: string;
  state: MonthDayCellState;
  openCount: number;
  totalCount: number;
  isCurrentMonth: boolean;
}

interface Props {
  cell: MonthDayCellData;
  todayStr: string;
  onDayClick: (date: string) => void;
}

function getDayNumber(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00`).getDate();
}

function stateLabel(cell: MonthDayCellData, isToday: boolean): string {
  const prefix = isToday ? "Today · " : "";
  if (cell.state === "past") return `${prefix}Past`;
  if (cell.state === "closed") return `${prefix}Closed`;
  if (cell.state === "not_open_yet") return `${prefix}Not open yet`;
  if (cell.openCount === 0) return `${prefix}Full`;
  return `${prefix}${cell.openCount} of ${cell.totalCount} open`;
}

export default function MonthDayCell({ cell, todayStr, onDayClick }: Props) {
  const isToday = cell.date === todayStr;
  const fillPercent =
    cell.totalCount > 0
      ? Math.round((cell.openCount / cell.totalCount) * 100)
      : 0;

  const isInteractive = cell.state === "open" && cell.openCount > 0;

  const baseClasses = `bg-background flex flex-col p-2 min-h-[72px] text-left w-full transition-colors duration-100 motion-reduce:transition-none ${
    cell.isCurrentMonth ? "" : "opacity-40"
  } ${isToday ? "ring-2 ring-inset ring-accent" : ""} ${
    isInteractive ? "hover:bg-surface-soft cursor-pointer active:scale-[0.98] motion-reduce:transform-none" : "cursor-default"
  }`;

  return (
    <button
      type="button"
      onClick={() => onDayClick(cell.date)}
      disabled={!isInteractive}
      aria-label={`${cell.date}${isToday ? ", today" : ""}, ${stateLabel(cell, false)}`}
      aria-current={isToday ? "date" : undefined}
      className={baseClasses}
    >
      <span className="text-xl font-bold text-heading leading-none">
        {getDayNumber(cell.date)}
      </span>
      <span className="text-[10px] text-text-secondary mt-1 leading-tight">
        {stateLabel(cell, isToday)}
      </span>
      <div className="mt-auto pt-2 flex w-full">
        <div
          className="h-[3px] bg-accent rounded-full"
          style={{ width: `${fillPercent}%` }}
        />
        <div
          className="h-[3px] bg-border rounded-full flex-1"
        />
      </div>
    </button>
  );
}
