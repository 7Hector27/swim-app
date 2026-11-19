import { LEVEL_NAMES } from "@/components/LevelLadder/helpers";
import type { LevelDistributionEntry, SummaryCardData } from "../helpers";

interface SummaryCardProps {
  data: SummaryCardData;
  firstName: string;
}

// Season-summary card at the top of the parent progress page. Carries
// a plain-language headline, a lesson byline, and a stacked bar showing
// the current level distribution across the swimmer's rated non-rollup
// skills.
//
// The stacked bar uses the same accent ramp as the Starts arc. Each
// level's name sits inline with its count inside the segment ("26
// Emerging"). Segments that are too narrow drop the name first, then
// the count — the sentence-form aria-label always carries the full
// distribution so screen readers never lose data.
export default function SummaryCard({ data, firstName }: SummaryCardProps) {
  return (
    <section
      className="rounded-lg border p-5 flex flex-col gap-4 h-full"
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
        const percent = (entry.count / total) * 100;
        // Width thresholds. Each level's name sits inside the segment
        // with its count ("26 Emerging"). When the segment is too narrow
        // for the full phrase, show only the count. When it's too narrow
        // even for that, show nothing. The sentence-form aria-label
        // ensures the distribution is still fully readable to a screen
        // reader.
        //
        // Thresholds picked against the phone-width case: at ~327px of
        // bar width, 14% ≈ 46px — about enough for "Emerging" + the
        // count; 7% ≈ 23px — about enough for a 1-2 digit count.
        const showName = percent >= 14;
        const showCount = percent >= 7;
        const label = showName
          ? `${entry.count} ${LEVEL_NAMES[entry.level]}`
          : showCount
            ? String(entry.count)
            : "";
        return (
          <span
            key={entry.level}
            className="relative flex items-center justify-center min-h-[32px] px-1 text-[11px] font-semibold tabular-nums whitespace-nowrap overflow-hidden"
            style={{
              flexGrow: entry.count,
              flexBasis: 0,
              minWidth: "20px",
              backgroundColor: segmentBackground(entry.level),
              color: segmentTextColor(entry.level),
            }}
            data-testid={`parent-summary-segment-${entry.level}`}
            data-count={entry.count}
            data-percent={percent.toFixed(2)}
            data-shows={showName ? "name-and-count" : showCount ? "count" : "none"}
            aria-hidden="true"
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}
