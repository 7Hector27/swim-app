"use client";

import type { WeekDayAvailability } from "@swim-app/shared";
import { formatSlotTime, isSlotInSelection } from "./helpers";

type Slot = WeekDayAvailability["slots"][number];

interface Props {
  day: WeekDayAvailability | null;
  durationMinutes: 30 | 45 | 60;
  selectedStartsAt: string | null;
  // Multi-select states; see DayColumn for semantics.
  pickStartsSet?: Set<string>;
  pickSpanSet?: Set<string>;
  plannedStartsAtSet?: Set<string>;
  flagReasonByStart?: Map<string, string>;
  takenByPicksSet?: Set<string>;
  onSlotClick: (slot: { startsAt: string; state: string }) => void;
}

const BASE_CLASSES =
  "min-h-[44px] w-full flex items-center px-4 text-sm rounded-button border transition-colors duration-100 motion-reduce:transition-none";

function SlotRow({
  slot,
  isYourPick,
  isPlanned,
  isFlagged,
  flagReason,
  isTakenByPicks,
  onSlotClick,
}: {
  slot: Slot;
  isYourPick: boolean;
  isPlanned: boolean;
  isFlagged: boolean;
  flagReason: string | undefined;
  isTakenByPicks: boolean;
  onSlotClick: (slot: { startsAt: string; state: string }) => void;
}) {
  const time = formatSlotTime(slot.startsAt);

  if (slot.state === "past") {
    return (
      <div className={`${BASE_CLASSES} border-border text-text-secondary opacity-40`}>
        {time}
      </div>
    );
  }

  if (slot.state === "not_open_yet") {
    return (
      <div
        className={`${BASE_CLASSES} border-border text-text-secondary opacity-60`}
        title="Not open yet"
        data-not-open-yet="true"
      >
        <span className="flex-1 text-left">{time}</span>
        <span className="text-xs font-normal opacity-80">Not open yet</span>
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

  if (isFlagged) {
    const title = flagReason ?? "Flagged";
    return (
      <button
        type="button"
        className={`${BASE_CLASSES} border-2 border-danger bg-danger/5 text-danger font-semibold active:scale-[0.97] motion-reduce:transform-none`}
        aria-pressed={true}
        aria-label={`${time}, flagged: ${title}`}
        title={title}
        data-flagged="true"
        onClick={() => onSlotClick(slot)}
      >
        <span className="flex-1 text-left">{time}</span>
        <span className="text-xs font-normal opacity-80">{title}</span>
      </button>
    );
  }

  if (isYourPick) {
    return (
      <button
        type="button"
        className={`${BASE_CLASSES} border-transparent bg-heading text-background font-semibold active:scale-[0.97] motion-reduce:transform-none`}
        aria-pressed={true}
        data-your-pick="true"
        onClick={() => onSlotClick(slot)}
      >
        {time}
      </button>
    );
  }

  if (isPlanned) {
    return (
      <button
        type="button"
        className={`${BASE_CLASSES} border border-dashed border-accent bg-accent/10 text-accent font-semibold active:scale-[0.97] motion-reduce:transform-none`}
        aria-pressed={true}
        data-planned="true"
        onClick={() => onSlotClick(slot)}
      >
        {time}
      </button>
    );
  }

  if (isTakenByPicks) {
    return (
      <div
        className={`${BASE_CLASSES} border-dashed border-border bg-surface-soft text-text-secondary line-through opacity-70`}
        title="Taken by your picks"
        data-taken-by-picks="true"
      >
        {time}
      </div>
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
  pickStartsSet,
  pickSpanSet,
  plannedStartsAtSet,
  flagReasonByStart,
  takenByPicksSet,
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
        const isYourPickFromSingle =
          selectedStartsAt !== null &&
          isSlotInSelection(slot.startsAt, selectedStartsAt, durationMinutes);
        const isYourPickFromSpan = pickSpanSet?.has(slot.startsAt) ?? false;
        const isYourPick = isYourPickFromSingle || isYourPickFromSpan;
        const isPlanned =
          !isYourPick && (plannedStartsAtSet?.has(slot.startsAt) ?? false);
        const isPickHead = pickStartsSet?.has(slot.startsAt) ?? false;
        const flagReason = isPickHead ? flagReasonByStart?.get(slot.startsAt) : undefined;
        const isFlagged = flagReason !== undefined;
        const isTakenByPicks =
          !isYourPick && !isPlanned && !isFlagged &&
          (takenByPicksSet?.has(slot.startsAt) ?? false);

        return (
          <SlotRow
            key={slot.startsAt}
            slot={slot}
            isYourPick={isYourPick}
            isPlanned={isPlanned}
            isFlagged={isFlagged}
            flagReason={flagReason}
            isTakenByPicks={isTakenByPicks}
            onSlotClick={onSlotClick}
          />
        );
      })}
    </div>
  );
}
