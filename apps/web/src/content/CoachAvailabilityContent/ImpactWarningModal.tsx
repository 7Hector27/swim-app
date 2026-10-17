"use client";

import { useEffect, useRef } from "react";
import type { ImpactWarning } from "@swim-app/shared";

import styles from "./CoachAvailabilityContent.module.css";
import { formatLessonLA, joinNames } from "./availabilityFormat";

interface Props {
  open: boolean;
  warnings: ImpactWarning[];
  onDismiss: () => void;
}

export default function ImpactWarningModal({ open, warnings, onDismiss }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function handleBackdropClick(event: React.MouseEvent<HTMLDialogElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    ) {
      onDismiss();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onCancel={onDismiss}
      onClick={handleBackdropClick}
      aria-labelledby="impact-warning-title"
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <h2
            id="impact-warning-title"
            className="text-lg font-heading font-semibold text-text leading-tight"
            style={{ fontVariationSettings: '"SOFT" 100, "WONK" 0' }}
          >
            {warnings.length} booked lesson{warnings.length === 1 ? "" : "s"} fall outside your new hours
          </h2>
          <p className="text-sm text-text-secondary leading-relaxed">
            Your changes are saved. Review these lessons and reschedule or cancel with the family if needed. Nothing was changed for them.
          </p>
        </div>

        <ul className="flex flex-col gap-2 max-h-80 overflow-auto">
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

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex items-center justify-center h-11 px-5 rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm transition-opacity duration-150 hover:opacity-90 active:scale-[0.97]"
          >
            Keep lessons as scheduled
          </button>
        </div>
      </div>
    </dialog>
  );
}
