"use client";

import { useState } from "react";
import type { ProgressRatingPoint, StartProgress } from "@swim-app/shared";
import StartDiveCard from "./StartDiveCard";
import { pickInitialStartSlug, tabStatusLabel } from "./helpers";

// Starts code never reads faultTags off a rating point, so the prop
// accepts the structural intersection of the coach and parent history
// shapes — both parent variants omit faultTags; the coach's extra field
// is simply unused here.
type StartsHistoryPoint = Omit<ProgressRatingPoint, "faultTags">;

interface StartsSectionProps {
  startProgress: StartProgress[];
  // Flat list — only `slug` and `history` are read inside the card.
  swimmerSkills: Array<{
    slug: string;
    history: StartsHistoryPoint[];
  }>;
  // Coach shows the session-by-session grid + the "Still to grade" tile;
  // parent hides both. Props forwarded verbatim to StartDiveCard.
  showSessionGrid?: boolean;
  showStillToGrade?: boolean;
}

export default function StartsSection({
  startProgress,
  swimmerSkills,
  showSessionGrid = true,
  showStillToGrade = true,
}: StartsSectionProps) {
  const initial = pickInitialStartSlug(startProgress);
  const [activeSlug, setActiveSlug] = useState<string | null>(initial);

  if (startProgress.length === 0) {
    return (
      <p className="text-sm text-text-secondary">No start ratings yet.</p>
    );
  }

  const activeStart = startProgress.find((start) => start.slug === activeSlug) ?? startProgress[0];
  if (!activeStart) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Starts">
        {startProgress.map((start) => {
          const isActive = start.slug === activeStart.slug;
          return (
            <button
              key={start.slug}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`starts-panel-${start.slug}`}
              className="text-sm font-semibold px-4 rounded-full border transition-colors min-h-[44px] flex items-center"
              // Unselected tabs mirror the Skills switcher group buttons:
              // page background with text-text and a border, readable in
              // both themes. Selected flips to the accent fill with
              // on-accent text so the active state remains obvious.
              style={{
                backgroundColor: isActive ? "var(--color-accent)" : "var(--color-background)",
                color: isActive ? "var(--color-on-accent)" : "var(--color-text)",
                borderColor: isActive ? "var(--color-accent)" : "var(--color-border)",
              }}
              onClick={() => setActiveSlug(start.slug)}
              data-testid={`starts-tab-${start.slug}`}
            >
              <span>
                {start.name}
                <span className="opacity-80"> · {tabStatusLabel(start)}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`starts-panel-${activeStart.slug}`}
        aria-labelledby={`starts-tab-${activeStart.slug}`}
      >
        <StartDiveCard
          start={activeStart}
          swimmerSkills={swimmerSkills}
          showSessionGrid={showSessionGrid}
          showStillToGrade={showStillToGrade}
        />
      </div>
    </div>
  );
}
