"use client";

import { useId } from "react";
import { type SwimStroke, VALID_EVENTS } from "@swim-app/shared";

interface EventPickerProps {
  stroke: SwimStroke;
  distance: number;
  onStrokeChange: (next: SwimStroke) => void;
  onDistanceChange: (next: number) => void;
  disabled?: boolean;
  label?: string;
}

const STROKE_ORDER: SwimStroke[] = ["free", "back", "breast", "fly", "im"];
const STROKE_LABELS: Record<SwimStroke, string> = {
  free: "Free",
  back: "Back",
  breast: "Breast",
  fly: "Fly",
  im: "IM",
};

// Radio-group styled as tap buttons. Each row is a semantic radiogroup so
// screen readers announce the two selections (stroke + distance) as discrete
// choices. Buttons meet the 44px touch target rule on every breakpoint.
export default function EventPicker({
  stroke,
  distance,
  onStrokeChange,
  onDistanceChange,
  disabled,
  label = "Event",
}: EventPickerProps) {
  const groupId = useId();
  const strokeGroupId = `${groupId}-stroke`;
  const distanceGroupId = `${groupId}-distance`;

  const distances = VALID_EVENTS[stroke] ?? [];

  function handleStroke(next: SwimStroke): void {
    onStrokeChange(next);
    const nextDistances = VALID_EVENTS[next] ?? [];
    if (!nextDistances.includes(distance)) {
      const first = nextDistances[0];
      if (first !== undefined) onDistanceChange(first);
    }
  }

  return (
    <fieldset className="flex flex-col gap-2 border-0 p-0 m-0" disabled={disabled}>
      <legend className="text-xs font-semibold text-text-secondary">{label}</legend>

      <div
        role="radiogroup"
        aria-labelledby={`${strokeGroupId}-label`}
        className="flex flex-wrap gap-2"
      >
        <span id={`${strokeGroupId}-label`} className="sr-only">Stroke</span>
        {STROKE_ORDER.map((value) => {
          const selected = value === stroke;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => handleStroke(value)}
              disabled={disabled}
              className={[
                "inline-flex items-center justify-center min-h-[44px] px-4 rounded-button text-sm font-semibold border transition-colors",
                selected
                  ? "bg-button-primary-background text-button-primary-text border-transparent"
                  : "bg-background text-text border-border hover:bg-surface-soft",
                "disabled:opacity-60",
              ].join(" ")}
            >
              {STROKE_LABELS[value]}
            </button>
          );
        })}
      </div>

      <div
        role="radiogroup"
        aria-labelledby={`${distanceGroupId}-label`}
        className="flex flex-wrap gap-2"
      >
        <span id={`${distanceGroupId}-label`} className="sr-only">Distance</span>
        {distances.map((value) => {
          const selected = value === distance;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onDistanceChange(value)}
              disabled={disabled}
              className={[
                "inline-flex items-center justify-center min-h-[44px] min-w-[52px] px-3 rounded-button text-sm font-semibold border transition-colors tabular-nums",
                selected
                  ? "bg-button-primary-background text-button-primary-text border-transparent"
                  : "bg-background text-text border-border hover:bg-surface-soft",
                "disabled:opacity-60",
              ].join(" ")}
            >
              {value}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
