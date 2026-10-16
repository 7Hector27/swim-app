export type EvaluateState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "saved"; sessionId: string; ratingIds: string[] };

export function mapSubmitResponse(httpStatus: number, body: unknown): EvaluateState {
  if (httpStatus === 201) {
    const parsed = typeof body === "object" && body !== null ? (body as { sessionId?: unknown; ratingIds?: unknown }) : {};
    if (
      typeof parsed.sessionId === "string" &&
      Array.isArray(parsed.ratingIds) &&
      parsed.ratingIds.every((id: unknown) => typeof id === "string")
    ) {
      return { status: "saved", sessionId: parsed.sessionId, ratingIds: parsed.ratingIds as string[] };
    }
    return { status: "error", message: "Something went wrong. Please try again." };
  }
  if (httpStatus === 422) return { status: "error", message: "Some inputs are invalid. Please check and retry." };
  if (httpStatus === 404) return { status: "error", message: "Swimmer not found." };
  return { status: "error", message: "Something went wrong. Please try again." };
}

// ── UI-only state types ────────────────────────────────────────────────────────

export type SkillDraft = {
  grade: 1 | 2 | 3 | 4 | 5 | null;
  notLegal: boolean;
  noConcept: boolean;
  capacityValue: string;
  capacityUnit: "yards" | "reps" | null;
  measurementValue: string;
  measurementUnit: string | null;
  note: string;
  faultTags: string[];
  detailsOpen: boolean;
  golfScoreCategory: "push_off_in_water" | "deck_dive" | "block_dive" | null;
};

export type SessionDraft = {
  screenSlug: string;
  sessionDate: string;
  context: "drill" | "practice" | "race" | null;
  coachingPriority: string;
  breathingPattern: "every_1" | "every_2" | "every_3" | "every_4" | "every_5" | "other" | null;
  skills: Record<string, SkillDraft>;
};

// ── Pure helpers ───────────────────────────────────────────────────────────────

export function todayLA(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
}

export function defaultSkillDraft(): SkillDraft {
  return {
    grade: null,
    notLegal: false,
    noConcept: false,
    capacityValue: "",
    capacityUnit: null,
    measurementValue: "",
    measurementUnit: null,
    note: "",
    faultTags: [],
    detailsOpen: false,
    golfScoreCategory: null,
  };
}

export function initialSessionDraft(): SessionDraft {
  return {
    screenSlug: "",
    sessionDate: todayLA(),
    context: null,
    coachingPriority: "",
    breathingPattern: null,
    skills: {},
  };
}

export function canSubmit(draft: SessionDraft, ratingsCount: number, isPending: boolean): boolean {
  return (
    draft.screenSlug !== "" &&
    draft.sessionDate !== "" &&
    draft.context !== null &&
    draft.coachingPriority.trim().length > 0 &&
    ratingsCount > 0 &&
    !isPending
  );
}

// Accepts any object that has a skills array of SkillForRating — works for both
// SkillCategoryWithSkills (legacy) and ScreenWithSkills.
type SkillContainer = { skills: import("@swim-app/shared").SkillForRating[] };

export function buildSkillGroups(container: SkillContainer): {
  startParents: import("@swim-app/shared").SkillForRating[];
  standaloneSkills: import("@swim-app/shared").SkillForRating[];
  componentSkillsOf: (parentId: string) => import("@swim-app/shared").SkillForRating[];
} {
  const startParents = container.skills.filter(
    (skill) =>
      skill.parentSkillId === null &&
      container.skills.some((other) => other.parentSkillId === skill.id),
  );
  const startParentIds = new Set(startParents.map((skill) => skill.id));
  const standaloneSkills = container.skills.filter(
    (skill) =>
      !startParentIds.has(skill.id) &&
      (skill.parentSkillId === null || !startParentIds.has(skill.parentSkillId ?? "")),
  );
  const componentSkillsOf = (parentId: string): import("@swim-app/shared").SkillForRating[] =>
    container.skills.filter((skill) => skill.parentSkillId === parentId);
  return { startParents, standaloneSkills, componentSkillsOf };
}

export function buildSectionGroups(
  container: SkillContainer,
  sections: Array<{ name: string; slugs: string[] }>,
): Array<{ name: string; skills: import("@swim-app/shared").SkillForRating[] }> {
  const slugToSkill = new Map(container.skills.map((skill) => [skill.slug, skill]));
  const everAssigned = new Set<string>();
  const result: Array<{ name: string; skills: import("@swim-app/shared").SkillForRating[] }> = [];

  for (const section of sections) {
    const sectionSkills: import("@swim-app/shared").SkillForRating[] = [];
    for (const slug of section.slugs) {
      const skill = slugToSkill.get(slug);
      if (skill) {
        sectionSkills.push(skill);
        everAssigned.add(skill.id);
      }
    }
    if (sectionSkills.length > 0) {
      result.push({ name: section.name, skills: sectionSkills });
    }
  }

  const other = container.skills.filter((skill) => !everAssigned.has(skill.id));
  if (other.length > 0) {
    result.push({ name: "Other", skills: other });
  }

  return result;
}

// The section name is the sole source of stroke context — the stroke name
// appears once in the section heading, not repeated per-skill row.
export function skillDisplayLabel(
  skill: import("@swim-app/shared").SkillForRating,
  _sectionName: string,
): string {
  return skill.name;
}

export function buildRatingsArray(
  skills: import("@swim-app/shared").SkillForRating[],
  draftSkills: Record<string, SkillDraft>,
): Array<{
  skillId: string;
  grade: 1 | 2 | 3 | 4 | 5 | null;
  notLegal: boolean;
  noConcept: boolean;
  side: "left" | "right" | null;
  capacityValue: string | null;
  capacityUnit: "yards" | "reps" | null;
  measurementValue: string | null;
  measurementUnit: string | null;
  note: string | null;
  faultTags: string[];
  ratedAt: string;
  golfScoreCategory: "push_off_in_water" | "deck_dive" | "block_dive" | null;
}> {
  const ratings = [];
  const now = new Date().toISOString();
  for (const skill of skills) {
    if (skill.type === "rollup") continue;
    const keys = skill.ratedPerSide ? [`${skill.id}:left`, `${skill.id}:right`] : [skill.id];
    for (const key of keys) {
      const d = draftSkills[key];
      if (!d) continue;
      if (d.grade === null && !d.noConcept) continue;
      const side = skill.ratedPerSide
        ? (key.endsWith(":left") ? "left" : "right") as "left" | "right"
        : null;
      ratings.push({
        skillId: skill.id,
        grade: d.grade,
        notLegal: d.notLegal,
        noConcept: d.noConcept,
        side,
        capacityValue: d.capacityValue !== "" ? d.capacityValue : null,
        capacityUnit: d.capacityUnit,
        measurementValue: d.measurementValue !== "" ? d.measurementValue : null,
        measurementUnit: d.measurementUnit,
        note: d.note !== "" ? d.note : null,
        faultTags: d.faultTags,
        ratedAt: now,
        golfScoreCategory: d.golfScoreCategory,
      });
    }
  }
  return ratings;
}
