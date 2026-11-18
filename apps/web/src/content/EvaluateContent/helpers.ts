import {
  CreateSessionBodySchema,
  displayUnitToMeasurementEnum,
  validateRatingAgainstSkill,
  type RatingPayload,
  type RatingSkillDef,
} from "@swim-app/shared";
import type { SkillForRating } from "@swim-app/shared";

// A single validation issue, keyed by rating index when the problem is on a
// specific skill row (so the UI can scroll to and annotate the right field).
export interface EvaluateFieldIssue {
  ratingIndex?: number;
  field: string;
  message: string;
}

export type EvaluateState =
  | { status: "idle" }
  | { status: "error"; message: string; issues?: EvaluateFieldIssue[] }
  | { status: "saved"; sessionId: string; ratingIds: string[] }
  // ADR 032: PATCH /coach/sessions/:id returned 409 because another tab
  // superseded one of the ratings. The client refetches the session and
  // shows a "This evaluation was edited elsewhere" banner.
  | { status: "stale" };

const GENERIC_INVALID = "Some inputs are invalid. Please check and retry.";

// Human copy for the superRefine messages we expect; falls back to the raw
// message otherwise so a future rule still surfaces something readable.
const FIELD_MESSAGE_OVERRIDES: Record<string, string> = {
  measurementValue:
    "Enter a unit to save this measurement, or clear the value.",
  capacityValue:
    "Pick a unit to save this capacity, or clear the value.",
  grade:
    "Pick a 1 to 5 grade, or toggle 'No concept'.",
  notLegal:
    "'Not legal' needs a 1 to 5 grade.",
  // Pass 2c follow-up: golf-score numbers. Shown for any time/stroke
  // problem (partial pair caught by Zod, or grade-without-pair caught by
  // the catalog validator). Matches the catalog's canonical message so
  // the coach sees the same copy in both situations.
  timeSeconds: "Enter the time and stroke count for this golf score.",
  // Golf pair + no category picked. Zod reports on this field when
  // timeSeconds is set but golfScoreCategory is null.
  golfScoreCategory: "Pick a test category before saving a golf score.",
  coachingPriority: "Enter a coaching priority.",
  sessionDate: "Pick a session date.",
  context: "Pick a context.",
  breathingPattern: "Pick a breathing pattern.",
  screenSlug: "Pick a screen.",
  ratings: "Rate at least one skill before saving.",
};

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
  if (httpStatus === 422) {
    const issues = extractIssues(body);
    if (issues.length > 0) return { status: "error", message: GENERIC_INVALID, issues };
    return { status: "error", message: GENERIC_INVALID };
  }
  if (httpStatus === 404) return { status: "error", message: "Swimmer not found." };
  return { status: "error", message: "Something went wrong. Please try again." };
}

// Converts a Zod issues[] array (from safeParse or an API 422 body) into
// per-field entries the UI can render next to each skill row.
export function mapZodIssuesToFieldIssues(
  issues: ReadonlyArray<{ path: ReadonlyArray<unknown>; message: string }>,
): EvaluateFieldIssue[] {
  const result: EvaluateFieldIssue[] = [];
  for (const issue of issues) {
    const path = issue.path;
    if (path.length >= 3 && path[0] === "ratings" && typeof path[1] === "number") {
      const field = typeof path[2] === "string" ? path[2] : "unknown";
      result.push({
        ratingIndex: path[1] as number,
        field,
        message: FIELD_MESSAGE_OVERRIDES[field] ?? issue.message,
      });
      continue;
    }
    if (path.length >= 1 && typeof path[0] === "string") {
      const field = path[0];
      result.push({
        field,
        message: FIELD_MESSAGE_OVERRIDES[field] ?? issue.message,
      });
    }
  }
  return result;
}

// Canonical rendering order used for scroll-to-first. Session fields come
// before skills; coachingPriority sits at the end of the form, below the
// skill list.
export const SESSION_FIELD_ORDER = [
  "screenSlug",
  "breathingPattern",
  "sessionDate",
  "context",
  "ratings",
] as const;

