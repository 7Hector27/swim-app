"use client";

import type { AvailabilityConfig } from "@swim-app/shared";

interface Props {
  config: AvailabilityConfig;
  firstSeasonDate: string | null;
  onEdit: () => void;
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function formatDays(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 0) return "No days";
  // Collapse contiguous runs into "Mon to Fri".
  const runs: Array<[number, number]> = [];
  let runStart = sorted[0]!;
  let runEnd = runStart;
  for (let index = 1; index < sorted.length; index++) {
    const day = sorted[index]!;
    if (day === runEnd + 1) {
      runEnd = day;
    } else {
      runs.push([runStart, runEnd]);
      runStart = day;
      runEnd = day;
    }
  }
  runs.push([runStart, runEnd]);
  return runs
    .map(([start, end]) => {
      const startName = DAY_NAMES[start - 1]!;
      if (start === end) return startName;
      const endName = DAY_NAMES[end - 1]!;
      return `${startName} to ${endName}`;
    })
    .join(", ");
}

function time12(time: string): string {
  const [hoursStr, minutes] = time.split(":") as [string, string];
  const hours = Number(hoursStr);
  const period = hours >= 12 ? "pm" : "am";
  const display = hours % 12 === 0 ? 12 : hours % 12;
  return `${display}:${minutes} ${period}`;
}

function formatFirstSeasonHint(firstSeasonDate: string): string {
  const [year, month, day] = firstSeasonDate.split("-").map(Number) as [number, number, number];
  const utc = new Date(Date.UTC(year, month - 1, day));
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(utc);
  return `Used until your first season starts on ${label}.`;
}

export default function DefaultHoursCard({ config, firstSeasonDate, onEdit }: Props) {
  const daysLabel = formatDays(config.defaultTeachesDays);
  const hoursLabel = `${time12(config.defaultStartTime)} to ${time12(config.defaultEndTime)}`;
  const hint =
    firstSeasonDate === null
      ? "These hours are in effect — add a season to override them for a specific stretch."
      : formatFirstSeasonHint(firstSeasonDate);

  return (
    <section
      aria-labelledby="default-hours-title"
      className="rounded-card border border-border bg-background p-5 flex flex-col gap-3 tablet:flex-row tablet:items-center tablet:justify-between"
    >
      <div className="flex flex-col gap-1">
        <h2
          id="default-hours-title"
          className="text-base font-heading text-text"
          style={{ fontVariationSettings: '"SOFT" 100, "WONK" 0' }}
        >
          Default hours
        </h2>
        <p className="text-sm text-text">
          {daysLabel}, {hoursLabel}
        </p>
        <p className="text-xs text-text-secondary">{hint}</p>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="inline-flex items-center justify-center h-11 px-5 rounded-button border-2 border-button-outline text-button-outline font-bold text-sm transition-opacity duration-150 hover:opacity-80 active:scale-[0.98] self-start tablet:self-auto"
      >
        Edit
      </button>
    </section>
  );
}
