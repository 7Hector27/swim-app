"use client";

import { useState } from "react";
import {
  SCREEN_SLUGS,
  type ScreenSlug,
  type SwimmerProgressResponse,
} from "@swim-app/shared";
import ScreenGroupSwitcher, { type ScreenGroupSwitcherOption } from "@/components/ScreenGroupSwitcher";
import type { EvaluationEditContext } from "@/lib/evaluationEditHref";
import { buildScreenGroups, initialVisibleGroup } from "@/lib/screenGroups";
import SkillRow from "./SkillRow";

type SkillProgress = SwimmerProgressResponse["skills"][number];

// The schema's `screenSlug` field is `z.string()` to avoid coupling
// the schema layer to ScreenSlug — narrow at this boundary.
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

interface StrokeGroupsPanelProps {
  skills: ReadonlyArray<SkillProgress>;
  swimmerId: string;
  nowIso: string;
  editContext: EvaluationEditContext;
  // Per-group rollups for the latest session; drives the assessed/total
  // badges in the switcher and the header count next to the group name.
  rollups: ReadonlyArray<GroupRollupLoose>;
}

// Pass 3: one evaluate-screen group visible at a time, with a horizontal
// switcher. Client-side so the active group lives in React state.
export default function StrokeGroupsPanel({
  skills,
  swimmerId,
  nowIso,
  editContext,
  rollups,
}: StrokeGroupsPanelProps) {
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
            <h3 className="text-base font-heading text-text">
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
              Nothing rated in this group yet. Score a session to populate it.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {activeGroup.sections.map((section) => (
                <section key={`${activeGroup.screenSlug}:${section.name}`} className="flex flex-col gap-1">
                  <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
                    {section.name}
                  </h4>
                  <ul className="flex flex-col">
                    {section.skills.map((skill) => (
                      <SkillRow
                        key={`${activeGroup.screenSlug}:${section.name}:${skill.slug}`}
                        skill={skill}
                        swimmerId={swimmerId}
                        nowIso={nowIso}
                        editContext={editContext}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
