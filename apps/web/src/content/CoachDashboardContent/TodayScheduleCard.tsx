"use client";

import { useRef, useState, useActionState } from "react";
import Link from "next/link";
import type { CoachScheduleItem } from "@swim-app/shared";

import ConfirmDialog from "@/components/ConfirmDialog";
import LessonStatusBadge from "@/components/LessonStatusBadge";
import {
  getCoachScheduleAction,
  approveLessonAction,
  declineLessonAction,
  type CoachActionState,
} from "./actions";

interface Props {
  initialItems: CoachScheduleItem[];
  today: string; // YYYY-MM-DD (LA timezone)
}

function addDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function dayLabel(viewDate: string, today: string): string {
  if (viewDate === today) return "Today";
  if (viewDate === addDays(today, 1)) return "Tomorrow";
  const [year, month, day] = viewDate.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export default function TodayScheduleCard({ initialItems, today }: Props) {
  const [viewDate, setViewDate] = useState(today);
  const [items, setItems] = useState(initialItems);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navIdRef = useRef(0);

  async function navigate(newDate: string) {
    const navId = ++navIdRef.current;
    setViewDate(newDate);
    setIsLoading(true);
    setError(null);
    try {
      const result = await getCoachScheduleAction(newDate);
      if (navId !== navIdRef.current) return;
      if (!result.ok) {
        setError(result.error);
      } else {
        setItems(result.items);
      }
    } catch {
      if (navId !== navIdRef.current) return;
      setError("Could not load schedule. Please try again.");
    } finally {
      if (navId === navIdRef.current) setIsLoading(false);
    }
  }

  const label = dayLabel(viewDate, today);

  return (
    <div className="rounded-card border border-border p-5 tablet:p-6">
      <div className="flex items-center justify-between mb-4 gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => { void navigate(addDays(viewDate, -1)); }}
            aria-label="Previous day"
            className="inline-flex items-center justify-center w-9 h-9 rounded-button text-text-secondary hover:text-text transition-colors duration-150"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <h2 className="text-base font-semibold text-heading w-[6rem] text-center tabular-nums">
            {label}
          </h2>
          <button
            type="button"
            onClick={() => { void navigate(addDays(viewDate, 1)); }}
            aria-label="Next day"
            className="inline-flex items-center justify-center w-9 h-9 rounded-button text-text-secondary hover:text-text transition-colors duration-150"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M8 5l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <Link
          href={`/coach/schedule?date=${viewDate}`}
          className="text-sm font-semibold text-link hover:text-link-hover transition-colors duration-150"
        >
          Full schedule
        </Link>
      </div>

      {isLoading ? (
        <p className="text-sm text-text-secondary py-4">Loading…</p>
      ) : error !== null ? (
        <div className="py-4 flex flex-col gap-3">
          <p className="text-sm text-danger">{error}</p>
          <button
            type="button"
            onClick={() => { void navigate(viewDate); }}
            className="self-start text-sm font-semibold text-link hover:text-link-hover transition-colors duration-150"
          >
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-text-secondary py-4">No lessons scheduled.</p>
      ) : (
        <div className="divide-y divide-border">
          {items.map((item) => {
            if (item.type === "lesson") {
              return <LessonRow key={item.lesson.id} item={item} />;
            }
            if (item.type === "travel_buffer") {
              return <TravelBufferRow key={`travel_buffer-${item.startsAt}`} item={item} />;
            }
            return <OpenSlotRow key={`open_slot-${item.startsAt}`} item={item} />;
          })}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function formatTime(isoString: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(isoString));
}

const initialActionState: CoachActionState = { status: "idle" };

function LessonRow({ item }: { item: Extract<CoachScheduleItem, { type: "lesson" }> }) {
  const { lesson, locationName } = item;
  const declineDialogRef = useRef<HTMLDialogElement>(null);

  const approveAction = approveLessonAction.bind(null, lesson.id);
  const declineAction = declineLessonAction.bind(null, lesson.id);

  const [approveState, approveFormAction, isApproving] = useActionState<CoachActionState, FormData>(
    approveAction,
    initialActionState,
  );
  const [declineState, declineFormAction, isDeclining] = useActionState<CoachActionState, FormData>(
    declineAction,
    initialActionState,
  );

  const time = formatTime(lesson.startsAt);
  const swimmerNames = lesson.swimmers
    .map((swimmer) =>
      swimmer.clubName ? `${swimmer.firstName} (${swimmer.clubName})` : swimmer.firstName,
    )
    .join(", ");
  const firstSwimmerId = lesson.swimmers[0]?.swimmerId;
  const isPending = lesson.status === "pending";
  const approveFormId = `dashboard-approve-${lesson.id}`;
  const declineFormId = `dashboard-decline-${lesson.id}`;

  return (
    <div className="py-4 flex flex-col gap-1.5">
      <div className="flex items-start gap-4">
        <p className="text-xs font-semibold text-text-secondary tabular-nums tablet:w-[68px] tablet:flex-shrink-0 pt-0.5">
          {time}
        </p>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <p className="text-sm font-semibold text-text">
                {swimmerNames || "No swimmers"}, {lesson.durationMinutes} min
              </p>
              <p className="text-xs text-text-secondary mt-0.5">
                {lesson.type === "private" ? "Private" : "Family"} lesson &middot; {locationName}
              </p>
            </div>
            <LessonStatusBadge status={lesson.status} viewer="coach" />
          </div>

          {isPending && (
            <div className="flex items-center gap-2 mt-2 flex-wrap">
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

          {firstSwimmerId !== undefined && (
            <Link
              href={`/coach/swimmers/${firstSwimmerId}`}
              className="inline-flex items-center mt-1 min-h-[44px] text-sm font-semibold text-link hover:text-link-hover transition-colors duration-150"
            >
              Open swimmer
            </Link>
          )}
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

function TravelBufferRow({ item }: { item: Extract<CoachScheduleItem, { type: "travel_buffer" }> }) {
  const time = formatTime(item.startsAt);
  const durationMs = new Date(item.endsAt).getTime() - new Date(item.startsAt).getTime();
  const durationMin = Math.round(durationMs / 60_000);

  return (
    <div className="py-4 flex flex-col gap-1.5 tablet:flex-row tablet:items-center tablet:gap-4">
      <p className="text-xs font-semibold text-text-secondary tabular-nums tablet:w-[68px] tablet:flex-shrink-0">
        {time}
      </p>
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="flex-shrink-0 text-text-secondary"
          aria-hidden="true"
        >
          <rect x="1" y="3" width="15" height="13" rx="2" />
          <path d="M16 8h4l3 3v5h-7V8z" />
          <circle cx="5.5" cy="18.5" r="2.5" />
          <circle cx="18.5" cy="18.5" r="2.5" />
        </svg>
        <div>
          <p className="text-sm font-semibold text-text">Travel buffer, {durationMin} min</p>
          <p className="text-xs text-text-secondary mt-0.5">Blocked automatically. Not bookable.</p>
        </div>
      </div>
    </div>
  );
}

function OpenSlotRow({ item }: { item: Extract<CoachScheduleItem, { type: "open_slot" }> }) {
  const time = formatTime(item.startsAt);
  const until = formatTime(item.endsAt);

  return (
    <div className="py-4 flex flex-col gap-1.5 tablet:flex-row tablet:items-center tablet:gap-4">
      <p className="text-xs font-semibold text-text-secondary tabular-nums tablet:w-[68px] tablet:flex-shrink-0">
        {time}
      </p>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text-secondary">Open until {until}</p>
      </div>
    </div>
  );
}
