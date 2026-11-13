"use client";

import { useEffect, useState, useTransition } from "react";

import { createBookingAction } from "./actions";
import type { BookingState } from "./helpers";
import {
  clearPendingBooking,
  readPendingBooking,
  type PendingBooking,
} from "./InsufficientBalanceModal";

function formatSlotLocal(startsAt: string): string {
  const date = new Date(startsAt);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  }).format(date);
}

interface BookResumeBannerProps {
  onBooked: (state: Extract<BookingState, { status: "success" }>) => void;
  onInsufficient: (
    state: Extract<BookingState, { status: "insufficient_balance" }>,
  ) => void;
}

export default function BookResumeBanner({
  onBooked,
  onInsufficient,
}: BookResumeBannerProps) {
  const [pending, setPending] = useState<PendingBooking | null>(null);
  const [submitting, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [topupSuccess, setTopupSuccess] = useState(false);

  useEffect(() => {
    // Only run on mount in the browser.
    const params = new URLSearchParams(window.location.search);
    const isResume = params.get("resume") === "1";
    if (!isResume) return;
    const stored = readPendingBooking();
    // Batch stashes rehydrate via BookCalendarContent's resume effect —
    // the banner only speaks to the "one lesson at a time" flow.
    if (stored && stored.mode === "single") {
      setPending({
        startsAt: stored.startsAt,
        durationMinutes: stored.durationMinutes,
        locationId: stored.locationId,
        swimmerIds: stored.swimmerIds,
      });
    }
    setTopupSuccess(params.get("topup") === "success");
  }, []);

  if (!pending) return null;

  function handleFinish() {
    if (!pending) return;
    setErrorMessage(null);
    const form = new FormData();
    form.append("startsAt", pending.startsAt);
    form.append("durationMinutes", String(pending.durationMinutes));
    form.append("locationId", pending.locationId);
    for (const id of pending.swimmerIds) form.append("swimmerIds", id);
    startTransition(async () => {
      const next = await createBookingAction({ status: "idle" }, form);
      if (next.status === "success") {
        clearPendingBooking();
        onBooked(next);
        return;
      }
      if (next.status === "insufficient_balance") {
        onInsufficient(next);
        return;
      }
      if (next.status === "error") {
        setErrorMessage(next.message);
        return;
      }
      // "idle" shouldn't come back from a submit, but handle it so the
      // exhaustive-switch TypeScript check stays satisfied.
      setErrorMessage("Something went wrong. Please try again.");
    });
  }

  function handleDismiss() {
    clearPendingBooking();
    setPending(null);
  }

  return (
    <div
      role="region"
      aria-label="Finish booking"
      className="rounded-card border border-divider-section bg-card text-text-on-section p-4 tablet:p-5 mb-4"
    >
      {topupSuccess ? (
        <p className="font-body text-sm text-accent-on-section mb-2">
          Thanks — your balance is refreshing. If the balance looks off, give it a moment and retry.
        </p>
      ) : null}
      <p className="font-body text-sm font-semibold uppercase tracking-wide text-text-secondary-on-section">
        Finish your booking
      </p>
      <p className="font-body text-base mt-2">
        {formatSlotLocal(pending.startsAt)} · {pending.durationMinutes} min ·{" "}
        {pending.swimmerIds.length} swimmer{pending.swimmerIds.length === 1 ? "" : "s"}
      </p>
      <div className="mt-4 flex flex-col tablet:flex-row gap-2">
        <button
          type="button"
          onClick={handleFinish}
          disabled={submitting}
          className="min-h-[52px] rounded-full bg-accent-on-section text-on-accent font-body font-bold text-base px-6 disabled:opacity-60"
        >
          {submitting ? "Booking…" : "Book"}
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          className="min-h-[44px] font-body text-sm text-text-secondary-on-section hover:text-text-on-section"
        >
          Not now
        </button>
      </div>
      {errorMessage ? (
        <p role="alert" className="font-body text-sm text-danger mt-2">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
