"use client";

import { useEffect, useRef, useState } from "react";
import type {
  AvailabilityOverride,
  CreateOverrideBody,
  PatchOverrideBody,
} from "@swim-app/shared";

import styles from "./CoachAvailabilityContent.module.css";

interface Props {
  open: boolean;
  override: AvailabilityOverride | null;
  onCancel: () => void;
  onSubmit: (
    body: CreateOverrideBody | PatchOverrideBody,
    mode: "create" | "patch",
  ) => Promise<string | null>;
  isPending: boolean;
}

type Mode = "single_day_off" | "range_day_off" | "custom_hours";

const MODE_OPTIONS: { value: Mode; label: string; hint: string }[] = [
  { value: "single_day_off", label: "Single day off", hint: "One date Jason isn't teaching." },
  { value: "range_day_off", label: "Date range (vacation)", hint: "A span of days off." },
  { value: "custom_hours", label: "Custom hours", hint: "Different hours for one date." },
];

function inferMode(override: AvailabilityOverride): Mode {
  if (override.kind === "custom_hours") return "custom_hours";
  if (override.startDate === override.endDate) return "single_day_off";
  return "range_day_off";
}

export default function OverrideFormModal({ open, override, onCancel, onSubmit, isPending }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<Mode>("single_day_off");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [note, setNote] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isEdit = override !== null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (override) {
      setMode(inferMode(override));
      setStartDate(override.startDate);
      setEndDate(override.endDate);
      setStartTime(override.startTime ?? "");
      setEndTime(override.endTime ?? "");
      setNote(override.note ?? "");
    } else {
      setMode("single_day_off");
      setStartDate("");
      setEndDate("");
      setStartTime("");
      setEndTime("");
      setNote("");
    }
    setErrorMessage(null);
  }, [open, override]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    if (!startDate) {
      setErrorMessage("Pick a start date.");
      return;
    }

    let body: CreateOverrideBody;
    if (mode === "custom_hours") {
      if (!startTime || !endTime) {
        setErrorMessage("Pick start and end times for the custom hours.");
        return;
      }
      body = {
        kind: "custom_hours",
        startDate,
        endDate: startDate,
        startTime,
        endTime,
        ...(note.trim().length > 0 && { note: note.trim() }),
      };
    } else if (mode === "range_day_off") {
      if (!endDate) {
        setErrorMessage("Pick an end date for the range.");
        return;
      }
      body = {
        kind: "day_off",
        startDate,
        endDate,
        ...(note.trim().length > 0 && { note: note.trim() }),
      };
    } else {
      body = {
        kind: "day_off",
        startDate,
        endDate: startDate,
        ...(note.trim().length > 0 && { note: note.trim() }),
      };
    }

    const message = await onSubmit(body, isEdit ? "patch" : "create");
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
    "h-11 px-3 rounded-button border border-divider-section bg-section text-text-on-section text-sm focus:outline focus:outline-2 focus:outline-focus-ring";
  const labelClass = "text-sm font-semibold text-text-on-section";

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onClick={handleBackdropClick}
      onCancel={onCancel}
      aria-labelledby="override-form-title"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
        <h2
          id="override-form-title"
          className="text-lg font-heading font-semibold text-text-on-section leading-tight"
          style={{ fontVariationSettings: '"SOFT" 100, "WONK" 0' }}
        >
          {isEdit ? "Edit one-off change" : "Add a day off or custom hours"}
        </h2>

        <fieldset className="flex flex-col gap-2">
          <legend className={labelClass}>Type</legend>
          <div className="flex flex-col gap-2">
            {MODE_OPTIONS.map((option) => {
              const active = option.value === mode;
              return (
                <label
                  key={option.value}
                  className={`flex items-start gap-3 p-3 min-h-[44px] rounded-card border cursor-pointer transition-colors duration-150 ${
                    active
                      ? "border-accent-on-section bg-surface-soft"
                      : "border-divider-section"
                  }`}
                >
                  <input
                    type="radio"
                    name="override-mode"
                    value={option.value}
                    checked={active}
                    onChange={() => setMode(option.value)}
                    className="mt-1"
                  />
                  <span className="flex flex-col">
                    <span className="text-sm font-semibold text-text-on-section">
                      {option.label}
                    </span>
                    <span className="text-xs text-text-secondary-on-section">{option.hint}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="grid grid-cols-1 tablet:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="override-start-date" className={labelClass}>
              {mode === "range_day_off" ? "From" : "Date"}
            </label>
            <input
              id="override-start-date"
              type="date"
              required
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className={inputClass}
            />
          </div>
          {mode === "range_day_off" && (
            <div className="flex flex-col gap-1">
              <label htmlFor="override-end-date" className={labelClass}>
                To
              </label>
              <input
                id="override-end-date"
                type="date"
                required
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className={inputClass}
              />
            </div>
          )}
        </div>

        {mode === "custom_hours" && (
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="override-start-time" className={labelClass}>
                Starts
              </label>
              <input
                id="override-start-time"
                type="time"
                step={900}
                required
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
                className={inputClass}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="override-end-time" className={labelClass}>
                Ends
              </label>
              <input
                id="override-end-time"
                type="time"
                step={900}
                required
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
                className={inputClass}
              />
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label htmlFor="override-note" className={labelClass}>
            Note (optional)
          </label>
          <textarea
            id="override-note"
            rows={2}
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="px-3 py-2 rounded-button border border-divider-section bg-section text-text-on-section text-sm focus:outline focus:outline-2 focus:outline-focus-ring"
          />
          <p className="text-xs text-text-secondary-on-section">{note.length}/500</p>
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
            className="inline-flex items-center justify-center h-11 px-5 rounded-button border border-divider-section text-text-on-section font-semibold text-sm transition-colors duration-150 hover:border-text-secondary-on-section"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex items-center justify-center h-11 px-5 rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm transition-opacity duration-150 disabled:opacity-60 hover:opacity-90 active:scale-[0.97]"
          >
            {isPending ? "Saving…" : isEdit ? "Save change" : "Save change"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
