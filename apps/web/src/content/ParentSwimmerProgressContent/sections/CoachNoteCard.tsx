import type { LatestCoachingPriority } from "@swim-app/shared";
import { coachPriorityByline } from "../helpers";

interface CoachNoteCardProps {
  latestPriority: LatestCoachingPriority | null;
}

// Coach's note card — the latest priority text in the coach's words
// with a right-aligned byline. Split out of CoachFocus so the parent
// page's responsive layout can place the note in one grid cell and the
// three focus cards in another.
//
// Returns null when there is no latest priority on the response. The
// surrounding layout decides whether a nothing-to-show empty state
// should appear elsewhere (CoachFocusList carries that copy).
export default function CoachNoteCard({ latestPriority }: CoachNoteCardProps) {
  if (!latestPriority) return null;

  return (
    <section
      className="rounded-lg border p-4 flex flex-col gap-3"
      style={{
        backgroundColor: "var(--color-background)",
        borderColor: "var(--color-border)",
      }}
      aria-labelledby="parent-coach-note-heading"
      data-testid="parent-coach-focus-note"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="parent-coach-note-heading"
          className="text-base font-heading text-text"
          style={{ fontVariationSettings: "\"SOFT\" 100, \"WONK\" 0" }}
        >
          Coach's focus
        </h2>
        <span className="text-xs text-text-secondary" data-testid="parent-coach-focus-byline">
          {coachPriorityByline(latestPriority.sessionDate, latestPriority.coachName)}
        </span>
      </div>
      <p className="text-sm text-text">{latestPriority.text}</p>
    </section>
  );
}
