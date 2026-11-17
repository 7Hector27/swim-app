"use client";

import { useEffect, useRef, useState } from "react";

import type { BatchPreviewPick, BatchPickState } from "@swim-app/shared";

import PendingLabel from "@/components/PendingLabel";
import { formatDollars } from "@/lib/formatDollars";
import { lessonPrice } from "@/lib/pricing";

import { formatLaTime, pickReasonCopy } from "./batchHelpers";
import { formatSlotRangeWithDate } from "./helpers";
import InsufficientFundsActions, {
  PolicyQuietLine,
} from "./InsufficientFundsActions";
import styles from "./ReviewSheet.module.css";

const LA_TZ = "America/Los_Angeles";

// "Tue, Nov 17" — the bold first-line date on each pick row.
function formatRowDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: LA_TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

// "10:45 to 11:15 AM · 30 min" — the secondary line. Drops the start
// meridiem when both ends share one so the range reads as a span, not
// two timestamps.
function formatRowTimeRange(iso: string, durationMinutes: number): string {
  const start = new Date(iso);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const fmt = (date: Date) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: LA_TZ,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date);
  const startStr = fmt(start);
  const endStr = fmt(end);
  const startMeridiem = startStr.slice(-2);
  const endMeridiem = endStr.slice(-2);
  const range =
    startMeridiem === endMeridiem
      ? `${startStr.slice(0, -3)} to ${endStr}`
      : `${startStr} to ${endStr}`;
  return `${range} \u00b7 ${durationMinutes} min`;
}

// Oxford-style join of distinct first names across the visible picks
// for the header subline: "Lily" / "Lily & Timmy" / "Lily, Timmy & Jack".
function joinFirstNames(
  visible: BatchPreviewPick[],
  swimmers: readonly { id: string; firstName: string }[],
): string {
  const firstNameById = new Map(swimmers.map((swimmer) => [swimmer.id, swimmer.firstName]));
  const seen = new Set<string>();
  const names: string[] = [];
  for (const pick of visible) {
    for (const id of pick.swimmerIds ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      const name = firstNameById.get(id);
      if (name) names.push(name);
    }
  }
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  const head = names.slice(0, -1).join(", ");
  const tail = names[names.length - 1]!;
  return `${head} & ${tail}`;
}

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
  bookingMinAdvanceHours: number | null;
  // Short copy under the Book button explaining why it is disabled.
  bookDisabledReason?: string;
  // Authoritative household balance in cents, and the server-pricing total
  // for the current review set. When total > balance, the footer swaps the
  // Book button for the insufficient-funds options.
  balanceCents: number | null;
  totalPriceCents: number;
  // Server-authoritative shortfall from a 422 insufficient_balance on
  // submit — overrides the derived balance guard with the exact numbers
  // the server used to reject the batch.
  serverShortfall: {
    balanceCents: number;
    priceCents: number;
    shortfallCents: number;
  } | null;
  onClose: () => void;
  onApplySuggestion: (index: number, startsAt: string) => void;
  onSkip: (index: number) => void;
  onRemove: (index: number) => void;
  onUnskip: (index: number) => void;
  onBook: () => void;
  onBackToCalendar: () => void;
  onBackToDashboard: () => void;
  onBuyPackage: () => void;
  // "Add $N of credit" — starts a Stripe top-up for one lesson's worth
  // of credit sized to the picks currently in the batch. The caller
  // reports the shown price via `addCreditCents`, which also gates the
  // button (null hides it, e.g. when no pick is available).
  onAddCredit: () => void;
  addCreditCents: number | null;
  isAddingCredit: boolean;
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
  // Header subline — lesson count and who's swimming. Derived here so
  // both the header and any future reuse share the same string.
  const visible = props.previewPicks.filter(
    (pick) =>
      !props.skippedIndexes.has(pick.index) && !props.removedIndexes.has(pick.index),
  );
  const sublineCount = visible.length;
  const sublineNames = joinFirstNames(visible, props.swimmers);

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
        <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-border gap-3">
          <div
            key={props.success !== null ? "heading-success" : "heading-review"}
            className={`${styles.fade} min-w-0 flex-1`}
          >
            <h2
              id="review-sheet-heading"
              className="font-heading text-xl text-heading"
            >
              {props.success !== null ? "You're set" : "Review your lessons"}
            </h2>
            {props.success === null && sublineCount > 0 && (
              <p
                className="text-sm text-text-secondary mt-0.5"
                data-testid="review-sheet-subline"
              >
                {sublineCount} {sublineCount === 1 ? "lesson" : "lessons"}
                {sublineNames !== "" && (
                  <>
                    {" \u00b7 "}
                    {sublineNames}
                  </>
                )}
              </p>
            )}
          </div>
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
              onBackToDashboard={props.onBackToDashboard}
            />
          ) : (
            <ReviewContent
              mode={props.mode}
              previewPicks={props.previewPicks}
              skippedIndexes={props.skippedIndexes}
              removedIndexes={props.removedIndexes}
              isLoading={props.isLoading}
              previewError={props.previewError}
              needsApproval={props.needsApproval}
              bookingMinAdvanceHours={props.bookingMinAdvanceHours}
              balanceCents={props.balanceCents}
              totalPriceCents={props.totalPriceCents}
              onApplySuggestion={props.onApplySuggestion}
              onSkip={props.onSkip}
              onRemove={props.onRemove}
              onUnskip={props.onUnskip}
            />
          )}
        </div>

        {props.success === null && (
          <ReviewFooter {...props} />
        )}
      </div>
    </dialog>
  );
}

