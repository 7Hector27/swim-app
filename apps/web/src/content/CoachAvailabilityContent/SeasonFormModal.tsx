"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CreateSeasonBody,
  PatchSeasonBody,
  SeasonWithIsCurrent,
} from "@swim-app/shared";

import { isQuarterHour } from "@swim-app/shared";

import TimeSelect from "@/components/TimeSelect";
import { formatMonthDay, isValidDateIso } from "./availabilityFormat";
import styles from "./CoachAvailabilityContent.module.css";

interface Props {
  open: boolean;
  season: SeasonWithIsCurrent | null;
  seasons: SeasonWithIsCurrent[];
  onCancel: () => void;
  onSubmit: (
    body: CreateSeasonBody | PatchSeasonBody,
    mode: "create" | "patch",
  ) => Promise<string | null>;
  isPending: boolean;
  // Only set in edit mode. Clicking the quiet Delete button closes this
  // modal and hands control to the parent, which opens a dedicated
  // confirm step (DeleteSeasonConfirmModal) with the impact preview.
  onDelete?: (season: SeasonWithIsCurrent) => void;
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

type FieldErrors = Partial<Record<"weekdayStart" | "weekdayEnd" | "weekendStart" | "weekendEnd", string>>;

export default function SeasonFormModal({
  open,
  season,
  seasons,
  onCancel,
  onSubmit,
  isPending,
  onDelete,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [teachesDays, setTeachesDays] = useState<number[]>([2, 3, 4, 5]);
  const [weekdayStart, setWeekdayStart] = useState("");
  const [weekdayEnd, setWeekdayEnd] = useState("");
  const [weekendStart, setWeekendStart] = useState("");
  const [weekendEnd, setWeekendEnd] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setErrorMessage(null);
    setFieldErrors({});
    if (season) {
      setName(season.name);
      setStartDate(season.startDate);
      setEndDate(season.endDate);
      setTeachesDays([...season.teachesDays]);
      setWeekdayStart(season.weekdayStartTime ?? "");
      setWeekdayEnd(season.weekdayEndTime ?? "");
      setWeekendStart(season.weekendStartTime ?? "");
      setWeekendEnd(season.weekendEndTime ?? "");
    } else {
      setName("");
      setStartDate("");
      setEndDate("");
      setTeachesDays([2, 3, 4, 5]);
      setWeekdayStart("");
      setWeekdayEnd("");
      setWeekendStart("");
      setWeekendEnd("");
    }
  }, [open, season]);

  const afterMessage = useMemo(() => {
    if (!isValidDateIso(endDate)) return null;
    const editingId = season?.id ?? null;
    const next = seasons
      .filter((s) => s.id !== editingId && s.startDate > endDate)
      .sort((a, b) => a.startDate.localeCompare(b.startDate))[0] ?? null;
    if (next) {
      return `After ${formatMonthDay(endDate)}, ${next.name} starts on ${formatMonthDay(next.startDate)}.`;
    }
    return `After ${formatMonthDay(endDate)}, your default hours apply.`;
  }, [endDate, season, seasons]);

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

    const errors: FieldErrors = {};
    if (teachesWeekday && !weekdayStart) errors.weekdayStart = "Required";
    if (teachesWeekday && !weekdayEnd) errors.weekdayEnd = "Required";
    if (teachesWeekend && !weekendStart) errors.weekendStart = "Required";
    if (teachesWeekend && !weekendEnd) errors.weekendEnd = "Required";
    const quarterMessage = "Must be on a 15-minute step";
    if (teachesWeekday && weekdayStart && !isQuarterHour(weekdayStart))
      errors.weekdayStart = quarterMessage;
    if (teachesWeekday && weekdayEnd && !isQuarterHour(weekdayEnd))
      errors.weekdayEnd = quarterMessage;
    if (teachesWeekend && weekendStart && !isQuarterHour(weekendStart))
      errors.weekendStart = quarterMessage;
    if (teachesWeekend && weekendEnd && !isQuarterHour(weekendEnd))
      errors.weekendEnd = quarterMessage;

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    const weekdayStartValue = teachesWeekday ? weekdayStart || null : null;
    const weekdayEndValue = teachesWeekday ? weekdayEnd || null : null;
    const weekendStartValue = teachesWeekend ? weekendStart || null : null;
    const weekendEndValue = teachesWeekend ? weekendEnd || null : null;

