"use client";

import { formatMonthDay } from "../helpers";

interface SessionCadenceProps {
  weeks: Array<{ weekStart: string; count: number }>;
}

// 12-week bar strip of session counts. Zero-session weeks still render a
// thin baseline so a gap is visible rather than a gap plus a missing bar.
export default function SessionCadence({ weeks }: SessionCadenceProps) {
  const maxCount = Math.max(...weeks.map((week) => week.count), 1);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-1 h-12">
        {weeks.map((week) => {
          const heightPercent = week.count === 0 ? 6 : Math.max(16, (week.count / maxCount) * 100);
          return (
            <div
              key={week.weekStart}
              className="flex-1 rounded-sm"
              style={{
                height: `${heightPercent}%`,
                backgroundColor: week.count === 0 ? "var(--color-border)" : "var(--color-accent)",
                opacity: week.count === 0 ? 0.6 : 1,
                transition: "height 320ms cubic-bezier(0.23, 1, 0.32, 1)",
              }}
              title={`${formatMonthDay(week.weekStart)}: ${week.count} session${week.count === 1 ? "" : "s"}`}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-text-secondary tabular-nums">
        <span>{weeks[0] ? formatMonthDay(weeks[0].weekStart) : ""}</span>
        <span>{weeks[weeks.length - 1] ? formatMonthDay(weeks[weeks.length - 1]!.weekStart) : ""}</span>
      </div>
    </div>
  );
}
