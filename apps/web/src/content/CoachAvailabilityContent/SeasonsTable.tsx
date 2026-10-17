"use client";

import type { SeasonWithIsCurrent } from "@swim-app/shared";

import {
  formatMonthDay,
  formatTeachesDays,
  formatTime12,
  seasonHasDifferentWeekendStart,
} from "./availabilityFormat";

interface SeasonsTableProps {
  seasons: SeasonWithIsCurrent[];
  onEdit: (season: SeasonWithIsCurrent) => void;
  onDelete: (season: SeasonWithIsCurrent) => void;
}

export default function SeasonsTable({ seasons, onEdit, onDelete }: SeasonsTableProps) {
  return (
    <div className="rounded-card border border-border overflow-hidden bg-background">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-text-secondary text-[11px] uppercase tracking-widest">
            <th className="px-5 py-3 font-semibold">Season</th>
            <th className="px-5 py-3 font-semibold">Teaches</th>
            <th className="px-5 py-3 font-semibold">Weekday start</th>
            <th className="px-5 py-3 font-semibold">Weekend start</th>
            <th className="px-5 py-3 font-semibold">Ends</th>
            <th className="px-5 py-3 font-semibold w-11" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {seasons.map((season) => {
            const highlight = seasonHasDifferentWeekendStart(season);
            return (
              <tr
                key={season.id}
                className="border-t border-border hover:bg-surface-soft transition-colors duration-150"
              >
                <td className="px-5 py-4 align-top">
                  <button
                    type="button"
                    onClick={() => onEdit(season)}
                    className="flex flex-col items-start gap-1 text-left h-11 justify-center active:scale-[0.99] transition-transform duration-150"
                  >
                    <span className="font-semibold text-text inline-flex items-center gap-2">
                      {season.name}
                      {season.isCurrent && (
                        <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-accent text-on-accent">
                          Now
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-text-secondary">
                      Starts {formatMonthDay(season.startDate)}
                    </span>
                  </button>
                </td>
                <td className="px-5 py-4 text-text align-middle">
                  {formatTeachesDays(season.teachesDays)}
                </td>
                <td className="px-5 py-4 text-text align-middle">
                  {formatTime12(season.weekdayStartTime)}
                </td>
                <td className="px-5 py-4 text-text align-middle">
                  <span className="inline-flex items-center gap-2">
                    {formatTime12(season.weekendStartTime)}
                    {highlight && (
                      <span
                        aria-label="Weekend start differs from weekdays"
                        title="Weekend start differs from weekdays"
                        className="inline-block w-1.5 h-1.5 rounded-full bg-accent"
                      />
                    )}
                  </span>
                </td>
                <td className="px-5 py-4 text-text align-middle">
                  {formatTime12(season.endTime)}
                </td>
                <td className="px-3 py-4 align-middle">
                  <button
                    type="button"
                    onClick={() => onDelete(season)}
                    aria-label={`Delete ${season.name}`}
                    className="inline-flex items-center justify-center w-11 h-11 rounded-button text-text-secondary hover:text-danger transition-colors duration-150"
                  >
                    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                      <path
                        d="M4 6h12M8 6V4h4v2M6 6l1 10a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1l1-10"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </td>
              </tr>
            );
          })}
          {seasons.length === 0 && (
            <tr>
              <td
                colSpan={6}
                className="px-5 py-10 text-center text-sm text-text-secondary"
              >
                No seasons yet. Add one to set your teaching hours.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
