"use client";

import { useState, useEffect, useActionState, useMemo } from "react";

import type { LessonResponse } from "@swim-app/shared";

import {
  approveBatchPendingAction,
  approveLessonAction,
  declineLessonAction,
  type CoachLessonActionState,
} from "@/components/CoachLessonRow/actions";
import { buildBatchGroupSummary } from "./batchGroupSummary";

interface Props {
  initialLessons: LessonResponse[];
}

type Group =
  | { kind: "solo"; lesson: LessonResponse }
  | { kind: "batch"; batchId: string; batchMode: "manual" | "weekly"; lessons: LessonResponse[] };

export default function BookingRequestsCard({ initialLessons }: Props) {
  const [lessons, setLessons] = useState(initialLessons);

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

function buildGroups(lessons: LessonResponse[]): Group[] {
  const soloList: LessonResponse[] = [];
  const batchMap = new Map<string, { mode: "manual" | "weekly"; lessons: LessonResponse[] }>();
  for (const lesson of lessons) {
    const batchId = lesson.batchId;
    const mode = lesson.batchMode;
    if (!batchId || !mode) {
      soloList.push(lesson);
      continue;
    }
    const existing = batchMap.get(batchId);
    if (existing) {
      existing.lessons.push(lesson);
    } else {
      batchMap.set(batchId, { mode, lessons: [lesson] });
    }
  }
  const groups: Group[] = [];
  for (const lesson of soloList) {
    groups.push({ kind: "solo", lesson });
  }
  for (const [batchId, entry] of batchMap) {
    if (entry.lessons.length === 1) {
      groups.push({ kind: "solo", lesson: entry.lessons[0]! });
    } else {
      groups.push({
        kind: "batch",
        batchId,
        batchMode: entry.mode,
        lessons: entry.lessons,
      });
    }
  }
  // Sort by the earliest pending startsAt so the most imminent group floats up.
  groups.sort((a, b) => firstStartsAt(a).localeCompare(firstStartsAt(b)));
  return groups;
}

function firstStartsAt(group: Group): string {
  if (group.kind === "solo") return group.lesson.startsAt;
  return [...group.lessons].sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0]!.startsAt;
}

function BatchGroup({
  batchId,
  batchMode,
  lessons,
  onLessonDone,
  onBatchApproved,
}: {
  batchId: string;
  batchMode: "manual" | "weekly";
  lessons: LessonResponse[];
  onLessonDone: (id: string) => void;
  onBatchApproved: (ids: Set<string>) => void;
}) {
  const [expanded, setExpanded] = useState(false);

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

  useEffect(() => {
    if (approveState.status === "success") {
      onBatchApproved(new Set(sorted.map((lesson) => lesson.id)));
    }
  }, [approveState.status, sorted, onBatchApproved]);

  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
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
            disabled={isApproving}
            className="w-full rounded-button bg-button-primary-background text-button-primary-text font-semibold text-xs h-9 transition-opacity hover:opacity-90 active:scale-[0.97] disabled:opacity-50"
          >
            {isApproving ? "Approving…" : "Approve all"}
          </button>
        </form>
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          className="flex-1 rounded-button border border-border text-text-secondary font-semibold text-xs h-9 hover:bg-surface-soft transition-colors duration-150"
        >
          {expanded ? "Hide lessons" : `Show ${sorted.length} lessons`}
        </button>
      </div>

      {expanded && (
        <div className="flex flex-col divide-y divide-border border-t border-border pt-2">
          {sorted.map((lesson) => (
            <BookingRequestRow
              key={lesson.id}
              lesson={lesson}
              onDone={onLessonDone}
              compact
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BookingRequestRow({
  lesson,
  onDone,
  compact = false,
}: {
  lesson: LessonResponse;
  onDone: (id: string) => void;
  compact?: boolean;
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
    <div className={`flex flex-col gap-3 py-4 first:pt-0 last:pb-0 ${compact ? "" : ""}`}>
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