export const DOM_IDS = {
  screenSlug: "evaluate-field-screenSlug",
  breathingPattern: "evaluate-field-breathingPattern",
  sessionDate: "evaluate-field-sessionDate",
  context: "evaluate-field-context",
  ratings: "evaluate-skills-section",
  coachingPriority: "evaluate-field-coachingPriority",
} as const;

export function anchorIdForIssue(
  issue: EvaluateFieldIssue,
  ratingKeys: readonly string[],
): string | null {
  if (issue.ratingIndex !== undefined) {
    const key = ratingKeys[issue.ratingIndex];
    return key !== undefined ? `skill-${key}` : null;
  }
  if (issue.field in DOM_IDS) {
    return DOM_IDS[issue.field as keyof typeof DOM_IDS];
  }
  return null;
}

// Orders a list of issues by document position so the UI can pick the first
// one to scroll to. Session fields follow SESSION_FIELD_ORDER; rating issues
// slot in by their ratingIndex (which mirrors render order); coachingPriority
// trails everything.
export function sortIssuesForScroll(
  issues: readonly EvaluateFieldIssue[],
): EvaluateFieldIssue[] {
  const sessionIndex = (field: string): number => {
    const idx = (SESSION_FIELD_ORDER as readonly string[]).indexOf(field);
    return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
  };
  return [...issues].sort((a, b) => {
    const aRating = a.ratingIndex !== undefined;
    const bRating = b.ratingIndex !== undefined;
    if (!aRating && !bRating) {
      if (a.field === "coachingPriority" && b.field !== "coachingPriority") return 1;
      if (b.field === "coachingPriority" && a.field !== "coachingPriority") return -1;
      return sessionIndex(a.field) - sessionIndex(b.field);
    }
    if (aRating && !bRating) {
      if (b.field === "coachingPriority") return -1;
      return 1;
    }
    if (!aRating && bRating) {
      if (a.field === "coachingPriority") return 1;
      return -1;
    }
    const aIdx = a.ratingIndex ?? 0;
    const bIdx = b.ratingIndex ?? 0;
    return aIdx - bIdx;
  });
}

