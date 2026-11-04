"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { UpcomingLesson } from "@swim-app/shared";

import styles from "./BookingConfirmDialog.module.css";

// `lesson` is omitted when the details fetch failed. Rendering the dialog
// without details is still the right call — the parent otherwise sees no
// confirmation after a successful booking and may book again. See the
// server page for how this is triggered.
interface Props {
  lesson?: UpcomingLesson;
  movedFrom?: string;
}

function formatDateTime(isoStr: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(isoStr));
}

export default function BookingConfirmDialog({ lesson, movedFrom }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();

  const dismiss = useCallback(() => {
    dialogRef.current?.close();
    router.replace("/dashboard");
  }, [router]);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    function handleCancel(event: Event) {
      event.preventDefault();
      dismiss();
    }
    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
  }, [dismiss]);

  function handleBackdropClick(event: React.MouseEvent<HTMLDialogElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    ) {
      dismiss();
    }
  }

  const lessonIdForView = lesson?.id;
  function viewLesson() {
    if (lessonIdForView === undefined) return;
    router.push(`/dashboard/lessons/${lessonIdForView}`);
  }

  const isRescheduled = movedFrom !== undefined;
  const hasDetails = lesson !== undefined;
  const isConfirmed = lesson?.status === "approved";

  const swimmerNames = lesson
    ? lesson.swimmers.map((swimmer) => `${swimmer.firstName} ${swimmer.lastName}`).join(", ")
    : "";

  // Generic variant — shown when the booking succeeded but the follow-up
  // details fetch failed. The parent needs to see confirmation (otherwise
  // they'll book again) without the specific "Pending/Confirmed" claim we
  // can't substantiate from a failed fetch.
  const eyebrow = hasDetails
    ? isRescheduled
      ? "Rescheduled"
      : isConfirmed
        ? "Confirmed"
        : "Pending"
    : isRescheduled
      ? "Rescheduled"
      : "Request sent";
  const title = hasDetails
    ? isRescheduled
      ? "Your lesson has been moved."
      : isConfirmed
        ? "You are all set!"
        : "Request sent"
    : isRescheduled
      ? "Your reschedule request was sent."
      : "Your booking request was sent.";
  const useSuccessEyebrow = hasDetails ? isConfirmed || isRescheduled : true;

  return (
    <dialog ref={dialogRef} onClick={handleBackdropClick} className={styles.dialog}>
      <div className="flex flex-col gap-5" data-testid="booking-confirm-dialog">
        <div className="flex flex-col gap-1">
          <span
            className={`text-xs font-bold uppercase tracking-widest ${useSuccessEyebrow ? "text-success" : "text-accent-on-section"}`}
          >
            {eyebrow}
          </span>
          <h2 className="text-lg font-semibold text-text-on-section leading-tight">
            {title}
          </h2>
          {hasDetails && !isConfirmed && !isRescheduled && (
            <p className="text-sm text-text-secondary-on-section">
              Jason will confirm your lesson shortly.
            </p>
          )}
          {!hasDetails && (
            <p className="text-sm text-text-secondary-on-section" data-testid="booking-confirm-generic-body">
              We couldn&apos;t load the details, but it&apos;s in Jason&apos;s system. Check
              your Lessons page in a moment to see the latest.
            </p>
          )}
        </div>

        {hasDetails && (
          <div className="flex flex-col gap-3 text-sm border-t border-divider-section pt-4">
            {isRescheduled ? (
              <>
                <div className="flex justify-between gap-4">
                  <span className="text-text-secondary-on-section flex-shrink-0">From</span>
                  <span className="font-semibold text-text-on-section text-right">
                    {formatDateTime(movedFrom)}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-text-secondary-on-section flex-shrink-0">To</span>
                  <span className="font-semibold text-text-on-section text-right">
                    {formatDateTime(lesson.startsAt)}
                  </span>
                </div>
              </>
            ) : (
              <div className="flex justify-between gap-4">
                <span className="text-text-secondary-on-section flex-shrink-0">When</span>
                <span className="font-semibold text-text-on-section text-right">
                  {formatDateTime(lesson.startsAt)}
                </span>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <span className="text-text-secondary-on-section flex-shrink-0">Duration</span>
              <span className="font-semibold text-text-on-section">{lesson.durationMinutes} min</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-text-secondary-on-section flex-shrink-0">Pool</span>
              <span className="font-semibold text-text-on-section text-right">{lesson.locationName}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-text-secondary-on-section flex-shrink-0">Swimmers</span>
              <span className="font-semibold text-text-on-section text-right">{swimmerNames}</span>
            </div>
          </div>
        )}

        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={dismiss}
            className="inline-flex items-center justify-center rounded-button border border-divider-section text-text-on-section font-semibold text-sm px-5 h-11 transition-colors duration-150 hover:border-text-secondary-on-section"
          >
            Done
          </button>
          {hasDetails && (
            <button
              type="button"
              onClick={viewLesson}
              className="inline-flex items-center justify-center rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm px-5 h-11 transition-opacity hover:opacity-90 active:scale-[0.97]"
            >
              View lesson
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
