"use client";

import { useState } from "react";
import Link from "next/link";
import type { ScheduleItem } from "@swim-app/shared";

import { fetchCoachSchedule } from "@/lib/api/lessons";

interface Props {
  initialItems: ScheduleItem[];
  today: string; // YYYY-MM-DD (LA timezone)
  accessToken: string;
}

function addDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number) as [number, number, number];
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return d.toISOString().slice(0, 10);
}

function dayLabel(viewDate: string, today: string): string {
  if (viewDate === today) return "Today";
  if (viewDate === addDays(today, 1)) return "Tomorrow";
  const [year, month, day] = viewDate.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export default function TodayScheduleCard({ initialItems, today, accessToken }: Props) {
  const [viewDate, setViewDate] = useState(today);
  const [items, setItems] = useState(initialItems);
  const [isLoading, setIsLoading] = useState(false);

  async function navigate(newDate: string) {
    setViewDate(newDate);
    setIsLoading(true);
    try {
      const fetched = await fetchCoachSchedule(accessToken, newDate);
      setItems(fetched);
    } finally {
      setIsLoading(false);
    }
  }

  const label = dayLabel(viewDate, today);

  return (
    <div className="rounded-card border border-border p-5 tablet:p-6">
      <div className="flex items-center justify-between mb-4 gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => { void navigate(addDays(viewDate, -1)); }}
            aria-label="Previous day"
            className="inline-flex items-center justify-center w-9 h-9 rounded-button text-text-secondary hover:text-text transition-colors duration-150"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <h2 className="text-base font-semibold text-heading w-[6rem] text-center tabular-nums">
            {label}
          </h2>
          <button
            type="button"
            onClick={() => { void navigate(addDays(viewDate, 1)); }}
            aria-label="Next day"
            className="inline-flex items-center justify-center w-9 h-9 rounded-button text-text-secondary hover:text-text transition-colors duration-150"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M8 5l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <Link
          href={`/coach/schedule?date=${viewDate}`}
          className="text-sm font-semibold text-link hover:text-link-hover transition-colors duration-150"
        >
          Full schedule
        </Link>
      </div>

      {isLoading ? (
        <p className="text-sm text-text-secondary py-4">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-text-secondary py-4">No lessons scheduled.</p>
      ) : (
        <div className="divide-y divide-border">
          {items.map((item) => {
            if (item.type === "lesson") {
              return <LessonRow key={item.lesson.id} item={item} />;
            }
            if (item.type === "travel_buffer") {
              return <TravelBufferRow key={`travel_buffer-${item.startsAt}`} item={item} />;
            }
            return <OpenSlotRow key={`open_slot-${item.startsAt}`} item={item} />;
          })}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function formatTime(isoString: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(isoString));
}

function LessonRow({ item }: { item: Extract<ScheduleItem, { type: "lesson" }> }) {
  const time = formatTime(item.lesson.startsAt);
  const swimmerNames = item.lesson.swimmers.map((swimmer) => swimmer.firstName).join(", ");

  return (
    <div className="py-4 flex flex-col gap-1.5 tablet:flex-row tablet:items-center tablet:gap-4">
      <p className="text-xs font-semibold text-text-secondary tabular-nums tablet:w-[68px] tablet:flex-shrink-0">
        {time}
      </p>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text">
          {swimmerNames || "No swimmers"}, {item.lesson.durationMinutes} min
        </p>
        <p className="text-xs text-text-secondary mt-0.5">
          {item.lesson.type === "private" ? "Private" : "Family"} lesson &middot; {item.locationName}
        </p>
      </div>
      <button
        type="button"
        className="self-start tablet:flex-shrink-0 min-h-[44px] flex items-center text-sm font-semibold text-link hover:text-link-hover transition-colors duration-150"
      >
        Open swimmer
      </button>
    </div>
  );
}

function TravelBufferRow({ item }: { item: Extract<ScheduleItem, { type: "travel_buffer" }> }) {
  const time = formatTime(item.startsAt);
  const durationMs = new Date(item.endsAt).getTime() - new Date(item.startsAt).getTime();
  const durationMin = Math.round(durationMs / 60_000);

  return (
    <div className="py-4 flex flex-col gap-1.5 tablet:flex-row tablet:items-center tablet:gap-4">
      <p className="text-xs font-semibold text-text-secondary tabular-nums tablet:w-[68px] tablet:flex-shrink-0">
        {time}
      </p>
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="flex-shrink-0 text-text-secondary"
          aria-hidden="true"
        >
          <rect x="1" y="3" width="15" height="13" rx="2" />
          <path d="M16 8h4l3 3v5h-7V8z" />
          <circle cx="5.5" cy="18.5" r="2.5" />
          <circle cx="18.5" cy="18.5" r="2.5" />
        </svg>
        <div>
          <p className="text-sm font-semibold text-text">
            Travel buffer, {durationMin} min
          </p>
          <p className="text-xs text-text-secondary mt-0.5">
            Blocked automatically. Not bookable.
          </p>
        </div>
      </div>
    </div>
  );
}

function OpenSlotRow({ item }: { item: Extract<ScheduleItem, { type: "open_slot" }> }) {
  const time = formatTime(item.startsAt);
  const until = formatTime(item.endsAt);

  return (
    <div className="py-4 flex flex-col gap-1.5 tablet:flex-row tablet:items-center tablet:gap-4">
      <p className="text-xs font-semibold text-text-secondary tabular-nums tablet:w-[68px] tablet:flex-shrink-0">
        {time}
      </p>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text-secondary">
          Open until {until}
        </p>
      </div>
    </div>
  );
}
