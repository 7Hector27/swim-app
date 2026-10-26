"use client";

import type { WeekDayAvailability } from "@swim-app/shared";
import { getSlotHHMM, isSlotInSelection } from "./helpers";
import SlotCell from "./SlotCell";

interface Props {
  day: WeekDayAvailability;
  gridRows: string[];
  durationMinutes: 30 | 45 | 60;
  selectedStartsAt: string | null;
  // Set of pick starts (used for pick-head detection) and the derived
  // within-span set for full-span highlighting (a 45-min pick covers 3
  // adjacent 15-min cells).
  pickStartsSet?: Set<string>;
  pickSpanSet?: Set<string>;
  // Generated-but-not-committed startsAt strings in Recurring mode.
  plannedStartsAtSet?: Set<string>;
  // Slot startsAt strings the server's preview has flagged, mapped to the
  // reason copy to show on hover + screen readers.
  flagReasonByStart?: Map<string, string>;
  // Slots not currently picked but blocked by one of the parent's picks
  // (overlap or daily-cap). Rendered dim + non-interactive.
  takenByPicksSet?: Set<string>;
  todayStr: string;
  onSlotClick: (slot: { startsAt: string; state: string }) => void;
}

const DOW_ABBRS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function getDowAbbr(dateStr: string): string {
  const dow = new Date(`${dateStr}T12:00:00`).getDay();
  return DOW_ABBRS[dow] ?? "";
}

function getDayNumber(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00`).getDate();
}

function dayStateLabel(
  dayState: WeekDayAvailability["dayState"],
  openCount: number,
): string | null {
  if (dayState === "past") return "Past";
  if (dayState === "closed") return "Closed";
  if (dayState === "not_open_yet") return "Not open";
  if (openCount === 0) return "Full";
  return `${openCount} open`;
}

export default function DayColumn({
  day,
  gridRows,
  durationMinutes,
  selectedStartsAt,
  pickStartsSet,
  pickSpanSet,
  plannedStartsAtSet,
  flagReasonByStart,
  takenByPicksSet,
  todayStr,
  onSlotClick,
}: Props) {
  const isToday = day.date === todayStr;
  const label = dayStateLabel(day.dayState, day.openCount);
  const isInactive =
    day.dayState === "closed" ||
    day.dayState === "past" ||
    day.dayState === "not_open_yet";

  const slotsByHHMM = new Map<string, WeekDayAvailability["slots"][number]>();
  for (const slot of day.slots) {
    slotsByHHMM.set(getSlotHHMM(slot.startsAt), slot);
  }

  return (
    <div className="flex flex-col flex-1 min-w-[80px]">
      <div
        className={`flex flex-col items-center py-2 border-b border-border text-xs font-semibold ${isToday ? "text-accent" : "text-text-secondary"}`}
        aria-current={isToday ? "date" : undefined}
      >
        <span>{getDowAbbr(day.date)}</span>
        <span className={`text-base font-bold ${isToday ? "text-accent" : "text-heading"}`}>
          {getDayNumber(day.date)}
        </span>
        {label !== null && (
          <span className="text-[10px] text-text-secondary mt-0.5">{label}</span>
        )}
      </div>

      {isInactive ? (
        <div className="flex-1 flex items-center justify-center text-xs text-text-secondary opacity-50 min-h-[44px]">
          {day.dayState === "closed" ? "Closed" : ""}
        </div>
      ) : (
        <div className="flex flex-col gap-[2px] pt-[2px]">
          {gridRows.map((rowHHMM) => {
            const slot = slotsByHHMM.get(rowHHMM) ?? null;
            const isYourPickFromSingle =
              selectedStartsAt !== null &&
              slot !== null &&
              isSlotInSelection(slot.startsAt, selectedStartsAt, durationMinutes);
            const isYourPickFromSpan =
              slot !== null && (pickSpanSet?.has(slot.startsAt) ?? false);
            const isYourPick = isYourPickFromSingle || isYourPickFromSpan;
            const isPlanned =
              slot !== null && !isYourPick &&
              (plannedStartsAtSet?.has(slot.startsAt) ?? false);
            const isPickHead =
              slot !== null && (pickStartsSet?.has(slot.startsAt) ?? false);
            // A flag applies to the pick's HEAD cell, not every within-span
            // cell. Looking it up on the head keeps the "red" visual to one
            // cell per pick, which matches how the reason appears in Review.
            const flagReason =
              slot !== null && isPickHead
                ? flagReasonByStart?.get(slot.startsAt)
                : undefined;
            const isFlagged = flagReason !== undefined;
            const isTakenByPicks =
              slot !== null && !isYourPick && !isPlanned && !isFlagged &&
              (takenByPicksSet?.has(slot.startsAt) ?? false);

            return (
              <SlotCell
                key={rowHHMM}
                slot={slot}
                rowHHMM={rowHHMM}
                dayDate={day.date}
                isYourPick={isYourPick}
                isPlanned={isPlanned}
                isFlagged={isFlagged}
                {...(flagReason !== undefined && { flagReason })}
                isTakenByPicks={isTakenByPicks}
                durationMinutes={durationMinutes}
                onSlotClick={onSlotClick}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
