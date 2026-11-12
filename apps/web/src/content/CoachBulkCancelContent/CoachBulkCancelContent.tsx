"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type {
  BulkCancelPreviewLesson,
  BulkCancelPreviewResponse,
  LessonLocation,
} from "@swim-app/shared";
import { BULK_CANCEL_MESSAGE_MAX_LENGTH } from "@swim-app/shared";
import { postBulkCancelConfirm, postBulkCancelPreview } from "@/lib/api/coachBulkCancel";
import { formatDollars } from "@/content/AccountBalanceContent/formatters";

interface Props {
  accessToken: string;
  namedPools: LessonLocation[];
  // LA calendar date, YYYY-MM-DD. Used as the min for both date inputs so a
  // coach can't pick a past date, and as the floor when auto-advancing the
  // other end on an input change.
  today: string;
  initialStartDate: string;
  initialEndDate: string;
  initialLocationId: string | null;
}

type ConfirmSummary = {
  canceledLessonCount: number;
  declinedLessonCount: number;
  affectedHouseholdCount: number;
  blockApplied: boolean;
};

export default function CoachBulkCancelContent({
  accessToken,
  namedPools,
  today,
  initialStartDate,
  initialEndDate,
  initialLocationId,
}: Props) {
  const router = useRouter();

  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(initialEndDate);
  const [locationId, setLocationId] = useState<string>(initialLocationId ?? "");
  const [startTime, setStartTime] = useState<string>("");
  const [endTime, setEndTime] = useState<string>("");
  const [message, setMessage] = useState("");
  const [blockRange, setBlockRange] = useState(true);

  const [preview, setPreview] = useState<BulkCancelPreviewResponse | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmResult, setConfirmResult] = useState<ConfirmSummary | null>(null);
  const [routerPending, startRouterTransition] = useTransition();
  // Flips to true after the first successful Preview click. Once set, any
  // change to dates / times / pool re-fetches automatically (debounced).
  const [hasPreviewed, setHasPreviewed] = useState(false);
  // Monotonic request counter so a stale fetch result can't overwrite a
  // newer one. Compared against the active value when the fetch resolves.
  const requestSeqRef = useRef(0);

  const rangeValid = endDate >= startDate;
  const messageTooLong = message.length > BULK_CANCEL_MESSAGE_MAX_LENGTH;
  const bothTimesSet = startTime.length > 0 && endTime.length > 0;
  const neitherTimeSet = startTime.length === 0 && endTime.length === 0;
  const timesPaired = bothTimesSet || neitherTimeSet;
  const timeOrderValid = !bothTimesSet || endTime > startTime;
  const timeWindowValid = timesPaired && timeOrderValid;
  const canPreview =
    rangeValid && !messageTooLong && timeWindowValid && !previewing;
  const hasAffectedLessons = preview !== null && preview.lessons.length > 0;
  const canConfirm =
    preview !== null && !confirming && (hasAffectedLessons || blockRange);

  const groupedByHousehold = useMemo(() => groupPreview(preview), [preview]);

  const fetchPreview = useCallback(
    async (options: { silent: boolean }): Promise<void> => {
      if (!canPreview) return;
      const seq = ++requestSeqRef.current;
      setErrorMessage(null);
      if (!options.silent) setPreview(null);
      setPreviewing(true);
      const result = await postBulkCancelPreview(accessToken, {
        startDate,
        endDate,
        ...(locationId.length > 0 && { locationId }),
        ...(bothTimesSet && { startTime, endTime }),
      });
      if (seq !== requestSeqRef.current) return;
      setPreviewing(false);
      if (!result.ok) {
        setErrorMessage(`We couldn't load the preview (${result.error}). Try again.`);
        return;
      }
      setPreview(result.data);
      setHasPreviewed(true);
    },
    [accessToken, bothTimesSet, canPreview, endDate, endTime, locationId, startDate, startTime],
  );

  async function onPreview() {
    await fetchPreview({ silent: false });
  }

  // Auto-refresh: once the coach has opened the preview once, any change to
  // the fields that affect the server result refreshes it (debounced, so a
  // date-picker drag or quick tab through the time inputs doesn't fire a
  // request per keystroke). The message field is intentionally excluded —
  // it doesn't change which lessons are affected. Hook sits above the
  // success-screen early return so hook order stays stable across renders.
  useEffect(() => {
    if (!hasPreviewed) return;
    if (!canPreview) return;
    const handle = window.setTimeout(() => {
      void fetchPreview({ silent: true });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [canPreview, fetchPreview, hasPreviewed]);

  if (confirmResult !== null) {
    return (
      <ConfirmSuccess
        result={confirmResult}
        onBack={() =>
          startRouterTransition(() => router.push(`/coach/schedule?view=day&date=${startDate}`))
        }
        routerPending={routerPending}
      />
    );
  }

  async function onConfirm() {
    if (preview === null) return;
    setErrorMessage(null);
    setConfirming(true);
    const result = await postBulkCancelConfirm(accessToken, {
      startDate,
      endDate,
      ...(locationId.length > 0 && { locationId }),
      ...(bothTimesSet && { startTime, endTime }),
      ...(message.length > 0 && { message }),
      blockRange,
    });
    setConfirming(false);
    if (!result.ok) {
      setErrorMessage(mapConfirmError(result.error));
      return;
    }
    setConfirmResult({
      canceledLessonCount: result.data.canceledLessonCount,
      declinedLessonCount: result.data.declinedLessonCount,
      affectedHouseholdCount: result.data.affectedHouseholdCount,
      blockApplied: result.data.blockApplied,
    });
  }

  function onFormChange() {
    // Clear any stale error so a new fetch starts clean. The preview itself
    // stays visible until the auto-refresh effect replaces it, so the panel
    // doesn't flicker on each keystroke.
    if (errorMessage !== null) setErrorMessage(null);
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl tablet:text-4xl text-heading">Cancel lessons</h1>
          <p className="text-sm text-text-secondary">
            Cancel approved lessons and decline pending requests inside a date range.
            Families get one email that lists everything affected.
          </p>
        </div>
        <Link
          href={`/coach/schedule?view=day&date=${startDate}`}
          className="inline-flex items-center justify-center min-h-[44px] px-4 rounded-button border border-border text-text-secondary text-sm font-semibold hover:bg-surface-soft transition-colors duration-100"
        >
          Back to schedule
        </Link>
      </header>

      <section
        aria-label="Cancellation form"
        className="rounded-card border border-border bg-section text-text-on-section p-5 tablet:p-6 flex flex-col gap-5"
      >
        <div className="grid gap-4 tablet:grid-cols-2">
          <Field label="Start date">
            <input
              type="date"
              value={startDate}
              min={today}
              onChange={(event) => {
                const next = event.target.value;
                if (!next) return;
                setStartDate(next);
                // Auto-advance end when the new start lands past the current
                // end. No mutual max on either input, so both are freely
                // editable; invalid order surfaces as a soft error below.
                if (next > endDate) setEndDate(next);
                onFormChange();
              }}
              className={inputClass}
            />
          </Field>
          <Field label="End date">
            <input
              type="date"
              value={endDate}
              min={today}
              onChange={(event) => {
                const next = event.target.value;
                if (!next) return;
                setEndDate(next);
                // Mirror of the start-side auto-advance: bump the start back
                // when the new end lands before it.
                if (next < startDate) setStartDate(next);
                onFormChange();
              }}
              className={inputClass}
            />
          </Field>
          <Field label="Pool (optional)">
            <select
              value={locationId}
              onChange={(event) => {
                setLocationId(event.target.value);
                onFormChange();
              }}
              className={inputClass}
            >
              <option value="">All pools</option>
              {namedPools.map((pool) => (
                <option key={pool.id} value={pool.id}>
                  {pool.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Time window (optional, Pacific)">
            <div className="flex items-center gap-2">
              <input
                type="time"
                step={900}
                value={startTime}
                aria-label="Start time (Pacific)"
                onChange={(event) => {
                  setStartTime(event.target.value);
                  onFormChange();
                }}
                className={inputClass}
              />
              <span className="text-xs text-text-secondary shrink-0">to</span>
              <input
                type="time"
                step={900}
                value={endTime}
                aria-label="End time (Pacific)"
                onChange={(event) => {
                  setEndTime(event.target.value);
                  onFormChange();
                }}
                className={inputClass}
              />
            </div>
            <p className="mt-1 text-xs text-text-secondary">
              Leave blank to apply to the whole day.
            </p>
          </Field>
          <Field label="Message to families (optional)">
            <textarea
              value={message}
              maxLength={BULK_CANCEL_MESSAGE_MAX_LENGTH}
              rows={3}
              onChange={(event) => {
                setMessage(event.target.value);
                onFormChange();
              }}
              placeholder="e.g. Pool is closed for maintenance this week. Rebook anytime."
              className={`${inputClass} resize-y`}
            />
            <p className="mt-1 text-xs text-text-secondary">
              {message.length} / {BULK_CANCEL_MESSAGE_MAX_LENGTH}
            </p>
          </Field>
        </div>

        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={blockRange}
            onChange={(event) => {
              setBlockRange(event.target.checked);
              onFormChange();
            }}
            className="mt-1 h-5 w-5 rounded border-border text-accent focus:outline focus:outline-2 focus:outline-focus-ring"
          />
          <span className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-text">
              Also block this time so it can't be rebooked
            </span>
            <span className="text-xs text-text-secondary">
              {bothTimesSet
                ? locationId.length > 0
                  ? "A blocked time at the selected pool is written for the window on each day in the range."
                  : "A blocked time covering the window is written for each day in the range."
                : locationId.length > 0
                  ? "A blocked time at the selected pool is written for every day in the range."
                  : "A day-off override covers the entire range."}
            </span>
          </span>
        </label>

        {!rangeValid && (
          <p className="text-sm text-danger">End date must be on or after start date.</p>
        )}
        {!timesPaired && (
          <p className="text-sm text-danger">Set both a start and end time, or leave both blank.</p>
        )}
        {timesPaired && !timeOrderValid && (
          <p className="text-sm text-danger">End time must be after start time.</p>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={onPreview}
            disabled={!canPreview}
            className="inline-flex items-center justify-center min-h-[44px] px-5 rounded-button bg-button-primary-background text-button-primary-text text-sm font-bold transition-opacity duration-150 motion-reduce:transition-none hover:opacity-90 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {previewing ? "Loading preview…" : preview === null ? "Preview" : "Refresh preview"}
          </button>
          {preview !== null && (
            <span className="text-sm text-text-secondary">
              Showing lessons as of your last preview. Edit any field to refresh.
            </span>
          )}
        </div>
      </section>

      {errorMessage !== null && (
        <div
          role="alert"
          className="rounded-card border border-border bg-section text-text-on-section p-4 text-sm text-danger"
        >
          {errorMessage}
        </div>
      )}

      {preview !== null && (
        <PreviewPanel
          preview={preview}
          grouped={groupedByHousehold}
          blockRange={blockRange}
          onConfirm={onConfirm}
          confirming={confirming}
          canConfirm={canConfirm}
        />
      )}
    </div>
  );
}

const inputClass =
  "w-full h-11 px-3 rounded-button border border-border bg-background text-text text-sm focus:outline focus:outline-2 focus:outline-focus-ring";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm text-text">
      <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
        {label}
      </span>
      {children}
    </label>
  );
}

function PreviewPanel({
  preview,
  grouped,
  blockRange,
  onConfirm,
  confirming,
  canConfirm,
}: {
  preview: BulkCancelPreviewResponse;
  grouped: Map<string, { householdName: string; lessons: BulkCancelPreviewLesson[] }>;
  blockRange: boolean;
  onConfirm: () => void;
  confirming: boolean;
  canConfirm: boolean;
}) {
  const total = preview.lessons.length;
  const noLessons = total === 0;
  return (
    <section
      aria-label="Preview"
      className="rounded-card border border-border bg-section text-text-on-section p-5 tablet:p-6 flex flex-col gap-5"
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-xl text-heading">Preview</h2>
        <p className="text-sm text-text">{formatWindowLabel(preview)}</p>
        {noLessons ? (
          <p className="text-sm text-text-secondary">
            No approved or pending lessons fall in this {preview.startTime !== null ? "window" : "range"}.
            {blockRange ? " The block will still be applied." : ""}
          </p>
        ) : (
          <p className="text-sm text-text-secondary">
            {preview.approvedCount} approved {pluralize("lesson", preview.approvedCount)} and{" "}
            {preview.pendingCount} pending {pluralize("request", preview.pendingCount)} across{" "}
            {preview.householdCount} {pluralize("family", preview.householdCount)}.
          </p>
        )}
      </header>

      {!noLessons && (
        <ul className="flex flex-col gap-4">
          {Array.from(grouped.entries()).map(([householdId, group]) => {
            // ADR 036 Phase 8 Part B Stop 3 piece 4: per-family refund
            // total from the preview response (summed server-side from
            // the ledger — never recomputed in the browser). Suppressed
            // when zero so free-lesson-only families don't show a
            // misleading "$0 back" line.
            const refund = preview.perHouseholdRefunds.find(
              (entry) => entry.householdId === householdId,
            );
            const refundCents = refund?.totalRefundCents ?? 0;
            return (
              <li key={householdId} className="rounded-card border border-border bg-background p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-heading">{group.householdName}</p>
                  {refundCents > 0 && (
                    <p
                      className="text-sm text-text"
                      data-testid={`bulk-cancel-refund-${householdId}`}
                    >
                      <span className="font-semibold">{formatDollars(refundCents)}</span>{" "}
                      back to the family
                    </p>
                  )}
                </div>
                <ul className="mt-2 flex flex-col gap-1">
                  {group.lessons.map((lesson) => (
                    <li
                      key={lesson.lessonId}
                      className="text-sm text-text flex flex-wrap items-baseline gap-x-2"
                    >
                      <span className="font-semibold">{lesson.startsAtLocalDisplay}</span>
                      <span className="text-text-secondary">
                        {lesson.durationMinutes} min · {lesson.swimmerFirstNames.join(", ") || "swimmer"} ·{" "}
                        {lesson.locationName}
                      </span>
                      <StatusChip status={lesson.status} />
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}

      <div className="rounded-card border border-border bg-surface-soft p-4 text-sm text-text flex flex-col gap-2">
        <p className="font-semibold text-heading">You can't undo this.</p>
        <p className="text-text-secondary">
          Confirming will cancel {preview.approvedCount} approved{" "}
          {pluralize("lesson", preview.approvedCount)}, decline {preview.pendingCount} pending{" "}
          {pluralize("request", preview.pendingCount)}, and send one email to each of the{" "}
          {preview.householdCount} affected {pluralize("family", preview.householdCount)}.
          {blockRange
            ? " The range will also be blocked so it can't be rebooked."
            : " The range stays open for rebooking."}
        </p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={onConfirm}
          disabled={!canConfirm}
          className="inline-flex items-center justify-center min-h-[44px] px-5 rounded-button bg-danger text-button-danger-text text-sm font-bold transition-opacity duration-150 motion-reduce:transition-none hover:opacity-90 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {confirming
            ? "Canceling…"
            : noLessons
              ? "Apply block"
              : `Cancel ${total} ${pluralize("lesson", total)} and email ${preview.householdCount} ${pluralize("family", preview.householdCount)}`}
        </button>
      </div>
    </section>
  );
}

function StatusChip({ status }: { status: "approved" | "pending" }) {
  const label = status === "approved" ? "Approved" : "Pending";
  return (
    <span
      className={`inline-flex items-center h-5 px-2 rounded-full text-[11px] font-semibold uppercase tracking-wide ${
        status === "approved"
          ? "bg-accent text-on-accent"
          : "bg-surface-soft text-text-secondary"
      }`}
    >
      {label}
    </span>
  );
}

function ConfirmSuccess({
  result,
  onBack,
  routerPending,
}: {
  result: ConfirmSummary;
  onBack: () => void;
  routerPending: boolean;
}) {
  const anyAction =
    result.canceledLessonCount + result.declinedLessonCount > 0 || result.blockApplied;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl tablet:text-4xl text-heading">Done.</h1>
        <p className="text-sm text-text-secondary">
          Family emails are on their way. Google Calendar is updating for every cancelled lesson.
        </p>
      </header>
      <section className="rounded-card border border-border bg-section text-text-on-section p-5 tablet:p-6 flex flex-col gap-2">
        <SummaryRow label="Cancelled lessons" value={result.canceledLessonCount} />
        <SummaryRow label="Declined requests" value={result.declinedLessonCount} />
        <SummaryRow label="Families emailed" value={result.affectedHouseholdCount} />
        <SummaryRow
          label="Range blocked"
          value={result.blockApplied ? "Yes" : "No"}
        />
        {!anyAction && (
          <p className="text-sm text-text-secondary">
            Nothing was cancelled, and no block was applied.
          </p>
        )}
      </section>
      <div>
        <button
          type="button"
          onClick={onBack}
          disabled={routerPending}
          className="inline-flex items-center justify-center min-h-[44px] px-5 rounded-button bg-button-primary-background text-button-primary-text text-sm font-bold transition-opacity duration-150 motion-reduce:transition-none hover:opacity-90 active:scale-[0.97] disabled:opacity-50"
        >
          Back to schedule
        </button>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: number | string }) {
  return (
    <p className="text-sm text-text flex items-center justify-between gap-4">
      <span className="text-text-secondary">{label}</span>
      <span className="font-semibold text-heading">{value}</span>
    </p>
  );
}

function groupPreview(
  preview: BulkCancelPreviewResponse | null,
): Map<string, { householdName: string; lessons: BulkCancelPreviewLesson[] }> {
  const grouped = new Map<string, { householdName: string; lessons: BulkCancelPreviewLesson[] }>();
  if (preview === null) return grouped;
  for (const lesson of preview.lessons) {
    const existing = grouped.get(lesson.householdId);
    if (existing !== undefined) {
      existing.lessons.push(lesson);
    } else {
      grouped.set(lesson.householdId, {
        householdName: lesson.householdName,
        lessons: [lesson],
      });
    }
  }
  return grouped;
}

// "Thursday, Nov 6, 4:00 PM to 6:00 PM" (single day + window)
// "Thursday, Nov 6" (single day, no window)
// "Thursday, Nov 6 through Saturday, Nov 8, 4:00 PM to 6:00 PM each day" (range + window)
// "Thursday, Nov 6 through Saturday, Nov 8" (range, no window)
function formatWindowLabel(preview: BulkCancelPreviewResponse): string {
  const sameDay = preview.startDate === preview.endDate;
  const dateLabel = sameDay
    ? formatLaDateForLabel(preview.startDate)
    : `${formatLaDateForLabel(preview.startDate)} through ${formatLaDateForLabel(preview.endDate)}`;
  if (preview.startTime === null || preview.endTime === null) {
    return dateLabel;
  }
  const timeLabel = `${formatLaTime(preview.startTime)} to ${formatLaTime(preview.endTime)}`;
  return sameDay ? `${dateLabel}, ${timeLabel}` : `${dateLabel}, ${timeLabel} each day`;
}

function formatLaDateForLabel(laDate: string): string {
  const year = Number(laDate.slice(0, 4));
  const month = Number(laDate.slice(5, 7));
  const day = Number(laDate.slice(8, 10));
  const anchor = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(anchor);
}

function formatLaTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map((n) => Number.parseInt(n, 10));
  const hour = h ?? 0;
  const minute = m ?? 0;
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  const paddedMinute = minute.toString().padStart(2, "0");
  return `${displayHour}:${paddedMinute} ${period}`;
}

function pluralize(word: string, count: number): string {
  if (count === 1) return word;
  if (word === "family") return "families";
  return `${word}s`;
}

function mapConfirmError(code: string): string {
  if (code === "no_lessons_in_range") {
    return "No lessons fall in this range. Enable the block option, or widen the range.";
  }
  if (code === "message_too_long") {
    return `Your message is longer than ${BULK_CANCEL_MESSAGE_MAX_LENGTH} characters.`;
  }
  if (code === "network") {
    return "We couldn't reach the server. Check your connection and try again.";
  }
  return `Something went wrong (${code}). Try again.`;
}
