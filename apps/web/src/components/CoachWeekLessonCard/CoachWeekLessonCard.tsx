"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import type { CoachLessonSwimmer, CoachScheduleLessonItem } from "@swim-app/shared";

interface Props {
  item: CoachScheduleLessonItem;
}

// Compact lesson card for the tablet+ week-view day columns. Each column is
// narrow (roughly 90–160 CSS px), so the card prefers wrapping over truncation.
// The whole card is one link via an absolutely-positioned overlay; Evaluate is
// a sibling of that overlay (not a descendant), so activating it never fires
// the lesson link.
export default function CoachWeekLessonCard({ item }: Props) {
  const { lesson, locationName } = item;

  const timeSpan = formatTimeSpan(lesson.startsAt, lesson.durationMinutes);
  const durationLabel = `${lesson.durationMinutes} min`;
  const swimmerNames =
    lesson.swimmers.map((swimmer) => swimmer.firstName).join(", ") || "No swimmers";
  const isPending = lesson.status === "pending";
  const isCanceled = lesson.status === "canceled" || lesson.status === "declined";
  const hasStarted = Date.now() >= new Date(lesson.startsAt).getTime();
  const showEvaluate = hasStarted && !isCanceled && lesson.swimmers.length > 0;

  const ariaLabel = `${swimmerNames}, ${timeSpan}, ${durationLabel} at ${locationName}. Open lesson.`;

  return (
    <div className="group relative flex flex-col rounded-card border border-border bg-background transition-colors duration-150 ease-out hover:border-accent/60">
      <Link
        href={`/coach/lessons/${lesson.id}`}
        aria-label={ariaLabel}
        className="absolute inset-0 z-0 rounded-card outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      />

      <div className="relative z-[1] pointer-events-none flex flex-col gap-1 px-2.5 py-2.5">
        <p className="text-xs font-semibold text-text tabular-nums leading-snug break-words">
          {timeSpan}
        </p>
        <p className="text-[11px] text-text-secondary tabular-nums leading-snug">
          {durationLabel}
        </p>
        {isPending && (
          <span className="inline-flex self-start items-center h-[18px] px-1.5 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-accent/10 text-accent border border-accent/25">
            Needs approval
          </span>
        )}
        <p className="text-sm font-semibold text-text leading-snug break-words">
          {swimmerNames}
        </p>
        <p className="text-xs text-text-secondary leading-snug break-words">{locationName}</p>
      </div>

      {showEvaluate && (
        <div className="relative z-10 border-t border-border/70 px-2.5 py-1.5">
          <EvaluateControl swimmers={lesson.swimmers} />
        </div>
      )}
    </div>
  );
}

function EvaluateControl({ swimmers }: { swimmers: CoachLessonSwimmer[] }) {
  if (swimmers.length === 1) {
    const only = swimmers[0];
    if (!only) return null;
    return (
      <Link
        href={`/coach/swimmers/${only.swimmerId}/evaluate`}
        className="inline-flex items-center min-h-[28px] text-xs font-semibold text-link hover:text-link-hover transition-colors duration-150"
      >
        Evaluate {only.firstName}
      </Link>
    );
  }

  return <EvaluateMenu swimmers={swimmers} />;
}

function EvaluateMenu({ swimmers }: { swimmers: CoachLessonSwimmer[] }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointer(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex items-center gap-1 min-h-[28px] text-xs font-semibold text-link hover:text-link-hover transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-button"
      >
        Evaluate
        <ChevronDownIcon open={open} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Pick a swimmer to evaluate"
          className="absolute left-0 top-full mt-1 min-w-[160px] rounded-card border border-border bg-background py-1 z-30"
        >
          {swimmers.map((swimmer) => (
            <Link
              key={swimmer.swimmerId}
              role="menuitem"
              href={`/coach/swimmers/${swimmer.swimmerId}/evaluate`}
              onClick={() => setOpen(false)}
              className="block px-3 py-1.5 text-xs font-semibold text-text hover:bg-surface-soft transition-colors duration-100 outline-none focus-visible:bg-surface-soft"
            >
              Evaluate {swimmer.firstName}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function ChevronDownIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
      className={`transition-transform duration-150 ease-out ${open ? "rotate-180" : ""} motion-reduce:transition-none`}
    >
      <path
        d="M2 4l3 3 3-3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const LA_TIMEZONE = "America/Los_Angeles";
const TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TIMEZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function formatTimeSpan(startIso: string, durationMinutes: number): string {
  const start = new Date(startIso);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const startLabel = TIME_FORMATTER.format(start);
  const endLabel = TIME_FORMATTER.format(end);
  const startPeriod = startLabel.slice(-2);
  const endPeriod = endLabel.slice(-2);
  return startPeriod === endPeriod
    ? `${startLabel.slice(0, -3)} to ${endLabel}`
    : `${startLabel} to ${endLabel}`;
}
