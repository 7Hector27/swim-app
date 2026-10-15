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
};

export type SessionDraft = {
  categoryId: string;
  sessionDate: string;
  context: "drill" | "practice" | "race" | null;
  coachingPriority: string;
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
  };
}

export function initialSessionDraft(): SessionDraft {
  return {
    categoryId: "",
    sessionDate: todayLA(),
    context: null,
    coachingPriority: "",
    skills: {},
  };
}

export function canSubmit(draft: SessionDraft, ratingsCount: number, isPending: boolean): boolean {
  return (
    draft.categoryId !== "" &&
    draft.sessionDate !== "" &&
    draft.context !== null &&
    draft.coachingPriority.trim().length > 0 &&
    ratingsCount > 0 &&
    !isPending
  );
}

export function buildSkillGroups(category: import("@swim-app/shared").SkillCategoryWithSkills): {
  startParents: import("@swim-app/shared").SkillForRating[];
  standaloneSkills: import("@swim-app/shared").SkillForRating[];
  componentSkillsOf: (parentId: string) => import("@swim-app/shared").SkillForRating[];
} {
  const startParents = category.skills.filter(
    (skill) =>
      skill.parentSkillId === null &&
      category.skills.some((other) => other.parentSkillId === skill.id),
  );
  const startParentIds = new Set(startParents.map((skill) => skill.id));
  const standaloneSkills = category.skills.filter(
    (skill) =>
      !startParentIds.has(skill.id) &&
      (skill.parentSkillId === null || !startParentIds.has(skill.parentSkillId)),
  );
  const componentSkillsOf = (parentId: string): import("@swim-app/shared").SkillForRating[] =>
    category.skills.filter((skill) => skill.parentSkillId === parentId);
  return { startParents, standaloneSkills, componentSkillsOf };
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
      });
    }
  }
  return ratings;
}
