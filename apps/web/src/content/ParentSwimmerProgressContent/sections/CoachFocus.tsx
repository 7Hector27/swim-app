import type { LatestCoachingPriority, ProgressCoachingPriority } from "@swim-app/shared";
import { coachPriorityByline } from "../helpers";

interface CoachFocusProps {
  latestPriority: LatestCoachingPriority | null;
  workingOnNext: ReadonlyArray<ProgressCoachingPriority>;
  coachName: string | null;
}

// Coach's focus card: the latest coaching priority verbatim with a byline
// ("From Coach Jason, Nov 17") and, underneath, a plain list of the
// current skills the coach is targeting ("Working on next"). Replaces
// the arrow-chain list from the old parent page — parents told us the
// arrows read like a maze. One line per priority skill is cleaner.
export default function CoachFocus({ latestPriority, workingOnNext, coachName }: CoachFocusProps) {
  if (!latestPriority && workingOnNext.length === 0) return null;

  return (
    <section
      className="flex flex-col gap-3"
      aria-labelledby="parent-coach-focus-heading"
      data-testid="parent-progress-coach-focus"
    >
      <h2
        id="parent-coach-focus-heading"
        className="text-lg font-heading text-text"
        style={{ fontVariationSettings: "\"SOFT\" 100, \"WONK\" 0" }}
      >
        Coach's focus
      </h2>
      <div
        className="rounded-lg p-4 flex flex-col gap-3 border"
        style={{
          backgroundColor: "var(--color-background)",
          borderColor: "var(--color-border)",
        }}
      >
        {latestPriority && (
          <>
            <p className="text-sm text-text" data-testid="parent-coach-focus-text">
              {latestPriority.text}
            </p>
            <p className="text-xs text-text-secondary">
              {coachPriorityByline(latestPriority.sessionDate, coachName)}
            </p>
          </>
        )}
        {workingOnNext.length > 0 && (
          <div
            className="flex flex-col gap-2 pt-3"
            style={{ borderTop: latestPriority ? "1px solid var(--color-border)" : "none" }}
          >
            <span className="text-xs font-semibold text-text">Working on next</span>
            <ul className="flex flex-col gap-1">
              {workingOnNext.map((priority) => (
                <li key={priority.targetSlug} className="text-sm text-text">
                  {priority.targetName}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