// Checks everything the API requires on the client, so a tap on Save with a
// missing field never fires a request. Combines three layers:
//   1. Explicit per-field checks for the session-level fields the form hosts.
//   2. Catalog-aware per-rating checks (validateRatingAgainstSkill) for
//      rules that need skill context — notably "golf grade requires
//      time + strokes + category." Requires screenSkills.
//   3. The shared Zod schema for structural rules (paired fields, grade
//      vs noConcept, etc.). Zod runs last so catalog messages take
//      precedence on overlapping fields.
// Returns issues ready to render. When screenSkills is omitted (legacy
// call sites + some tests), layer 2 is skipped.
export function validateSubmission(
  draft: SessionDraft,
  ratingsArray: ReturnType<typeof buildRatingsArray>,
  screenSkills?: ReadonlyArray<SkillForRating>,
): EvaluateFieldIssue[] {
  const issues: EvaluateFieldIssue[] = [];

  if (draft.screenSlug === "") {
    issues.push({ field: "screenSlug", message: FIELD_MESSAGE_OVERRIDES.screenSlug ?? "" });
  }
  if (draft.sessionDate === "") {
    issues.push({ field: "sessionDate", message: FIELD_MESSAGE_OVERRIDES.sessionDate ?? "" });
  }
  if (draft.context === null) {
    issues.push({ field: "context", message: FIELD_MESSAGE_OVERRIDES.context ?? "" });
  }
  const needsBreathing = draft.screenSlug === "freestyle" || draft.screenSlug === "butterfly";
  if (needsBreathing && draft.breathingPattern === null) {
    issues.push({ field: "breathingPattern", message: FIELD_MESSAGE_OVERRIDES.breathingPattern ?? "" });
  }
  // coachingPriority is optional. The parent progress view falls back to the
  // most recent non-empty priority from a non-voided session, so blank is OK.
  if (ratingsArray.length === 0) {
    issues.push({ field: "ratings", message: FIELD_MESSAGE_OVERRIDES.ratings ?? "" });
  }

  // Layer 2 — catalog-aware per-rating checks. The shared validator is
  // the single source of truth; the server runs the same function on
  // CREATE and PATCH, so any divergence surfaces immediately.
  if (screenSkills !== undefined) {
    const skillById = new Map(screenSkills.map((skill) => [skill.id, skill]));
    for (let ratingIndex = 0; ratingIndex < ratingsArray.length; ratingIndex++) {
      const rating = ratingsArray[ratingIndex]!;
      const skill = skillById.get(rating.skillId);
      if (!skill) continue;
      const skillDef: RatingSkillDef = {
        type: skill.type,
        ratedPerSide: skill.ratedPerSide,
        notLegalAllowed: skill.notLegalAllowed,
        unit: skill.unit,
        allowedFaultTags: skill.faultTags,
      };
      // buildRatingsArray returns `measurementUnit: string | null` so the
      // dropdown's string value can flow through unchanged for skills
      // without a catalog unit; the catalog validator rejects mismatches.
      // RatingPayload narrows the type to the MeasurementUnit enum, so
      // cast at this boundary.
      const issue = validateRatingAgainstSkill(skillDef, rating as unknown as RatingPayload);
      if (issue) {
        issues.push({ ratingIndex, field: issue.field, message: issue.message });
      }
    }
  }

  // Layer 3 — Zod. Catches structural issues the catalog pass can't see
  // (measurement/capacity pairing, grade/noConcept pairing). Runs after
  // the catalog layer so when both fire on the same field+index, the
  // catalog's user-facing copy wins the dedupe.
  if (ratingsArray.length > 0 && draft.screenSlug !== "") {
    const trimmedPriority = draft.coachingPriority.trim();
    const body = {
      screenSlug: draft.screenSlug,
      sessionDate: draft.sessionDate || "1970-01-01",
      context: draft.context ?? "practice",
      coachingPriority: trimmedPriority.length > 0 ? trimmedPriority : null,
      breathingPattern: draft.breathingPattern,
      ratings: ratingsArray,
    };
    const parsed = CreateSessionBodySchema.safeParse(body);
    if (!parsed.success) {
      for (const issue of mapZodIssuesToFieldIssues(parsed.error.issues)) {
        // Session-level checks are more specific than Zod's generic ones.
        if (issue.ratingIndex === undefined && issues.some((existing) => existing.field === issue.field)) {
          continue;
        }
        // Per-rating dedupe against the catalog layer: if we already
        // emitted an issue for this (ratingIndex, field), the catalog
        // message wins.
        if (
          issue.ratingIndex !== undefined &&
          issues.some(
            (existing) =>
              existing.ratingIndex === issue.ratingIndex && existing.field === issue.field,
          )
        ) {
          continue;
        }
        issues.push(issue);
      }
    }
  }
  return issues;
}

