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

  const swimmerNames = lesson.swimmers.map((swimmer) => swimmer.firstName).join(", ");

  const clubNames = [
    ...new Set(
      lesson.swimmers
        .map((swimmer) => swimmer.clubName)
        .filter((name): name is string => name !== null),
    ),
  ];

  const isPending = lesson.status === "pending";
  const isHiddenFromEvaluate = lesson.status === "canceled" || lesson.status === "declined";
  const approveFormId = `approve-${lesson.id}`;
  const declineFormId = `decline-${lesson.id}`;

  return (
    <div className="flex items-start gap-4 px-5 py-4">
      <div className="flex-shrink-0 w-[72px] pt-0.5">
        <p className="text-xs font-semibold text-text-secondary tabular-nums">{startLabel}</p>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-3 flex-wrap justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text">
              {swimmerNames || "No swimmers"}, {lesson.durationMinutes} min
            </p>
            {clubNames.length > 0 && (
              <p className="text-xs text-text-secondary mt-0.5">{clubNames.join(" · ")}</p>
            )}
            <p className="text-xs text-text-secondary mt-0.5">
              {locationName} &middot; {lesson.type === "private" ? "Private" : "Family"} lesson
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
              className="inline-flex items-center justify-center rounded-button bg-button-primary-background text-button-primary-text font-semibold text-xs px-4 h-9 transition-opacity disabled:opacity-60 hover:opacity-90 active:scale-[0.97]"
            >
              {isApproving ? "Approving…" : "Approve"}
            </button>
            <button
              type="button"
              disabled={isApproving || isDeclining}
              onClick={() => declineDialogRef.current?.showModal()}
              className="inline-flex items-center justify-center rounded-button border border-border text-text-secondary font-semibold text-xs px-4 h-9 transition-colors disabled:opacity-60 hover:border-text-secondary"
            >
              Decline
            </button>
            {approveState.status === "error" && (
              <p className="text-xs text-danger w-full">{approveState.message}</p>
            )}
          </div>
        )}

        {!isHiddenFromEvaluate && lesson.swimmers.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {lesson.swimmers.map((swimmer) => (
              <Link
                key={swimmer.swimmerId}
                href={`/coach/swimmers/${swimmer.swimmerId}/evaluate`}
                className="inline-flex items-center justify-center rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm px-5 min-h-[44px] transition-opacity hover:opacity-80 active:scale-[0.97]"
              >
                Evaluate {swimmer.firstName}
              </Link>
            ))}
          </div>
        )}

        <div className="mt-2">
          <Link
            href={`/coach/lessons/${lesson.id}`}
            className="text-xs font-semibold text-link hover:text-link-hover transition-colors duration-150"
          >
            View details
          </Link>
        </div>
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
