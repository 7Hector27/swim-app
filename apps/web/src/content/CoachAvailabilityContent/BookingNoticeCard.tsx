"use client";

import { useEffect, useState } from "react";

interface Props {
  bookingMinAdvanceHours: number;
  onSave: (hours: number) => Promise<string | null>;
  isPending: boolean;
}

const MIN_HOURS = 0;
const MAX_HOURS = 168;

export default function BookingNoticeCard({
  bookingMinAdvanceHours,
  onSave,
  isPending,
}: Props) {
  const [value, setValue] = useState<string>(String(bookingMinAdvanceHours));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    setValue(String(bookingMinAdvanceHours));
  }, [bookingMinAdvanceHours]);

  useEffect(() => {
    if (savedAt === null) return;
    const timer = setTimeout(() => setSavedAt(null), 3000);
    return () => clearTimeout(timer);
  }, [savedAt]);

  const parsed = Number(value);
  const isValid =
    value.trim() !== "" &&
    Number.isInteger(parsed) &&
    parsed >= MIN_HOURS &&
    parsed <= MAX_HOURS;
  const isDirty = parsed !== bookingMinAdvanceHours;
  const canSave = isValid && isDirty && !isPending;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave) return;
    setErrorMessage(null);
    setSavedAt(null);
    const message = await onSave(parsed);
    if (message === null) {
      setSavedAt(Date.now());
    } else {
      setErrorMessage(message);
    }
  }

  return (
    <section
      aria-labelledby="booking-notice-title"
      className="rounded-card border border-border bg-background p-5 flex flex-col gap-3"
    >
      <div className="flex flex-col gap-1">
        <h2
          id="booking-notice-title"
          className="text-base font-heading text-text"
          style={{ fontVariationSettings: '"SOFT" 100, "WONK" 0' }}
        >
          Booking notice
        </h2>
        <p className="text-xs text-text-secondary">
          Parents can&apos;t book a lesson that starts sooner than this. Coach
          bookings aren&apos;t affected.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        noValidate
        className="flex flex-col gap-3 tablet:flex-row tablet:items-end tablet:gap-3"
      >
        <div className="flex flex-col gap-1 tablet:flex-1">
          <label
            htmlFor="booking-min-advance-hours"
            className="text-xs font-semibold text-text-secondary"
          >
            Hours in advance
          </label>
          <div className="flex items-center gap-2">
            <input
              id="booking-min-advance-hours"
              type="number"
              inputMode="numeric"
              min={MIN_HOURS}
              max={MAX_HOURS}
              step={1}
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setErrorMessage(null);
                setSavedAt(null);
              }}
              disabled={isPending}
              aria-describedby="booking-min-advance-hours-hint"
              aria-invalid={!isValid && value.trim() !== ""}
              className="h-11 w-28 rounded-button border border-border bg-background px-3 text-base text-text focus:outline-none focus:border-text disabled:opacity-60"
            />
            <span className="text-sm text-text-secondary">hours</span>
          </div>
          <p
            id="booking-min-advance-hours-hint"
            className="text-[11px] text-text-secondary"
          >
            Whole hours between {MIN_HOURS} and {MAX_HOURS} (one week).
          </p>
        </div>

        <button
          type="submit"
          disabled={!canSave}
          className="inline-flex items-center justify-center h-11 px-5 rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm transition-opacity duration-150 hover:opacity-90 active:scale-[0.97] disabled:opacity-40 disabled:cursor-default self-start tablet:self-auto"
        >
          {isPending ? "Saving…" : "Save"}
        </button>
      </form>

      {errorMessage !== null && (
        <p
          role="alert"
          aria-live="polite"
          className="text-sm text-danger"
          data-testid="booking-notice-error"
        >
          {errorMessage}
        </p>
      )}
      {savedAt !== null && errorMessage === null && (
        <p
          role="status"
          aria-live="polite"
          className="text-sm text-text-secondary"
          data-testid="booking-notice-saved"
        >
          Saved.
        </p>
      )}
    </section>
  );
}
