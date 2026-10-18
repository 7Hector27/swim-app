"use client";

import type { SeasonWithIsCurrent } from "@swim-app/shared";

import { formatMonthDay, formatWindowRange } from "./availabilityFormat";

interface Props {
  season: SeasonWithIsCurrent;
  onEdit: () => void;
}

export default function SeasonCard({ season, onEdit }: Props) {
  return (
    <div className="rounded-card border-2 border-accent bg-background p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h2
            className="text-xl text-text font-heading font-semibold"
            style={{ fontVariationSettings: '"SOFT" 100, "WONK" 0' }}
          >
            {season.name}
          </h2>
          {season.isCurrent && (
            <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-accent text-on-accent">
              Now
            </span>
          )}
        </div>
        <span className="text-xs text-text-secondary whitespace-nowrap">
          Since {formatMonthDay(season.startDate)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <TimeStat
          label="Weekday hours"
          value={
            season.weekdayStartTime && season.weekdayEndTime
              ? formatWindowRange(season.weekdayStartTime, season.weekdayEndTime)
              : "—"
          }
        />
        <TimeStat
          label="Weekend hours"
          value={
            season.weekendStartTime && season.weekendEndTime
              ? formatWindowRange(season.weekendStartTime, season.weekendEndTime)
              : "—"
          }
        />
      </div>

      <button
        type="button"
        onClick={onEdit}
        className="inline-flex items-center justify-center h-11 rounded-button border-2 border-button-outline text-button-outline font-bold text-sm transition-opacity duration-150 hover:opacity-80 active:scale-[0.98]"
      >
        Edit {season.name}
      </button>
    </div>
  );
}

function TimeStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-button bg-surface-soft px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary">
        {label}
      </p>
      <p className="text-base font-bold text-text mt-0.5">{value}</p>
    </div>
  );
}
