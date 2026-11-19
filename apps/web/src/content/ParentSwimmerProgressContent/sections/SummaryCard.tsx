import { LEVEL_NAMES } from "@/components/LevelLadder/helpers";
import type { LevelDistributionEntry, SummaryCardData } from "../helpers";

interface SummaryCardProps {
  data: SummaryCardData;
  firstName: string;
}

// Season-summary card at the top of the parent progress page. Replaces
// the old three-tile hero with one card carrying a plain-language
// headline, a lesson byline, and a stacked bar showing the current level
// distribution across the swimmer's rated non-rollup skills.
//
// The stacked bar uses the same 5-step accent ramp as the Starts arc.
// Each segment flex-grows proportionally to its count so a busy level
// visually dominates. A segment too narrow for its count number drops
// the number; the whole bar still carries a sentence-form text
// alternative so screen readers get the exact distribution.
export default function SummaryCard({ data, firstName }: SummaryCardProps) {
  return (
    <section
      className="rounded-lg border p-5 flex flex-col gap-4"
      style={{
        backgroundColor: "var(--color-background)",
        borderColor: "var(--color-border)",
      }}
      aria-labelledby="parent-summary-heading"
      data-testid="parent-progress-summary-card"
    >
      <div className="flex flex-col gap-2">
        <span className="text-xs text-text-secondary">This season</span>
        <h2
          id="parent-summary-heading"
          className="font-heading text-xl font-semibold text-text"
          style={{ fontVariationSettings: "\"SOFT\" 100, \"WONK\" 0" }}
          data-testid="parent-summary-headline"
        >
          {data.headline}
        </h2>
        {data.lessonLine && (
          <p className="text-xs text-text-secondary" data-testid="parent-summary-lesson-line">
            {data.lessonLine}
          </p>
        )}
      </div>

      {data.total > 0 && (
        <div className="flex flex-col gap-2" data-testid="parent-summary-level-bar">
          <span className="text-xs text-text-secondary">
            Where {firstName.endsWith("s") ? `${firstName}'` : `${firstName}'s`} {data.total} rated{" "}
            {data.total === 1 ? "skill is" : "skills are"} now
          </span>
          <StackedLevelBar entries={data.levelCounts} total={data.total} srText={data.levelsScreenReaderText} />
          <div
            className="grid gap-x-1 text-[10px] text-text-secondary leading-tight"
            style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}
            aria-hidden="true"
          >
            {data.levelCounts.map((entry) => (
              <span key={entry.level} className="text-center truncate">
                {LEVEL_NAMES[entry.level]}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ── Stacked bar ──────────────────────────────────────────────────────────

const LEVEL_MIX: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 18, 2: 32, 3: 55, 4: 78, 5: 100 };

function segmentBackground(level: 1 | 2 | 3 | 4 | 5): string {
  const share = LEVEL_MIX[level];
  if (share === 100) return "var(--color-accent)";
  return `color-mix(in oklab, var(--color-accent) ${share}%, var(--color-surface-soft))`;
}

function segmentTextColor(level: 1 | 2 | 3 | 4 | 5): string {
  return LEVEL_MIX[level] >= 70 ? "var(--color-on-accent)" : "var(--color-text)";
}

interface StackedLevelBarProps {
  entries: ReadonlyArray<LevelDistributionEntry>;
  total: number;
  srText: string;
}

function StackedLevelBar({ entries, total, srText }: StackedLevelBarProps) {
  if (total === 0) return null;
  return (
    <div
      className="flex rounded-md overflow-hidden"
      role="img"
      aria-label={srText}
      data-testid="parent-summary-stacked-bar"
    >
      {entries.map((entry) => {
        if (entry.count === 0) return null;
        // Percentage of the bar occupied by this level. Each segment
        // gets a minimum width (~28px) at phone widths so a count of 1
        // in a swimmer with 50+ rated skills still reads as a stripe
        // rather than vanishing.
        const percent = (entry.count / total) * 100;
        return (
          <span
            key={entry.level}
            className="relative flex items-center justify-center min-h-[28px] text-xs font-semibold tabular-nums"
            style={{
              flexGrow: entry.count,
              flexBasis: 0,
              minWidth: "24px",
              backgroundColor: segmentBackground(entry.level),
              color: segmentTextColor(entry.level),
            }}
            data-testid={`parent-summary-segment-${entry.level}`}
            data-count={entry.count}
            aria-hidden="true"
          >
            {/* Drop the number when the segment is thinner than ~6% of
                the bar — the count would overflow a narrow stripe at
                phone width otherwise. The sentence-form a11y label
                still surfaces every count. */}
            {percent >= 6 ? entry.count : ""}
          </span>
        );
      })}
    </div>
  );
}
