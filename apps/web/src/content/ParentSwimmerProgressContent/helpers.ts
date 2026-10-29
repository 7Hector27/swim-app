import type { SkillCurrentLevel, ParentProgressRatingPoint, StartGradeResult } from "@swim-app/shared";

export function currentLevelDisplay(level: SkillCurrentLevel): string {
  if (level.notLegal) return "DQ";
  if (level.noConcept) return "NC";
  if (level.grade === null) return "—";
  return String(level.grade);
}

export function currentLevelIsDanger(level: SkillCurrentLevel): boolean {
  return level.notLegal;
}

export function gradeNumber(point: ParentProgressRatingPoint): number | null {
  if (point.notLegal) return 0;
  if (point.noConcept) return null;
  return point.grade;
}

export function formatStartGradeDisplay(result: StartGradeResult, slugToName: (slug: string) => string): string {
  if (result.status === "not_legal") return "DQ";
  if (result.status === "no_concept") return "NC";
  if (result.status === "graded") return String(result.grade);
  if (result.missing.length === 0) return "In progress";
  const names = result.missing.slice(0, 2).map(slugToName).join(", ");
  return `In progress — needs ${names}`;
}

export const LEVEL_DESCRIPTIONS: Record<number, string> = {
  1: "Just getting started — learning the basic movement",
  2: "Developing — shows the skill sometimes, not yet consistent",
  3: "Consistent — performs the skill correctly most of the time",
  4: "Strong — reliable technique with good confidence",
  5: "Mastered — excellent form, performed consistently",
};

export const SPECIAL_DESCRIPTIONS = {
  dq: "Performed in a way that would result in a disqualification in competition",
  nc: "Hasn't grasped the basic idea of this skill yet",
  notAssessed: "This skill hasn't been evaluated yet",
};

// Short date for the "From ..." byline under the Current focus text, e.g.
// "Oct 14, 2026". Session dates arrive as YYYY-MM-DD; parse via Date.UTC so
// local-time rendering doesn't shift the day.
export function formatProgressSessionDate(sessionDate: string): string {
  const [year, month, day] = sessionDate.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return sessionDate;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}
