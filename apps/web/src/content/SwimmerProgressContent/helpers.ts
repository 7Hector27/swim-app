import type {
  ScoreHistoryResponse,
  SkillCurrentLevel,
  ProgressRatingPoint,
  StartGradeResult,
  SwimmerProgressResponse,
} from "@swim-app/shared";

export function currentLevelDisplay(level: SkillCurrentLevel): string {
  if (level.notLegal) return "Not legal";
  if (level.noConcept) return "No concept";
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
  if (result.status === "not_legal") return "Not legal";
  if (result.status === "no_concept") return "No concept";
  if (result.status === "graded") return String(result.grade);
  if (result.missing.length === 0) return "In progress";
  const names = result.missing.slice(0, 2).map(slugToName).join(", ");
  return `In progress · needs ${names}`;
}

export function formatDate(isoString: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Los_Angeles",
  }).format(new Date(isoString));
}

// formatRecency moved to @/lib/progressRow in Pass 3 — the parent progress
// page now imports the same helper. Re-export so legacy callers keep
// working; prefer the lib path for new call sites.
export { formatRecency } from "@/lib/progressRow";

// Fault-tag frequency across every non-voided rating in the progress response.
// Counted per (tag, skill) pair; dedupes a tag within a single rating. Coach
// response only; parent progress omits faultTags.
export function faultTagFrequency(progress: SwimmerProgressResponse): Array<{
  tag: string;
  count: number;
  skills: string[];
}> {
  const map = new Map<string, { count: number; skills: Set<string> }>();
  for (const skill of progress.skills) {
    for (const point of skill.history) {
      const seen = new Set<string>();
      for (const tag of point.faultTags) {
        if (seen.has(tag)) continue;
        seen.add(tag);
        const existing = map.get(tag);
        if (existing) {
          existing.count += 1;
          existing.skills.add(skill.name);
        } else {
          map.set(tag, { count: 1, skills: new Set([skill.name]) });
        }
      }
    }
  }
  return [...map.entries()]
    .map(([tag, entry]) => ({ tag, count: entry.count, skills: [...entry.skills] }))
    .sort((entryA, entryB) => entryB.count - entryA.count);
}

// Session-cadence buckets: last 12 complete weeks ending the week that
// contains `now`. Weeks start Monday to match how coaches read a schedule.
export function sessionCadence(
  progress: SwimmerProgressResponse,
  now: Date = new Date(),
): Array<{ weekStart: string; count: number }> {
  const uniqueDates = new Set<string>();
  for (const skill of progress.skills) {
    for (const point of skill.history) {
      uniqueDates.add(point.sessionDate);
    }
  }

  const buckets = new Map<string, number>();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const weekStarts: string[] = [];
  for (let weekOffset = 11; weekOffset >= 0; weekOffset--) {
    const monday = mondayOfWeek(todayStart);
    monday.setUTCDate(monday.getUTCDate() - weekOffset * 7);
    const key = isoDate(monday);
    weekStarts.push(key);
    buckets.set(key, 0);
  }
  const earliest = weekStarts[0]!;
  for (const date of uniqueDates) {
    const [year, month, day] = date.split("-").map(Number);
    const asDate = new Date(Date.UTC(year!, month! - 1, day!));
    const monday = mondayOfWeek(asDate);
    const key = isoDate(monday);
    if (key >= earliest && buckets.has(key)) {
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }
  return weekStarts.map((weekStart) => ({ weekStart, count: buckets.get(weekStart) ?? 0 }));
}

function mondayOfWeek(day: Date): Date {
  const copy = new Date(day.getTime());
  const dayOfWeek = copy.getUTCDay();
  const diff = (dayOfWeek + 6) % 7;
  copy.setUTCDate(copy.getUTCDate() - diff);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

function isoDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function evaluateHrefFor(swimmerId: string, slug: string): string {
  return `/coach/swimmers/${swimmerId}/evaluate?skill=${encodeURIComponent(slug)}`;
}

// Trailing-period summary for the hero chart. Returns undefined when a delta
// isn't meaningful (fewer than two non-null head-position values).
export function headPositionTrailingDelta(
  progress: SwimmerProgressResponse,
  history: ScoreHistoryResponse,
): string | undefined {
  const values = history.points
    .map((point) => point.headPositionOverall)
    .filter((value): value is number => value !== null);
  if (values.length < 2) return undefined;
  const first = values[0]!;
  const last = values[values.length - 1]!;
  const delta = last - first;
  if (delta === 0) return `Steady at ${last} across ${values.length} ratings`;
  const prefix = delta > 0 ? "+" : "";
  return `${prefix}${delta} vs. first rating · now ${progress.headPositionOverall ?? "unrated"}`;
}
