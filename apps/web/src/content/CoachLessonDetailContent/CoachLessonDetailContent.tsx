"use client";

import { useRef, useActionState } from "react";
import Link from "next/link";
import type { CoachLessonDetail, CoachNoteResponse } from "@swim-app/shared";

import AddNoteForm from "@/components/AddNoteForm";
import ConfirmDialog from "@/components/ConfirmDialog";
import InlineError from "@/components/InlineError";
import LessonStatusBadge from "@/components/LessonStatusBadge";
import { formatDollars } from "@/lib/formatDollars";
import ActionToast, { type ActionToastKind } from "./ActionToast";
import {
  cancelCoachLessonAction,
  approveCoachLessonAction,
  declineCoachLessonAction,
  markNoShowAction,
  undoNoShowAction,
  type CoachLessonDetailState,
} from "./actions";

type NotesSectionResult =
  | { ok: true; data: CoachNoteResponse[] }
  | { ok: false };

interface Props {
  lesson: CoachLessonDetail;
  notes: NotesSectionResult;
  // ADR 036 Phase 8 Part B Stop 3 piece 12 (animation audit #3):
  // the approve / decline / no-show server actions redirect back to
  // the lesson detail page with ?action=<kind>. The page normalizes
  // the value and threads it here so the one-shot toast fires once on
  // mount and auto-dismisses after 2.6s. The key on the toast element
  // is the action kind — if the coach chains approve → decline back
  // to back, React remounts the toast and the transitions re-fire.
  toastAction?: ActionToastKind;
}

