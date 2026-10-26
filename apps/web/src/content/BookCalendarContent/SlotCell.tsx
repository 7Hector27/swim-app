"use client";

import { formatHHMM, formatSlotTime } from "./helpers";

type SlotState = "available" | "unavailable" | "too_soon" | "past" | "not_open_yet";

interface Slot {
  startsAt: string;
  state: SlotState;
}

interface Props {
  slot: Slot | null;
  rowHHMM: string;
  dayDate: string;
  isYourPick: boolean;
  // Marks the slot as a recurring-mode "planned" lesson that the parent has
  // not yet committed via submit. Visually a dashed outline so it is clearly
  // distinct from a confirmed pick (solid filled) and still looks tappable.
  isPlanned?: boolean;
  // Marks the slot as flagged by the server's preview. Shown with a danger
  // outline so the parent sees which planned/picked slot needs attention.
  isFlagged?: boolean;
  // Human-readable reason shown on hover + screen readers when the slot is
  // flagged. e.g. "Jason is unavailable", "Time no longer open".
  flagReason?: string;
  // Marks the slot as blocked by one of the parent's own current picks:
  // either it overlaps a pick's duration span or adding it would exceed the
  // daily lesson cap. Rendered non-interactive with a dim strikethrough.
  isTakenByPicks?: boolean;
  durationMinutes: number;
  onSlotClick: (slot: { startsAt: string; state: string }) => void;
}

function buildAriaLabel(dayDate: string, rowHHMM: string, state: string): string {
  const date = new Date(`${dayDate}T12:00:00`);
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(date);
  const monthDay = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
  }).format(date);
  const time = formatHHMM(rowHHMM);
  return `${weekday}, ${monthDay}, ${time}, ${state}`;
}

const BASE_CLASSES =
  "min-h-[40px] w-full flex items-center justify-center text-xs rounded-[4px] transition-colors duration-100 [transition-timing-function:var(--ease-out-strong)] motion-reduce:transition-none";

export default function SlotCell({
  slot,
  rowHHMM,
  dayDate,
  isYourPick,
  isPlanned = false,
  isFlagged = false,
  flagReason,
  isTakenByPicks = false,
  durationMinutes: _durationMinutes,
  onSlotClick,
}: Props) {
  const state = slot?.state ?? null;
  const ariaLabel = buildAriaLabel(dayDate, rowHHMM, state ?? "empty");

  if (slot === null || state === "past") {
    return (
      <div
        className={`${BASE_CLASSES} opacity-40`}
        aria-label={ariaLabel}
      />
    );
  }

  if (state === "not_open_yet") {
    return (
      <div
        className={`${BASE_CLASSES} text-text-secondary opacity-60`}
        aria-label={`${ariaLabel}, not open yet`}
        title="Not open yet"
        data-not-open-yet="true"
      >
        {formatSlotTime(slot.startsAt)}
      </div>
    );
  }

  if (state === "unavailable") {
    return (
      <div
        className={`${BASE_CLASSES} text-text-secondary line-through opacity-60`}
        aria-label={ariaLabel}
      >
        {formatSlotTime(slot.startsAt)}
      </div>
    );
  }

  if (state === "available") {
    if (isFlagged) {
      const flagTitle = flagReason ?? "Flagged";
      return (
        <button
          type="button"
          className={`${BASE_CLASSES} border-2 border-danger bg-danger/5 text-danger font-semibold active:scale-[0.97] transition-[colors,transform] motion-reduce:transform-none`}
          aria-label={`${ariaLabel}, flagged: ${flagTitle}`}
          aria-pressed={true}
          title={flagTitle}
          data-flagged="true"
          onClick={() => onSlotClick(slot)}
        >
          {formatSlotTime(slot.startsAt)}
        </button>
      );
    }
    if (isYourPick) {
      return (
        <button
          type="button"
          className={`${BASE_CLASSES} bg-heading text-background font-semibold active:scale-[0.97] transition-[colors,transform] motion-reduce:transform-none`}
          aria-label={ariaLabel}
          aria-pressed={true}
          data-your-pick="true"
          onClick={() => onSlotClick(slot)}
        >
          {formatSlotTime(slot.startsAt)}
        </button>
      );
    }
    if (isPlanned) {
      return (
        <button
          type="button"
          className={`${BASE_CLASSES} border border-dashed border-accent bg-accent/10 text-accent font-semibold active:scale-[0.97] transition-[colors,transform] motion-reduce:transform-none`}
          aria-label={`${ariaLabel}, planned`}
          aria-pressed={true}
          data-planned="true"
          onClick={() => onSlotClick(slot)}
        >
          {formatSlotTime(slot.startsAt)}
        </button>
      );
    }
    if (isTakenByPicks) {
      return (
        <div
          className={`${BASE_CLASSES} border border-dashed border-border bg-surface-soft text-text-secondary line-through opacity-70`}
          aria-label={`${ariaLabel}, taken by your picks`}
          title="Taken by your picks"
          data-taken-by-picks="true"
        >
          {formatSlotTime(slot.startsAt)}
        </div>
      );
    }
    return (
      <button
        type="button"
        className={`${BASE_CLASSES} bg-surface-soft border border-border hover:bg-accent/10 active:scale-[0.97] transition-[colors,transform] motion-reduce:transform-none`}
        aria-label={ariaLabel}
        aria-pressed={false}
        onClick={() => onSlotClick(slot)}
      >
        {formatSlotTime(slot.startsAt)}
      </button>
    );
  }

  if (state === "too_soon") {
    return (
      <button
        type="button"
        className={`${BASE_CLASSES} text-text-secondary line-through opacity-60`}
        aria-label={ariaLabel}
        aria-pressed={false}
        onClick={() => onSlotClick(slot)}
      >
        {formatSlotTime(slot.startsAt)}
      </button>
    );
  }

  return (
    <div
      className={`${BASE_CLASSES} opacity-40`}
      aria-label={ariaLabel}
    />
  );
}
