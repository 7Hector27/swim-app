"use client";

import type { WeekDayAvailability } from "@swim-app/shared";
import { formatSlotTime, isSlotInSelection } from "./helpers";

type Slot = WeekDayAvailability["slots"][number];

interface Props {
  day: WeekDayAvailability | null;
  durationMinutes: 30 | 45 | 60;
  selectedStartsAt: string | null;
  onSlotClick: (slot: { startsAt: string; state: string }) => void;
}

const BASE_CLASSES =
  "min-h-[44px] w-full flex items-center px-4 text-sm rounded-button border transition-colors duration-100 motion-reduce:transition-none";

function SlotRow({
  slot,
  isYourPick,
  onSlotClick,
}: {
  slot: Slot;
  isYourPick: boolean;
  onSlotClick: (slot: { startsAt: string; state: string }) => void;
}) {
  const time = formatSlotTime(slot.startsAt);

  if (slot.state === "past" || slot.state === "not_open_yet") {
    return (
      <div className={`${BASE_CLASSES} border-border text-text-secondary opacity-40`}>
        {time}
      </div>
    );
  }

  if (slot.state === "unavailable") {
    return (
      <div className={`${BASE_CLASSES} border-border text-text-secondary line-through opacity-60`}>
        {time}
      </div>
    );
  }

  if (slot.state === "too_soon") {
    return (
      <button
        type="button"
        className={`${BASE_CLASSES} border-border text-text-secondary line-through opacity-60 active:scale-[0.97] motion-reduce:transform-none`}
        onClick={() => onSlotClick(slot)}
      >
        {time}
      </button>
    );
  }

  if (isYourPick) {
    return (
      <button
        type="button"
        className={`${BASE_CLASSES} border-transparent bg-heading text-background font-semibold active:scale-[0.97] motion-reduce:transform-none`}
        aria-pressed={true}
        onClick={() => onSlotClick(slot)}
      >
        {time}
      </button>
    );
  }

  return (
    <button
      type="button"
      className={`${BASE_CLASSES} border-border bg-surface-soft hover:bg-accent/10 active:scale-[0.97] motion-reduce:transform-none`}
      aria-pressed={false}
      onClick={() => onSlotClick(slot)}
    >
      {time}
    </button>
  );
}

export default function PhoneTimeList({
  day,
  durationMinutes,
  selectedStartsAt,
  onSlotClick,
}: Props) {
  if (day === null || day.slots.length === 0) {
    return (
      <p className="text-sm text-text-secondary py-6 text-center">
        No slots for this day.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {day.slots.map((slot) => {
        const isYourPick =
          selectedStartsAt !== null &&
          isSlotInSelection(slot.startsAt, selectedStartsAt, durationMinutes);

        return (
          <SlotRow
            key={slot.startsAt}
            slot={slot}
            isYourPick={isYourPick}
            onSlotClick={onSlotClick}
          />
        );
      })}
    </div>
  );
}
