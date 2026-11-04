"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { CoachScheduleItem } from "@swim-app/shared";

import DashboardLessonRow from "./DashboardLessonRow";
import { getCoachScheduleAction } from "./actions";

type SectionResult = { ok: true; data: CoachScheduleItem[] } | { ok: false };

interface Props {
  initialItems: CoachScheduleItem[];
  today: string; // YYYY-MM-DD (LA timezone)
  initialResult?: SectionResult;
}

function addDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function dayLabel(viewDate: string, today: string): string {
  if (viewDate === today) return "Today";
  if (viewDate === addDays(today, 1)) return "Tomorrow";
  const [year, month, day] = viewDate.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat("en-US", {
    // viewDate is an LA-timezone calendar string; Date.UTC constructs midnight UTC for that
    // date, and timeZone: "UTC" ensures the formatter reads it back without shifting.
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export default function TodayScheduleCard({ initialItems, today, initialResult }: Props) {
  const [viewDate, setViewDate] = useState(today);
  const [items, setItems] = useState(initialItems);
  const [isLoading, setIsLoading] = useState(false);
  // If the server-side initial load failed, surface the error up-front so the
  // card doesn't silently render as empty. Interactive navigation clears it.
  const [error, setError] = useState<string | null>(
    initialResult && !initialResult.ok ? "Couldn't load schedule." : null,
  );
  const [now, setNow] = useState<number | null>(null);
  const navIdRef = useRef(0);

  useEffect(() => {
    setNow(Date.now());
  }, []);

  async function navigate(newDate: string) {
    const navId = ++navIdRef.current;
    setViewDate(newDate);
    setIsLoading(true);
    setError(null);
    try {
      const result = await getCoachScheduleAction(newDate);
      if (navId !== navIdRef.current) return;
      if (!result.ok) {
        setError(result.error);
      } else {
        setItems(result.items);
      }
    } catch {
      if (navId !== navIdRef.current) return;
      setError("Could not load schedule. Please try again.");
    } finally {
      if (navId === navIdRef.current) setIsLoading(false);
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
      ) : error !== null ? (
        <div className="py-4 flex flex-col gap-3">
          <p className="text-sm text-danger">{error}</p>
          <button
            type="button"
            onClick={() => { void navigate(viewDate); }}
            className="self-start text-sm font-semibold text-link hover:text-link-hover transition-colors duration-150"
          >
            Retry
          </button>
        </div>
      ) : items.filter((item) => item.type !== "open_slot").length === 0 ? (
        <p className="text-sm text-text-secondary py-4">No lessons scheduled.</p>
      ) : (
        <div className="divide-y divide-border">
          {items.map((item) => {
            if (item.type === "lesson") {
              return <DashboardLessonRow key={item.lesson.id} item={item} now={now} />;
            }
            if (item.type === "travel_buffer") {
              return <TravelBufferRow key={`travel_buffer-${item.startsAt}`} item={item} />;
            }
            return null;
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

function TravelBufferRow({ item }: { item: Extract<CoachScheduleItem, { type: "travel_buffer" }> }) {
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
          <p className="text-sm font-semibold text-text">Travel buffer, {durationMin} min</p>
          <p className="text-xs text-text-secondary mt-0.5">Blocked automatically. Not bookable.</p>
        </div>
      </div>
    </div>
  );
}

