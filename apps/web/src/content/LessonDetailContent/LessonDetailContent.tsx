"use client";

import { useEffect, useRef, useActionState } from "react";
import Link from "next/link";

import type { LessonLocation, UpcomingLesson } from "@swim-app/shared";

import AddNoteForm from "@/components/AddNoteForm";
import ConfirmDialog from "@/components/ConfirmDialog";
import BatchModeBadge from "@/components/BatchModeBadge";
import { formatDollars } from "@/content/AccountBalanceContent/formatters";
import {
  cancelBatchRemainingAction,
  cancelLessonAction,
  type LessonDetailState,
} from "./actions";

interface Props {
  lesson: UpcomingLesson;
  locations: LessonLocation[];
  isViewer: boolean;
  isCoach: boolean;
  batchSiblings?: UpcomingLesson[];
}

export default function LessonDetailContent({
  lesson,
  locations,
  isViewer,
  isCoach,
  batchSiblings = [],
}: Props) {
  const cancelDialogRef = useRef<HTMLDialogElement>(null);
  const cancelBatchDialogRef = useRef<HTMLDialogElement>(null);
  const cancelSuccessDialogRef = useRef<HTMLDialogElement>(null);

  const [cancelState, cancelFormAction, isCanceling] = useActionState<LessonDetailState, FormData>(
    cancelLessonAction,
    { status: "idle" },
  );
  const [cancelBatchState, cancelBatchFormAction, isCancelingBatch] = useActionState<
    LessonDetailState,
    FormData
  >(cancelBatchRemainingAction, { status: "idle" });

  // ADR 036 Phase 8 Part B Stop 3 piece 4: when the cancel succeeds,
  // close the confirm dialog and open the refund-confirmation dialog so
  // the parent sees "Cancelled. Refunded $X. New balance $Y." before
  // going back to the dashboard. Free-lesson cancels still show the
  // dialog but drop the refund line.
  useEffect(() => {
    if (cancelState.status !== "canceled") return;
    cancelDialogRef.current?.close();
    cancelSuccessDialogRef.current?.showModal();
  }, [cancelState]);

  const startsAt = new Date(lesson.startsAt);
  const endsAt = new Date(startsAt.getTime() + lesson.durationMinutes * 60 * 1000);
  const lessonHasStarted = new Date() >= startsAt;
  const canModify = !isViewer && !lessonHasStarted;
  const canCancelBatch =
    !isViewer && !isCoach && lesson.batchId !== null && batchSiblings.length > 1;

  const location = locations.find((candidate) => candidate.id === lesson.locationId) ?? null;
  const mapHref = buildMapHref(location, lesson.locationName);
  const addressLine = location
    ? `${location.address}, ${location.city}, ${location.state} ${location.zip}`
    : null;

  const otherFutureSiblings = batchSiblings
    .filter((sibling) => sibling.id !== lesson.id)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const showBookingList = lesson.batchId !== null && otherFutureSiblings.length > 0;

  const cancelDialogSiblings = [...batchSiblings].sort((a, b) =>
    a.startsAt.localeCompare(b.startsAt),
  );

  const swimmerLabel =
    lesson.swimmers.map((swimmer) => `${swimmer.firstName} ${swimmer.lastName.charAt(0)}.`).join(", ") ||
    "No swimmers";
  const typeLabel = lesson.type === "private" ? "Private" : "Family";

  return (
    <div className="flex flex-col flex-1 bg-background">
      <main id="main-content" className="flex-1">
        <div className="mx-auto max-w-content px-page pt-6 tablet:pt-10 pb-20 tablet:pb-28">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-link hover:text-link-hover transition-colors duration-150"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M10 12L6 8l4-4"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Back to dashboard
          </Link>

          {/* Hero */}
          <section className="mt-6 rounded-card bg-section text-text-on-section border border-divider-section overflow-hidden">
            <div className="flex flex-col gap-6 tablet:flex-row tablet:items-end tablet:justify-between p-6 tablet:p-10">
              <div className="flex flex-col gap-3 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip status={lesson.status} />
                  {lesson.batchMode !== null && <BatchModeBadge mode={lesson.batchMode} />}
                </div>
                <h1 className="font-heading font-semibold text-[clamp(2rem,2vw+1.5rem,3.25rem)] leading-[1.05] text-text-on-section">
                  {formatHeroDate(lesson.startsAt)}
                </h1>
                <p className="text-base tablet:text-lg text-text-secondary-on-section tabular-nums">
                  {formatTime(startsAt)} to {formatTime(endsAt)}
                  <span className="mx-2 text-text-secondary-on-section/60" aria-hidden="true">
                    ·
                  </span>
                  {lesson.durationMinutes} min
                </p>
              </div>

              <div className="flex flex-col gap-1 tablet:text-right min-w-0">
                <p className="text-xs uppercase tracking-wide font-semibold text-text-secondary-on-section">
                  Pool
                </p>
                <p className="text-lg font-semibold text-text-on-section">{lesson.locationName}</p>
                <a
                  href={mapHref}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 self-start tablet:self-end text-sm font-semibold text-accent-on-section hover:underline break-words"
                >
                  {addressLine ?? "Open in Maps"}
                  <ArrowOutIcon />
                </a>
              </div>
            </div>
          </section>

          {/* Body: main column flows above a stacked action group on phone / tablet;
              moves beside the action rail on desktop. Rendered once so there is no
              duplicate DOM to differentiate between viewport widths. */}
          <div className="mt-6 tablet:mt-8 flex flex-col desktop:flex-row desktop:items-start gap-6 tablet:gap-8">
            <div className="flex-1 min-w-0 flex flex-col gap-6">
              <section className="rounded-card border border-border p-5 tablet:p-6">
                <h2 className="text-lg text-heading mb-5">Details</h2>
                <dl className="grid grid-cols-1 tablet:grid-cols-2 gap-x-8 gap-y-5">
                  <Field label="Swimmers" value={swimmerLabel} />
                  <Field label="Lesson type" value={typeLabel} />
                  <Field label="Length" value={`${lesson.durationMinutes} minutes`} />
                  <Field label="Booked" value={formatBookedOn(lesson.createdAt)} />
                  {lesson.movedAt !== null && lesson.previousStartsAt !== null && (
                    <Field
                      label="Rescheduled"
                      value={`Moved by Jason from ${formatShortDate(lesson.previousStartsAt)} at ${formatTime(new Date(lesson.previousStartsAt))}`}
                      wide
                    />
                  )}
                </dl>
              </section>

              {showBookingList && (
                <section className="rounded-card border border-border p-5 tablet:p-6">
                  <div className="flex items-baseline justify-between gap-3 mb-5">
                    <h2 className="text-lg text-heading">Upcoming in this booking</h2>
                    <span className="text-xs text-text-secondary">
                      {otherFutureSiblings.length}{" "}
                      {otherFutureSiblings.length === 1 ? "lesson" : "lessons"}
                    </span>
                  </div>
                  <ul className="flex flex-col divide-y divide-border">
                    {otherFutureSiblings.map((sibling) => (
                      <BookingRow key={sibling.id} sibling={sibling} />
                    ))}
                  </ul>
                </section>
              )}
            </div>

            <aside className="w-full desktop:w-[320px] desktop:flex-shrink-0 desktop:sticky desktop:top-6 flex flex-col gap-3">
              {canModify ? (
                <>
                  <Link
                    href={`/dashboard/lessons/${lesson.id}/reschedule`}
                    className="inline-flex items-center justify-center rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm h-11 px-5 w-full transition-opacity duration-150 hover:opacity-90 active:scale-[0.98] motion-reduce:transform-none"
                  >
                    Reschedule
                  </Link>
                  <button
                    type="button"
                    onClick={() => cancelDialogRef.current?.showModal()}
                    className="inline-flex items-center justify-center rounded-button border-2 border-danger text-danger font-bold text-sm h-11 px-5 w-full transition-colors duration-150 hover:bg-danger/10 active:scale-[0.98] motion-reduce:transform-none"
                  >
                    Cancel this lesson
                  </button>
                  {canCancelBatch && (
                    <button
                      type="button"
                      onClick={() => cancelBatchDialogRef.current?.showModal()}
                      className="inline-flex items-center justify-center rounded-button border-2 border-danger text-danger font-bold text-sm h-11 px-5 w-full transition-colors duration-150 hover:bg-danger/10 active:scale-[0.98] motion-reduce:transform-none"
                    >
                      Cancel remaining lessons
                    </button>
                  )}
                  <p className="text-xs text-text-secondary mt-1 leading-relaxed">
                    Canceling notifies Jason. Changes can&apos;t be undone.
                  </p>
                </>
              ) : (
                <div className="rounded-card border border-border p-5">
                  <p className="text-sm text-text-secondary leading-relaxed">
                    {lessonHasStarted
                      ? "This lesson has ended. It stays here for your records."
                      : "You can view this lesson but not change it."}
                  </p>
                </div>
              )}
            </aside>
          </div>

          {isCoach && lesson.swimmers.length > 0 && (
            <section className="mt-10 flex flex-col gap-4">
              <h2 className="text-xl text-heading">Lesson notes</h2>
              {lesson.swimmers.map((swimmer) => (
                <div
                  key={swimmer.swimmerId}
                  className="rounded-card border border-border p-5 tablet:p-6 flex flex-col gap-3"
                >
                  <p className="text-sm font-semibold text-text">
                    {swimmer.firstName} {swimmer.lastName}
                  </p>
                  <AddNoteForm swimmerId={swimmer.swimmerId} lessonId={lesson.id} label="Note" />
                </div>
              ))}
            </section>
          )}
        </div>
      </main>

      {/* Hidden forms backing the confirm dialogs */}
      <form id="cancel-form" action={cancelFormAction} className="hidden">
        <input type="hidden" name="lessonId" value={lesson.id} />
      </form>
      {canCancelBatch && (
        <form id="cancel-batch-form" action={cancelBatchFormAction} className="hidden">
          <input type="hidden" name="batchId" value={lesson.batchId ?? ""} />
        </form>
      )}

      <ConfirmDialog
        dialogRef={cancelDialogRef}
        title="Cancel this lesson?"
        description={`${formatLongDate(lesson.startsAt)} at ${formatTime(startsAt)} at ${lesson.locationName}. This can't be undone.`}
        formId="cancel-form"
        confirmLabel="Cancel lesson"
        confirmDanger
        cancelLabel="Keep it"
        isPending={isCanceling}
        {...(cancelState.status === "error" ? { errorMessage: cancelState.message } : {})}
        onCancel={() => cancelDialogRef.current?.close()}
      >
        {/* ADR 036 Phase 8 Part B Stop 3 piece 4: refund preview on the
            cancel confirmation. The amount is the lesson's outstanding
            charge from the lesson detail API (never computed in the
            browser). Free lessons have chargeAmountCents null and the
            refund line is suppressed. */}
        {typeof lesson.chargeAmountCents === "number" && lesson.chargeAmountCents > 0 && (
          <p
            className="text-sm text-text leading-relaxed"
            data-testid="parent-cancel-refund-preview"
          >
            You&apos;ll get{" "}
            <span className="font-semibold">{formatDollars(lesson.chargeAmountCents)}</span>{" "}
            back to your balance.
          </p>
        )}
      </ConfirmDialog>

      {cancelState.status === "canceled" && (
        <ConfirmDialog
          dialogRef={cancelSuccessDialogRef}
          title="Lesson canceled"
          description=""
          formId="cancel-back-form"
          confirmLabel="Back to dashboard"
          cancelLabel="Stay here"
          isPending={false}
          onCancel={() => cancelSuccessDialogRef.current?.close()}
        >
          <div
            className="flex flex-col gap-2 text-sm text-text leading-relaxed"
            data-testid="parent-cancel-success"
          >
            {cancelState.refundAmountCents !== null && cancelState.refundAmountCents > 0 ? (
              <p>
                Refunded{" "}
                <span className="font-semibold">
                  {formatDollars(cancelState.refundAmountCents)}
                </span>{" "}
                to your balance.
              </p>
            ) : null}
            <p>
              New balance:{" "}
              <span className="font-semibold">
                {formatDollars(cancelState.newBalanceCents)}
              </span>
              .
            </p>
          </div>
        </ConfirmDialog>
      )}

      {/* Navigates to /dashboard when the user clicks "Back to dashboard"
          on the success dialog. Plain form (GET) with no server action —
          the browser handles the navigation. */}
      <form id="cancel-back-form" action="/dashboard" method="get" className="hidden" />
      {canCancelBatch && (
        <ConfirmDialog
          dialogRef={cancelBatchDialogRef}
          title={`Cancel ${cancelDialogSiblings.length} remaining lessons?`}
          description="These lessons will be canceled and removed from your calendar."
          formId="cancel-batch-form"
          confirmLabel="Cancel all"
          confirmDanger
          cancelLabel="Keep them"
          isPending={isCancelingBatch}
          {...(cancelBatchState.status === "error" ? { errorMessage: cancelBatchState.message } : {})}
          onCancel={() => cancelBatchDialogRef.current?.close()}
        >
          <ul className="flex flex-col gap-1.5 text-sm text-text max-h-64 overflow-y-auto">
            {cancelDialogSiblings.map((sibling) => (
              <li key={sibling.id} className="flex justify-between gap-3">
                <span>{formatLongDate(sibling.startsAt)}</span>
                <span className="text-text-secondary tabular-nums">
                  {formatTime(new Date(sibling.startsAt))}
                </span>
              </li>
            ))}
          </ul>
        </ConfirmDialog>
      )}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function Field({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "tablet:col-span-2" : undefined}>
      <dt className="text-xs uppercase tracking-wide font-semibold text-text-secondary mb-1">
        {label}
      </dt>
      <dd className="text-sm text-text leading-snug">{value}</dd>
    </div>
  );
}

function StatusChip({ status }: { status: UpcomingLesson["status"] }) {
  const base =
    "inline-flex items-center h-[22px] px-2.5 rounded-full text-[11px] font-semibold uppercase tracking-wide";
  if (status === "approved") {
    return <span className={`${base} bg-success/20 text-success`}>Confirmed</span>;
  }
  if (status === "pending") {
    return (
      <span className={`${base} bg-white/10 text-text-on-section`}>Waiting for Jason</span>
    );
  }
  if (status === "completed") {
    return (
      <span className={`${base} bg-white/10 text-text-secondary-on-section`}>Completed</span>
    );
  }
  if (status === "canceled") {
    return <span className={`${base} bg-white/10 text-text-secondary-on-section`}>Canceled</span>;
  }
  if (status === "declined") {
    return <span className={`${base} bg-danger/20 text-danger`}>Declined</span>;
  }
  return <span className={`${base} bg-white/10 text-text-secondary-on-section`}>{status}</span>;
}

function BookingRow({ sibling }: { sibling: UpcomingLesson }) {
  const isPending = sibling.status === "pending";
  return (
    <li className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex items-center gap-3 min-w-0">
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${
            isPending ? "bg-text-secondary" : "bg-success"
          }`}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate text-text">
            {formatShortDate(sibling.startsAt)}
          </p>
          <p className="text-xs text-text-secondary tabular-nums">
            {formatTime(new Date(sibling.startsAt))} · {sibling.durationMinutes} min
          </p>
        </div>
      </div>
      <span className={`text-xs font-semibold ${isPending ? "text-text-secondary" : "text-success"}`}>
        {isPending ? "Pending" : "Confirmed"}
      </span>
    </li>
  );
}

function ArrowOutIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M4 2h6v6M10 2L3.5 8.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function buildMapHref(location: LessonLocation | null, locationName: string): string {
  const query = location
    ? `${location.address}, ${location.city}, ${location.state} ${location.zip}`
    : locationName;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

const LA_TIMEZONE = "America/Los_Angeles";

function formatHeroDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: LA_TIMEZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(iso));
}

function formatLongDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: LA_TIMEZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(iso));
}

function formatShortDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: LA_TIMEZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

function formatBookedOn(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: LA_TIMEZONE,
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: LA_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}
