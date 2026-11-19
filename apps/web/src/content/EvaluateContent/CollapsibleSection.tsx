"use client";

import { useId, type ReactNode } from "react";

// Stacked collapsible section header used by the evaluate form. Each stroke
// screen renders every section at once; the coach expands/collapses the ones
// they want. Multiple sections may be open at the same time — the parent
// owns the open-state map so search/jumpToSkill can open any section
// programmatically.

interface CollapsibleSectionProps {
  name: string;
  count: number;
  completed: number;
  open: boolean;
  onToggle: () => void;
  // Stable DOM id used as the scroll anchor when jumpToSkill opens a section
  // from the search dropdown. Lets us scroll to the header (not a partial row
  // behind a sticky save bar).
  anchorId: string;
  children: ReactNode;
}

export default function CollapsibleSection({
  name,
  count,
  completed,
  open,
  onToggle,
  anchorId,
  children,
}: CollapsibleSectionProps) {
  const panelId = useId();
  const done = completed > 0;
  return (
    <section id={anchorId} className="rounded border border-border">
      <h3 className="m-0">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="w-full flex items-center justify-between gap-3 px-4 min-h-[48px] text-left text-text focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-focus-ring"
        >
          <span className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block text-xs transition-transform duration-150"
              style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
            >
              ▶
            </span>
            <span className="font-semibold text-sm">{name}</span>
          </span>
          <span
            className={
              done
                ? "tabular-nums text-[10px] font-bold px-1.5 h-5 rounded-full inline-flex items-center bg-accent text-on-accent"
                : "tabular-nums text-[10px] font-bold px-1.5 h-5 rounded-full inline-flex items-center border border-border text-text-secondary"
            }
          >
            {completed}/{count}
          </span>
        </button>
      </h3>
      {open && (
        <div
          id={panelId}
          role="region"
          aria-label={`${name} skills`}
          className="px-4 pb-4 pt-1 border-t border-border"
        >
          {children}
        </div>
      )}
    </section>
  );
}
