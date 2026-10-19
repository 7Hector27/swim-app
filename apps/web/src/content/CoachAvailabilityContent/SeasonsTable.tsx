"use client";

import type { SeasonWithIsCurrent } from "@swim-app/shared";

import {
  addDaysIso,
  formatMonthDay,
  formatTeachesDays,
  formatWindowRange,
  seasonHasDifferentWeekendStart,
} from "./availabilityFormat";

interface SeasonsTableProps {
  seasons: SeasonWithIsCurrent[];
  onEdit: (season: SeasonWithIsCurrent) => void;
  onDelete: (season: SeasonWithIsCurrent) => void;
}

type TableEntry =
  | { kind: "season"; season: SeasonWithIsCurrent }
  | { kind: "gap"; from: string; to: string | null };

function buildEntries(seasons: SeasonWithIsCurrent[]): TableEntry[] {
  const sorted = [...seasons].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const entries: TableEntry[] = [];
  for (let index = 0; index < sorted.length; index++) {
    const season = sorted[index]!;
    entries.push({ kind: "season", season });
    const next = sorted[index + 1] ?? null;
    const gapStart = addDaysIso(season.endDate, 1);
    if (next === null) {
      entries.push({ kind: "gap", from: gapStart, to: null });
    } else if (gapStart < next.startDate) {
      entries.push({ kind: "gap", from: gapStart, to: addDaysIso(next.startDate, -1) });
    }
  }
  if (sorted.length === 0) {
    entries.push({ kind: "gap", from: "—", to: null });
  }
  return entries;
}

export default function SeasonsTable({ seasons, onEdit, onDelete }: SeasonsTableProps) {
  const entries = buildEntries(seasons);

  return (
    <div className="rounded-card border border-border overflow-hidden bg-background">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-text-secondary text-[11px] uppercase tracking-widest">
            <th className="px-5 py-3 font-semibold">Season</th>
            <th className="px-5 py-3 font-semibold">Teaches</th>
            <th className="px-5 py-3 font-semibold">Weekday hours</th>
            <th className="px-5 py-3 font-semibold">Weekend hours</th>
            <th className="px-5 py-3 font-semibold w-11" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            if (entry.kind === "gap") {
              const label = entry.to
                ? `Default hours · ${formatMonthDay(entry.from)} – ${formatMonthDay(entry.to)}`
                : `Default hours · from ${formatMonthDay(entry.from)}`;
              return (
                <tr
                  key={`gap-${entry.from}`}
                  className="border-t border-border bg-surface-soft"
                >
                  <td colSpan={4} className="px-5 py-3 align-middle">
                    <span className="text-xs text-text-secondary italic">{label}</span>
                  </td>
                  <td className="px-3 py-3 align-middle" />
                </tr>
              );
            }

            const { season } = entry;
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
                    className="flex flex-col items-start gap-0.5 text-left min-h-[44px] justify-center active:scale-[0.99] transition-transform duration-150"
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
                      {formatMonthDay(season.startDate)} – {formatMonthDay(season.endDate)}
                    </span>
                  </button>
                </td>
                <td className="px-5 py-4 text-text align-middle">
                  {formatTeachesDays(season.teachesDays)}
                </td>
                <td className="px-5 py-4 text-text align-middle">
                  {season.weekdayStartTime && season.weekdayEndTime
                    ? formatWindowRange(season.weekdayStartTime, season.weekdayEndTime)
                    : "—"}
                </td>
                <td className="px-5 py-4 text-text align-middle">
                  <span className="inline-flex items-center gap-2">
                    {season.weekendStartTime && season.weekendEndTime
                      ? formatWindowRange(season.weekendStartTime, season.weekendEndTime)
                      : "—"}
                    {highlight && (
                      <span
                        aria-label="Weekend start differs from weekdays"
                        title="Weekend start differs from weekdays"
                        className="inline-block w-1.5 h-1.5 rounded-full bg-accent"
                      />
                    )}
                  </span>
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
        </tbody>
      </table>
    </div>
  );
}
