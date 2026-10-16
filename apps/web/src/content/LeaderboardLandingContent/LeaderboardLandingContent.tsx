const boardCards = [
  {
    title: "Club Swim",
    href: "/leaderboard/club",
    description: "Top times from the current club season, age-grouped and ranked.",
  },
  {
    title: "Irvine Summer Swim League",
    href: "/leaderboard/isl",
    description: "Times from league registration, with age calculated at first entry.",
  },
  {
    title: "Master Board",
    href: "/leaderboard/master",
    description: "Personal bests across all of Jason's swimmers, with motivational standards.",
  },
];

export default function LeaderboardLandingContent() {
  return (
    <div className="bg-background min-h-screen">
      <div className="mx-auto max-w-content px-page py-16 tablet:py-24">
        <div className="flex flex-col gap-3 mb-10 tablet:mb-14">
          <h1 className="text-heading">Leaderboards</h1>
          <p className="text-text-secondary text-base max-w-xl">
            See where swimmers stand in each league, or across everyone Jason coaches.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 tablet:grid-cols-3">
          {boardCards.map((card) => (
            <a
              key={card.href}
              href={card.href}
              className="rounded-card border border-border p-6 flex flex-col gap-3 hover:border-accent transition-colors duration-150"
            >
              <p className="text-text font-bold text-base">{card.title}</p>
              <p className="text-text-secondary text-sm">{card.description}</p>
              <span className="text-accent text-sm font-semibold mt-auto">
                View board →
              </span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
