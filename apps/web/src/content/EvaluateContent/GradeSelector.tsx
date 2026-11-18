"use client";

import { useId, useRef } from "react";

// Jason taps grade buttons hundreds of times per session, often
// one-handed at the pool. The animate skill's 100+/day tier only
// allows near-imperceptible feedback — and that's exactly what the
// button needs today: a 160ms press scale(0.97) so the tap registers
// in the hand, plus a 140ms transition on the color flip so the
// selected state reads obviously without a hard cut.
//
// Selected state is a filled accent pill, not just an outlined one,
// because at pool-deck viewing angles + wet-screen contrast an outline
// loses to an interior fill. Reduced-motion drops the transform; the
// color transition is non-motion and stays.
//
// Pass 2b: an untouched row has nothing selected (the N/A pill is
// gone). Tapping the already-selected grade clears it to null. A
// polite live region announces the cleared state for screen readers.
// Arrow keys move focus between grades, matching native radiogroup
// behavior.

const GRADE_BUTTON_CLASS = [
  "min-h-[44px] min-w-[44px] px-3 rounded border text-sm font-semibold",
  "transition-[transform,background-color,border-color,color]",
  "duration-150 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]",
  "active:scale-[0.97] motion-reduce:transform-none",
  "disabled:opacity-40 disabled:cursor-not-allowed",
  "focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-focus-ring",
].join(" ");

const GRADES: ReadonlyArray<1 | 2 | 3 | 4 | 5> = [1, 2, 3, 4, 5];

interface GradeSelectorProps {
  value: 1 | 2 | 3 | 4 | 5 | null;
  disabled: boolean;
  onChange: (grade: 1 | 2 | 3 | 4 | 5 | null) => void;
  labelPrefix: string;
}

export default function GradeSelector({ value, disabled, onChange, labelPrefix }: GradeSelectorProps) {
  const liveRegionId = useId();
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function focusGrade(grade: 1 | 2 | 3 | 4 | 5) {
    const index = GRADES.indexOf(grade);
    buttonRefs.current[index]?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, grade: 1 | 2 | 3 | 4 | 5) {
    if (disabled) return;
    const currentIndex = GRADES.indexOf(grade);
    let next: 1 | 2 | 3 | 4 | 5 | undefined;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = GRADES[(currentIndex + 1) % GRADES.length];
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = GRADES[(currentIndex - 1 + GRADES.length) % GRADES.length];
    } else if (event.key === "Home") {
      next = GRADES[0];
    } else if (event.key === "End") {
      next = GRADES[GRADES.length - 1];
    }
    if (next !== undefined) {
      event.preventDefault();
      onChange(next);
      focusGrade(next);
    }
  }

  function handleClick(grade: 1 | 2 | 3 | 4 | 5) {
    if (value === grade) {
      onChange(null);
    } else {
      onChange(grade);
    }
  }

  return (
    <>
      <div
        role="radiogroup"
        aria-label={`${labelPrefix} grade`}
        aria-describedby={liveRegionId}
        className="flex gap-1 flex-wrap"
      >
        {GRADES.map((grade, index) => {
          const selected = value === grade;
          return (
            <button
              key={grade}
              ref={(node) => {
                buttonRefs.current[index] = node;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              // Only the selected radio is tabbable so Tab moves to the next
              // field after the group; arrow keys cycle inside it. When no
              // grade is selected, the first radio is the roving tab-stop.
              tabIndex={disabled ? -1 : selected || (value === null && index === 0) ? 0 : -1}
              disabled={disabled}
              onClick={() => handleClick(grade)}
              onKeyDown={(event) => handleKeyDown(event, grade)}
              className={GRADE_BUTTON_CLASS}
              style={{
                borderColor: selected ? "var(--color-accent)" : "var(--color-border)",
                color: selected ? "var(--color-on-accent)" : "var(--color-text-secondary)",
                backgroundColor: selected ? "var(--color-accent)" : "transparent",
              }}
            >
              {grade}
            </button>
          );
        })}
      </div>
      {/* Polite live region: announces the current selection (or "No grade
          selected") so a screen reader catches the cleared state after the
          coach taps the already-selected pill. Hidden visually. */}
      <span id={liveRegionId} role="status" aria-live="polite" className="sr-only">
        {value === null ? `${labelPrefix}: no grade selected` : `${labelPrefix}: grade ${value}`}
      </span>
    </>
  );
}
