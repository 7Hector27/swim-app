"use client";

import { useMemo, useState } from "react";
import {
  PROGRESS_GROUP_LABELS,
  SCREEN_SLUGS,
  type CategoriesResponse,
  type ParentSwimmerProgressResponse,
  type ScreenSlug,
} from "@swim-app/shared";
import ScreenGroupSwitcher, { type ScreenGroupSwitcherOption } from "@/components/ScreenGroupSwitcher";
import {
  activeGroupSectionSlugs,
  buildCatalogIndex,
  buildScreenGroups,
  initialVisibleGroup,
  startGradeToCurrentLevel,
  type CatalogIndexEntry,
} from "@/lib/screenGroups";
import ParentSkillProgressRow from "./ParentSkillProgressRow";

type ParentSkillProgress = ParentSwimmerProgressResponse["skills"][number];
type ParentStartProgress = ParentSwimmerProgressResponse["startProgress"][number];

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
  startProgress: ReadonlyArray<ParentStartProgress>;
  categories: CategoriesResponse;
  nowIso: string;
  rollups: ReadonlyArray<GroupRollupLoose>;
}

// Pass 3 parent-facing version. Same nine groups + switcher as the coach
// page. No coach-only affordances (fault tags, Edit links) — those come
// from props that aren't passed here.
export default function ParentStrokeGroupsPanel({
  skills,
  startProgress,
  categories,
  nowIso,
  rollups,
}: ParentStrokeGroupsPanelProps) {
  const catalogIndex = useMemo(() => buildCatalogIndex(categories), [categories]);
  const ratedBySlug = useMemo(() => {
    const map = new Map<string, ParentSkillProgress>();
    for (const skill of skills) map.set(skill.slug, skill);
    return map;
  }, [skills]);
  const startBySlug = useMemo(() => {
    const map = new Map<string, ParentStartProgress>();
    for (const start of startProgress) map.set(start.slug, start);
    return map;
  }, [startProgress]);

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

  const activeSections = useMemo(() => activeGroupSectionSlugs(active), [active]);
  const activeGroupName = PROGRESS_GROUP_LABELS[active];
  const resolvedSections = useMemo(() => {
    return activeSections.map((section) => {
      const rated: ParentSkillProgress[] = [];
      const unrated: ParentSkillProgress[] = [];
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
          <h3 className="font-bold text-sm text-text">{activeGroupName}</h3>
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
            Nothing to show in this group yet. Check back after the next practice session.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {resolvedSections.map((section) => {
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
                    <ul className="flex flex-col gap-0">
                      {rows.map((skill) => (
                        <ParentSkillProgressRow
                          key={`${active}:${section.name}:${skill.slug}`}
                          skill={skill}
                          nowIso={nowIso}
                        />
                      ))}
                    </ul>
                  )}
                  {unratedRows.length > 0 && (
                    <details className="group">
                      <summary
                        className="text-xs font-semibold cursor-pointer list-none flex items-center gap-2 py-2 min-h-[44px]"
                        style={{ color: "var(--color-link)" }}
                      >
                        <span
                          aria-hidden="true"
                          className="transition-transform duration-200 group-open:rotate-90"
                        >
                          ›
                        </span>
                        <span>{unratedRows.length} not rated yet</span>
                      </summary>
                      <ul className="flex flex-col gap-0">
                        {unratedRows.map((skill) => (
                          <ParentSkillProgressRow
                            key={`${active}:${section.name}:${skill.slug}`}
                            skill={skill}
                            nowIso={nowIso}
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

function resolveRow(
  slug: string,
  ratedBySlug: Map<string, ParentSkillProgress>,
  startBySlug: Map<string, ParentStartProgress>,
  catalogIndex: Map<string, CatalogIndexEntry>,
): ParentSkillProgress | null {
  const catalog = catalogIndex.get(slug);
  const rated = ratedBySlug.get(slug);
  if (rated !== undefined) {
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
