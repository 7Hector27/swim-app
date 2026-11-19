"use client";

import { useMemo, useState } from "react";
import {
  PROGRESS_GROUP_LABELS,
  SCREEN_SLUGS,
  type CategoriesResponse,
  type ScreenSlug,
  type SwimmerProgressResponse,
} from "@swim-app/shared";
import ScreenGroupSwitcher, { type ScreenGroupSwitcherOption } from "@/components/ScreenGroupSwitcher";
import type { EvaluationEditContext } from "@/lib/evaluationEditHref";
import {
  activeGroupSectionSlugs,
  buildCatalogIndex,
  buildScreenGroups,
  initialVisibleGroup,
  startGradeToCurrentLevel,
  type CatalogIndexEntry,
} from "@/lib/screenGroups";
import SkillRow from "./SkillRow";

type SkillProgress = SwimmerProgressResponse["skills"][number];
type StartProgress = SwimmerProgressResponse["startProgress"][number];

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
  startProgress: ReadonlyArray<StartProgress>;
  categories: CategoriesResponse;
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
  startProgress,
  categories,
  swimmerId,
  nowIso,
  editContext,
  rollups,
}: StrokeGroupsPanelProps) {
  const catalogIndex = useMemo(() => buildCatalogIndex(categories), [categories]);
  const ratedBySlug = useMemo(() => {
    const map = new Map<string, SkillProgress>();
    for (const skill of skills) map.set(skill.slug, skill);
    return map;
  }, [skills]);
  const startBySlug = useMemo(() => {
    const map = new Map<string, StartProgress>();
    for (const start of startProgress) map.set(start.slug, start);
    return map;
  }, [startProgress]);

  // First group with any rated row from the API's progress.skills.
  // `buildScreenGroups` is unchanged and still serves this one job.
  const [active, setActive] = useState<ScreenSlug>(() =>
    initialVisibleGroup(buildScreenGroups(skills)),
  );
  const activeRollup = rollups.find((rollup) => toScreenSlug(rollup.screenSlug) === active) ?? null;

  const options: ScreenGroupSwitcherOption[] = SCREEN_SLUGS.map((screenSlug) => {
    const rollup = rollups.find((r) => toScreenSlug(r.screenSlug) === screenSlug);
    return {
      screenSlug,
      name: PROGRESS_GROUP_LABELS[screenSlug],
      assessedCount: rollup?.assessedCount ?? 0,
      totalCount: rollup?.totalCount ?? 0,
    };
  });

  const activeSections = useMemo(
    () => activeGroupSectionSlugs(active),
    [active],
  );
  const activeGroupName = PROGRESS_GROUP_LABELS[active];
  // Resolve each slug under the active group to a row (rated skill,
  // composite start synthesized from startProgress, or an unrated
  // placeholder from the catalog) and split into rated/unrated so the
  // UI can render rated rows first and tuck the "Not rated yet" rows
  // behind a collapsible line.
  const resolvedSections = useMemo(() => {
    return activeSections.map((section) => {
      const rated: SkillProgress[] = [];
      const unrated: SkillProgress[] = [];
      for (const slug of section.slugs) {
        const entry = resolveRow(slug, ratedBySlug, startBySlug, catalogIndex);
        if (entry === null) continue;
        const isRated =
          entry.current !== null || entry.currentLeft !== null || entry.currentRight !== null;
        (isRated ? rated : unrated).push(entry);
      }
      return { name: section.name, rated, unrated };
    });
  }, [activeSections, ratedBySlug, startBySlug, catalogIndex]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <ScreenGroupSwitcher options={options} active={active} onChange={setActive} />
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <h3 className="text-base font-heading text-text">{activeGroupName}</h3>
          {activeRollup && (
            <span className="text-xs text-text-secondary tabular-nums">
              {activeRollup.average !== null && (
                <>Average {activeRollup.average.toFixed(1)} · </>
              )}
              {activeRollup.assessedCount} of {activeRollup.totalCount} skills rated
            </span>
          )}
        </div>

        {resolvedSections.length === 0 ? (
          <p className="text-sm text-text-secondary">
            Nothing to show in this group yet.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {resolvedSections.map((section) => {
              // Hide the per-section label when the group has exactly one
              // section and the section name is the group name (Fundamentals,
              // Water confidence, IM turns, Racing) — showing the same word
              // twice reads as a mistake. Case-insensitive because the
              // section name uses title case ("Water Confidence") while the
              // group label is sentence case ("Water confidence").
              const hideSectionLabel =
                resolvedSections.length === 1 &&
                section.name.toLowerCase() === activeGroupName.toLowerCase();
              const rows = section.rated;
              const unratedRows = section.unrated;
              return (
                <section key={`${active}:${section.name}`} className="flex flex-col gap-1">
                  {!hideSectionLabel && (
                    <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
                      {section.name}
                    </h4>
                  )}
                  {rows.length > 0 && (
                    <ul className="flex flex-col">
                      {rows.map((skill) => (
                        <SkillRow
                          key={`${active}:${section.name}:${skill.slug}`}
                          skill={skill}
                          swimmerId={swimmerId}
                          nowIso={nowIso}
                          editContext={editContext}
                        />
                      ))}
                    </ul>
                  )}
                  {unratedRows.length > 0 && (
                    <details className="group">
                      <summary
                        className="text-xs font-semibold cursor-pointer list-none flex items-center gap-2 py-2 min-h-[44px] text-link"
                      >
                        <span
                          aria-hidden="true"
                          className="transition-transform duration-200 group-open:rotate-90"
                        >
                          ›
                        </span>
                        <span>
                          {unratedRows.length} not rated yet
                        </span>
                      </summary>
                      <ul className="flex flex-col">
                        {unratedRows.map((skill) => (
                          <SkillRow
                            key={`${active}:${section.name}:${skill.slug}`}
                            skill={skill}
                            swimmerId={swimmerId}
                            nowIso={nowIso}
                            editContext={editContext}
                          />
                        ))}
                      </ul>
                    </details>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// Resolve a SCREEN_SECTIONS slug to a SkillProgress-shaped row:
// 1. If the API returned a rated entry under this slug, use it.
// 2. Else if the slug is a composite start parent, synthesize one from
//    its StartProgress entry. in_progress collapses to current=null so
//    the row reads as "Not rated yet".
// 3. Else, if the slug is in the catalog, synthesize an unrated
//    placeholder.
// Returns null when the slug isn't in the catalog at all (defensive —
// shouldn't happen on a synced DB).
function resolveRow(
  slug: string,
  ratedBySlug: Map<string, SkillProgress>,
  startBySlug: Map<string, StartProgress>,
  catalogIndex: Map<string, CatalogIndexEntry>,
): SkillProgress | null {
  const catalog = catalogIndex.get(slug);
  const rated = ratedBySlug.get(slug);
  if (rated !== undefined) {
    // Preserve the API's rated entry but swap in the catalog's
    // stroke-decorated display name so "Breakout" reads as
    // "Breakout (freestyle)" in a mixed list.
    return catalog && catalog.displayName !== rated.name
      ? { ...rated, name: catalog.displayName }
      : rated;
  }
  const start = startBySlug.get(slug);
  if (start !== undefined) {
    if (catalog === undefined) return null;
    return {
      skillId: catalog.skillId,
      slug: catalog.slug,
      name: catalog.displayName,
      categoryId: catalog.categoryId,
      categoryName: catalog.categoryName,
      type: "composite",
      unit: null,
      ratedPerSide: false,
      parentSkillId: null,
      current: startGradeToCurrentLevel(start.grade),
      currentLeft: null,
      currentRight: null,
      history: [],
    };
  }
  if (catalog === undefined) return null;
  return {
    skillId: catalog.skillId,
    slug: catalog.slug,
    name: catalog.displayName,
    categoryId: catalog.categoryId,
    categoryName: catalog.categoryName,
    type: catalog.type,
    unit: catalog.unit,
    ratedPerSide: catalog.ratedPerSide,
    parentSkillId: catalog.parentSkillId,
    current: null,
    currentLeft: null,
    currentRight: null,
    history: [],
  };
}
