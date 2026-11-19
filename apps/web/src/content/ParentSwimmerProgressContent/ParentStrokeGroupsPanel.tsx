"use client";

import { useState } from "react";
import {
  SCREEN_SLUGS,
  type ParentSwimmerProgressResponse,
  type ScreenSlug,
} from "@swim-app/shared";
import ScreenGroupSwitcher, { type ScreenGroupSwitcherOption } from "@/components/ScreenGroupSwitcher";
import { buildScreenGroups, initialVisibleGroup } from "@/lib/screenGroups";
import ParentSkillProgressRow from "./ParentSkillProgressRow";

type ParentSkillProgress = ParentSwimmerProgressResponse["skills"][number];

interface GroupRollupLoose {
  screenSlug: string;
  name: string;
  average: number | null;
  assessedCount: number;
  totalCount: number;
}

function toScreenSlug(slug: string): ScreenSlug | null {
  return (SCREEN_SLUGS as readonly string[]).includes(slug) ? (slug as ScreenSlug) : null;
}

interface ParentStrokeGroupsPanelProps {
  skills: ReadonlyArray<ParentSkillProgress>;
  nowIso: string;
  rollups: ReadonlyArray<GroupRollupLoose>;
}

// Pass 3 parent-facing version. Same nine groups + switcher as the coach
// page. No coach-only affordances (fault tags, Edit links) — those come
// from props that aren't passed here.
export default function ParentStrokeGroupsPanel({
  skills,
  nowIso,
  rollups,
}: ParentStrokeGroupsPanelProps) {
  const groups = buildScreenGroups(skills);
  const [active, setActive] = useState<ScreenSlug>(() => initialVisibleGroup(groups));
  const activeGroup = groups.find((group) => group.screenSlug === active) ?? groups[0];
  const activeRollup = rollups.find((rollup) => toScreenSlug(rollup.screenSlug) === active) ?? null;

  const options: ScreenGroupSwitcherOption[] = groups.map((group) => {
    const rollup = rollups.find((r) => toScreenSlug(r.screenSlug) === group.screenSlug);
    return {
      screenSlug: group.screenSlug,
      name: group.name,
      assessedCount: rollup?.assessedCount ?? 0,
      totalCount: rollup?.totalCount ?? 0,
    };
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="sticky top-0 z-10 bg-background border-b border-border">
        <ScreenGroupSwitcher options={options} active={active} onChange={setActive} />
      </div>

      {activeGroup && (
        <div className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <h3 className="font-bold text-sm text-text">
              {activeGroup.name}
            </h3>
            {activeRollup && (
              <span className="text-xs text-text-secondary tabular-nums">
                {activeRollup.average !== null && (
                  <>Average {activeRollup.average.toFixed(1)} · </>
                )}
                {activeRollup.assessedCount} of {activeRollup.totalCount} skills rated
              </span>
            )}
          </div>

          {activeGroup.sections.length === 0 ? (
            <p className="text-sm text-text-secondary">
              Nothing rated in this group yet. Check back after the next practice session.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {activeGroup.sections.map((section) => {
                // Hide the per-section label when the group has exactly one
                // section and the section name is the group name (Fundamentals,
                // Water confidence, IM turns, Racing) — showing the same word
                // twice reads as a mistake. Case-insensitive because the
                // section name uses title case ("Water Confidence") while the
                // group label is sentence case ("Water confidence").
                const hideSectionLabel =
                  activeGroup.sections.length === 1 &&
                  section.name.toLowerCase() === activeGroup.name.toLowerCase();
                return (
                  <section key={`${activeGroup.screenSlug}:${section.name}`} className="flex flex-col gap-1">
                    {!hideSectionLabel && (
                      <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
                        {section.name}
                      </h4>
                    )}
                    <ul className="flex flex-col gap-0">
                      {section.skills.map((skill) => (
                        <ParentSkillProgressRow
                          key={`${activeGroup.screenSlug}:${section.name}:${skill.slug}`}
                          skill={skill}
                          nowIso={nowIso}
                        />
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