function ReviewFooter(props: Props) {
  // Prefer the server's authoritative shortfall (from a 422 on submit) over
  // the client-side derived one. If neither is present, no shortfall.
  const serverShort = props.serverShortfall;
  const derivedShort =
    props.balanceCents !== null && props.totalPriceCents > props.balanceCents
      ? {
          balanceCents: props.balanceCents,
          priceCents: props.totalPriceCents,
          shortfallCents: props.totalPriceCents - props.balanceCents,
        }
      : null;
  const shortfall = serverShort ?? derivedShort;

  return (
    <div className="px-5 py-3 border-t border-border bg-background">
      {props.submitError !== null && (
        <p role="alert" className="text-sm text-danger mb-2">
          {props.submitError}
        </p>
      )}
      {shortfall !== null ? (
        <div
          role="alert"
          data-testid="review-insufficient-balance"
          className="flex flex-col"
        >
          {/* The Total / Your balance / "You need $X more" line is now
              shown once in the summary block above; the footer is the
              action stack plus the shared quiet policy line. */}
          <InsufficientFundsActions
            addCreditCents={props.addCreditCents ?? 0}
            showAddCredit={props.addCreditCents !== null}
            isAddingCredit={props.isAddingCredit}
            onAddCredit={props.onAddCredit}
            onBuyPackage={props.onBuyPackage}
            onNotNow={props.onClose}
            testIdPrefix="review"
          />
        </div>
      ) : (
        <>
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
          <PolicyQuietLine />
        </>
      )}
    </div>
  );
}

interface ReviewContentProps {
  mode: Mode;
  previewPicks: BatchPreviewPick[];
  skippedIndexes: Set<number>;
  removedIndexes: Set<number>;
  isLoading: boolean;
  previewError: string | null;
  needsApproval: boolean;
  bookingMinAdvanceHours: number | null;
  balanceCents: number | null;
  totalPriceCents: number;
  onApplySuggestion: (index: number, startsAt: string) => void;
  onSkip: (index: number) => void;
  onRemove: (index: number) => void;
  onUnskip: (index: number) => void;
}

