"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { CoachScheduleLessonItem } from "@swim-app/shared";
import {
  approveLessonAction,
  declineLessonAction,
  type CoachLessonActionState,
} from "@/components/CoachLessonRow/actions";

interface Props {
  item: CoachScheduleLessonItem;
  now: number | null;
}

const initialState: CoachLessonActionState = { status: "idle" };

function formatTime(isoString: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(isoString));
}

export default function DashboardLessonRow({ item, now }: Props) {
  const { lesson, locationName } = item;

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

  const startsAtMs = new Date(lesson.startsAt).getTime();
  const endsAtMs = startsAtMs + lesson.durationMinutes * 60_000;
  const isInProgress = now !== null && now >= startsAtMs && now < endsAtMs + 15 * 60_000;
  const isPending = lesson.status === "pending";

  const startLabel = formatTime(lesson.startsAt);
  const swimmerNames =
    lesson.swimmers.map((swimmer) => swimmer.firstName).join(", ") || "No swimmers";

  const approveFormId = `dash-approve-${lesson.id}`;
  const declineFormId = `dash-decline-${lesson.id}`;

  return (
    <div className={isInProgress ? "bg-accent/5" : undefined}>
      <Link
        href={`/coach/lessons/${lesson.id}`}
        aria-label="Open lesson"
        className="flex items-center gap-3 py-3 min-h-[44px] hover:bg-surface-soft transition-colors duration-150"
      >
        <span
          className={`w-[68px] flex-shrink-0 text-sm font-semibold tabular-nums whitespace-nowrap ${
            isInProgress ? "text-accent" : "text-text"
          }`}
        >
          {startLabel}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-text truncate">{swimmerNames}</p>
          <p className="text-xs text-text-secondary mt-0.5 truncate">{locationName}</p>
        </div>
        {isInProgress && (
          <span className="text-xs font-semibold text-accent bg-accent/10 px-2 py-0.5 rounded-full flex-shrink-0">
            Now
          </span>
        )}
      </Link>

      {isInProgress && lesson.swimmers.length > 0 && (
        <div className="flex flex-wrap gap-x-4 pb-2">
          {lesson.swimmers.map((swimmer) => (
            <Link
              key={swimmer.swimmerId}
              href={`/coach/swimmers/${swimmer.swimmerId}/evaluate`}
              aria-label={`Evaluate ${swimmer.firstName}`}
              className="inline-flex items-center min-h-[44px] text-sm font-semibold text-link hover:text-link-hover transition-colors duration-150"
            >
              Evaluate {swimmer.firstName} &rarr;
            </Link>
          ))}
        </div>
      )}

      {isPending && (
        <div className="flex items-center gap-2 pb-3 flex-wrap">
          <form id={approveFormId} action={approveFormAction} />
          <form id={declineFormId} action={declineFormAction} />
          <button
            type="submit"
            form={approveFormId}
            disabled={isApproving || isDeclining}
            className="inline-flex items-center justify-center rounded-button bg-button-primary-background text-button-primary-text font-semibold text-sm px-4 h-9 transition-opacity disabled:opacity-60 hover:opacity-90 active:scale-[0.97]"
          >
            {isApproving ? "Approving…" : "Approve"}
          </button>
          <button
            type="submit"
            form={declineFormId}
            disabled={isApproving || isDeclining}
            className="inline-flex items-center justify-center rounded-button border border-border text-text-secondary font-semibold text-sm px-4 h-9 transition-colors disabled:opacity-60 hover:border-text-secondary"
          >
            {isDeclining ? "Declining…" : "Decline"}
          </button>
          {approveState.status === "error" && (
            <p className="text-sm text-danger w-full">{approveState.message}</p>
          )}
          {declineState.status === "error" && (
            <p className="text-sm text-danger w-full">{declineState.message}</p>
          )}
        </div>
      )}
    </div>
  );
}
