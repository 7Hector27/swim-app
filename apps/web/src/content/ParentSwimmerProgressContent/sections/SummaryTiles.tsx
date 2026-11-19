import type { SummaryTilesData } from "../helpers";

interface SummaryTilesProps {
  data: SummaryTilesData;
}

// Three summary tiles at the top of the parent progress page. The accent
// hero tile reads "+N levels gained this season across M skills"; the two
// neutral tiles beneath are "last evaluated <Mon D>" and "N evaluations
// since <Mon>". Empty values (no evaluations yet) render as dashes rather
// than disappearing — a blank hero would look broken on a brand-new
// account. Tiles sit on --color-background (lifted off --color-surface-soft
// cards elsewhere on the page) so the hero accent reads cleanly in both
// themes.
export default function SummaryTiles({ data }: SummaryTilesProps) {
  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: "1fr 1fr" }}
      data-testid="parent-progress-summary-tiles"
    >
      <div
        className="rounded-lg p-4 flex flex-col gap-0.5"
        style={{
          gridColumn: "1 / -1",
          backgroundColor: "var(--color-accent)",
          color: "var(--color-on-accent)",
        }}
        data-testid="parent-tile-levels-gained"
      >
        <span className="font-heading text-2xl font-semibold tabular-nums">
          {data.levelsGained > 0 ? `+${data.levelsGained}` : "—"}
          {data.levelsGained > 0 && <span className="ml-1 text-base font-semibold">levels</span>}
        </span>
        <span className="text-xs opacity-90">
          {data.levelsGained > 0
            ? `gained this season across ${data.skillsLeveledUp} skill${data.skillsLeveledUp === 1 ? "" : "s"}`
            : "no level jumps this season yet"}
        </span>
      </div>
      <div
        className="rounded-lg p-4 flex flex-col gap-0.5 border"
        style={{
          backgroundColor: "var(--color-background)",
          borderColor: "var(--color-border)",
          color: "var(--color-text)",
        }}
        data-testid="parent-tile-last-evaluated"
      >
        <span className="font-heading text-2xl font-semibold text-text tabular-nums">
          {data.lastEvaluatedShort ?? "—"}
        </span>
        <span className="text-xs text-text-secondary">last evaluated</span>
      </div>
      <div
        className="rounded-lg p-4 flex flex-col gap-0.5 border"
        style={{
          backgroundColor: "var(--color-background)",
          borderColor: "var(--color-border)",
          color: "var(--color-text)",
        }}
        data-testid="parent-tile-evaluations-count"
      >
        <span className="font-heading text-2xl font-semibold text-text tabular-nums">
          {data.evaluationsThisSeason}
        </span>
        <span className="text-xs text-text-secondary">
          {data.seasonStartMonth ? `evaluations since ${data.seasonStartMonth}` : "evaluations this season"}
        </span>
      </div>
    </div>
  );
}
