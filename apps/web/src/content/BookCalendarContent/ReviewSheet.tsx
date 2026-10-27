"use client";

import { useEffect, useRef, useState } from "react";

import type { BatchPreviewPick, BatchPickState } from "@swim-app/shared";

import PendingLabel from "@/components/PendingLabel";

import { formatLaTime, pickReasonCopy } from "./batchHelpers";
import { formatSlotRangeWithDate } from "./helpers";
import styles from "./ReviewSheet.module.css";

type Mode = "multiple" | "recurring";

interface SubmittedLesson {
  startsAt: string;
  durationMinutes: number;
  status: "approved" | "pending";
}

interface SuccessView {
  confirmedCount: number;
  pendingCount: number;
  lessons: SubmittedLesson[];
}

interface Props {
  open: boolean;
  mode: Mode;
  previewPicks: BatchPreviewPick[];
  // Household swimmer list, used to resolve per-pick swimmerIds to first
  // names in each pick row (ADR 030 phase 2 — a batch can mix swimmer sets).
  swimmers: readonly { id: string; firstName: string }[];
  skippedIndexes: Set<number>;
  removedIndexes: Set<number>;
  isLoading: boolean;
  previewError: string | null;
  submitError: string | null;
  canSubmit: boolean;
  isSubmitting: boolean;
  needsApproval: boolean;
  success: SuccessView | null;
  // Short copy under the Book button explaining why it is disabled.
  bookDisabledReason?: string;
  onClose: () => void;
  onApplySuggestion: (index: number, startsAt: string) => void;
  onSkip: (index: number) => void;
  onRemove: (index: number) => void;
  onUnskip: (index: number) => void;
  onBook: () => void;
  onBackToCalendar: () => void;
}

const FLAGGED_STATES: BatchPickState[] = [
  "unavailable",
  "too_soon",
  "past",
  "outside_hours",
  "blocked_time",
  "day_closed",
  "conflicts_batch",
];

export default function ReviewSheet(props: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (props.open && !dialog.open) {
      dialog.showModal();
    }
    if (!props.open && dialog.open) {
      dialog.close();
    }
  }, [props.open]);

  function handleDialogClose() {
    props.onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={handleDialogClose}
      aria-labelledby="review-sheet-heading"
      className={[
        styles.sheet,
        "bg-background text-text overflow-hidden rounded-t-[24px]",
        "tablet:rounded-none tablet:rounded-l-[24px]",
      ].join(" ")}
      data-testid="review-sheet"
    >
      <div className="flex flex-col max-h-[90vh] tablet:max-h-screen tablet:h-full">
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border">
          <h2
            id="review-sheet-heading"
            key={props.success !== null ? "heading-success" : "heading-review"}
            className={`${styles.fade} font-heading text-xl text-heading`}
          >
            {props.success !== null ? "You're set" : "Review your lessons"}
          </h2>
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Close"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-button hover:bg-surface-soft transition-colors duration-150 motion-reduce:transition-none active:scale-[0.97] motion-reduce:transform-none"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="M5 5l10 10M15 5L5 15"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div
          key={props.success !== null ? "body-success" : "body-review"}
          className={`${styles.fade} flex-1 overflow-y-auto px-5 py-4`}
        >
          {props.success !== null ? (
            <SuccessContent
              success={props.success}
              onBackToCalendar={props.onBackToCalendar}
            />
          ) : (
            <ReviewContent
              mode={props.mode}
              previewPicks={props.previewPicks}
              swimmers={props.swimmers}
              skippedIndexes={props.skippedIndexes}
              removedIndexes={props.removedIndexes}
              isLoading={props.isLoading}
              previewError={props.previewError}
              needsApproval={props.needsApproval}
              onApplySuggestion={props.onApplySuggestion}
              onSkip={props.onSkip}
              onRemove={props.onRemove}
              onUnskip={props.onUnskip}
            />
          )}
        </div>

        {props.success === null && (
          <div className="px-5 py-3 border-t border-border bg-background">
            {props.submitError !== null && (
              <p role="alert" className="text-sm text-danger mb-2">
                {props.submitError}
              </p>
            )}
            <button
              type="button"
              onClick={props.onBook}
              disabled={!props.canSubmit || props.isSubmitting}
              data-testid="review-book"
              className="w-full min-h-[52px] px-5 rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm transition-opacity duration-150 hover:opacity-90 active:scale-[0.97] motion-reduce:transform-none disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <PendingLabel
                isPending={props.isSubmitting}
                label="Book lessons"
                pendingLabel="Booking…"
              />
            </button>
            {props.bookDisabledReason !== undefined && !props.canSubmit && (
              <p
                className="text-xs text-text-secondary text-center mt-2"
                data-testid="review-book-disabled-reason"
              >
                {props.bookDisabledReason}
              </p>
            )}
          </div>
        )}
      </div>
    </dialog>
  );
}

