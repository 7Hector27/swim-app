"use client";

import { useEffect, useRef, useState } from "react";
import type { AvailabilityConfig, PatchAvailabilityConfigBody } from "@swim-app/shared";

import styles from "./CoachAvailabilityContent.module.css";

interface Props {
  open: boolean;
  config: AvailabilityConfig;
  onCancel: () => void;
  onSubmit: (body: PatchAvailabilityConfigBody) => Promise<string | null>;
  isPending: boolean;
}

const DAY_OPTIONS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
] as const;

function isQuarterHour(time: string): boolean {
  const parts = time.split(":");
  const minutes = parts[1];
  return minutes === "00" || minutes === "15" || minutes === "30" || minutes === "45";
}

export default function DefaultHoursModal({
  open,
  config,
  onCancel,
  onSubmit,
  isPending,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [teachesDays, setTeachesDays] = useState<number[]>([]);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setErrorMessage(null);
    setTeachesDays([...config.defaultTeachesDays]);
    setStartTime(config.defaultStartTime);
    setEndTime(config.defaultEndTime);
  }, [open, config]);

  function toggleDay(day: number) {
    setTeachesDays((prev) =>
      prev.includes(day) ? prev.filter((value) => value !== day) : [...prev, day].sort(),
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    if (teachesDays.length === 0) {
      setErrorMessage("Pick at least one day Jason teaches by default.");
      return;
    }
    if (!isQuarterHour(startTime) || !isQuarterHour(endTime)) {
      setErrorMessage("Times must be on a 15-minute step.");
      return;
    }
    if (startTime >= endTime) {
      setErrorMessage("End time must be after start time.");
      return;
    }

    const body: PatchAvailabilityConfigBody = {
      defaultTeachesDays: teachesDays,
      defaultStartTime: startTime,
      defaultEndTime: endTime,
    };
    const message = await onSubmit(body);
    if (message) setErrorMessage(message);
  }

  function handleBackdropClick(event: React.MouseEvent<HTMLDialogElement>) {
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

  const inputClass =
    "h-11 px-3 rounded-button border border-border bg-background text-text text-sm focus:outline focus:outline-2 focus:outline-focus-ring";
  const labelClass = "text-sm font-semibold text-text";

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onClick={handleBackdropClick}
      onCancel={onCancel}
      aria-labelledby="default-hours-form-title"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
        <div className="flex flex-col gap-1">
          <h2
            id="default-hours-form-title"
            className="text-lg font-heading font-semibold text-text leading-tight"
            style={{ fontVariationSettings: '"SOFT" 100, "WONK" 0' }}
          >
            Edit default hours
          </h2>
          <p className="text-xs text-text-secondary">
            Used when no season covers a date and no one-off change applies.
          </p>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className={labelClass}>Teaches on</legend>
          <div className="flex flex-wrap gap-2">
            {DAY_OPTIONS.map((option) => {
              const active = teachesDays.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => toggleDay(option.value)}
                  aria-pressed={active}
                  className={`inline-flex items-center justify-center h-11 min-w-[52px] px-3 rounded-button border-2 text-sm font-semibold transition-colors duration-150 ${
                    active
                      ? "bg-button-primary-background text-button-primary-text border-button-primary-background"
                      : "bg-transparent border-button-outline text-text"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="grid grid-cols-1 tablet:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="default-start-time" className={labelClass}>
              Start
            </label>
            <input
              id="default-start-time"
              type="time"
              step={900}
              required
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="default-end-time" className={labelClass}>
              End
            </label>
            <input
              id="default-end-time"
              type="time"
              step={900}
              required
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        {errorMessage && (
          <p role="alert" aria-live="polite" className="text-sm text-danger">
            {errorMessage}
          </p>
        )}

        <div className="flex gap-3 justify-end flex-wrap">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center justify-center h-11 px-5 rounded-button border border-border text-text font-semibold text-sm transition-colors duration-150 hover:border-text-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex items-center justify-center h-11 px-5 rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm transition-opacity duration-150 disabled:opacity-60 hover:opacity-90 active:scale-[0.97]"
          >
            {isPending ? "Saving…" : "Save defaults"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
