"use client";

import type { SeasonWithIsCurrent } from "@swim-app/shared";

import { formatMonthDay, formatTime12 } from "./availabilityFormat";

interface Props {
  season: SeasonWithIsCurrent;
  onEdit: () => void;
}

export default function SeasonCard({ season, onEdit }: Props) {
  return (
    <div className="rounded-card border-2 border-accent-on-section bg-section p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h2
            className="text-xl text-text-on-section font-heading font-semibold"
            style={{ fontVariationSettings: '"SOFT" 100, "WONK" 0' }}
          >
            {season.name}
          </h2>
          {season.isCurrent && (
            <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-accent-on-section text-on-accent">
              Now
            </span>
          )}
        </div>
        <span className="text-xs text-text-secondary-on-section whitespace-nowrap">
          Since {formatMonthDay(season.startDate)}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <TimeStat label="Weekdays" value={formatTime12(season.weekdayStartTime)} />
        <TimeStat label="Weekends" value={formatTime12(season.weekendStartTime)} />
        <TimeStat label="Ends" value={formatTime12(season.endTime)} />
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
      <p className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary-on-section">
        {label}
      </p>
      <p className="text-base font-bold text-text-on-section mt-0.5">{value}</p>
    </div>
  );
}