interface ReviewContentProps {
  mode: Mode;
  previewPicks: BatchPreviewPick[];
  swimmers: readonly { id: string; firstName: string }[];
  skippedIndexes: Set<number>;
  removedIndexes: Set<number>;
  isLoading: boolean;
  previewError: string | null;
  needsApproval: boolean;
  onApplySuggestion: (index: number, startsAt: string) => void;
  onSkip: (index: number) => void;
  onRemove: (index: number) => void;
  onUnskip: (index: number) => void;
}

function ReviewContent({
  mode,
  previewPicks,
  swimmers,
  skippedIndexes,
  removedIndexes,
  isLoading,
  previewError,
  needsApproval,
  onApplySuggestion,
  onSkip,
  onRemove,
  onUnskip,
}: ReviewContentProps) {
  const firstNameById = new Map(swimmers.map((swimmer) => [swimmer.id, swimmer.firstName]));
  const visible = previewPicks.filter(
    (pick) => !skippedIndexes.has(pick.index) && !removedIndexes.has(pick.index),
  );
  const notOpenYet = visible.filter((pick) => pick.state === "not_open_yet").length;
  const flagged = visible.filter((pick) => FLAGGED_STATES.includes(pick.state)).length;
  const ready = visible.filter((pick) => pick.state === "available").length;

  return (
    <section aria-label="Review" className="flex flex-col gap-4">
      {previewError !== null && (
        <p role="alert" className="text-sm text-danger">
          {previewError}
        </p>
      )}

      <div
        aria-live="polite"
        data-testid="review-summary"
        className="rounded-card border border-border bg-surface-soft p-3 text-sm"
      >
        {isLoading ? (
          <span className="text-text-secondary">Checking availability…</span>
        ) : previewPicks.length === 0 ? (
          <span className="text-text-secondary">Add lessons on the calendar to review.</span>
        ) : (
          <span className="text-text">
            <span className="font-semibold text-heading">{ready}</span> ready
            {flagged > 0 && (
              <>
                , <span className="font-semibold text-danger">{flagged}</span>{" "}
                {flagged === 1 ? "needs" : "need"} attention
              </>
            )}
            {notOpenYet > 0 && (
              <>
                , <span className="font-semibold text-text-secondary">{notOpenYet}</span> past the
                booking window
              </>
            )}
            .
          </span>
        )}
      </div>

      {needsApproval && previewPicks.length > 0 && (
        <p className="text-xs text-text-secondary">
          Jason will confirm each lesson before it is final.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {previewPicks.map((pick) => {
          // swimmerIds is always present in the real server response (ADR
          // 030 phase 2 Zod schema), but defensive against test mocks that
          // skip the field — treat missing as "no first names to show."
          const pickSwimmerNames = (pick.swimmerIds ?? [])
            .map((id) => firstNameById.get(id))
            .filter((name): name is string => name !== undefined);
          return (
            <PickRow
              key={pick.index}
              pick={pick}
              swimmerFirstNames={pickSwimmerNames}
              mode={mode}
              isSkipped={skippedIndexes.has(pick.index)}
              isRemoved={removedIndexes.has(pick.index)}
              onApplySuggestion={(startsAt) => onApplySuggestion(pick.index, startsAt)}
              onSkip={() => onSkip(pick.index)}
              onRemove={() => onRemove(pick.index)}
              onUnskip={() => onUnskip(pick.index)}
            />
          );
        })}
      </ul>
    </section>
  );
}

interface PickRowProps {
  pick: BatchPreviewPick;
  swimmerFirstNames: string[];
  mode: Mode;
  isSkipped: boolean;
  isRemoved: boolean;
  onApplySuggestion: (startsAt: string) => void;
  onSkip: () => void;
  onRemove: () => void;
  onUnskip: () => void;
}

// Row exit duration must match the transition in ReviewSheet.module.css. The
// row stays rendered locally for this long after isRemoved flips so the slide
// + fade can play, then the row returns null. Parent data updates immediately
// via onRemove, so this is a visual-only delay.
const PICK_ROW_EXIT_MS = 180;

function PickRow({
  pick,
  swimmerFirstNames,
  mode,
  isSkipped,
  isRemoved,
  onApplySuggestion,
  onSkip,
  onRemove,
  onUnskip,
}: PickRowProps) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!isRemoved) {
      setHidden(false);
      return;
    }
    const timer = setTimeout(() => setHidden(true), PICK_ROW_EXIT_MS);
    return () => clearTimeout(timer);
  }, [isRemoved]);

  if (hidden) return null;

  const isAvailable = pick.state === "available";
  const isFlagged = FLAGGED_STATES.includes(pick.state) || pick.state === "not_open_yet";

  if (isSkipped) {
    return (
      <li
        data-exiting={isRemoved ? "true" : undefined}
        className={`${styles.pickRow} rounded-card border border-dashed border-border bg-background p-3 flex items-center justify-between gap-3`}
      >
        <span className="text-sm text-text-secondary line-through">
          {formatSlotRangeWithDate(pick.startsAt, pick.durationMinutes)}
        </span>
        <button
          type="button"
          onClick={onUnskip}
          className="text-sm font-semibold text-link hover:text-link-hover"
        >
          Undo
        </button>
      </li>
    );
  }

  return (
    <li
      role={isFlagged ? "alert" : undefined}
      data-flagged={isFlagged ? "true" : undefined}
      data-exiting={isRemoved ? "true" : undefined}
      className={[
        styles.pickRow,
        "rounded-card border p-3 flex flex-col gap-2",
        isFlagged ? "border-danger/50 bg-danger/5" : "border-border bg-background",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-heading">
            {formatSlotRangeWithDate(pick.startsAt, pick.durationMinutes)}
          </p>
          {swimmerFirstNames.length > 0 && (
            <p
              className="text-xs text-text-secondary mt-0.5"
              data-testid={`pick-row-swimmers-${pick.index}`}
            >
              {swimmerFirstNames.join(", ")}
            </p>
          )}
          {!isAvailable && (
            <p className="text-xs text-text-secondary mt-0.5">
              {pickReasonCopy(pick.state) || "Not available"}
            </p>
          )}
        </div>
        {mode === "recurring" ? (
          isFlagged && (
            <button
              type="button"
              onClick={onSkip}
              className="min-h-[36px] px-3 rounded-button border border-border text-xs font-semibold text-text hover:bg-surface-soft active:scale-[0.97] motion-reduce:transform-none transition-colors duration-150"
            >
              Skip this week
            </button>
          )
        ) : (
          <button
            type="button"
            onClick={onRemove}
            className="min-h-[36px] px-3 rounded-button border border-border text-xs font-semibold text-text hover:bg-surface-soft active:scale-[0.97] motion-reduce:transform-none transition-colors duration-150"
          >
            Remove
          </button>
        )}
      </div>

      {isFlagged && pick.suggestions && pick.suggestions.length > 0 && (
        <div
          className="flex flex-wrap gap-1.5"
          data-testid={`suggestions-${pick.index}`}
        >
          <span className="text-xs text-text-secondary self-center">Try:</span>
          {pick.suggestions.map((suggestion) => (
            <button
              key={suggestion.startsAt}
              type="button"
              onClick={() => onApplySuggestion(suggestion.startsAt)}
              className="min-h-[36px] px-3 rounded-full border border-accent text-xs font-semibold text-accent hover:bg-accent/10 active:scale-[0.97] motion-reduce:transform-none transition-colors duration-150"
            >
              {formatLaTime(suggestion.startsAt)}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}

function SuccessContent({
  success,
  onBackToCalendar,
}: {
  success: SuccessView;
  onBackToCalendar: () => void;
}) {
  const confirmed = success.lessons.filter((lesson) => lesson.status === "approved");
  const pending = success.lessons.filter((lesson) => lesson.status === "pending");

  return (
    <section aria-label="Lessons booked" data-testid="batch-success" className="flex flex-col gap-5">
      <div className="rounded-card border border-border bg-surface-soft p-4">
        <h3 className="font-heading text-xl text-heading">
          {success.pendingCount === 0
            ? success.confirmedCount === 1
              ? "Your lesson is booked."
              : "Your lessons are booked."
            : success.confirmedCount === 0
              ? "Request received."
              : `${success.confirmedCount} confirmed, ${success.pendingCount} waiting.`}
        </h3>
        <p className="text-sm text-text-secondary mt-1">
          A summary email is on its way with calendar invites for the confirmed lessons.
        </p>
      </div>

      {confirmed.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">
            Confirmed
          </p>
          <ul className="flex flex-col gap-1">
            {confirmed.map((lesson) => (
              <li key={lesson.startsAt} className="text-sm text-text">
                {formatSlotRangeWithDate(lesson.startsAt, lesson.durationMinutes)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {pending.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">
            Waiting for Jason
          </p>
          <ul className="flex flex-col gap-1">
            {pending.map((lesson) => (
              <li key={lesson.startsAt} className="text-sm text-text">
                {formatSlotRangeWithDate(lesson.startsAt, lesson.durationMinutes)}
              </li>
            ))}
          </ul>
          <p className="text-xs text-text-secondary mt-3">
            Jason will approve each lesson. You will get a note for each one as it is confirmed.
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={onBackToCalendar}
        className="min-h-[52px] px-5 rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm transition-opacity duration-150 hover:opacity-90 active:scale-[0.97] motion-reduce:transform-none"
      >
        Back to calendar
      </button>
    </section>
  );
}
