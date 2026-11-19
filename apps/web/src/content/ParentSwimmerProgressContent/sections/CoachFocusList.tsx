import type {
  ParentSkillProgress,
  ProgressCoachingPriority,
} from "@swim-app/shared";
import { LEVEL_NAMES } from "@/components/LevelLadder/helpers";
import type { CatalogIndexEntry } from "@/lib/screenGroups";
import { rowLevelLabel, rowPipCount } from "../helpers";

interface CoachFocusListProps {
  // Raw list from the parent response. The list is capped at 3 here —
  // matching the coach page's WhatToWorkOn — so a 50-skill priority
  // list doesn't bury the section.
  workingOnNext: ReadonlyArray<ProgressCoachingPriority>;
  swimmerFirstName: string;
  skillsBySlug: ReadonlyMap<string, ParentSkillProgress>;
  catalogIndex: ReadonlyMap<string, CatalogIndexEntry>;
}

// Working-on-next list — up to three focus cards. Tablet and desktop
// always render them as one even row of N cards, where N is the actual
// count — never a 2+1 wrap. Phone stacks one per row.
//
// Empty state ("Nothing flagged right now. <Name> is on track.") fires
// when the list is empty.
export default function CoachFocusList({
  workingOnNext,
  swimmerFirstName,
  skillsBySlug,
  catalogIndex,
}: CoachFocusListProps) {
  const topPriorities = workingOnNext.slice(0, 3);

  if (topPriorities.length === 0) {
    return (
      <div
        className="rounded-lg border p-4"
        style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-border)" }}
        data-testid="parent-coach-focus-empty"
      >
        <p className="text-sm text-text">
          Nothing flagged right now. {swimmerFirstName} is on track.
        </p>
      </div>
    );
  }

  // Grid column count equals the number of cards on tablet+. With 1 or
  // 2 priorities the row still reads evenly (never a 2+1 wrap for
  // N === 3, never a single-wide card for N === 2). Phone stacks.
  const cardCount = topPriorities.length as 1 | 2 | 3;
  const gridClass =
    cardCount === 1
      ? "grid gap-3 tablet:grid-cols-1"
      : cardCount === 2
        ? "grid gap-3 tablet:grid-cols-2"
        : "grid gap-3 tablet:grid-cols-3";

  return (
    <div
      className={gridClass}
      data-testid="parent-coach-focus-list"
      data-card-count={cardCount}
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
