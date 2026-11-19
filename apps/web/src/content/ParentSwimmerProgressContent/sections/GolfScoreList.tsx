// Parent-side golf score renderer. Two visual forms:
//
//   - `variant="compact"`: a one-row-per-stroke list used in the
//     desktop side column. Each row is stroke / latest score / change
//     since first.
//   - `variant="cards"`: 2-up or 3-up card grid used on tablet and
//     phone. Each card carries stroke, latest score, a tiny trend
//     line, and the change line.
//
// The parent progress response doesn't currently ship any golf data —
// `/coach/golf-score` is coach-only. Until a parent-facing golf
// endpoint lands, the caller always passes an empty `trends` array
// and this component renders null. The structure is in place so the
// layout slot behaves correctly once data flows through.

export interface ParentGolfTrend {
  skillSlug: string;
  skillName: string;
  latest: number | null;
  firstScore: number | null;
  firstSessionMonth: string | null;   // "Sep" from the earliest point
  sparklinePoints: ReadonlyArray<number>;
}

interface GolfScoreListProps {
  trends: ReadonlyArray<ParentGolfTrend>;
  variant: "compact" | "cards";
}

export default function GolfScoreList({ trends, variant }: GolfScoreListProps) {
  if (trends.length === 0) return null;

  if (variant === "compact") {
    return (
      <ul
        className="flex flex-col gap-2 text-sm"
        data-testid="parent-golf-score-list"
        data-variant="compact"
      >
        {trends.map((trend) => (
          <li
            key={trend.skillSlug}
            className="flex items-baseline justify-between gap-2 border-t pt-2 first:border-t-0 first:pt-0"
            style={{ borderColor: "var(--color-border)" }}
          >
            <span className="text-text truncate">{trend.skillName}</span>
            <span className="tabular-nums font-semibold text-text">
              {trend.latest !== null ? trend.latest.toFixed(1) : "—"}
            </span>
            <span className="text-xs text-text-secondary">
              {changeLabel(trend)}
            </span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div
      className="grid gap-3 tablet:grid-cols-2 desktop:grid-cols-3"
      data-testid="parent-golf-score-list"
      data-variant="cards"
    >
      {trends.map((trend) => (
        <div
          key={trend.skillSlug}
          className="rounded-lg border p-4 flex flex-col gap-1"
          style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-border)" }}
        >
          <span className="text-xs font-semibold text-text">{trend.skillName}</span>
          <span className="font-heading text-2xl font-semibold text-text tabular-nums">
            {trend.latest !== null ? trend.latest.toFixed(1) : "—"}
          </span>
          <span className="text-xs text-text-secondary">{changeLabel(trend)}</span>
        </div>
      ))}
    </div>
  );
}

function changeLabel(trend: ParentGolfTrend): string {
  if (trend.latest === null || trend.firstScore === null) return "First score";
  const delta = Math.round((trend.latest - trend.firstScore) * 10) / 10;
  if (delta === 0) return `Steady since ${trend.firstSessionMonth ?? "the first lesson"}`;
  const direction = delta < 0 ? "Down" : "Up";
  return `${direction} ${Math.abs(delta).toFixed(1)}${trend.firstSessionMonth ? ` since ${trend.firstSessionMonth}` : ""}`;
}
