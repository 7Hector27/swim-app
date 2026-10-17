"use client";

import type { AvailabilityPreviewResponse } from "@swim-app/shared";

import { dayOfMonth, formatMonthDay, formatWindowRange, weekdayShort } from "./availabilityFormat";

interface Props {
  weekStart: string;
  preview: AvailabilityPreviewResponse;
  isLoading: boolean;
  onPrev: () => void;
  onNext: () => void;
}

export default function WeekPreview({
  weekStart,
  preview,
  isLoading,
  onPrev,
  onNext,
}: Props) {
  const label = `Week of ${formatMonthDay(weekStart)}`;

  return (
    <section
      aria-labelledby="week-preview-title"
      className="rounded-card border border-border bg-section p-5"
    >
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h3
            id="week-preview-title"
            className="text-base font-heading font-semibold text-text-on-section"
            style={{ fontVariationSettings: '"SOFT" 100, "WONK" 0' }}
          >
            What parents see
          </h3>
          <p className="text-xs text-text-secondary-on-section mt-0.5">{label}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onPrev}
            aria-label="Previous week"
            className="inline-flex items-center justify-center w-11 h-11 rounded-button border border-divider-section text-text-on-section hover:border-text-secondary-on-section transition-colors duration-150"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onNext}
            aria-label="Next week"
            className="inline-flex items-center justify-center w-11 h-11 rounded-button border border-divider-section text-text-on-section hover:border-text-secondary-on-section transition-colors duration-150"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M8 5l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      <ul
        className={`grid grid-cols-2 tablet:grid-cols-7 gap-2 ${isLoading ? "opacity-60" : ""}`}
        aria-busy={isLoading}
      >
        {preview.days.map((day) => (
          <li
            key={day.date}
            className="rounded-button border border-divider-section bg-surface-soft px-3 py-3 flex flex-col gap-1 min-h-[88px]"
          >
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary-on-section">
              {weekdayShort(day.date)}
            </p>
            <p className="text-base font-bold text-text-on-section">{dayOfMonth(day.date)}</p>
            {day.state === "closed" ? (
              <p className="text-xs text-text-secondary-on-section mt-auto">Day off</p>
            ) : (
              <ul className="text-xs text-text-on-section mt-auto flex flex-col gap-0.5">
                {day.windows.map((window, index) => (
                  <li key={`${day.date}-${index}`}>{formatWindowRange(window.start, window.end)}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