function extractIssues(body: unknown): EvaluateFieldIssue[] {
  if (body === null || typeof body !== "object") return [];
  const maybe = body as { issues?: unknown };
  if (!Array.isArray(maybe.issues)) return [];
  const parsed: Array<{ path: unknown[]; message: string }> = [];
  for (const raw of maybe.issues) {
    if (raw === null || typeof raw !== "object") continue;
    const entry = raw as { path?: unknown; message?: unknown };
    const path = Array.isArray(entry.path) ? entry.path : [];
    const message = typeof entry.message === "string" ? entry.message : "";
    if (message) parsed.push({ path, message });
  }
  return mapZodIssuesToFieldIssues(parsed);
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
  // Pass 2c: golf-score inputs — free text while typing, parsed to
  // number at submit time. buildRatingsArray converts "12.5" → 12.5
  // and "" → null.
  timeSeconds: string;
  strokeCountValue: string;
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
    timeSeconds: "",
    strokeCountValue: "",
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

// URL-safe slug for a section name — used to scope DOM ids when the same
// skill renders in more than one section on the same screen (push-off and
// streamline-in-motion on stroke screens). Pass 2a addition.
export function slugifySectionName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// UI label for a skill, with a stroke suffix when more than one distinct
// skill in `scope` shares the same display name. Different rows that render
// the SAME skillId (push-off in Start + The wall) aren't ambiguous and never
// get a suffix. Pass 2a addition for the Oct 14 screen rule "Every repeated
// skill label includes its stroke."
const STROKE_FULL_NAME: Record<"free" | "back" | "breast" | "fly", string> = {
  free: "freestyle",
  back: "backstroke",
  breast: "breaststroke",
  fly: "butterfly",
};

export function getDisambiguatedLabel(
  skill: import("@swim-app/shared").SkillForRating,
  scope: ReadonlyArray<import("@swim-app/shared").SkillForRating>,
): string {
  const sameName = scope.filter(
    (other) => other.name === skill.name && other.id !== skill.id,
  );
  if (sameName.length === 0) return skill.name;
  if (skill.stroke !== null && skill.stroke in STROKE_FULL_NAME) {
    return `${skill.name} (${STROKE_FULL_NAME[skill.stroke as keyof typeof STROKE_FULL_NAME]})`;
  }
  return skill.name;
}

// Returns the draftKey for each entry in `buildRatingsArray` (same order).
// Lets the UI translate server/safeParse `ratings[i]` issue paths back to
// the specific skill row.
export function buildRatingKeys(
  skills: import("@swim-app/shared").SkillForRating[],
  draftSkills: Record<string, SkillDraft>,
): string[] {
  const keys: string[] = [];
  for (const skill of skills) {
    if (skill.type === "rollup") continue;
    const skillKeys = skill.ratedPerSide ? [`${skill.id}:left`, `${skill.id}:right`] : [skill.id];
    for (const key of skillKeys) {
      const d = draftSkills[key];
      if (!d) continue;
      if (d.grade === null && !d.noConcept) continue;
      keys.push(key);
    }
  }
  return keys;
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
  timeSeconds: number | null;
  strokeCountValue: number | null;
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
      const measurementValue = d.measurementValue !== "" ? d.measurementValue : null;
      // Prefer the catalog-mapped enum when the skill prescribes a unit, so
      // the UI's single `measurementValue` input is always paired with the
      // right enum on submit. Falls back to the draft's own `measurementUnit`
      // (set via the dropdown for skills with no catalog unit).
      const measurementUnit = measurementValue === null
        ? null
        : (displayUnitToMeasurementEnum(skill.unit) ?? d.measurementUnit);
      // Pass 2c: parse the two golf-score free-text inputs. Only emit them
      // on score skills (API rejects them on non-score). Empty string → null.
      // A partial pair (one filled, one empty) is passed through so the
      // Zod paired-fields rule fires in validateSubmission — the coach sees
      // "Enter both time and stroke count" instead of a silent drop.
      let timeSeconds: number | null = null;
      let strokeCountValue: number | null = null;
      if (skill.type === "score") {
        if (d.timeSeconds !== "") {
          const parsedTime = parseFloat(d.timeSeconds);
          if (!Number.isNaN(parsedTime)) timeSeconds = parsedTime;
        }
        if (d.strokeCountValue !== "") {
          const parsedStrokes = parseInt(d.strokeCountValue, 10);
          if (!Number.isNaN(parsedStrokes)) strokeCountValue = parsedStrokes;
        }
      }
      ratings.push({
        skillId: skill.id,
        grade: d.grade,
        notLegal: d.notLegal,
        noConcept: d.noConcept,
        side,
        capacityValue: d.capacityValue !== "" ? d.capacityValue : null,
        capacityUnit: d.capacityUnit,
        measurementValue,
        measurementUnit,
        note: d.note !== "" ? d.note : null,
        faultTags: d.faultTags,
        ratedAt: now,
        golfScoreCategory: d.golfScoreCategory,
        timeSeconds,
        strokeCountValue,
      });
    }
  }
  return ratings;
}
