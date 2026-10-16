"use client";

import type { WeekDayAvailability } from "@swim-app/shared";
import { formatSlotTime, isSlotInSelection, getSlotHHMM } from "@/content/BookCalendarContent/helpers";

interface CurrentLesson {
  date: string;
  startHHMM: string;
  durationMinutes: number;
}

interface Props {
  day: WeekDayAvailability | null;
  durationMinutes: 30 | 45 | 60;
  selectedStartsAt: string | null;
  onSlotClick: (slot: { startsAt: string; state: string }) => void;
  currentLesson: CurrentLesson;
}

const BASE_CLASSES =
  "min-h-[44px] w-full flex items-center px-4 text-sm rounded-button border transition-colors duration-100 motion-reduce:transition-none";

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function isCurrentSlot(slotStartsAt: string, currentLesson: CurrentLesson, dayDate: string): boolean {
  if (dayDate !== currentLesson.date) return false;
  const slotHHMM = getSlotHHMM(slotStartsAt);
  const slotMin = toMinutes(slotHHMM);
  const startMin = toMinutes(currentLesson.startHHMM);
  return slotMin >= startMin && slotMin < startMin + currentLesson.durationMinutes;
}

export default function ReschedulePhoneTimeList({
  day,
  durationMinutes,
  selectedStartsAt,
  onSlotClick,
  currentLesson,
}: Props) {
  if (day === null || day.slots.length === 0) {
    return (
      <p className="text-sm text-text-secondary py-6 text-center">No slots for this day.</p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {day.slots.map((slot) => {
        const time = formatSlotTime(slot.startsAt);

        if (isCurrentSlot(slot.startsAt, currentLesson, day.date)) {
          return (
            <div
              key={slot.startsAt}
              className="min-h-[44px] w-full flex items-center px-4 text-sm rounded-button border-2 border-dashed border-accent text-accent font-semibold"
            >
              Current · {time}
            </div>
          );
        }

        const isYourPick =
          selectedStartsAt !== null &&
          isSlotInSelection(slot.startsAt, selectedStartsAt, durationMinutes);

        if (slot.state === "past" || slot.state === "not_open_yet") {
          return (
            <div key={slot.startsAt} className={`${BASE_CLASSES} border-border text-text-secondary opacity-40`}>
              {time}
            </div>
          );
        }

        if (slot.state === "unavailable") {
          return (
            <div key={slot.startsAt} className={`${BASE_CLASSES} border-border text-text-secondary line-through opacity-60`}>
              {time}
            </div>
          );
        }

        if (slot.state === "too_soon") {
          return (
            <button
              key={slot.startsAt}
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
              key={slot.startsAt}
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
            key={slot.startsAt}
            type="button"
            className={`${BASE_CLASSES} border-border bg-surface-soft hover:bg-accent/10 active:scale-[0.97] motion-reduce:transform-none`}
            aria-pressed={false}
            onClick={() => onSlotClick(slot)}
          >
            {time}
          </button>
        );
      })}
    </div>
  );
}
