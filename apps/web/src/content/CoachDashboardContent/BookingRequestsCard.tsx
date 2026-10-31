"use client";

import { useState, useEffect, useActionState, useMemo, useId, useRef } from "react";
import { useSearchParams } from "next/navigation";

import type { LessonResponse } from "@swim-app/shared";

import {
  approveBatchPendingAction,
  approveLessonAction,
  declineLessonAction,
  type CoachLessonActionState,
} from "@/components/CoachLessonRow/actions";
import { buildBatchGroupSummary } from "./batchGroupSummary";
import { buildGroups } from "./batchGroups";
import styles from "./BookingRequestsCard.module.css";

// Approve-all exit animation duration. The group fades + settles for this
// long before the parent is told the batch is approved. Visual only; the
// server call succeeds first, so this is purely for the on-screen settle.
const BATCH_EXIT_MS = 220;

interface Props {
  initialLessons: LessonResponse[];
}

export default function BookingRequestsCard({ initialLessons }: Props) {
  const [lessons, setLessons] = useState(initialLessons);
  // `?batch=<id>` deep-links from a coach notification. The matching
  // BatchGroup auto-expands and scrolls itself into view on mount. The
  // param stays on the URL so a browser back/forward returns to the
  // expanded state.
  const searchParams = useSearchParams();
  const focusBatchId = searchParams?.get("batch") ?? null;

  const groups = useMemo(() => buildGroups(lessons), [lessons]);

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
        {groups.map((group) =>
          group.kind === "solo" ? (
            <BookingRequestRow
              key={group.lesson.id}
              lesson={group.lesson}
              onDone={(id) =>
                setLessons((prev) => prev.filter((lesson) => lesson.id !== id))
              }
            />
          ) : (
            <BatchGroup
              key={group.batchId}
              batchId={group.batchId}
              batchMode={group.batchMode}
              lessons={group.lessons}
              initiallyExpanded={group.batchId === focusBatchId}
              scrollIntoViewOnMount={group.batchId === focusBatchId}
              onLessonDone={(id) =>
                setLessons((prev) => prev.filter((lesson) => lesson.id !== id))
              }
              onBatchApproved={(ids) =>
                setLessons((prev) => prev.filter((lesson) => !ids.has(lesson.id)))
              }
            />
          ),
        )}
      </div>
    </div>
  );
}

function BatchGroup({
  batchId,
  batchMode,
  lessons,
  initiallyExpanded = false,
  scrollIntoViewOnMount = false,
  onLessonDone,
  onBatchApproved,
}: {
  batchId: string;
  batchMode: "manual" | "weekly";
  lessons: LessonResponse[];
  initiallyExpanded?: boolean;
  scrollIntoViewOnMount?: boolean;
  onLessonDone: (id: string) => void;
  onBatchApproved: (ids: Set<string>) => void;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [exiting, setExiting] = useState(false);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // Scroll the matching batch (notification deep-link) into view on
  // mount. One-shot: reruns of this effect are not meaningful because
  // the prop is only true for the batch currently targeted by `?batch=`.
  useEffect(() => {
    if (!scrollIntoViewOnMount) return;
    containerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [scrollIntoViewOnMount]);

  const sorted = useMemo(
    () => [...lessons].sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [lessons],
  );

  const householdLabel = useMemo(() => {
    const names = new Set<string>();
    for (const lesson of sorted) {
      for (const swimmer of lesson.swimmers) {
        names.add(`${swimmer.firstName} ${swimmer.lastName[0] ?? ""}.`.trim());
      }
    }
    return [...names].join(", ") || "Household";
  }, [sorted]);

  const summary = useMemo(
    () => buildBatchGroupSummary({ lessons: sorted, mode: batchMode }),
    [sorted, batchMode],
  );

  const boundApproveBatch = approveBatchPendingAction.bind(null, batchId);
  const [approveState, approveFormAction, isApproving] = useActionState(
    boundApproveBatch,
    { status: "idle" } as CoachLessonActionState,
  );

  // On success: start the exit animation, then tell the parent to drop the
  // batch from state. Timer is tracked in a ref so unmount cancels it.
  useEffect(() => {
    if (approveState.status !== "success") return;
    setExiting(true);
    const ids = new Set(sorted.map((lesson) => lesson.id));
    exitTimerRef.current = setTimeout(() => {
      onBatchApproved(ids);
    }, BATCH_EXIT_MS);
    return () => {
      if (exitTimerRef.current !== null) clearTimeout(exitTimerRef.current);
    };
  }, [approveState.status, sorted, onBatchApproved]);

  return (
    <div
      ref={containerRef}
      className={`${styles.batchGroup} flex flex-col gap-3 py-4 first:pt-0 last:pb-0`}
      data-exiting={exiting ? "true" : undefined}
    >
      <div>
        <p className="text-sm font-semibold text-text">{householdLabel}</p>
        <p className="text-xs text-text-secondary mt-0.5">{summary}</p>
      </div>

      {approveState.status === "error" && (
        <p role="alert" className="text-xs text-danger">
          {approveState.message}
        </p>
      )}

      <div className="flex gap-2">
        <form action={approveFormAction} className="flex-1">
          <button
            type="submit"
            disabled={isApproving || exiting}
            className="w-full rounded-button bg-button-primary-background text-button-primary-text font-semibold text-xs h-9 transition-opacity hover:opacity-90 active:scale-[0.97] disabled:opacity-50"
          >
            {isApproving ? "Approving…" : "Approve all"}
          </button>
        </form>
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          aria-controls={panelId}
          className="flex-1 rounded-button border border-border text-text-secondary font-semibold text-xs h-9 hover:bg-surface-soft transition-colors duration-150"
        >
          {expanded ? "Hide lessons" : `Show ${sorted.length} lessons`}
        </button>
      </div>

      {/* <details> drives the collapse via the global details::details-content
          CSS. The visible toggle control is the button above; the native
          <summary> is kept for valid markup but hidden. */}
      <details id={panelId} open={expanded}>
        <summary className={styles.hiddenSummary} aria-hidden="true" tabIndex={-1}>
          Lessons in this booking
        </summary>
        <div className="flex flex-col divide-y divide-border border-t border-border pt-2">
          {sorted.map((lesson) => (
            <BookingRequestRow
              key={lesson.id}
              lesson={lesson}
              onDone={onLessonDone}
            />
          ))}
        </div>
      </details>
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
    .map((swimmer) => `${swimmer.firstName} ${swimmer.lastName[0] ?? ""}.`.trim())
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

  const timeLabel = `${laFmt(start)} - ${endTimeFmt}`;

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
