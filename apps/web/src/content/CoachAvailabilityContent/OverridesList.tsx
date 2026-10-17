"use client";

import type { AvailabilityOverride, BlockedTime } from "@swim-app/shared";

import { formatMonthDay, formatTime12 } from "./availabilityFormat";

interface OverridesListProps {
  overrides: AvailabilityOverride[];
  blockedTimes: BlockedTime[];
  onDelete: (override: AvailabilityOverride) => void;
}

type Row =
  | { type: "override"; sortKey: string; data: AvailabilityOverride }
  | { type: "blocked"; sortKey: string; data: BlockedTime };

function toLADateString(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function timeOnlyLA(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(new Date(iso))
    .toLowerCase();
}

export default function OverridesList({
  overrides,
  blockedTimes,
  onDelete,
}: OverridesListProps) {
  const rows: Row[] = [
    ...overrides.map((override): Row => ({
      type: "override",
      sortKey: override.startDate,
      data: override,
    })),
    ...blockedTimes.map((blocked): Row => ({
      type: "blocked",
      sortKey: toLADateString(blocked.startsAt),
      data: blocked,
    })),
  ].sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  if (rows.length === 0) {
    return (
      <p className="text-sm text-text-secondary-on-section py-6 text-center">
        No one-off changes yet.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => {
        if (row.type === "override") {
          const override = row.data;
          const title =
            override.kind === "day_off"
              ? override.startDate === override.endDate
                ? `Day off · ${formatMonthDay(override.startDate)}`
                : `Days off · ${formatMonthDay(override.startDate)} – ${formatMonthDay(override.endDate)}`
              : `Custom hours · ${formatMonthDay(override.startDate)}`;
          const detail =
            override.kind === "custom_hours" && override.startTime && override.endTime
              ? `${formatTime12(override.startTime)} – ${formatTime12(override.endTime)}`
              : override.note ?? "Blocks all bookings this day";
          return (
            <li
              key={`override-${override.id}`}
              className="rounded-card border border-divider-section bg-section p-3 flex items-center justify-between gap-3"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-text-on-section">{title}</p>
                <p className="text-xs text-text-secondary-on-section truncate">{detail}</p>
              </div>
              <button
                type="button"
                onClick={() => onDelete(override)}
                aria-label="Delete one-off change"
                className="inline-flex items-center justify-center w-11 h-11 rounded-button text-text-secondary-on-section hover:text-danger transition-colors duration-150"
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
            </li>
          );
        }
        const blocked = row.data;
        const date = formatMonthDay(toLADateString(blocked.startsAt));
        return (
          <li
            key={`blocked-${blocked.id}`}
            className="rounded-card border border-divider-section bg-surface-soft p-3 flex items-center justify-between gap-3"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-text-on-section">
                Blocked · {date} · {timeOnlyLA(blocked.startsAt)} – {timeOnlyLA(blocked.endsAt)}
              </p>
              <p className="text-xs text-text-secondary-on-section truncate">
                {blocked.note ?? "Calendar event"}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
