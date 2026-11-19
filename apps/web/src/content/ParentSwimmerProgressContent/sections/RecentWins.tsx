import { formatShortMonthDay, type RecentWin } from "../helpers";

interface RecentWinsProps {
  wins: ReadonlyArray<RecentWin>;
  swimmerFirstName: string;
  // On tablet the brief wants wins as three cards across; the desktop
  // side column keeps the stacked list. Phone defaults to the list too.
  // `tabletVariant` picks between the two tablet forms.
  tabletVariant?: "list" | "cards";
}

// Up to three recent wins. Empty state is the brief's one-line copy
// ("Wins will show up here as <first name> levels up.") rather than a
// hidden section — parents told us the absence of good news was itself
// confusing. Only positive events: see buildRecentWins() in helpers.
export default function RecentWins({ wins, swimmerFirstName, tabletVariant = "list" }: RecentWinsProps) {
  // The outer section's `h-full` lets the desktop grid stretch the
  // Recent wins column to match the Summary+Note stack beside it.
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
      ) : tabletVariant === "cards" ? (
        <WinCards wins={wins} />
      ) : (
        <WinList wins={wins} />
      )}
    </section>
  );
}

// ── List variant ─────────────────────────────────────────────────────────

function WinList({ wins }: { wins: ReadonlyArray<RecentWin> }) {
  return (
    <div
      className="rounded-lg border h-full"
      style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-border)" }}
    >
      <ul className="flex flex-col h-full">
        {wins.map((win, index) => (
          <li
            key={`${win.skillSlug}-${win.kind}-${index}`}
            className="flex items-center gap-3 px-4 py-3 flex-1"
            // Thin divider in the border token between rows. Starts on
            // the second item so the top row sits flush against the
            // card's own border.
            style={index > 0 ? { borderTop: "1px solid var(--color-border)" } : undefined}
            data-testid="parent-recent-win"
          >
            <WinIcon kind={win.kind} />
            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
              <span className="text-sm font-semibold text-text truncate">{win.headline}</span>
              <span className="text-xs text-text-secondary">
                {formatShortMonthDay(win.sessionDate)}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Cards variant (tablet) ──────────────────────────────────────────────

function WinCards({ wins }: { wins: ReadonlyArray<RecentWin> }) {
  // Grid column count follows the actual number of wins so N === 1 or
  // 2 still reads evenly instead of leaving a lonely third column.
  // Falls back to the list variant on phone (single column).
  const columns = wins.length === 1 ? "tablet:grid-cols-1" : wins.length === 2 ? "tablet:grid-cols-2" : "tablet:grid-cols-3";
  return (
    <div className={`grid grid-cols-1 gap-3 ${columns}`}>
      {wins.map((win, index) => (
        <div
          key={`${win.skillSlug}-${win.kind}-${index}`}
          className="rounded-lg border p-4 flex items-start gap-3"
          style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-border)" }}
          data-testid="parent-recent-win"
        >
          <WinIcon kind={win.kind} />
          <div className="flex flex-col gap-0.5 min-w-0 flex-1">
            <span className="text-sm font-semibold text-text">{win.headline}</span>
            <span className="text-xs text-text-secondary">
              {formatShortMonthDay(win.sessionDate)}
            </span>
          </div>
        </div>
      ))}
    </div>
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
