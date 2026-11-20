import type {
  LatestCoachingPriority,
  ParentSkillProgress,
  ProgressCoachingPriority,
} from "@swim-app/shared";
import { LEVEL_NAMES } from "@/components/LevelLadder/helpers";
import type { CatalogIndexEntry } from "@/lib/screenGroups";
import { coachPriorityByline, rowLevelLabel, rowPipCount } from "../helpers";

interface CoachFocusProps {
  latestPriority: LatestCoachingPriority | null;
  // Raw list from the parent response. CoachFocus caps the visible list
  // at 3 — same behavior as the coach page's WhatToWorkOn — so a 50-skill
  // priority list doesn't bury the section.
  workingOnNext: ReadonlyArray<ProgressCoachingPriority>;
  swimmerFirstName: string;
  // Lookup from slug → full skill progress. Used to render each
  // priority's level, pip bar, and next-level descriptor.
  skillsBySlug: ReadonlyMap<string, ParentSkillProgress>;
  catalogIndex: ReadonlyMap<string, CatalogIndexEntry>;
}

// Coach's focus section at the top of the parent progress page.
// Structure:
//
//   - Heading on the left, "From Coach <name> · <date>" byline on the
//     right. Byline hides when there's no latest priority.
//   - Note card with the latest priority text, hidden when the swimmer
//     has never had a priority written.
//   - "Working on next" grid: up to 3 priority skills, each a card with
//     the stroke-decorated name, group, pip bar + level name, and
//     "Next: <descriptor>" when the skill has level descriptors.
//   - Empty state when the swimmer has no priorities: "Nothing flagged
//     right now. <First name> is on track."
export default function CoachFocus({
  latestPriority,
  workingOnNext,
  swimmerFirstName,
  skillsBySlug,
  catalogIndex,
}: CoachFocusProps) {
  const topPriorities = workingOnNext.slice(0, 3);
  const hasAnything = latestPriority !== null || topPriorities.length > 0;
  if (!hasAnything) {
    return (
      <section
        className="flex flex-col gap-3"
        aria-labelledby="parent-coach-focus-heading"
        data-testid="parent-progress-coach-focus"
      >
        <Heading />
        <div
          className="rounded-lg border p-4"
          style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-border)" }}
          data-testid="parent-coach-focus-empty"
        >
          <p className="text-sm text-text">
            Nothing flagged right now. {swimmerFirstName} is on track.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      className="flex flex-col gap-3"
      aria-labelledby="parent-coach-focus-heading"
      data-testid="parent-progress-coach-focus"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Heading />
        {latestPriority && (
          <span className="text-xs text-text-secondary" data-testid="parent-coach-focus-byline">
            {coachPriorityByline(latestPriority.sessionDate, latestPriority.coachFirstName)}
          </span>
        )}
      </div>

      {latestPriority && (
        <div
          className="rounded-lg border p-4"
          style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-border)" }}
          data-testid="parent-coach-focus-note"
        >
          <p className="text-sm text-text">{latestPriority.text}</p>
        </div>
      )}

      {topPriorities.length > 0 && (
        <div
          className="grid gap-3 tablet:grid-cols-2 desktop:grid-cols-3"
          data-testid="parent-coach-focus-list"
        >
          {topPriorities.map((priority) => (
            <PriorityCard
              key={priority.targetSlug}
              priority={priority}
              skill={skillsBySlug.get(priority.targetSlug) ?? null}
              catalogIndex={catalogIndex}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function Heading() {
  return (
    <h2
      id="parent-coach-focus-heading"
      className="text-lg font-heading text-text"
      style={{ fontVariationSettings: "\"SOFT\" 100, \"WONK\" 0" }}
    >
      Coach's focus
    </h2>
  );
}

// ── Per-priority card ────────────────────────────────────────────────────

interface PriorityCardProps {
  priority: ProgressCoachingPriority;
  skill: ParentSkillProgress | null;
  catalogIndex: ReadonlyMap<string, CatalogIndexEntry>;
}

function PriorityCard({ priority, skill, catalogIndex }: PriorityCardProps) {
  const catalogEntry = catalogIndex.get(priority.targetSlug);
  const displayName = catalogEntry?.displayName ?? priority.targetName;
  const groupName = catalogEntry?.categoryName ?? null;
  const levelLabel = skill ? rowLevelLabel(skill) : "Not rated";
  const pipCount = skill ? rowPipCount(skill) : null;
  const nextDescriptor = nextLevelDescriptor(skill, pipCount);

  return (
    <div
      className="rounded-lg border p-4 flex flex-col gap-2"
      style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-border)" }}
      data-testid="parent-coach-focus-card"
    >
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-sm font-semibold text-text truncate">{displayName}</span>
        {groupName && (
          <span className="text-xs text-text-secondary truncate">{groupName}</span>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <LevelPips count={pipCount} />
        <span className="text-xs text-text-secondary">{levelLabel}</span>
      </div>
      {nextDescriptor && (
        <p className="text-xs text-text-secondary" data-testid="parent-coach-focus-next">
          <span className="font-semibold text-text">Next:</span> {nextDescriptor}
        </p>
      )}
    </div>
  );
}

function nextLevelDescriptor(
  skill: ParentSkillProgress | null,
  currentLevel: 1 | 2 | 3 | 4 | 5 | null,
): string | null {
  if (!skill || !skill.levelDescriptors) return null;
  if (currentLevel === null || currentLevel >= 5) return null;
  const nextLevel = currentLevel + 1;
  const descriptor = skill.levelDescriptors[String(nextLevel)];
  if (!descriptor || descriptor.trim().length === 0) return null;
  return `${LEVEL_NAMES[nextLevel as 1 | 2 | 3 | 4 | 5]} — ${descriptor}`;
}

// ── Pip bar ──────────────────────────────────────────────────────────────

function LevelPips({ count }: { count: 1 | 2 | 3 | 4 | 5 | null }) {
  const pips: Array<1 | 2 | 3 | 4 | 5> = [1, 2, 3, 4, 5];
  return (
    <span
      className="flex gap-[3px] items-center shrink-0"
      aria-hidden="true"
      data-testid="parent-coach-focus-pips"
    >
      {pips.map((pip) => (
        <span
          key={pip}
          className="block h-2 rounded-[2px]"
          style={{
            width: "14px",
            backgroundColor: count !== null && pip <= count ? "var(--color-accent)" : "var(--color-border)",
          }}
        />
      ))}
    </span>
  );
}
