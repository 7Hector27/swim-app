import type { LeaderboardBoardId, PublicBoardResponse, PublicMasterResponse } from "@swim-app/shared";

import ScrollReveal from "@/components/ScrollReveal";

import {
  fetchClubBoard,
  fetchISLBoard,
  fetchLeaderboardSummary,
  fetchMasterBoard,
} from "@/lib/api/leaderboard";

import ScrollFadeArea from "./ScrollFadeArea";

interface LeaderboardRow {
  rank: number;
  swimmer: string;
  event: string;
  time: string;
}

interface LeaderboardCard {
  board: LeaderboardBoardId;
  title: string;
  subtitle?: string;
  href: string;
  rows: LeaderboardRow[];
}

const BOARD_META: Record<LeaderboardBoardId, { title: string; subtitle?: string; href: string }> = {
  club: { title: "Club Swim", href: "/leaderboard/club" },
  isl: {
    title: "Irvine Summer Swim League",
    subtitle: "Seahawks",
    href: "/leaderboard/isl",
  },
  master: {
    title: "All swimmers",
    subtitle: "Master leaderboard",
    href: "/leaderboard/master",
  },
};

const PREVIEW_ROWS = 5;
const STROKE_LABELS: Record<string, string> = {
  free: "Free",
  back: "Back",
  breast: "Breast",
  fly: "Fly",
  im: "IM",
};

function toPreviewRow(row: {
  firstName: string;
  lastInitial: string;
  rank: number;
  time: string;
  eventDistance: number;
  eventStroke: string;
  course: string;
}): LeaderboardRow {
  const strokeLabel = STROKE_LABELS[row.eventStroke] ?? row.eventStroke;
  return {
    rank: row.rank,
    swimmer: `${row.firstName} ${row.lastInitial}.`,
    event: `${row.eventDistance} ${strokeLabel} · ${row.course.toUpperCase()}`,
    time: row.time,
  };
}

// Pick the first row from each distinct (event, stroke, course) partition so
// the preview samples the top of several groups rather than a long tail of
// one. Falls back to the first N rows if we somehow can't fill the quota.
function pickPreview(rows: Array<{
  firstName: string;
  lastInitial: string;
  rank: number;
  time: string;
  eventDistance: number;
  eventStroke: string;
  course: string;
  ageGroup: string;
  sex: string;
}>): LeaderboardRow[] {
  const seen = new Set<string>();
  const picked: LeaderboardRow[] = [];
  for (const row of rows) {
    const key = `${row.sex}|${row.ageGroup}|${row.eventDistance}|${row.eventStroke}|${row.course}`;
    if (seen.has(key)) continue;
    if (row.rank !== 1) continue;
    seen.add(key);
    picked.push(toPreviewRow(row));
    if (picked.length >= PREVIEW_ROWS) break;
  }
  if (picked.length < PREVIEW_ROWS) {
    for (const row of rows) {
      if (picked.length >= PREVIEW_ROWS) break;
      const already = picked.some((p) => p.rank === row.rank && p.swimmer === `${row.firstName} ${row.lastInitial}.`);
      if (already) continue;
      picked.push(toPreviewRow(row));
    }
  }
  return picked;
}

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
        {rows.map((row, index) => (
          <tr key={`${row.rank}-${index}`} className="border-t border-divider-section">
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

// The homepage pulls real data from the public API and only renders cards for
// boards that qualify under the min-swimmers-per-event-list threshold. When
// zero boards qualify the whole section returns null — the homepage renders
// without it and the footer's `/leaderboard` link stops offering something to
// land on (handled in SiteFooter via the same summary fetch).
export default async function LeaderboardSection() {
  const summary = await fetchLeaderboardSummary();
  const qualifying: LeaderboardBoardId[] = summary?.qualifying ?? [];
  if (qualifying.length === 0) return null;

  const [clubData, islData, masterData] = await Promise.all([
    qualifying.includes("club") ? fetchClubBoard({}) : Promise.resolve<PublicBoardResponse | null>(null),
    qualifying.includes("isl") ? fetchISLBoard({}) : Promise.resolve<PublicBoardResponse | null>(null),
    qualifying.includes("master") ? fetchMasterBoard({}) : Promise.resolve<PublicMasterResponse | null>(null),
  ]);

  const cards: LeaderboardCard[] = [];
  if (qualifying.includes("club") && clubData && clubData.rows.length > 0) {
    cards.push({ board: "club", ...BOARD_META.club, rows: pickPreview(clubData.rows) });
  }
  if (qualifying.includes("isl") && islData && islData.rows.length > 0) {
    cards.push({ board: "isl", ...BOARD_META.isl, rows: pickPreview(islData.rows) });
  }
  if (qualifying.includes("master") && masterData && masterData.rows.length > 0) {
    cards.push({ board: "master", ...BOARD_META.master, rows: pickPreview(masterData.rows) });
  }
  if (cards.length === 0) return null;

  return (
    <section id="leaderboards" className="scroll-mt-16 bg-section text-text-on-section">
      <div className="mx-auto max-w-content px-page py-16 tablet:py-24">
        <div className="flex flex-col gap-3 mb-10 tablet:mb-14">
          <h2 className="text-text-on-section">Leaderboards</h2>
          <p className="text-text-secondary-on-section text-base max-w-xl">
            See where swimmers stand in each league, or across everyone Jason coaches.
          </p>
        </div>

        {/* Desktop: 3-column grid, cards stretch to the same height. Mobile: horizontal swipe row. */}
        <div className="flex gap-4 overflow-x-auto pb-2 tablet:grid tablet:grid-cols-3 tablet:gap-6 tablet:overflow-visible tablet:pb-0">
          {cards.map((card, index) => (
            <ScrollReveal
              key={card.board}
              delay={index * 60}
              mobileStagger={false}
              className="flex-shrink-0 w-72 tablet:w-auto"
            >
              <article className="rounded-card bg-card text-text-on-section border border-divider-section p-6 flex flex-col gap-4 h-full">
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
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
