interface LeaderboardRow {
  rank: number;
  swimmer: string;
  event: string;
  time: string;
  trend: "up" | "down";
}

// Real data must come from an API endpoint that filters by public_profile = true
// and returns swimmer names as first name + last initial only (e.g. "Maya R.").
const leaderboardRows: LeaderboardRow[] = [
  { rank: 1, swimmer: "Maya R.", event: "[Event]", time: "[0:00.00]", trend: "up" },
  { rank: 2, swimmer: "Ethan K.", event: "[Event]", time: "[0:00.00]", trend: "up" },
  { rank: 3, swimmer: "Sofia M.", event: "[Event]", time: "[0:00.00]", trend: "down" },
  { rank: 4, swimmer: "Liam T.", event: "[Event]", time: "[0:00.00]", trend: "up" },
  { rank: 5, swimmer: "Aria N.", event: "[Event]", time: "[0:00.00]", trend: "down" },
];

const rankBgClass: Record<number, string> = {
  1: "bg-rank-gold",
  2: "bg-rank-silver",
  3: "bg-rank-bronze",
};

function RankBadge({ rank }: { rank: number }) {
  if (rank <= 3) {
    return (
      <span
        className={`inline-flex items-center justify-center w-7 h-7 rounded-full ${rankBgClass[rank]} text-on-accent font-bold text-xs`}
      >
        {rank}
      </span>
    );
  }
  return (
    <span className="font-heading font-extrabold italic text-accent font-stretch-expanded">
      {rank}
    </span>
  );
}

function TrendIcon({ trend }: { trend: "up" | "down" }) {
  if (trend === "up") {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        aria-label="Improved"
        className="text-success"
      >
        <path
          d="M7 11V3M3.5 6.5L7 3l3.5 3.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-label="Slower"
      className="text-danger"
    >
      <path
        d="M7 3v8M3.5 7.5L7 11l3.5-3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function LeaderboardSection() {
  return (
    <section className="bg-background">
      <div className="mx-auto max-w-content px-page py-16 tablet:py-24">
        <div className="flex flex-col gap-3 mb-10 tablet:mb-14">
          <p className="text-eyebrow text-accent font-bold uppercase tracking-[0.08em]">
            Leaderboard
          </p>
          <h2 className="text-heading">
            [Top times heading]
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[400px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-3 pr-4 text-text-secondary font-semibold text-sm w-12">
                  Rank
                </th>
                <th className="text-left py-3 pr-4 text-text-secondary font-semibold text-sm">
                  Swimmer
                </th>
                <th className="text-left py-3 pr-4 text-text-secondary font-semibold text-sm hidden tablet:table-cell">
                  Event
                </th>
                <th className="text-left py-3 pr-4 text-text-secondary font-semibold text-sm">
                  Time
                </th>
                <th className="text-left py-3 text-text-secondary font-semibold text-sm w-8">
                  <span className="sr-only">Trend</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {leaderboardRows.map((row) => (
                <tr
                  key={row.rank}
                  className="border-b border-border"
                >
                  <td className="py-4 pr-4">
                    <RankBadge rank={row.rank} />
                  </td>
                  <td className="py-4 pr-4">
                    <span className="text-text font-semibold">{row.swimmer}</span>
                    <span className="tablet:hidden block text-text-secondary text-xs mt-0.5">
                      {row.event}
                    </span>
                  </td>
                  <td className="py-4 pr-4 text-text-secondary text-sm hidden tablet:table-cell">
                    {row.event}
                  </td>
                  <td className="py-4 pr-4 text-text font-semibold text-sm tabular-nums">
                    {row.time}
                  </td>
                  <td className="py-4">
                    <TrendIcon trend={row.trend} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-8">
          <a
            href="/leaderboard"
            className="inline-flex items-center justify-center rounded-pill border-2 border-button-outline text-button-outline font-bold text-sm px-6 h-[44px] transition-colors duration-200 active:scale-97"
          >
            View full leaderboard
          </a>
        </div>
      </div>
    </section>
  );
}
