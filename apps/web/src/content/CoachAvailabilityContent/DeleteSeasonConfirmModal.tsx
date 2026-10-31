"use client";

import { useEffect, useRef } from "react";
import type { ImpactWarning, SeasonWithIsCurrent } from "@swim-app/shared";

import {
  formatLessonLA,
  formatMonthDay,
  joinNames,
} from "./availabilityFormat";
import styles from "./CoachAvailabilityContent.module.css";

interface Props {
  open: boolean;
  season: SeasonWithIsCurrent | null;
  warnings: ImpactWarning[];
  warningsLoading: boolean;
  isPending: boolean;
  errorMessage?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function DeleteSeasonConfirmModal({
  open,
  season,
  warnings,
  warningsLoading,
  isPending,
  errorMessage,
  onCancel,
  onConfirm,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function handleBackdropClick(event: React.MouseEvent<HTMLDialogElement>) {
    if (isPending) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    ) {
      onCancel();
    }
  }

  if (!season) {
    // Still render the dialog so the open/close effect has a target; just
    // skip the content body so stale season copy never flashes.
    return (
      <dialog
        ref={dialogRef}
        className={styles.dialog}
        onCancel={onCancel}
        aria-label="Delete season"
      />
    );
  }

  const dateRange = `${formatMonthDay(season.startDate)} to ${formatMonthDay(season.endDate)}`;
  const warningCount = warnings.length;

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onCancel={onCancel}
      onClick={handleBackdropClick}
      aria-labelledby="delete-season-title"
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <h2
            id="delete-season-title"
            className="text-lg font-heading font-semibold text-text leading-tight"
            style={{ fontVariationSettings: '"SOFT" 100, "WONK" 0' }}
          >
            Delete {season.name}?
          </h2>
          <p className="text-sm text-text-secondary leading-relaxed">
            Your default hours will apply to {dateRange} instead. Booked
            lessons stay on the calendar.
          </p>
        </div>

        {warningsLoading ? (
          <p className="text-sm text-text-secondary">Checking booked lessons…</p>
        ) : warningCount > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-text">
              {warningCount} booked lesson{warningCount === 1 ? "" : "s"} would
              fall outside your default hours
            </p>
            <ul className="flex flex-col gap-2 max-h-60 overflow-auto">
              {warnings.map((warning) => {
                const { date, time } = formatLessonLA(warning.startsAt);
                return (
                  <li
                    key={warning.lessonId}
                    className="rounded-card border border-border bg-surface-soft p-3"
                  >
                    <p className="text-sm font-semibold text-text">
                      {date} · {time}
                    </p>
                    <p className="text-xs text-text-secondary mt-0.5">
                      {joinNames(warning.swimmerFirstNames)} · {warning.poolName}
                    </p>
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-text-secondary">
              Nothing is cancelled automatically. You can reschedule or cancel
              with the family after.
            </p>
          </div>
        ) : null}

        {errorMessage && (
          <p role="alert" aria-live="polite" className="text-sm text-danger">
            {errorMessage}
          </p>
        )}

        <div className="flex gap-3 justify-end flex-wrap">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="inline-flex items-center justify-center h-11 px-5 rounded-button border border-border text-text font-semibold text-sm transition-colors duration-150 hover:border-text-secondary disabled:opacity-60"
          >
            Keep season
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending || warningsLoading}
            className="inline-flex items-center justify-center h-11 px-5 rounded-button bg-danger text-button-danger-text font-bold text-sm transition-opacity duration-150 disabled:opacity-60 hover:opacity-90 active:scale-[0.97]"
          >
            {isPending ? "Deleting…" : "Delete season"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
