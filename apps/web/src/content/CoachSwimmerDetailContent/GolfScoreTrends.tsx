import type { GolfScoreTrend, GolfScoreAgeBands } from "@swim-app/shared";

interface GolfScoreTrendsProps {
  trends: GolfScoreTrend[];
}

const CATEGORY_LABELS: Record<string, string> = {
  push_off_in_water: "Push-off in water",
  deck_dive: "Deck dive",
  block_dive: "Block dive",
};

function formatDate(sessionDate: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(sessionDate));
}

function AgeBandRow({ bands }: { bands: GolfScoreAgeBands }) {
  return (
    <div className="flex gap-4 text-xs text-text-secondary mt-1">
      <span>Age-group ({bands.bandCount} swimmers):</span>
      {bands.p25 !== null && <span>P25: {bands.p25.toFixed(1)}</span>}
      {bands.p50 !== null && <span>Median: {bands.p50.toFixed(1)}</span>}
      {bands.p75 !== null && <span>P75: {bands.p75.toFixed(1)}</span>}
    </div>
  );
}

export default function GolfScoreTrends({ trends }: GolfScoreTrendsProps) {
  if (trends.length === 0) return null;

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="font-bold text-sm text-text">Golf Score</h2>
        <p className="text-xs text-text-secondary">Lower is better</p>
      </div>
      {trends.map((trend) => (
        <div key={trend.skillSlug} className="flex flex-col gap-3">
          <p className="text-xs font-semibold text-text-secondary">{trend.skillName}</p>
          {trend.byCategory.map((catTrend) => (
            <div key={catTrend.category} className="flex flex-col gap-1">
              <p className="text-xs text-text-secondary">{CATEGORY_LABELS[catTrend.category] ?? catTrend.category}</p>
              {catTrend.ageBands && <AgeBandRow bands={catTrend.ageBands} />}
              {!catTrend.ageBands && (
                <p className="text-xs text-text-secondary italic">Your trend only</p>
              )}
              <ul className="flex flex-col gap-0">
                {catTrend.points.slice().reverse().map((point) => (
                  <li key={point.sessionDate + point.ratedAt} className="flex gap-3 text-xs py-1 border-b border-border items-center">
                    <span className="text-text-secondary w-24 shrink-0">{formatDate(point.sessionDate)}</span>
                    {point.measurementValue !== null && (
                      <span className="font-semibold text-text">{point.measurementValue}</span>
                    )}
                    {point.grade !== null && (
                      <span className="text-text-secondary">Grade {point.grade}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
