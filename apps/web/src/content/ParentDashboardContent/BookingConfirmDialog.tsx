"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { UpcomingLesson } from "@swim-app/shared";

import styles from "./BookingConfirmDialog.module.css";

interface Props {
  lesson: UpcomingLesson;
}

export default function BookingConfirmDialog({ lesson }: Props) {
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

  function viewLesson() {
    router.push(`/dashboard/lessons/${lesson.id}`);
  }

  const isConfirmed = lesson.status === "approved";

  const dateTime = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(lesson.startsAt));

  const swimmerNames = lesson.swimmers
    .map((swimmer) => `${swimmer.firstName} ${swimmer.lastName}`)
    .join(", ");

  return (
    <dialog ref={dialogRef} onClick={handleBackdropClick} className={styles.dialog}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <span
            className={`text-xs font-bold uppercase tracking-widest ${isConfirmed ? "text-success" : "text-accent-on-section"}`}
          >
            {isConfirmed ? "Confirmed" : "Pending"}
          </span>
          <h2 className="text-lg font-semibold text-text-on-section leading-tight">
            {isConfirmed ? "You are all set!" : "Request sent"}
          </h2>
          {!isConfirmed && (
            <p className="text-sm text-text-secondary-on-section">
              Jason will confirm your lesson shortly.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3 text-sm border-t border-divider-section pt-4">
          <div className="flex justify-between gap-4">
            <span className="text-text-secondary-on-section flex-shrink-0">When</span>
            <span className="font-semibold text-text-on-section text-right">{dateTime}</span>
          </div>
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

        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={dismiss}
            className="inline-flex items-center justify-center rounded-button border border-divider-section text-text-on-section font-semibold text-sm px-5 h-11 transition-colors duration-150 hover:border-text-secondary-on-section"
          >
            Done
          </button>
          <button
            type="button"
            onClick={viewLesson}
            className="inline-flex items-center justify-center rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm px-5 h-11 transition-opacity hover:opacity-90 active:scale-[0.97]"
          >
            View lesson
          </button>
        </div>
      </div>
    </dialog>
  );
}
