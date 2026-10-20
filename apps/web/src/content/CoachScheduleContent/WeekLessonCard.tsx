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

export default function WeekLessonCard({ item }: Props) {
  const { lesson, locationName } = item;
  const declineDialogRef = useRef<HTMLDialogElement>(null);

  const approveAction = approveLessonAction.bind(null, lesson.id);
  const declineAction = declineLessonAction.bind(null, lesson.id);

  const [approveState, approveFormAction, isApproving] = useActionState<CoachLessonActionState, FormData>(
    approveAction,
    initialState,
  );
  const [declineState, declineFormAction, isDeclining] = useActionState<CoachLessonActionState, FormData>(
    declineAction,
    initialState,
  );

  const startLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(lesson.startsAt));

  const swimmerNames = lesson.swimmers.map((s) => s.firstName).join(", ");

  const clubNames = [
    ...new Set(
      lesson.swimmers
        .map((s) => s.clubName)
        .filter((name): name is string => name !== null),
    ),
  ];

  const isPending = lesson.status === "pending";
  const approveFormId = `week-approve-${lesson.id}`;
  const declineFormId = `week-decline-${lesson.id}`;

  return (
    <div className="rounded-card border border-border bg-background p-2 flex flex-col gap-1.5 text-xs">
      <div className="flex items-start justify-between gap-1">
        <span className="font-semibold tabular-nums text-text-secondary shrink-0">{startLabel}</span>
        <LessonStatusBadge status={lesson.status} viewer="coach" />
      </div>

      <Link
        href={`/coach/lessons/${lesson.id}`}
        className="block hover:underline focus:outline focus:outline-2 focus:outline-focus-ring rounded-sm"
      >
        <p className="font-semibold text-text truncate">{swimmerNames || "No swimmers"}</p>
        {clubNames.length > 0 && (
          <p className="text-text-secondary truncate">{clubNames.join(" · ")}</p>
        )}
        <p className="text-text-secondary truncate">{locationName}</p>
      </Link>

      {isPending && (
        <div className="flex flex-col gap-1 pt-1 border-t border-border">
          <form id={approveFormId} action={approveFormAction} />
          <button
            type="submit"
            form={approveFormId}
            disabled={isApproving || isDeclining}
            className="inline-flex items-center justify-center rounded-button bg-button-primary-background text-button-primary-text font-semibold text-xs h-9 w-full transition-opacity disabled:opacity-60 hover:opacity-90 active:scale-[0.97]"
          >
            {isApproving ? "Approving…" : "Approve"}
          </button>
          <button
            type="button"
            disabled={isApproving || isDeclining}
            onClick={() => declineDialogRef.current?.showModal()}
            className="inline-flex items-center justify-center rounded-button border border-border text-text-secondary font-semibold text-xs h-9 w-full transition-colors disabled:opacity-60 hover:border-text-secondary"
          >
            Decline
          </button>
          {approveState.status === "error" && (
            <p className="text-danger">{approveState.message}</p>
          )}
        </div>
      )}

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
          <span className="text-xs font-semibold text-text-secondary-on-section">Reason (optional)</span>
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
