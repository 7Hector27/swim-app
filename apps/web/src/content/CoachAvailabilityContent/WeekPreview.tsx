"use client";

import type { AvailabilityPreviewResponse } from "@swim-app/shared";

import { dayOfMonth, formatMonthDay, formatWindowRange, weekdayShort } from "./availabilityFormat";
import styles from "./CoachAvailabilityContent.module.css";

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
      className="rounded-card border border-border bg-background p-5"
    >
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h3
            id="week-preview-title"
            className="text-base font-heading font-semibold text-text"
            style={{ fontVariationSettings: '"SOFT" 100, "WONK" 0' }}
          >
            What parents see
          </h3>
          <p className="text-xs text-text-secondary mt-0.5">{label}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onPrev}
            aria-label="Previous week"
            className="inline-flex items-center justify-center w-11 h-11 rounded-button border border-border text-text hover:border-text-secondary transition-colors duration-150"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onNext}
            aria-label="Next week"
            className="inline-flex items-center justify-center w-11 h-11 rounded-button border border-border text-text hover:border-text-secondary transition-colors duration-150"
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
        {preview.days.map((day) => {
          const isClosed = day.state === "closed";
          return (
            <li
              key={day.date}
              className={`${styles.previewDay} ${
                isClosed ? styles.previewDayClosed : styles.previewDayOpen
              }`}
            >
              <p
                className={`text-[10px] font-semibold uppercase tracking-widest ${
                  isClosed ? "text-text-secondary" : styles.previewDayLabel
                }`}
              >
                {weekdayShort(day.date)}
              </p>
              <p
                className={`text-base font-bold ${
                  isClosed ? "text-text-secondary" : styles.previewDayLabel
                }`}
              >
                {dayOfMonth(day.date)}
              </p>
              {isClosed ? (
                <p className="text-xs text-text-secondary mt-auto">Day off</p>
              ) : (
                <ul className={`text-xs mt-auto flex flex-col gap-0.5 ${styles.previewDayHours}`}>
                  {day.windows.map((window) => (
                    <li key={`${day.date}-${window.start}`}>
                      {formatWindowRange(window.start, window.end)}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
