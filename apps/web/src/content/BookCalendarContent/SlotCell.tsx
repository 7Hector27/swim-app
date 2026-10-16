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
  durationMinutes: _durationMinutes,
  onSlotClick,
}: Props) {
  const state = slot?.state ?? null;
  const ariaLabel = buildAriaLabel(dayDate, rowHHMM, state ?? "empty");

  if (slot === null || state === "past" || state === "not_open_yet") {
    return (
      <div
        className={`${BASE_CLASSES} opacity-40`}
        aria-label={ariaLabel}
      />
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
    if (isYourPick) {
      return (
        <button
          type="button"
          className={`${BASE_CLASSES} bg-heading text-background font-semibold active:scale-[0.97] transition-[colors,transform] motion-reduce:transform-none`}
          aria-label={ariaLabel}
          aria-pressed={true}
          onClick={() => onSlotClick(slot)}
        >
          {formatSlotTime(slot.startsAt)}
        </button>
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
