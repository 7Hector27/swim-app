import { formatShortMonthDay, type RecentWin } from "../helpers";

interface RecentWinsProps {
  wins: ReadonlyArray<RecentWin>;
  swimmerFirstName: string;
}

// Up to three recent wins. Switches between two visual forms via
// viewport CSS so the component mounts once and keeps a single DOM
// node per section:
//
//   - Phone + desktop: stacked list inside a single card. Desktop
//     uses this form because the wins sit in the narrow right column
//     of the 12-col grid where cards would be cramped.
//   - Tablet (769-1247px): 1-up / 2-up / 3-up card grid matching the
//     actual win count so the row never leaves a lonely third column.
//
// Empty state carries the "Wins will show up here as <name> levels
// up." copy; CSS routes it to the right surface regardless of form.
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
        <>
          {/* List variant — visible on phone and on desktop (hidden
              only at the tablet range). */}
          <div
            className="tablet:max-desktop:hidden rounded-lg border h-full"
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
                    <span className="text-sm font-semibold text-text truncate">{win.headline}</span>
                    <span className="text-xs text-text-secondary">{formatShortMonthDay(win.sessionDate)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          {/* Cards variant — tablet only. Column count matches the
              actual win count so 1/2 priorities don't leave gaps. */}
          <div
            className={`hidden tablet:max-desktop:grid gap-3 ${
              wins.length === 1
                ? "tablet:grid-cols-1"
                : wins.length === 2
                  ? "tablet:grid-cols-2"
                  : "tablet:grid-cols-3"
            }`}
            data-testid="parent-recent-wins-cards"
          >
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
                  <span className="text-xs text-text-secondary">{formatShortMonthDay(win.sessionDate)}</span>
                </div>
              </div>
            ))}
          </div>
        </>
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
