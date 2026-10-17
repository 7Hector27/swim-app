"use client";

import { useEffect, useRef, useState } from "react";
import type {
  CreateSeasonBody,
  PatchSeasonBody,
  SeasonWithIsCurrent,
} from "@swim-app/shared";

import styles from "./CoachAvailabilityContent.module.css";

interface Props {
  open: boolean;
  season: SeasonWithIsCurrent | null;
  onCancel: () => void;
  onSubmit: (
    body: CreateSeasonBody | PatchSeasonBody,
    mode: "create" | "patch",
  ) => Promise<string | null>;
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

function hasWeekday(days: number[]): boolean {
  return days.some((day) => day >= 1 && day <= 5);
}
function hasWeekend(days: number[]): boolean {
  return days.some((day) => day === 6 || day === 7);
}

export default function SeasonFormModal({
  open,
  season,
  onCancel,
  onSubmit,
  isPending,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [teachesDays, setTeachesDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
  const [weekdayStart, setWeekdayStart] = useState("");
  const [weekendStart, setWeekendStart] = useState("");
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
    if (season) {
      setName(season.name);
      setStartDate(season.startDate);
      setTeachesDays([...season.teachesDays]);
      setWeekdayStart(season.weekdayStartTime ?? "");
      setWeekendStart(season.weekendStartTime ?? "");
      setEndTime(season.endTime);
    } else {
      setName("");
      setStartDate("");
      setTeachesDays([1, 2, 3, 4, 5, 6, 7]);
      setWeekdayStart("");
      setWeekendStart("");
      setEndTime("");
    }
  }, [open, season]);

  function toggleDay(day: number) {
    setTeachesDays((prev) =>
      prev.includes(day) ? prev.filter((value) => value !== day) : [...prev, day].sort(),
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    if (teachesDays.length === 0) {
      setErrorMessage("Pick at least one day Jason teaches this season.");
      return;
    }

    const teachesWeekday = hasWeekday(teachesDays);
    const teachesWeekend = hasWeekend(teachesDays);

    const weekdayValue = teachesWeekday ? weekdayStart || null : null;
    const weekendValue = teachesWeekend ? weekendStart || null : null;

    if (season === null) {
      const body: CreateSeasonBody = {
        name,
        startDate,
        teachesDays,
        weekdayStartTime: weekdayValue,
        weekendStartTime: weekendValue,
        endTime,
      };
      const message = await onSubmit(body, "create");
      if (message) setErrorMessage(message);
    } else {
      const body: PatchSeasonBody = {
        name,
        startDate,
        teachesDays,
        weekdayStartTime: weekdayValue,
        weekendStartTime: weekendValue,
        endTime,
      };
      const message = await onSubmit(body, "patch");
      if (message) setErrorMessage(message);
    }
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

  const teachesWeekday = hasWeekday(teachesDays);
  const teachesWeekend = hasWeekend(teachesDays);
  const inputClass =
    "h-11 px-3 rounded-button border border-divider-section bg-section text-text-on-section text-sm focus:outline focus:outline-2 focus:outline-focus-ring";
  const labelClass = "text-sm font-semibold text-text-on-section";

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onClick={handleBackdropClick}
      onCancel={onCancel}
      aria-labelledby="season-form-title"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
        <h2
          id="season-form-title"
          className="text-lg font-heading font-semibold text-text-on-section leading-tight"
          style={{ fontVariationSettings: '"SOFT" 100, "WONK" 0' }}
        >
          {season === null ? "Add season" : `Edit ${season.name}`}
        </h2>

        <div className="flex flex-col gap-1">
          <label htmlFor="season-name" className={labelClass}>
            Name
          </label>
          <input
            id="season-name"
            type="text"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={inputClass}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="season-start-date" className={labelClass}>
            Start date
          </label>
          <input
            id="season-start-date"
            type="date"
            required
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            className={inputClass}
          />
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
                  className={`inline-flex items-center justify-center h-11 min-w-[52px] px-3 rounded-button border text-sm font-semibold transition-colors duration-150 ${
                    active
                      ? "bg-button-primary-background text-button-primary-text border-transparent"
                      : "border-divider-section text-text-on-section"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="grid grid-cols-1 tablet:grid-cols-3 gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="weekday-start" className={labelClass}>
              Weekday start
            </label>
            <input
              id="weekday-start"
              type="time"
              step={900}
              disabled={!teachesWeekday}
              value={weekdayStart}
              onChange={(event) => setWeekdayStart(event.target.value)}
              className={`${inputClass} disabled:opacity-50`}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="weekend-start" className={labelClass}>
              Weekend start
            </label>
            <input
              id="weekend-start"
              type="time"
              step={900}
              disabled={!teachesWeekend}
              value={weekendStart}
              onChange={(event) => setWeekendStart(event.target.value)}
              className={`${inputClass} disabled:opacity-50`}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="end-time" className={labelClass}>
              Ends
            </label>
            <input
              id="end-time"
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
            className="inline-flex items-center justify-center h-11 px-5 rounded-button border border-divider-section text-text-on-section font-semibold text-sm transition-colors duration-150 hover:border-text-secondary-on-section"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex items-center justify-center h-11 px-5 rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm transition-opacity duration-150 disabled:opacity-60 hover:opacity-90 active:scale-[0.97]"
          >
            {isPending ? "Saving…" : season === null ? "Add season" : "Save season"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