    if (season === null) {
      const body: CreateSeasonBody = {
        name,
        startDate,
        endDate,
        teachesDays,
        weekdayStartTime: weekdayStartValue,
        weekdayEndTime: weekdayEndValue,
        weekendStartTime: weekendStartValue,
        weekendEndTime: weekendEndValue,
      };
      const message = await onSubmit(body, "create");
      if (message) setErrorMessage(message);
    } else {
      const body: PatchSeasonBody = {
        name,
        startDate,
        endDate,
        teachesDays,
        weekdayStartTime: weekdayStartValue,
        weekdayEndTime: weekdayEndValue,
        weekendStartTime: weekendStartValue,
        weekendEndTime: weekendEndValue,
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
    "h-11 px-3 rounded-button border border-border bg-background text-text text-sm focus:outline focus:outline-2 focus:outline-focus-ring";
  const labelClass = "text-sm font-semibold text-text";
  const fieldLabelClass = "text-xs font-semibold text-text-secondary";

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
          className="text-lg font-heading font-semibold text-text leading-tight"
          style={{ fontVariationSettings: '"SOFT" 100, "WONK" 0' }}
        >
          {season === null ? "Add season" : "Edit season"}
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

        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-3">
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
            <div className="flex flex-col gap-1">
              <label htmlFor="season-end-date" className={labelClass}>
                End date
              </label>
              <input
                id="season-end-date"
                type="date"
                required
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className={inputClass}
              />
            </div>
          </div>
          {afterMessage && (
            <p className="text-xs text-text-secondary -mt-2">{afterMessage}</p>
          )}
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className={labelClass}>Teaching days</legend>
          <p className="text-xs text-text-secondary">Tap the days you teach.</p>
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

        {teachesWeekday && (
          <fieldset className="flex flex-col gap-2">
            <legend className={labelClass}>Weekday hours</legend>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor="weekday-start" className={fieldLabelClass}>
                  Start
                </label>
                <TimeSelect
                  id="weekday-start"
                  value={weekdayStart}
                  onChange={setWeekdayStart}
                  className={inputClass}
                />
                {fieldErrors.weekdayStart && (
                  <p className="text-xs text-danger">{fieldErrors.weekdayStart}</p>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="weekday-end" className={fieldLabelClass}>
                  End
                </label>
                <TimeSelect
                  id="weekday-end"
                  value={weekdayEnd}
                  onChange={setWeekdayEnd}
                  className={inputClass}
                />
                {fieldErrors.weekdayEnd && (
                  <p className="text-xs text-danger">{fieldErrors.weekdayEnd}</p>
                )}
              </div>
            </div>
          </fieldset>
        )}

        {teachesWeekend && (
          <fieldset className="flex flex-col gap-2">
            <legend className={labelClass}>Weekend hours</legend>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor="weekend-start" className={fieldLabelClass}>
                  Start
                </label>
                <TimeSelect
                  id="weekend-start"
                  value={weekendStart}
                  onChange={setWeekendStart}
                  className={inputClass}
                />
                {fieldErrors.weekendStart && (
                  <p className="text-xs text-danger">{fieldErrors.weekendStart}</p>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="weekend-end" className={fieldLabelClass}>
                  End
                </label>
                <TimeSelect
                  id="weekend-end"
                  value={weekendEnd}
                  onChange={setWeekendEnd}
                  className={inputClass}
                />
                {fieldErrors.weekendEnd && (
                  <p className="text-xs text-danger">{fieldErrors.weekendEnd}</p>
                )}
              </div>
            </div>
          </fieldset>
        )}

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
            {isPending ? "Saving…" : season === null ? "Add season" : "Save"}
          </button>
        </div>

        {/* Quiet destructive action pinned to the bottom in edit mode so
            it reads as a secondary path, not a sibling of Save. The
            actual confirmation (with impact preview + solid red
            confirm) lives in DeleteSeasonConfirmModal. */}
        {season !== null && onDelete && (
          <div className="pt-4 border-t border-border flex justify-center">
            <button
              type="button"
              onClick={() => onDelete(season)}
              disabled={isPending}
              className="inline-flex items-center justify-center h-11 px-5 rounded-button border border-danger text-danger font-semibold text-sm transition-colors duration-150 hover:bg-surface-soft disabled:opacity-60"
            >
              Delete season
            </button>
          </div>
        )}
      </form>
    </dialog>
  );
}
