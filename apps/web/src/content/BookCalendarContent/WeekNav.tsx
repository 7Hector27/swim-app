"use client";

// Week navigation for the booking calendar. Three ways to move:
//
// 1. Labeled Previous / Next buttons (the primary control — keyboard
//    reachable, with a clear text label at tablet widths).
// 2. Horizontal swipe on the center label (phone-first). The gesture only
//    engages after a clearly horizontal drag, so a vertical finger drag
//    scrolls the page normally and never flips the week. Momentum-based
//    like Sonner's dismiss: a quick flick commits even if the finger
//    doesn't travel far.
// 3. A dot row that marks every bookable week; tapping a dot jumps to
//    that week. Dots can carry per-week badges (open-slots, parent's
//    picks) when the caller passes them.
//
// When focus lands anywhere inside the group, left and right arrow keys
// move the week. The current week range is announced to screen readers
// on every change via an aria-live region.
//
// Edge resistance at prev / next boundaries (0.3x the pointer delta) so
// the drag doesn't feel like it broke when the user is already on the
// first or last bookable week. Reduced motion skips the drag physics
// entirely — the swap is instant.

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { addDaysToDateStr, formatWeekLabel, getMondayOfWeek } from "./helpers";

export interface WeekNavDot {
  mondayStr: string;
  hasOpen?: boolean;
  pickCount?: number;
}

interface Props {
  mondayStr: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  todayStr: string;
  disablePrev?: boolean;
  disableNext?: boolean;
  dots?: {
    weeks: WeekNavDot[];
    onJump: (monday: string) => void;
  };
}

// Pointer-distance (CSS px) and velocity (px/ms) thresholds. Match
// Sonner-style flick detection so a quick swipe commits even if the finger
// doesn't travel far.
const COMMIT_DISTANCE_PX = 60;
const COMMIT_VELOCITY_PX_PER_MS = 0.11;
// Resistance factor when dragging past the edge of the booking window. The
// label still moves so the gesture feels alive, but at 30%.
const EDGE_RESISTANCE = 0.3;
// Horizontal-angle gate: a drag has to move at least this many pixels
// horizontally AND be clearly more horizontal than vertical before the
// swipe engages. Prevents vertical page scrolls from flipping the week.
const HORIZONTAL_ENGAGE_PX = 10;
const HORIZONTAL_ANGLE_RATIO = 1.5;

