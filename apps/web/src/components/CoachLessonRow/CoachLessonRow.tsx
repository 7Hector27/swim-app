"use client";

import { useRef, useActionState } from "react";
import Link from "next/link";
import type { CoachScheduleLessonItem } from "@swim-app/shared";
import ConfirmDialog from "@/components/ConfirmDialog";
import LessonStatusBadge from "@/components/LessonStatusBadge";
import {
  approveLessonAction,
  declineLessonAction,
  type CoachLessonActionState,
} from "./actions";

interface Props {
  item: CoachScheduleLessonItem;
}

const initialState: CoachLessonActionState = { status: "idle" };

export default function CoachLessonRow({ item }: Props) {
  const { lesson, locationName } = item;
  const declineDialogRef = useRef<HTMLDialogElement>(null);

  const approveAction = approveLessonAction.bind(null, lesson.id);
  const declineAction = declineLessonAction.bind(null, lesson.id);

  const [approveState, approveFormAction, isApproving] = useActionState<
    CoachLessonActionState,
    FormData
  >(approveAction, initialState);
  const [declineState, declineFormAction, isDeclining] = useActionState<
    CoachLessonActionState,
    FormData
  >(declineAction, initialState);

  const startLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(lesson.startsAt));

  const swimmerNames =
    lesson.swimmers.map((swimmer) => swimmer.firstName).join(", ") || "No swimmers";
  const clubNames = [
    ...new Set(
      lesson.swimmers
        .map((swimmer) => swimmer.clubName)
        .filter((name): name is string => name !== null),
    ),
  ];
  const lessonTypeLabel = lesson.type === "private" ? "Private" : "Family";
  const isPending = lesson.status === "pending";
  const isCanceled = lesson.status === "canceled" || lesson.status === "declined";
  const showEvaluate = !isCanceled && lesson.swimmers.length > 0;
  const approveFormId = `approve-${lesson.id}`;
  const declineFormId = `decline-${lesson.id}`;

  return (
    <div className="rounded-card border border-border overflow-hidden">
      <div className="flex items-stretch">
        {/* Time slab — w-[92px] fits "12:45 PM" at text-sm without wrapping */}
        <div className="bg-surface-soft border-r border-border flex flex-col items-center justify-center w-[92px] flex-shrink-0 px-2 py-5 gap-1">
          <p className="text-sm font-semibold text-text tabular-nums text-center leading-tight whitespace-nowrap">
            {startLabel}
          </p>
          <p className="text-xs text-text-secondary text-center leading-tight">
            {lesson.durationMinutes} min
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 px-4 py-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold text-text truncate">{swimmerNames}</p>
              {clubNames.length > 0 && (
                <p className="text-xs text-text-secondary mt-0.5 truncate">
                  {clubNames.join(" · ")}
                </p>
              )}
              <p className="text-xs text-text-secondary mt-0.5 truncate">
                {locationName} &middot; {lessonTypeLabel}
              </p>
            </div>
            <LessonStatusBadge status={lesson.status} viewer="coach" />
          </div>

          {isPending && (
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <form id={approveFormId} action={approveFormAction} />
              <button
                type="submit"
                form={approveFormId}
                disabled={isApproving || isDeclining}
                className="inline-flex items-center justify-center rounded-button bg-button-primary-background text-button-primary-text font-semibold text-sm px-4 h-9 transition-opacity disabled:opacity-60 hover:opacity-90 active:scale-[0.97]"
              >
                {isApproving ? "Approving…" : "Approve"}
              </button>
              <button
                type="button"
                disabled={isApproving || isDeclining}
                onClick={() => declineDialogRef.current?.showModal()}
                className="inline-flex items-center justify-center rounded-button border border-border text-text-secondary font-semibold text-sm px-4 h-9 transition-colors disabled:opacity-60 hover:border-text-secondary"
              >
                Decline
              </button>
              {approveState.status === "error" && (
                <p className="text-sm text-danger w-full">{approveState.message}</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Action rail — links sized to 44px touch targets */}
      <div className="border-t border-border px-4 flex items-center justify-between gap-3">
        <div className="flex flex-wrap gap-x-4 min-w-0">
          {showEvaluate ? (
            lesson.swimmers.map((swimmer) => (
              <Link
                key={swimmer.swimmerId}
                href={`/coach/swimmers/${swimmer.swimmerId}/evaluate`}
                aria-label={`Evaluate ${swimmer.firstName}`}
                className="inline-flex items-center min-h-[44px] text-sm font-semibold text-link hover:text-link-hover transition-colors duration-150"
              >
                Evaluate {swimmer.firstName} &rarr;
              </Link>
            ))
          ) : (
            <span className="inline-flex items-center min-h-[44px] text-sm text-text-secondary italic">
              {lesson.status === "canceled" ? "Canceled" : "Declined"}
            </span>
          )}
        </div>
        <Link
          href={`/coach/lessons/${lesson.id}`}
          aria-label="Open lesson"
          className="inline-flex items-center min-h-[44px] text-sm font-semibold text-text-secondary hover:text-text transition-colors duration-150 flex-shrink-0"
        >
          Open &rarr;
        </Link>
      </div>

      <form id={declineFormId} action={declineFormAction} />
      <ConfirmDialog
        dialogRef={declineDialogRef}
        title="Decline this lesson?"
        description="The family will be notified. You can optionally leave a reason."
        formId={declineFormId}
        confirmLabel="Decline"
        confirmDanger
        cancelLabel="Keep it"
        isPending={isDeclining}
        {...(declineState.status === "error" ? { errorMessage: declineState.message } : {})}
        onCancel={() => declineDialogRef.current?.close()}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-text-secondary-on-section">
            Reason (optional)
          </span>
          <textarea
            name="reason"
            rows={3}
            placeholder="e.g. scheduling conflict"
            className="rounded-card border border-divider-section bg-card text-text-on-section text-sm px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-focus-ring placeholder:text-text-secondary-on-section"
          />
        </label>
      </ConfirmDialog>
    </div>
  );
}
