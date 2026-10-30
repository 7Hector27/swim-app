import type { GetEvaluationsItem } from "@swim-app/shared";

interface EvaluationsListProps {
  swimmerId: string;
  evaluations: GetEvaluationsItem[];
  // Deep-link target to return to after a save completes. The signup
  // `isSafeReturnTo` helper validates this on the server before redirecting.
  returnTo: string;
}

// Session dates are YYYY-MM-DD without a timezone. Build the instant at
// noon UTC so the LA formatter resolves to the same calendar day on server
// and client (same pattern as the chart components).
function formatSessionDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Los_Angeles",
  }).format(new Date(Date.UTC(year!, month! - 1, day!, 12)));
}

export default function EvaluationsList({
  swimmerId,
  evaluations,
  returnTo,
}: EvaluationsListProps) {
  return (
    <ul className="flex flex-col divide-y divide-border">
      {evaluations.map((item) => (
        <li
          key={item.sessionId}
          className="py-3 first:pt-0 last:pb-0 flex items-start gap-3 tablet:items-center tablet:gap-6"
          data-testid="evaluations-list-row"
        >
          <div className="flex-1 min-w-0 flex flex-col gap-1 tablet:flex-row tablet:items-baseline tablet:gap-4">
            <div className="flex items-center gap-2 flex-wrap shrink-0">
              <span className="font-bold text-sm text-text whitespace-nowrap">
                {formatSessionDate(item.sessionDate)}
              </span>
              <span className="text-xs text-text-secondary">{item.screenName}</span>
              {item.edited && (
                <span
                  data-testid="evaluations-list-edited-pill"
                  className="text-[11px] font-semibold px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: "var(--color-border)", color: "var(--color-text)" }}
                >
                  Edited
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <span className="text-xs text-text-secondary tabular-nums shrink-0">
                {item.ratingCount === 1 ? "1 rating" : `${item.ratingCount} ratings`}
              </span>
              {item.coachingPriority && (
                <span className="text-sm text-text-secondary truncate">
                  {item.coachingPriority}
                </span>
              )}
            </div>
          </div>
          <a
            href={`/coach/swimmers/${swimmerId}/evaluate?editSession=${encodeURIComponent(item.sessionId)}&returnTo=${encodeURIComponent(returnTo)}`}
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center px-3 rounded-[var(--radius-button)] text-sm font-semibold border transition-transform duration-150 active:scale-[0.97]"
            style={{
              borderColor: "var(--color-border)",
              color: "var(--color-text)",
              transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
            }}
            data-testid="evaluations-list-edit-link"
            aria-label={`Edit evaluation from ${formatSessionDate(item.sessionDate)}`}
          >
            <span className="sr-only tablet:not-sr-only">Edit</span>
            <span aria-hidden="true" className="tablet:hidden">
              ✎
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
