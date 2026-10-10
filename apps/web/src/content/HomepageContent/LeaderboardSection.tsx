import ScrollFadeArea from "./ScrollFadeArea";

interface LeaderboardRow {
  rank: number;
  swimmer: string;
  event: string;
  time: string;
}

interface LeaderboardCard {
  title: string;
  subtitle?: string;
  href: string;
  rows: LeaderboardRow[];
}

// Three cards with 2, 5, and 12 rows to show content-sized cards and the scroll behaviour.
// TODO: replace with real API data (filter by public_profile = true).
const cards: LeaderboardCard[] = [
  {
    title: "Club Swim",
    href: "/leaderboard/club",
    rows: [
      { rank: 1, swimmer: "Maya R.",  event: "[50 Free]",   time: "[0:00.00]" },
      { rank: 2, swimmer: "Ethan K.", event: "[100 Back]",  time: "[0:00.00]" },
    ],
  },
  {
    title: "Irvine Summer Swim League",
    subtitle: "Seahawks",
    href: "/leaderboard/issl",
    rows: [
      { rank: 1, swimmer: "Liam T.",  event: "[50 Breast]", time: "[0:00.00]" },
      { rank: 2, swimmer: "Aria N.",  event: "[100 Free]",  time: "[0:00.00]" },
      { rank: 3, swimmer: "Sofia M.", event: "[50 Fly]",    time: "[0:00.00]" },
      { rank: 4, swimmer: "Noah P.",  event: "[50 Back]",   time: "[0:00.00]" },
      { rank: 5, swimmer: "Chloe W.", event: "[200 IM]",    time: "[0:00.00]" },
    ],
  },
  {
    title: "All swimmers",
    subtitle: "Master leaderboard",
    href: "/leaderboard",
    rows: [
      { rank:  1, swimmer: "Maya R.",   event: "[50 Free]",    time: "[0:00.00]" },
      { rank:  2, swimmer: "Liam T.",   event: "[50 Breast]",  time: "[0:00.00]" },
      { rank:  3, swimmer: "Ethan K.",  event: "[100 Back]",   time: "[0:00.00]" },
      { rank:  4, swimmer: "Sofia M.",  event: "[50 Fly]",     time: "[0:00.00]" },
      { rank:  5, swimmer: "Aria N.",   event: "[100 Free]",   time: "[0:00.00]" },
      { rank:  6, swimmer: "Noah P.",   event: "[50 Back]",    time: "[0:00.00]" },
      { rank:  7, swimmer: "Chloe W.",  event: "[200 IM]",     time: "[0:00.00]" },
      { rank:  8, swimmer: "James L.",  event: "[100 Fly]",    time: "[0:00.00]" },
      { rank:  9, swimmer: "Mia S.",    event: "[50 Free]",    time: "[0:00.00]" },
      { rank: 10, swimmer: "Lucas A.",  event: "[100 Breast]", time: "[0:00.00]" },
      { rank: 11, swimmer: "Zoe H.",    event: "[200 Free]",   time: "[0:00.00]" },
      { rank: 12, swimmer: "Owen B.",   event: "[50 Back]",    time: "[0:00.00]" },
    ],
  },
];

function LeaderboardTable({ rows }: { rows: LeaderboardRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-text-secondary-on-section text-sm py-4">
        No times posted yet.
      </p>
    );
  }

  return (
    <table className="w-full">
      <thead>
        <tr>
          <th className="sticky top-0 bg-card text-left pb-3 pt-1 text-text-secondary-on-section font-semibold text-xs w-8">
            Rank
          </th>
          <th className="sticky top-0 bg-card text-left pb-3 pt-1 text-text-secondary-on-section font-semibold text-xs">
            Swimmer
          </th>
          <th className="sticky top-0 bg-card text-left pb-3 pt-1 text-text-secondary-on-section font-semibold text-xs">
            Time
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.rank} className="border-t border-divider-section">
            <td className="py-3 text-accent-on-section font-heading font-bold text-sm tabular-nums">
              {row.rank}
            </td>
            <td className="py-3 pr-3">
              <span className="text-text-on-section font-semibold text-sm">
                {row.swimmer}
              </span>
              <span className="block text-text-secondary-on-section text-xs mt-0.5">
                {row.event}
              </span>
            </td>
            <td className="py-3 text-text-on-section text-sm tabular-nums">
              {row.time}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function LeaderboardSection() {
  return (
    <section className="bg-section">
      <div className="mx-auto max-w-content px-page py-16 tablet:py-24">
        <div className="flex flex-col gap-3 mb-10 tablet:mb-14">
          <h2 className="text-text-on-section">Leaderboards</h2>
          <p className="text-text-secondary-on-section text-base max-w-xl">
            See where swimmers stand in each league, or across everyone Jason coaches.
          </p>
        </div>

        {/* Desktop: 3-column grid, all cards stretch to the same height. Mobile: horizontal swipe row. */}
        <div className="flex gap-4 overflow-x-auto pb-2 tablet:grid tablet:grid-cols-3 tablet:gap-6 tablet:overflow-visible tablet:pb-0">
          {cards.map((card) => (
            <article
              key={card.title}
              className="flex-shrink-0 w-72 tablet:w-auto rounded-card bg-card border border-divider-section p-6 flex flex-col gap-4"
            >
              <div>
                <h3 className="text-text-on-section font-bold text-base font-body">
                  {card.title}
                </h3>
                {card.subtitle && (
                  <p className="text-text-secondary-on-section text-sm mt-0.5">
                    {card.subtitle}
                  </p>
                )}
              </div>

              <ScrollFadeArea label={`${card.title} leaderboard`}>
                <LeaderboardTable rows={card.rows} />
              </ScrollFadeArea>

              <a
                href={card.href}
                className="text-accent-on-section text-sm font-semibold hover:underline mt-auto"
              >
                View full leaderboard
              </a>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