export default function CoachLessonDetailContent({ lesson, notes, toastAction }: Props) {
  const cancelDialogRef = useRef<HTMLDialogElement>(null);
  const declineDialogRef = useRef<HTMLDialogElement>(null);
  const noShowDialogRef = useRef<HTMLDialogElement>(null);

  const [cancelState, cancelFormAction, isCanceling] = useActionState<
    CoachLessonDetailState,
    FormData
  >(cancelCoachLessonAction, { status: "idle" });

  const [approveState, approveFormAction, isApproving] = useActionState<
    CoachLessonDetailState,
    FormData
  >(approveCoachLessonAction, { status: "idle" });

  const [declineState, declineFormAction, isDeclining] = useActionState<
    CoachLessonDetailState,
    FormData
  >(declineCoachLessonAction, { status: "idle" });

  const [noShowState, noShowFormAction, isMarkingNoShow] = useActionState<
    CoachLessonDetailState,
    FormData
  >(markNoShowAction, { status: "idle" });

  const [undoNoShowState, undoNoShowFormAction, isUndoingNoShow] = useActionState<
    CoachLessonDetailState,
    FormData
  >(undoNoShowAction, { status: "idle" });

  const startsAt = new Date(lesson.startsAt);
  const endsAt = new Date(startsAt.getTime() + lesson.durationMinutes * 60 * 1000);
  const lessonType = lesson.type === "private" ? "Private lesson" : "Family lesson";
  const swimmerNames = lesson.swimmers
    .map((swimmer) =>
      swimmer.clubName ? `${swimmer.firstName} (${swimmer.clubName})` : swimmer.firstName,
    )
    .join(", ");

  const isPending = lesson.status === "pending";
  const isActive = lesson.status === "pending" || lesson.status === "approved";
  // Mark no-show is only valid once the lesson has started AND the lesson is
  // still in a markable status. The server enforces both; the UI gates the
  // control so the past-but-not-yet-started edge case can't render a stub.
  const hasStarted = startsAt.getTime() < Date.now();
  const canMarkNoShow =
    hasStarted && (lesson.status === "approved" || lesson.status === "completed");
  const isNoShow = lesson.status === "no_show";

  const poolAddress = lesson.isHomePool
    ? `${lesson.locationAddress}, ${lesson.locationCity}, ${lesson.locationState} ${lesson.locationZip}`
    : null;

  return (
    <div className="flex flex-col flex-1 bg-background">
      {toastAction !== undefined ? <ActionToast key={toastAction} action={toastAction} /> : null}
      <main id="main-content" className="flex-1">
        <div className="mx-auto max-w-content px-page pt-10 pb-20 tablet:pt-14 tablet:pb-32">
          <Link
            href="/coach/schedule"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-link hover:text-link-hover transition-colors duration-150 mb-6"
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
            Back to schedule
          </Link>

          <h1 className="text-3xl tablet:text-4xl text-heading mb-8">Lesson details</h1>

          <div className="flex flex-col gap-6 desktop:max-w-[640px]">
            {/* Lesson summary */}
            <div className="rounded-card border border-border p-5 tablet:p-6">
              <h2 className="text-xl text-heading mb-4">Summary</h2>
              <dl className="flex flex-col gap-3">
                <Row label="Date">{formatDateLabel(lesson.startsAt)}</Row>
                <Row label="Time">{`${formatTime(startsAt)} to ${formatTime(endsAt)}`}</Row>
                <Row label="Pool">{lesson.locationName}</Row>
                {poolAddress !== null && <Row label="Address">{poolAddress}</Row>}
                <Row label="Duration">{`${lesson.durationMinutes} min`}</Row>
                <Row label="Swimmers">{swimmerNames || "—"}</Row>
                <Row label="Type">{lessonType}</Row>
                {lesson.householdName !== null && (
                  <Row label="Household">{lesson.householdName}</Row>
                )}
                <Row label="Status">
                  {lesson.status === "approved" ? (
                    "Confirmed"
                  ) : (
                    <LessonStatusBadge status={lesson.status} viewer="coach" />
                  )}
                </Row>
              </dl>
            </div>

            {lesson.swimmers.length > 0 && (
              <div className="flex flex-col gap-4 desktop:max-w-[640px]">
                <h2 className="text-xl text-heading">Lesson notes</h2>
                {!notes.ok ? (
                  <InlineError message="Couldn't load lesson notes." reloadOnRetry />
                ) : (
                  lesson.swimmers.map((swimmer) => {
                    const swimmerNotes = notes.data.filter(
                      (note) => note.swimmerId === swimmer.swimmerId,
                    );
                    return (
                      <div
                        key={swimmer.swimmerId}
                        className="rounded-card border border-border p-5 tablet:p-6 flex flex-col gap-3"
                      >
                        <p className="text-sm font-semibold text-text">
                          {swimmer.firstName} {swimmer.lastName}
                        </p>
                        {swimmerNotes.length > 0 && (
                          <ul className="flex flex-col divide-y divide-border">
                            {swimmerNotes.map((note) => (
                              <li key={note.id} className="py-2 first:pt-0 last:pb-0">
                                <p className="text-sm text-text">{note.body}</p>
                              </li>
                            ))}
                          </ul>
                        )}
                        <AddNoteForm
                          swimmerId={swimmer.swimmerId}
                          lessonId={lesson.id}
                          label="Note"
                        />
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* Pending actions */}
            {isPending && (
              <div className="rounded-card border border-border p-5 tablet:p-6">
                <h2 className="text-xl text-heading mb-1">Approval</h2>
                <p className="text-sm text-text-secondary mb-5">
                  This lesson is waiting for your approval.
                </p>

                <form id="approve-detail-form" action={approveFormAction}>
                  <input type="hidden" name="lessonId" value={lesson.id} />
                </form>

                <div className="flex gap-3 flex-wrap">
                  <button
                    type="submit"
                    form="approve-detail-form"
                    disabled={isApproving || isDeclining}
                    className="inline-flex items-center justify-center rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm px-5 h-11 transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    {isApproving ? "Approving…" : "Approve"}
                  </button>
                  <button
                    type="button"
                    disabled={isApproving || isDeclining}
                    onClick={() => declineDialogRef.current?.showModal()}
                    className="inline-flex items-center justify-center rounded-button border border-border text-text font-semibold text-sm px-5 h-11 transition-colors hover:bg-surface-soft disabled:opacity-60"
                  >
                    Decline
                  </button>
                </div>
                {approveState.status === "error" && (
                  <p role="alert" className="text-sm text-danger mt-3">
                    {approveState.message}
                  </p>
                )}
              </div>
            )}

            {/* Reschedule */}
            {isActive && (
              <div className="rounded-card border border-border p-5 tablet:p-6">
                <h2 className="text-xl text-heading mb-1">Reschedule lesson</h2>
                <p className="text-sm text-text-secondary mb-5">
                  Pick a new time. The family will be notified of the change.
                </p>
                <Link
                  href={`/coach/lessons/${lesson.id}/reschedule`}
                  className="inline-flex items-center justify-center rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm px-5 h-11 transition-opacity hover:opacity-90 active:scale-[0.97] motion-reduce:transform-none"
                >
                  Reschedule
                </Link>
              </div>
            )}

            {/* Cancel */}
            {isActive && (
              <div className="rounded-card border border-border p-5 tablet:p-6">
                <h2 className="text-xl text-heading mb-1">Cancel lesson</h2>
                <p className="text-sm text-text-secondary mb-5">
                  Canceling is permanent. The family will be notified.
                </p>

                <form id="cancel-coach-lesson-form" action={cancelFormAction}>
                  <input type="hidden" name="lessonId" value={lesson.id} />
                </form>

                <button
                  type="button"
                  onClick={() => cancelDialogRef.current?.showModal()}
                  className="inline-flex items-center justify-center rounded-button bg-danger text-button-danger-text font-bold text-sm px-5 h-11 transition-opacity hover:opacity-90"
                >
                  Cancel this lesson
                </button>
              </div>
            )}

            {/* Mark no-show: past approved or completed, not yet marked */}
            {canMarkNoShow && (
              <div className="rounded-card border border-border p-5 tablet:p-6">
                <h2 className="text-xl text-heading mb-1">Mark no-show</h2>
                <p className="text-sm text-text-secondary mb-5">
                  Flag this lesson as a no-show if the family didn't attend. No email
                  goes out; the lesson stays on your calendar as history and the
                  family sees it as missed.
                </p>

                <form id="mark-no-show-form" action={noShowFormAction}>
                  <input type="hidden" name="lessonId" value={lesson.id} />
                </form>

                <button
                  type="button"
                  disabled={isMarkingNoShow}
                  onClick={() => noShowDialogRef.current?.showModal()}
                  className="inline-flex items-center justify-center rounded-button border border-border text-text font-semibold text-sm px-5 h-11 transition-colors hover:bg-surface-soft disabled:opacity-60"
                >
                  {isMarkingNoShow ? "Marking…" : "Mark no-show"}
                </button>
                {noShowState.status === "error" && (
                  <p role="alert" className="text-sm text-danger mt-3">
                    {noShowState.message}
                  </p>
                )}
              </div>
            )}

            {/* Undo no-show: lesson currently marked no_show */}
            {isNoShow && (
              <div className="rounded-card border border-border p-5 tablet:p-6">
                <h2 className="text-xl text-heading mb-1">Marked no-show</h2>
                <p className="text-sm text-text-secondary mb-5">
                  Undo returns this lesson to its previous state (completed if the
                  end time has passed, otherwise approved).
                </p>

                <form id="undo-no-show-form" action={undoNoShowFormAction}>
                  <input type="hidden" name="lessonId" value={lesson.id} />
                </form>

                <button
                  type="submit"
                  form="undo-no-show-form"
                  disabled={isUndoingNoShow}
                  className="inline-flex items-center justify-center rounded-button border border-border text-text font-semibold text-sm px-5 h-11 transition-colors hover:bg-surface-soft disabled:opacity-60"
                >
                  {isUndoingNoShow ? "Undoing…" : "Undo no-show"}
                </button>
                {undoNoShowState.status === "error" && (
                  <p role="alert" className="text-sm text-danger mt-3">
                    {undoNoShowState.message}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Decline dialog */}
      <form id="decline-detail-form" action={declineFormAction}>
        <input type="hidden" name="lessonId" value={lesson.id} />
      </form>
      <ConfirmDialog
        dialogRef={declineDialogRef}
        title="Decline this lesson?"
        description="The family will be notified. You can optionally leave a reason."
        formId="decline-detail-form"
        confirmLabel="Decline"
        confirmDanger
        cancelLabel="Keep it"
        isPending={isDeclining}
        {...(declineState.status === "error" ? { errorMessage: declineState.message } : {})}
        onCancel={() => declineDialogRef.current?.close()}
      >
        <div className="flex flex-col gap-3">
          <RefundLine
            chargeAmountCents={lesson.chargeAmountCents}
            testid="coach-decline-refund"
          />
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-text-secondary-on-section">
              Reason (optional)
            </span>
            <textarea
              name="reason"
              form="decline-detail-form"
              rows={3}
              placeholder="e.g. scheduling conflict"
              className="rounded-card border border-divider-section bg-card text-text-on-section text-sm px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-focus-ring placeholder:text-text-secondary-on-section"
            />
          </label>
        </div>
      </ConfirmDialog>

      {/* Cancel dialog */}
      <ConfirmDialog
        dialogRef={cancelDialogRef}
        title="Cancel this lesson?"
        description={`${formatDateLabel(lesson.startsAt)} at ${formatTime(startsAt)} at ${lesson.locationName}. This can't be undone.`}
        formId="cancel-coach-lesson-form"
        confirmLabel="Cancel lesson"
        confirmDanger
        cancelLabel="Keep it"
        isPending={isCanceling}
        {...(cancelState.status === "error" ? { errorMessage: cancelState.message } : {})}
        onCancel={() => cancelDialogRef.current?.close()}
      >
        <RefundLine
          chargeAmountCents={lesson.chargeAmountCents}
          testid="coach-cancel-refund"
        />
      </ConfirmDialog>

      {/* Mark no-show dialog */}
      <ConfirmDialog
        dialogRef={noShowDialogRef}
        title="Mark this lesson as a no-show?"
        description={`${formatDateLabel(lesson.startsAt)} at ${formatTime(startsAt)} at ${lesson.locationName}. The family will see it as missed. You can undo this.`}
        formId="mark-no-show-form"
        confirmLabel="Mark no-show"
        cancelLabel="Keep it"
        isPending={isMarkingNoShow}
        onCancel={() => noShowDialogRef.current?.close()}
      >
        <RefundLine
          chargeAmountCents={lesson.chargeAmountCents}
          testid="coach-no-show-refund"
        />
      </ConfirmDialog>
    </div>
  );
}

// ADR 036 Phase 8 Part B Stop 3 piece 4: shared refund-preview line
// used by the coach cancel / decline / no-show confirmation dialogs.
// Suppressed on free or already-refunded lessons (chargeAmountCents is
// null) and on anonymized rows (no live household balance to refund).
function RefundLine({
  chargeAmountCents,
  testid,
}: {
  chargeAmountCents: number | null | undefined;
  testid: string;
}) {
  if (typeof chargeAmountCents !== "number" || chargeAmountCents <= 0) return null;
  return (
    <p className="text-sm text-text leading-relaxed" data-testid={testid}>
      <span className="font-semibold">{formatDollars(chargeAmountCents)}</span> will
      go back to the family&apos;s balance.
    </p>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <dt className="text-sm text-text-secondary w-24 flex-shrink-0">{label}</dt>
      <dd className="text-sm text-text">{children}</dd>
    </div>
  );
}

function formatDateLabel(startsAt: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(startsAt));
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}
