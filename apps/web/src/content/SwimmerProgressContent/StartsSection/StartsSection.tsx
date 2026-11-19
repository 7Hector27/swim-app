"use client";

import { useState } from "react";
import type { ProgressRatingPoint, StartProgress } from "@swim-app/shared";
import StartDiveCard from "./StartDiveCard";
import { pickInitialStartSlug, tabStatusLabel } from "./helpers";

interface StartsSectionProps {
  startProgress: StartProgress[];
  // Flat list — only `slug` and `history` are read inside the card.
  swimmerSkills: Array<{
    slug: string;
    history: ProgressRatingPoint[];
  }>;
}

export default function StartsSection({ startProgress, swimmerSkills }: StartsSectionProps) {
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
              style={{
                backgroundColor: isActive ? "var(--color-accent)" : "var(--color-card)",
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
        <StartDiveCard start={activeStart} swimmerSkills={swimmerSkills} />
      </div>
    </div>
  );
}
