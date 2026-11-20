import type { LeaderboardBoardId } from "@swim-app/shared";

const BOARD_CARDS: Record<LeaderboardBoardId, { title: string; href: string; description: string }> = {
  club: {
    title: "Club Swim",
    href: "/leaderboard/club",
    description: "Top times from the current club season, age-grouped and ranked.",
  },
  isl: {
    title: "Irvine Summer Swim League",
    href: "/leaderboard/isl",
    description: "Times from league registration, with age calculated at first entry.",
  },
  master: {
    title: "Master Board",
    href: "/leaderboard/master",
    description: "Personal bests across every swimmer whose family opted in.",
  },
};

interface LeaderboardLandingContentProps {
  qualifying: LeaderboardBoardId[];
}

export default function LeaderboardLandingContent({ qualifying }: LeaderboardLandingContentProps) {
  const cards = qualifying.map((board) => BOARD_CARDS[board]);

  return (
    <div className="bg-background">
      <div className="mx-auto max-w-content px-page py-16 tablet:py-24">
        <div className="flex flex-col gap-3 mb-10 tablet:mb-14">
          <h1 className="text-heading">Leaderboards</h1>
          <p className="text-text-secondary text-base max-w-xl">
            See where swimmers stand in each league, or across everyone Jason coaches.
          </p>
        </div>

        {cards.length === 0 ? (
          <p className="text-text-secondary text-sm py-16 text-center">
            Not enough results yet. Check back after the next meet.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-6 tablet:grid-cols-3">
            {cards.map((card) => (
              <a
                key={card.href}
                href={card.href}
                className="rounded-card border border-border p-6 flex flex-col gap-3 hover:border-accent transition-colors duration-150"
              >
                <p className="text-text font-bold text-base">{card.title}</p>
                <p className="text-text-secondary text-sm">{card.description}</p>
                <span className="text-accent text-sm font-semibold mt-auto">View board →</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