function ReviewContent({
  mode,
  previewPicks,
  skippedIndexes,
  removedIndexes,
  isLoading,
  previewError,
  needsApproval,
  bookingMinAdvanceHours,
  balanceCents,
  totalPriceCents,
  onApplySuggestion,
  onSkip,
  onRemove,
  onUnskip,
}: ReviewContentProps) {
  const hasPicks = previewPicks.length > 0;
  const visible = previewPicks.filter(
    (pick) => !skippedIndexes.has(pick.index) && !removedIndexes.has(pick.index),
  );
  const shortfallCents =
    balanceCents !== null && totalPriceCents > balanceCents
      ? totalPriceCents - balanceCents
      : 0;
  const isShort = shortfallCents > 0;

  return (
    <section aria-label="Review" className="flex flex-col gap-4">
      {previewError !== null && (
        <p role="alert" className="text-sm text-danger">
          {previewError}
        </p>
      )}

      {isLoading && (
        <p className="text-sm text-text-secondary" data-testid="review-loading">
          Checking availability…
        </p>
      )}

      {!isLoading && !hasPicks && (
        <p className="text-sm text-text-secondary">
          Add lessons on the calendar to review.
        </p>
      )}

      {needsApproval && hasPicks && (
        <p className="text-xs text-text-secondary">
          Jason will confirm each lesson before it is final.
        </p>
      )}

      {hasPicks && (
        <ul
          className="flex flex-col divide-y divide-border"
          data-testid="review-pick-list"
        >
          {previewPicks.map((pick) => (
            <PickRow
              key={pick.index}
              pick={pick}
              mode={mode}
              isSkipped={skippedIndexes.has(pick.index)}
              isRemoved={removedIndexes.has(pick.index)}
              bookingMinAdvanceHours={bookingMinAdvanceHours}
              onApplySuggestion={(startsAt) => onApplySuggestion(pick.index, startsAt)}
              onSkip={() => onSkip(pick.index)}
              onRemove={() => onRemove(pick.index)}
              onUnskip={() => onUnskip(pick.index)}
            />
          ))}
        </ul>
      )}

      {/* Single summary block: Total, Your balance, and — only when
          short — the "You need $X more" danger line. Replaces the
          "N ready." pill and the top-of-sheet balance summary so the
          review surface has exactly one place to look for money. */}
      {hasPicks && balanceCents !== null && visible.length > 0 && (
        <div
          data-testid="review-summary"
          className="rounded-card border border-border bg-surface-soft p-4 flex flex-col gap-2"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          <div className="flex items-center justify-between text-sm">
            <span className="text-text-secondary">Total</span>
            <span
              className="font-semibold text-text"
              data-testid="review-summary-total"
            >
              {formatDollars(totalPriceCents)}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-text-secondary">Your balance</span>
            <span
              className="font-semibold text-text"
              data-testid="review-summary-balance"
            >
              {formatDollars(balanceCents)}
            </span>
          </div>
          {isShort && (
            <div className="flex items-center justify-between text-sm pt-2 border-t border-border">
              <span
                className="font-semibold text-danger"
                data-testid="review-summary-shortfall"
              >
                You need {formatDollars(shortfallCents)} more
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

interface PickRowProps {
  pick: BatchPreviewPick;
  mode: Mode;
  isSkipped: boolean;
  isRemoved: boolean;
  bookingMinAdvanceHours: number | null;
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
  mode,
  isSkipped,
  isRemoved,
  bookingMinAdvanceHours,
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
  const priceDollars = lessonPrice(
    pick.durationMinutes,
    (pick.swimmerIds ?? []).length,
  );

  // Skipped recurring picks keep the pre-existing struck-through card so
  // the "I know this week is off, bring it back with Undo" affordance
  // doesn't move from where the parent learned it.
  if (isSkipped) {
    return (
      <li
        data-exiting={isRemoved ? "true" : undefined}
        className={`${styles.pickRow} py-3 flex items-center justify-between gap-3`}
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

  // Active rows: date (bold) on line 1, time/length on line 2, price
  // top-right with a plain-text Remove / Skip link underneath. Flagged
  // picks keep a left-edge tint and a reason line so the parent sees at
  // a glance that this one needs attention.
  const rowAction =
    mode === "recurring"
      ? isFlagged
        ? { label: "Skip this week", onClick: onSkip }
        : null
      : { label: "Remove", onClick: onRemove };

  return (
    <li
      role={isFlagged ? "alert" : undefined}
      data-flagged={isFlagged ? "true" : undefined}
      data-exiting={isRemoved ? "true" : undefined}
      className={[
        styles.pickRow,
        "py-3 flex flex-col gap-2",
        isFlagged ? "border-l-2 border-danger pl-3 -ml-3" : "",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-text">
            {formatRowDate(pick.startsAt)}
          </p>
          <p
            className="text-sm text-text-secondary mt-0.5"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {formatRowTimeRange(pick.startsAt, pick.durationMinutes)}
          </p>
          {!isAvailable && (
            <p className="text-xs text-danger mt-1">
              {pickReasonCopy(pick.state, bookingMinAdvanceHours) || "Not available"}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <p
            className="text-base font-semibold text-text"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            ${priceDollars}
          </p>
          {rowAction !== null && (
            <button
              type="button"
              onClick={rowAction.onClick}
              className="text-xs font-semibold text-link hover:text-link-hover"
            >
              {rowAction.label}
            </button>
          )}
        </div>
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
  onBackToDashboard,
}: {
  success: SuccessView;
  onBackToCalendar: () => void;
  onBackToDashboard: () => void;
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

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onBackToCalendar}
          className="min-h-[52px] px-5 rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm transition-opacity duration-150 hover:opacity-90 active:scale-[0.97] motion-reduce:transform-none"
        >
          Back to calendar
        </button>
        <button
          type="button"
          onClick={onBackToDashboard}
          className="min-h-[52px] px-5 rounded-button border border-border text-text font-semibold text-sm hover:bg-surface-soft transition-colors duration-150 active:scale-[0.97] motion-reduce:transform-none"
        >
          Back to dashboard
        </button>
      </div>
    </section>
  );
}
