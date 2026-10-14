import type { SkillCurrentLevel, ProgressRatingPoint, StartGradeResult } from "@swim-app/shared";

export function currentLevelDisplay(level: SkillCurrentLevel): string {
  if (level.notLegal) return "DQ";
  if (level.noConcept) return "NC";
  if (level.grade === null) return "—";
  return String(level.grade);
}

export function currentLevelIsDanger(level: SkillCurrentLevel): boolean {
  return level.notLegal;
}

export function gradeNumber(point: ProgressRatingPoint): number | null {
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

export function formatDate(isoString: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Los_Angeles",
  }).format(new Date(isoString));
}

export function formatSessionDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Los_Angeles",
  }).format(new Date(year!, month! - 1, day!));
}
