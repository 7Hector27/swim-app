"use client";

import { useRef, useActionState } from "react";
import Link from "next/link";

import type { LessonLocation, UpcomingLesson } from "@swim-app/shared";

import AddNoteForm from "@/components/AddNoteForm";
import ConfirmDialog from "@/components/ConfirmDialog";
import LessonStatusBadge from "@/components/LessonStatusBadge";
import { cancelLessonAction, type LessonDetailState } from "./actions";

interface Props {
  lesson: UpcomingLesson;
  locations: LessonLocation[];
  isViewer: boolean;
  isCoach: boolean;
}

export default function LessonDetailContent({ lesson, locations: _locations, isViewer, isCoach }: Props) {
  const cancelDialogRef = useRef<HTMLDialogElement>(null);

  const [cancelState, cancelFormAction, isCanceling] = useActionState<LessonDetailState, FormData>(
    cancelLessonAction,
    { status: "idle" },
  );

  const startsAt = new Date(lesson.startsAt);
  const endsAt = new Date(startsAt.getTime() + lesson.durationMinutes * 60 * 1000);
  const lessonType = lesson.type === "private" ? "Private lesson" : "Family lesson";
  const swimmerNames = lesson.swimmers.map((swimmer) => swimmer.firstName).join(", ");
  const lessonHasStarted = new Date() >= new Date(lesson.startsAt);

  return (
    <div className="flex flex-col flex-1 bg-background">

      <main id="main-content" className="flex-1">
        <div className="mx-auto max-w-content px-page pt-10 pb-20 tablet:pt-14 tablet:pb-32">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-link hover:text-link-hover transition-colors duration-150 mb-6"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back to dashboard
          </Link>

          <h1 className="text-3xl tablet:text-4xl text-heading mb-8">Lesson details</h1>

          <div className="flex flex-col gap-6 desktop:max-w-[640px]">
            {/* Lesson summary */}
            <div className="rounded-card border border-border p-5 tablet:p-6">
              <h2 className="text-xl text-heading mb-4">Summary</h2>
              <dl className="flex flex-col gap-3">
                <Row label="Date">{formatDateLabel(lesson.startsAt)}</Row>
                <Row label="Time">{`${formatTime(startsAt)} to ${formatTime(endsAt)}`}</Row>
                <Row label="Location">{lesson.locationName}</Row>
                <Row label="Duration">{`${lesson.durationMinutes} min`}</Row>
                <Row label="Swimmers">{swimmerNames || "—"}</Row>
                <Row label="Type">{lessonType}</Row>
                <Row label="Status">
                  {lesson.status === "approved" ? (
                    <span className="inline-flex items-center rounded-full text-xs font-semibold px-2.5 py-1 bg-success/10 text-success">
                      Confirmed
                    </span>
                  ) : (
                    <LessonStatusBadge status={lesson.status} viewer="parent" />
                  )}
                </Row>
                {lesson.movedAt !== null && lesson.previousStartsAt !== null && (
                  <Row label="Rescheduled">
                    Moved by Jason from {formatDateLabel(lesson.previousStartsAt)} at{" "}
                    {formatTime(new Date(lesson.previousStartsAt))}
                  </Row>
                )}
              </dl>
            </div>

            {!isViewer && !lessonHasStarted && (
              <>
                {/* Reschedule */}
                <Link
                  href={`/dashboard/lessons/${lesson.id}/reschedule`}
                  className="inline-flex items-center justify-center rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm px-5 h-11 transition-opacity hover:opacity-90 active:scale-[0.97] motion-reduce:transform-none self-start"
                >
                  Reschedule
                </Link>

                {/* Cancel */}
                <div className="rounded-card border border-border p-5 tablet:p-6">
                  <h2 className="text-xl text-heading mb-1">Cancel lesson</h2>
                  <p className="text-sm text-text-secondary mb-5">
                    Canceling is permanent. Jason will be notified.
                  </p>

                  <form id="cancel-form" action={cancelFormAction}>
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
              </>
            )}
          </div>

          {isCoach && lesson.swimmers.length > 0 && (
            <div className="flex flex-col gap-4 mt-2 desktop:max-w-[640px]">
              <h2 className="text-xl text-heading">Lesson notes</h2>
              {lesson.swimmers.map((swimmer) => (
                <div key={swimmer.swimmerId} className="rounded-card border border-border p-5 tablet:p-6 flex flex-col gap-3">
                  <p className="text-sm font-semibold text-text">{swimmer.firstName} {swimmer.lastName}</p>
                  <AddNoteForm
                    swimmerId={swimmer.swimmerId}
                    lessonId={lesson.id}
                    label="Note"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      <ConfirmDialog
        dialogRef={cancelDialogRef}
        title="Cancel this lesson?"
        description={`${formatDateLabel(lesson.startsAt)} at ${formatTime(startsAt)} at ${lesson.locationName}. This can't be undone.`}
        formId="cancel-form"
        confirmLabel="Cancel lesson"
        confirmDanger
        cancelLabel="Keep it"
        isPending={isCanceling}
        {...(cancelState.status === "error" ? { errorMessage: cancelState.message } : {})}
        onCancel={() => cancelDialogRef.current?.close()}
      />
    </div>
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
  const date = new Date(startsAt);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(date);
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}
