"use client";

import { useEffect, useRef, useState } from "react";
import type { CoachBookingWarnings } from "@swim-app/shared";
import ConfirmDialog from "@/components/ConfirmDialog";
import {
  activeWarningKeys,
  emptyWarnings,
  formatLessonTimeDisplay,
  hasAnyWarning,
  warningCopy,
} from "./helpers";
import { formatDollars } from "@/content/AccountBalanceContent/formatters";

export interface ConfirmSummary {
  householdName: string;
  swimmerFirstNames: string[];
  locationName: string;
  startsAtUtc: string;
  durationMinutes: 30 | 45 | 60;
  // Set when the coach picked a custom time; drives overrideWindow in the
  // outgoing request.
  overrideWindow: boolean;
}

interface Props {
  open: boolean;
  summary: ConfirmSummary;
  // When the server has returned a 409, this holds its warnings payload. The
  // dialog renders an acknowledge checkbox per TRUE flag; Submit is disabled
  // until every TRUE flag is acknowledged.
  warnings: CoachBookingWarnings | null;
  // Set when the server rejected a balance-charged booking with 422
  // insufficient_balance. The dialog surfaces balance/price/shortfall and
  // switches the primary action to "Book as free lesson."
  balanceShortfall?: {
    balanceCents: number;
    priceCents: number;
    shortfallCents: number;
  } | null;
  // Server config value used to render the max-advance warning string.
  bookingMaxAdvanceWeeks: number;
  isSubmitting: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  // Called when the coach submits. acknowledgedWarnings mirrors the shape of
  // the server-computed warnings — true for each one the coach checked.
  onSubmit: (acknowledgedWarnings: CoachBookingWarnings) => void;
  // Resend the same booking with chargeType='free'. Optional for callers
  // that don't surface the balance path yet (e.g. older tests).
  onBookAsFree?: () => void;
}

const DIALOG_FORM_ID = "coach-booking-confirm-form";

export default function ConfirmBookingDialog({
  open,
  summary,
  warnings,
  balanceShortfall = null,
  bookingMaxAdvanceWeeks,
  isSubmitting,
  errorMessage,
  onCancel,
  onSubmit,
  onBookAsFree,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [acknowledged, setAcknowledged] = useState<CoachBookingWarnings>(emptyWarnings());
  const copy = warningCopy(bookingMaxAdvanceWeeks);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) {
      dialog.showModal();
    }
  }, [open]);

  useEffect(() => {
    if (open) return;
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
    // Reset acknowledgements whenever the dialog is dismissed.
    setAcknowledged(emptyWarnings());
  }, [open]);

  // When warnings arrive from a 409, clear any stale acknowledgements that
  // apply to warnings the server no longer reports.
  useEffect(() => {
    if (warnings === null) return;
    setAcknowledged((prev) => {
      const next = { ...prev };
      (Object.keys(next) as Array<keyof CoachBookingWarnings>).forEach((key) => {
        if (!warnings[key]) next[key] = false;
      });
      return next;
    });
  }, [warnings]);

  const trueKeys = warnings ? activeWarningKeys(warnings) : [];
  const needsAck = warnings !== null && hasAnyWarning(warnings);
  const allAcknowledged = trueKeys.every((key) => acknowledged[key]);

  const canSubmit = !isSubmitting && (!needsAck || allAcknowledged);

  function handleSubmit() {
    if (!canSubmit) return;
    onSubmit(acknowledged);
  }

  // A balance shortfall takes over the dialog: the balance CTA is out of
  // reach, so the primary action switches to "Book as free lesson" if the
  // parent passed a handler. Keep the regular submit button rendered for
  // rendering simplicity but disable it.
  const hasShortfall = balanceShortfall !== null;

  return (
    <ConfirmDialog
      dialogRef={dialogRef}
      title="Confirm this lesson"
      description={`${summary.swimmerFirstNames.join(", ")} · ${
        summary.durationMinutes
      } min at ${summary.locationName}`}
      formId={DIALOG_FORM_ID}
      confirmLabel={needsAck ? "Book anyway" : "Book lesson"}
      isPending={isSubmitting}
      {...(errorMessage !== null ? { errorMessage } : {})}
      onCancel={onCancel}
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-card border border-border p-3 text-sm text-text">
          <p className="font-semibold">{summary.householdName}</p>
          <p className="text-text-secondary mt-0.5">
            {formatLessonTimeDisplay(summary.startsAtUtc)}
          </p>
        </div>

        {hasShortfall && balanceShortfall !== null && (
          <div
            role="alert"
            data-testid="coach-balance-shortfall"
            className="rounded-card border border-danger/50 bg-danger/5 p-3 text-sm text-text"
          >
            <p className="font-semibold text-heading">
              Family can&apos;t cover this lesson
            </p>
            <p
              className="text-text-secondary mt-1"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              Balance: {formatDollars(balanceShortfall.balanceCents)} · Lesson:{" "}
              {formatDollars(balanceShortfall.priceCents)} · Short by{" "}
              <span className="font-semibold text-danger">
                {formatDollars(balanceShortfall.shortfallCents)}
              </span>
              .
            </p>
            {onBookAsFree !== undefined && (
              <button
                type="button"
                onClick={onBookAsFree}
                disabled={isSubmitting}
                data-testid="coach-book-as-free"
                className="mt-3 min-h-[44px] px-4 rounded-button bg-button-primary-background text-button-primary-text text-sm font-semibold disabled:opacity-60"
              >
                {isSubmitting ? "Booking…" : "Book as free lesson"}
              </button>
            )}
          </div>
        )}

        {needsAck && warnings !== null && (
          <div
            role="alert"
            className="rounded-card border border-border bg-surface-soft p-3 text-sm text-text"
          >
            <p className="font-semibold text-heading mb-2">
              Confirm these before booking
            </p>
            <ul className="flex flex-col gap-2">
              {trueKeys.map((key) => (
                <li key={key}>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={acknowledged[key]}
                      onChange={(event) =>
                        setAcknowledged((prev) => ({
                          ...prev,
                          [key]: event.target.checked,
                        }))
                      }
                      className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
                    />
                    <span>{copy[key]}</span>
                  </label>
                </li>
              ))}
            </ul>
            {!allAcknowledged && (
              <p className="text-xs text-text-secondary mt-2">
                Acknowledge each item to continue.
              </p>
            )}
          </div>
        )}

        {/* Hidden form so Enter submits via ConfirmDialog's submit button. */}
        <form
          id={DIALOG_FORM_ID}
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit();
          }}
          className="sr-only"
          aria-hidden="true"
          tabIndex={-1}
        >
          <button type="submit" disabled={!canSubmit}>
            Submit
          </button>
        </form>
      </div>
    </ConfirmDialog>
  );
}
