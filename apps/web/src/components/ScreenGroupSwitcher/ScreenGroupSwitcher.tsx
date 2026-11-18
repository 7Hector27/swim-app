"use client";

import { useId, useRef } from "react";
import type { ScreenSlug } from "@swim-app/shared";

// Pass 3: horizontal pill-strip switcher for the nine progress-page
// groups (Fundamentals, Water confidence, Freestyle, …). One group
// visible at a time; tapping a pill changes the active group. Mirrors
// the evaluate screen's section-tab a11y shape (`role=radiogroup` +
// `role=radio`), so keyboard users get arrow-key navigation for free.

export interface ScreenGroupSwitcherOption {
  screenSlug: ScreenSlug;
  name: string;
  // Small badge: how many skills in this group are rated (0/N → empty).
  assessedCount: number;
  totalCount: number;
}

interface ScreenGroupSwitcherProps {
  options: ReadonlyArray<ScreenGroupSwitcherOption>;
  active: ScreenSlug;
  onChange: (next: ScreenSlug) => void;
}

export default function ScreenGroupSwitcher({ options, active, onChange }: ScreenGroupSwitcherProps) {
  const groupId = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function focusAt(index: number) {
    const target = refs.current[index];
    target?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number | undefined;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = (index + 1) % options.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = (index - 1 + options.length) % options.length;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = options.length - 1;
    }
    if (next !== undefined) {
      event.preventDefault();
      const target = options[next];
      if (target) {
        onChange(target.screenSlug);
        focusAt(next);
      }
    }
  }

  return (
    <nav
      aria-label="Progress groups"
      aria-labelledby={groupId}
      className="scrollbar-none overflow-x-auto -mx-page px-page"
    >
      <ul role="radiogroup" className="flex gap-1 w-max min-w-full py-1" aria-label="Progress group">
        {options.map((option, index) => {
          const selected = option.screenSlug === active;
          const done = option.assessedCount > 0;
          return (
            <li key={option.screenSlug}>
              <button
                ref={(node) => {
                  refs.current[index] = node;
                }}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => onChange(option.screenSlug)}
                onKeyDown={(event) => handleKeyDown(event, index)}
                className="relative min-h-[44px] px-4 inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors duration-150 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-focus-ring"
                style={{
                  color: selected ? "var(--color-text)" : "var(--color-text-secondary)",
                }}
              >
                <span className="font-semibold text-sm">{option.name}</span>
                <span
                  className="tabular-nums text-[10px] font-bold px-1.5 h-5 rounded-full inline-flex items-center"
                  style={{
                    backgroundColor: done ? "var(--color-accent)" : "transparent",
                    color: done ? "var(--color-on-accent)" : "var(--color-text-secondary)",
                    border: done ? "none" : "1px solid var(--color-border)",
                  }}
                >
                  {option.assessedCount}/{option.totalCount}
                </span>
                {selected && (
                  <span
                    aria-hidden
                    className="absolute left-2 right-2 bottom-0 h-[2px] rounded-full"
                    style={{ backgroundColor: "var(--color-accent)" }}
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
