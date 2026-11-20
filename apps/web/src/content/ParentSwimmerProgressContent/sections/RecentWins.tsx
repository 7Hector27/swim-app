import { formatShortMonthDay, type RecentWin } from "../helpers";

interface RecentWinsProps {
  wins: ReadonlyArray<RecentWin>;
  swimmerFirstName: string;
}

// Up to three recent wins as a stacked list inside one card. The section
// lives in the top-row 1/3 column on tablet+ and a stack of its own on
// phone — a list reads at every width.
export default function RecentWins({ wins, swimmerFirstName }: RecentWinsProps) {
  return (
    <section
      className="flex flex-col gap-3 h-full"
      aria-labelledby="parent-recent-wins-heading"
      data-testid="parent-progress-recent-wins"
    >
      <h2
        id="parent-recent-wins-heading"
        className="text-lg font-heading text-text"
        style={{ fontVariationSettings: "\"SOFT\" 100, \"WONK\" 0" }}
      >
        Recent wins
      </h2>
      {wins.length === 0 ? (
        <div
          className="rounded-lg border"
          style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-border)" }}
        >
          <p className="text-sm text-text-secondary px-4 py-4" data-testid="parent-recent-wins-empty">
            Wins will show up here as {swimmerFirstName} levels up.
          </p>
        </div>
      ) : (
        <div
          className="rounded-lg border h-full"
          style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-border)" }}
          data-testid="parent-recent-wins-list"
        >
          <ul className="flex flex-col h-full">
            {wins.map((win, index) => (
              <li
                key={`${win.skillSlug}-${win.kind}-${index}`}
                className="flex items-center gap-3 px-4 py-3 flex-1"
                style={index > 0 ? { borderTop: "1px solid var(--color-border)" } : undefined}
                data-testid="parent-recent-win"
              >
                <WinIcon kind={win.kind} />
                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                  <span className="text-sm font-semibold text-text">{win.headline}</span>
                  <span className="text-xs text-text-secondary">{formatShortMonthDay(win.sessionDate)}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function WinIcon({ kind }: { kind: RecentWin["kind"] }) {
  return (
    <span
      className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
      style={{
        backgroundColor: "color-mix(in oklab, var(--color-accent) 18%, var(--color-background))",
      }}
      aria-hidden="true"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 18 18"
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {kind === "raceHeld" ? (
          <>
            <path d="M4 16V2" />
            <path d="M4 3h10l-2.5 3.5L14 10H4" />
          </>
        ) : (
          <>
            <path d="M9 15V3" />
            <path d="M4 8l5-5 5 5" />
          </>
        )}
      </svg>
    </span>
  );
}
