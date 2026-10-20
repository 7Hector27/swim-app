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
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="text-xs text-text-secondary whitespace-nowrap">
            {formatMonthDay(season.startDate)} – {formatMonthDay(season.endDate)}
          </span>
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit ${season.name}`}
            className="inline-flex items-center justify-center w-11 h-11 rounded-button text-text-secondary hover:text-accent transition-colors duration-150"
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="M13.586 3.586a2 2 0 1 1 2.828 2.828L7 15.828 3 17l1.172-4L13.586 3.586z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <TimeStat
          label="Weekday hours"
          value={
            season.weekdayStartTime && season.weekdayEndTime
              ? formatWindowRange(season.weekdayStartTime, season.weekdayEndTime)
              : "Off"
          }
        />
        <TimeStat
          label="Weekend hours"
          value={
            season.weekendStartTime && season.weekendEndTime
              ? formatWindowRange(season.weekendStartTime, season.weekendEndTime)
              : "Off"
          }
        />
      </div>
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