function formatShortDate(dateStr: string): string {
  const date = new Date(`${dateStr}T12:00:00`);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function relativeWeekLabel(mondayStr: string, todayMonday: string): string {
  if (mondayStr === todayMonday) return "This week";
  const target = new Date(`${mondayStr}T12:00:00`).getTime();
  const base = new Date(`${todayMonday}T12:00:00`).getTime();
  const diffWeeks = Math.round((target - base) / (1000 * 60 * 60 * 24 * 7));
  if (diffWeeks === 1) return "Next week";
  if (diffWeeks === -1) return "Last week";
  if (diffWeeks > 0) return `In ${diffWeeks} weeks`;
  return `${Math.abs(diffWeeks)} weeks ago`;
}

export default function WeekNav({
  mondayStr,
  onPrev,
  onNext,
  onToday,
  todayStr,
  disablePrev,
  disableNext = false,
  dots,
}: Props) {
  const todayMonday = getMondayOfWeek(todayStr);
  const defaultDisablePrev = mondayStr === todayMonday;
  const prevDisabled = disablePrev ?? defaultDisablePrev;
  const nextDisabled = disableNext;
  const isCurrentWeek = mondayStr === todayMonday;

  const sundayStr = addDaysToDateStr(mondayStr, 6);
  const prevMondayStr = addDaysToDateStr(mondayStr, -7);
  const nextMondayStr = addDaysToDateStr(mondayStr, 7);

  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(query.matches);
    const handler = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    query.addEventListener("change", handler);
    return () => query.removeEventListener("change", handler);
  }, []);

  const [dragDelta, setDragDelta] = useState(0);
  type DragStart = { x: number; y: number; time: number; engaged: boolean; pointerId: number };
  const dragStart = useRef<DragStart | null>(null);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (reducedMotion) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    dragStart.current = {
      x: event.clientX,
      y: event.clientY,
      time: event.timeStamp,
      engaged: false,
      pointerId: event.pointerId,
    };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const start = dragStart.current;
    if (start === null) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;

    if (!start.engaged) {
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      // Give up on this drag once it's clearly vertical: let the page scroll.
      if (absDy > HORIZONTAL_ENGAGE_PX && absDy >= absDx) {
        dragStart.current = null;
        return;
      }
      // Engage only when the drag is clearly horizontal.
      if (absDx < HORIZONTAL_ENGAGE_PX || absDx < absDy * HORIZONTAL_ANGLE_RATIO) return;
      start.engaged = true;
      try {
        event.currentTarget.setPointerCapture(start.pointerId);
      } catch {
        // jsdom / older browsers may not implement setPointerCapture.
      }
    }

    const atEdge = (dx > 0 && prevDisabled) || (dx < 0 && nextDisabled);
    setDragDelta(atEdge ? dx * EDGE_RESISTANCE : dx);
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const start = dragStart.current;
    if (start === null) return;
    const engaged = start.engaged;
    const dx = event.clientX - start.x;
    const elapsed = Math.max(1, event.timeStamp - start.time);
    const velocity = Math.abs(dx) / elapsed;
    const committed =
      engaged &&
      (Math.abs(dx) > COMMIT_DISTANCE_PX || velocity > COMMIT_VELOCITY_PX_PER_MS);
    if (committed) {
      if (dx > 0 && !prevDisabled) onPrev();
      else if (dx < 0 && !nextDisabled) onNext();
    }
    dragStart.current = null;
    setDragDelta(0);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") {
      if (prevDisabled) return;
      event.preventDefault();
      onPrev();
    } else if (event.key === "ArrowRight") {
      if (nextDisabled) return;
      event.preventDefault();
      onNext();
    }
  }

  const dragging = dragDelta !== 0;
  const buttonBase =
    "inline-flex items-center justify-center gap-1.5 min-h-[48px] px-3 rounded-button border border-border text-text text-sm font-semibold transition-colors duration-150 motion-reduce:transition-none hover:bg-surface-soft active:scale-[0.97] motion-reduce:transform-none disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent";

  return (
    <div
      role="group"
      aria-label="Week navigation"
      onKeyDown={onKeyDown}
      className="flex flex-col gap-3"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPrev}
          disabled={prevDisabled}
          aria-label="Previous week"
          className={buttonBase}
        >
          <ChevronLeftIcon />
          <span className="hidden tablet:inline">Last week</span>
        </button>

        <div
          className="flex-1 min-w-0 overflow-hidden select-none touch-pan-y"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          data-testid="week-nav-swipe-area"
        >
          <div
            className="flex flex-col items-center"
            style={
              reducedMotion
                ? undefined
                : {
                    transform: `translateX(${dragDelta}px)`,
                    transition: dragging
                      ? "none"
                      : "transform 220ms cubic-bezier(0.23, 1, 0.32, 1)",
                  }
            }
          >
            <p className="text-base tablet:text-lg font-bold text-heading text-center truncate tabular-nums">
              {formatWeekLabel(mondayStr)}
            </p>
            <p className="text-xs text-text-secondary mt-0.5">
              {relativeWeekLabel(mondayStr, todayMonday)}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onNext}
          disabled={nextDisabled}
          aria-label="Next week"
          className={buttonBase}
        >
          <span className="hidden tablet:inline">Next week</span>
          <ChevronRightIcon />
        </button>
      </div>

      <div className="flex items-center justify-between gap-3 text-xs text-text-secondary">
        <span className="flex-1 min-w-0 truncate" aria-hidden="true">
          {!prevDisabled ? (
            <span className="opacity-70">&larr; {formatShortDate(prevMondayStr)}</span>
          ) : (
            "\u00a0"
          )}
        </span>

        {dots ? (
          <div
            className="flex items-center gap-1.5 flex-shrink-0"
            role="group"
            aria-label="Jump to week"
          >
            {dots.weeks.map((week) => {
              const isActive = week.mondayStr === mondayStr;
              const hasPicks = (week.pickCount ?? 0) > 0;
              const dotClass = isActive
                ? "w-2 h-2 bg-accent"
                : hasPicks
                  ? "w-1.5 h-1.5 bg-accent opacity-60"
                  : week.hasOpen === true
                    ? "w-1.5 h-1.5 bg-text-secondary"
                    : "w-1.5 h-1.5 bg-border";
              return (
                <button
                  key={week.mondayStr}
                  type="button"
                  onClick={() => dots.onJump(week.mondayStr)}
                  aria-label={`Jump to week of ${formatShortDate(week.mondayStr)}`}
                  aria-current={isActive ? "true" : undefined}
                  className="w-6 h-6 inline-flex items-center justify-center rounded-full transition-colors duration-150 motion-reduce:transition-none hover:bg-surface-soft focus:outline focus:outline-2 focus:outline-focus-ring"
                >
                  <span
                    className={`${dotClass} rounded-full transition-colors duration-150 motion-reduce:transition-none`}
                  />
                </button>
              );
            })}
          </div>
        ) : null}

        <span className="flex-1 min-w-0 truncate text-right" aria-hidden="true">
          {!nextDisabled ? (
            <span className="opacity-70">{formatShortDate(nextMondayStr)} &rarr;</span>
          ) : (
            "\u00a0"
          )}
        </span>
      </div>

      {!isCurrentWeek && (
        <button
          type="button"
          onClick={onToday}
          className="self-end min-h-[36px] px-2 text-xs font-semibold text-link hover:text-link-hover transition-colors duration-150 motion-reduce:transition-none"
        >
          Jump to this week
        </button>
      )}

      <span aria-live="polite" aria-atomic="true" className="sr-only">
        {`Week of ${mondayStr} through ${sundayStr}`}
      </span>
    </div>
  );
}

function ChevronLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M13 4l-6 6 6 6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M7 4l6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
