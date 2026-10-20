"use client";

import { useState, useEffect, useActionState } from "react";

import type { LessonResponse } from "@swim-app/shared";

import {
  approveLessonAction,
  declineLessonAction,
  type CoachLessonActionState,
} from "@/components/CoachLessonRow/actions";

interface Props {
  initialLessons: LessonResponse[];
}

export default function BookingRequestsCard({ initialLessons }: Props) {
  const [lessons, setLessons] = useState(initialLessons);

  if (lessons.length === 0) {
    return (
      <div className="rounded-card border border-border p-5">
        <h3 className="text-base font-semibold text-heading mb-2">Booking requests</h3>
        <p className="text-sm text-text-secondary">No pending requests.</p>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-border p-5">
      <h3 className="text-base font-semibold text-heading mb-4">Booking requests</h3>
      <div className="flex flex-col divide-y divide-border">
        {lessons.map((lesson) => (
          <BookingRequestRow
            key={lesson.id}
            lesson={lesson}
            onDone={(id) => setLessons((prev) => prev.filter((lessonItem) => lessonItem.id !== id))}
          />
        ))}
      </div>
    </div>
  );
}

function BookingRequestRow({
  lesson,
  onDone,
}: {
  lesson: LessonResponse;
  onDone: (id: string) => void;
}) {
  const boundApprove = approveLessonAction.bind(null, lesson.id);
  const [approveState, approveFormAction, isApproving] = useActionState(
    boundApprove,
    { status: "idle" } as CoachLessonActionState,
  );

  const boundDecline = declineLessonAction.bind(null, lesson.id);
  const [declineState, declineFormAction, isDeclining] = useActionState(
    boundDecline,
    { status: "idle" } as CoachLessonActionState,
  );

  useEffect(() => {
    if (approveState.status === "success" || declineState.status === "success") {
      onDone(lesson.id);
    }
  }, [approveState.status, declineState.status, lesson.id, onDone]);

  const isPending = isApproving || isDeclining;
  const errorMessage =
    approveState.status === "error"
      ? approveState.message
      : declineState.status === "error"
        ? declineState.message
        : null;

  const swimmerLabel = lesson.swimmers
    .map((swimmer) => `${swimmer.firstName} ${swimmer.lastName[0]}.`)
    .join(", ");

  const start = new Date(lesson.startsAt);
  const end = new Date(start.getTime() + lesson.durationMinutes * 60 * 1000);

  const laFmt = (date: Date) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);

  const endTimeFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
  }).format(end);

  const timeLabel = `${laFmt(start)} – ${endTimeFmt}`;

  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
      <div>
        <p className="text-sm font-semibold text-text">
          {swimmerLabel}, {lesson.durationMinutes} min
        </p>
        <p className="text-xs text-text-secondary mt-0.5">{timeLabel}</p>
      </div>

      {errorMessage && (
        <p role="alert" className="text-xs text-danger">
          {errorMessage}
        </p>
      )}

      <div className="flex gap-2">
        <form action={approveFormAction} className="flex-1">
          <button
            type="submit"
            disabled={isPending}
            className="w-full rounded-button bg-button-primary-background text-button-primary-text font-semibold text-xs h-9 transition-opacity hover:opacity-90 active:scale-[0.97] disabled:opacity-50"
          >
            {isApproving ? "Approving…" : "Approve"}
          </button>
        </form>
        <form action={declineFormAction} className="flex-1">
          <button
            type="submit"
            disabled={isPending}
            className="w-full rounded-button border border-border text-text-secondary font-semibold text-xs h-9 hover:bg-surface-soft transition-colors duration-150 disabled:opacity-50"
          >
            {isDeclining ? "Declining…" : "Decline"}
          </button>
        </form>
      </div>
    </div>
  );
}
