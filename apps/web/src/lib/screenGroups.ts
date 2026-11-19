// Pass 3 progress-page assembly. Turns a flat `SkillProgress[]` (coach or
// parent-shaped) into the nine evaluate-screen groups the user asked for,
// sectioned exactly like `SCREEN_SECTIONS`. A skill that appears in more
// than one section (push-off, streamline-in-motion, wall approach, UDKs,
// breakouts, turns) shows under each group it belongs to with the same
// underlying grade — the shape re-uses the same `SkillProgress` object
// across appearances so the current grade, history, and shared-skill
// handling stay in lockstep with the evaluate screens.

import {
  PROGRESS_GROUP_LABELS,
  SCREEN_SECTIONS,
  SCREEN_SLUGS,
  type CategoriesResponse,
  type ScreenSlug,
  type SkillCurrentLevel,
  type StartGradeResult,
  type Stroke,
} from "@swim-app/shared";

// Per-stroke "Freestyle" / "Backstroke" / "Breaststroke" / "Butterfly".
// Used to disambiguate skill names that exist in more than one stroke
// (breakout, underwater dolphin kick, catch, pull, etc.) on the progress
// page row list.
const STROKE_LABEL: Record<Stroke, string> = {
  free: "freestyle",
  back: "backstroke",
  breast: "breaststroke",
  fly: "butterfly",
};

export interface CatalogIndexEntry {
  skillId: string;
  slug: string;
  rawName: string;
  // Name decorated with a stroke suffix when another skill shares the
  // same raw name — "Breakout (freestyle)" rather than just "Breakout".
  // Shared single-grade skills (push-off, streamline, wall-approach) have
  // stroke: null in the catalog, so they stay undecorated, which is what
  // the progress-page spec asks for.
  displayName: string;
  categoryId: string;
  categoryName: string;
  type: "rubric" | "measured" | "score" | "composite" | "rollup";
  unit: string | null;
  ratedPerSide: boolean;
  parentSkillId: string | null;
}

// Build a slug → catalog entry map that also carries the stroke-decorated
// display name. The display rule: if another skill in the catalog shares
// this name AND this skill is scoped to a single stroke, append " (<stroke>)";
// otherwise leave the name alone.
export function buildCatalogIndex(
  categories: CategoriesResponse,
): Map<string, CatalogIndexEntry> {
  const nameCount = new Map<string, number>();
  for (const cat of categories) {
    for (const skill of cat.skills) {
      nameCount.set(skill.name, (nameCount.get(skill.name) ?? 0) + 1);
    }
  }
  const out = new Map<string, CatalogIndexEntry>();
  for (const cat of categories) {
    for (const skill of cat.skills) {
      const shared = (nameCount.get(skill.name) ?? 0) > 1;
      const displayName =
        shared && skill.stroke !== null
          ? `${skill.name} (${STROKE_LABEL[skill.stroke]})`
          : skill.name;
      out.set(skill.slug, {
        skillId: skill.id,
        slug: skill.slug,
        rawName: skill.name,
        displayName,
        categoryId: cat.id,
        categoryName: cat.name,
        type: skill.type,
        unit: skill.unit,
        ratedPerSide: skill.ratedPerSide,
        parentSkillId: skill.parentSkillId,
      });
    }
  }
  return out;
}

// Map a composite start's StartGradeResult to the SkillCurrentLevel shape
// the per-skill row component expects. in_progress collapses to null so
// the composite row reads as "Not rated yet" via the same unrated-path
// non-composite skills use. graded/not_legal/no_concept map to the usual
// three grade shapes.
export function startGradeToCurrentLevel(
  grade: StartGradeResult,
): SkillCurrentLevel | null {
  const empty = {
    capacityValue: null,
    capacityUnit: null,
    measurementValue: null,
    measurementUnit: null,
  } as const;
  switch (grade.status) {
    case "graded":
      return { grade: grade.grade, notLegal: false, noConcept: false, ...empty };
    case "not_legal":
      return { grade: null, notLegal: true, noConcept: false, ...empty };
    case "no_concept":
      return { grade: null, notLegal: false, noConcept: true, ...empty };
    case "in_progress":
      return null;
  }
}

// Shape consumed by the per-section renderer in each panel. Every section
// returned by activeGroupSectionSlugs lists its slugs verbatim from
// SCREEN_SECTIONS — the caller resolves each slug to a row (rated,
// composite, or unrated placeholder) using its own type-specific builder.
// Keeps the type-parametric Skill helper out of this module.
export function activeGroupSectionSlugs(
  screenSlug: ScreenSlug,
): Array<{ name: string; slugs: string[] }> {
  return SCREEN_SECTIONS[screenSlug].map((section) => {
    const seen = new Set<string>();
    const slugs: string[] = [];
    for (const slug of section.slugs) {
      if (seen.has(slug)) continue;
      seen.add(slug);
      slugs.push(slug);
    }
    return { name: section.name, slugs };
  });
}

// Minimum shape every progress page skill offers. Coach and parent both
// satisfy this; we accept the loose form so one helper serves both.
interface SkillMinimal {
  slug: string;
}

export interface ScreenGroupSection<Skill extends SkillMinimal> {
  name: string;
  skills: Skill[];
}

export interface ScreenGroup<Skill extends SkillMinimal> {
  screenSlug: ScreenSlug;
  name: string;
  sections: ScreenGroupSection<Skill>[];
}

// Assemble the nine ordered groups. Every group is returned even if it's
// empty for the current swimmer — the group switcher needs the full list
// so a coach can navigate to an empty "IM turns" (and the row area
// renders "Not rated yet" for every row it contains).
export function buildScreenGroups<Skill extends SkillMinimal>(
  skills: ReadonlyArray<Skill>,
): ScreenGroup<Skill>[] {
  const bySlug = new Map<string, Skill>();
  for (const skill of skills) {
    bySlug.set(skill.slug, skill);
  }
  return SCREEN_SLUGS.map((screenSlug) => {
    const sections = SCREEN_SECTIONS[screenSlug]
      .map((section) => {
        const resolved: Skill[] = [];
        const seen = new Set<string>();
        for (const slug of section.slugs) {
          if (seen.has(slug)) continue;
          seen.add(slug);
          const skill = bySlug.get(slug);
          if (skill !== undefined) resolved.push(skill);
        }
        return { name: section.name, skills: resolved };
      })
      // Drop sections that resolve to nothing (e.g., Finish when the
      // swimmer has no finishing rating yet) so the row area stays tight.
      .filter((section) => section.skills.length > 0);
    return {
      screenSlug,
      name: PROGRESS_GROUP_LABELS[screenSlug],
      sections,
    };
  });
}

// Group that should be selected on initial render. Picks the first group
// with any assessed skills. Falls back to "fundamentals" so the page
// always has something to show — even for a swimmer with zero data, the
// switcher is in a predictable state.
export function initialVisibleGroup<Skill extends SkillMinimal>(
  groups: ReadonlyArray<ScreenGroup<Skill>>,
): ScreenSlug {
  for (const group of groups) {
    const total = group.sections.reduce((sum, section) => sum + section.skills.length, 0);
    if (total > 0) return group.screenSlug;
  }
  return "fundamentals";
}
