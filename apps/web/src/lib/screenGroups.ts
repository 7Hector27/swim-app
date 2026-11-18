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
  type ScreenSlug,
} from "@swim-app/shared";

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
