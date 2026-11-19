import type {
  ParentProgressRatingPoint,
  ParentSkillProgress,
  ParentSwimmerProgressResponse,
  SkillCurrentLevel,
  StartGradeResult,
} from "@swim-app/shared";
import { LEVEL_NAMES } from "@/components/LevelLadder/helpers";

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

// Shorter "Nov 17" variant — used on tiles and recent-win rows where
// the year is implied by context ("last evaluated", "evaluations since
// <month>"). Same TZ anchor so server + client agree on the calendar day.
export function formatShortMonthDay(sessionDate: string): string {
  const [year, month, day] = sessionDate.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return sessionDate;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

// Human-readable month name only, for lines like "evaluations since Sep"
// on the summary tiles. Uses the swimmer's season-first-session date.
export function formatMonth(sessionDate: string): string {
  const [year, month, day] = sessionDate.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

// ── Skill-row change text ────────────────────────────────────────────────

// First level this skill was rated at (chronologically earliest numeric
// grade in its ratings history). Returns null when the skill has no
// numeric history — DQ / NC-only ratings don't contribute a baseline.
function firstGradeFromHistory(history: ParentProgressRatingPoint[]): 1 | 2 | 3 | 4 | 5 | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const point = history[index];
    if (!point) continue;
    if (point.grade === 1 || point.grade === 2 || point.grade === 3 || point.grade === 4 || point.grade === 5) {
      return point.grade;
    }
  }
  return null;
}

function latestGradeFromCurrent(level: SkillCurrentLevel | null): 1 | 2 | 3 | 4 | 5 | null {
  if (level === null) return null;
  if (level.notLegal || level.noConcept) return null;
  if (level.grade === 1 || level.grade === 2 || level.grade === 3 || level.grade === 4 || level.grade === 5) {
    return level.grade;
  }
  return null;
}

// Change text a parent sees under the level name on each skill row:
// "up N", "down N", "holding steady", or null when there's no comparable
// history (single rating, DQ / NC path). Sided skills render left/right
// as a combined string — see rowLevelAndChange() below.
export function rowChangeText(skill: ParentSkillProgress): string | null {
  if (skill.ratedPerSide) {
    const left = latestGradeFromCurrent(skill.currentLeft);
    const right = latestGradeFromCurrent(skill.currentRight);
    if (left === null && right === null) return null;
    const parts: string[] = [];
    if (left !== null) parts.push(`left ${left}`);
    if (right !== null) parts.push(`right ${right}`);
    return parts.join(", ");
  }
  const latest = latestGradeFromCurrent(skill.current);
  const first = firstGradeFromHistory(skill.history);
  if (latest === null) return null;
  if (first === null) return null;
  // A single numeric-graded rating counts as both first and latest — no
  // meaningful delta. Return null so the row doesn't show "holding steady"
  // on a one-time sampling.
  const numericHistoryCount = skill.history.reduce(
    (count, point) => (point.grade === 1 || point.grade === 2 || point.grade === 3 || point.grade === 4 || point.grade === 5 ? count + 1 : count),
    0,
  );
  if (numericHistoryCount < 2) return null;
  const delta = latest - first;
  if (delta > 0) return `up ${delta}`;
  if (delta < 0) return `down ${Math.abs(delta)}`;
  return "holding steady";
}

// Display name of the current level for a skill row ("Advanced", "DQ",
// "No concept", "Not rated"). Falls back for edge cases so callers never
// render "null".
export function rowLevelLabel(skill: ParentSkillProgress): string {
  const current = skill.ratedPerSide
    ? skill.currentLeft ?? skill.currentRight
    : skill.current;
  if (current === null) return "Not rated";
  if (current.notLegal) return "DQ";
  if (current.noConcept) return "No concept";
  if (current.grade === null) return "—";
  const grade = current.grade;
  if (grade === 1 || grade === 2 || grade === 3 || grade === 4 || grade === 5) {
    return LEVEL_NAMES[grade];
  }
  return "—";
}

// Pip count (1..5) for the mini five-step bar in the row header. Null
// when the skill isn't rated or is in a DQ / NC state — the row then
// draws the bar empty.
export function rowPipCount(skill: ParentSkillProgress): 1 | 2 | 3 | 4 | 5 | null {
  if (skill.ratedPerSide) {
    const left = latestGradeFromCurrent(skill.currentLeft);
    const right = latestGradeFromCurrent(skill.currentRight);
    // When both sides are rated, show the lower side as the bar — it's
    // the growth edge. When only one side is rated, show it.
    if (left === null && right === null) return null;
    if (left === null) return right;
    if (right === null) return left;
    return left <= right ? left : right;
  }
  return latestGradeFromCurrent(skill.current);
}

// ── Summary tiles ────────────────────────────────────────────────────────

export interface SummaryTilesData {
  levelsGained: number;                // sum of (latest − first) across skills that went up
  skillsLeveledUp: number;             // how many distinct skills contributed to levelsGained
  lastEvaluatedShort: string | null;   // "Nov 17" from the most-recent session date
  evaluationsThisSeason: number;       // sessions in scoreHistory.points
  seasonStartMonth: string | null;     // "Sep" from the earliest session in the window
}

export function buildSummaryTiles(
  skills: ParentSkillProgress[],
  sessionDates: string[],
): SummaryTilesData {
  let levelsGained = 0;
  let skillsLeveledUp = 0;
  for (const skill of skills) {
    const latest = latestGradeFromCurrent(skill.current);
    const first = firstGradeFromHistory(skill.history);
    if (latest !== null && first !== null && latest > first) {
      levelsGained += latest - first;
      skillsLeveledUp += 1;
    }
  }

  const sortedDates = [...sessionDates].sort();
  const earliest = sortedDates[0] ?? null;
  const latestDate = sortedDates[sortedDates.length - 1] ?? null;

  return {
    levelsGained,
    skillsLeveledUp,
    lastEvaluatedShort: latestDate ? formatShortMonthDay(latestDate) : null,
    evaluationsThisSeason: sessionDates.length,
    seasonStartMonth: earliest ? formatMonth(earliest) : null,
  };
}

// ── Recent wins ──────────────────────────────────────────────────────────

export type WinKind = "newLevel" | "raceHeld" | "mastery";

export interface RecentWin {
  kind: WinKind;
  skillSlug: string;
  skillName: string;
  level: 1 | 2 | 3 | 4 | 5;
  sessionDate: string;             // YYYY-MM-DD
  headline: string;                // e.g. "Kick reached Advanced"
}

// Up to `maxWins` most-recent positive events from the swimmer's ratings,
// sorted newest-first. Three event kinds per the brief:
//
//   - "newLevel": the first time a skill reached level N (N >= 2). Only
//     one per (skill, level) so a long run at the same level doesn't
//     spam the list.
//   - "raceHeld": the first time a skill was rated at level 3+ in the
//     "race" context. Celebrates holding the skill under race pressure.
//   - "mastery": the first time a skill reached level 5. Supersedes a
//     "newLevel 5" entry for the same skill and date.
//
// The function never emits "held steady", "dropped" or "DQ" items — the
// brief limits this section to positive events.
export function buildRecentWins(
  skills: ReadonlyArray<ParentSkillProgress>,
  maxWins: number = 3,
): RecentWin[] {
  const wins: RecentWin[] = [];

  for (const skill of skills) {
    // Walk the history oldest → newest to detect first occurrences.
    const oldestFirst = [...skill.history].reverse();
    const seenLevels = new Set<1 | 2 | 3 | 4 | 5>();
    let seenRaceAtOrAbove3 = false;

    for (const point of oldestFirst) {
      if (point.grade === 1 || point.grade === 2 || point.grade === 3 || point.grade === 4 || point.grade === 5) {
        const level = point.grade;
        // Mastery takes precedence when level === 5.
        if (level === 5 && !seenLevels.has(5)) {
          wins.push({
            kind: "mastery",
            skillSlug: skill.slug,
            skillName: skill.name,
            level: 5,
            sessionDate: point.sessionDate,
            headline: `${skill.name} reached Mastery`,
          });
          seenLevels.add(5);
        } else if (level >= 2 && !seenLevels.has(level)) {
          wins.push({
            kind: "newLevel",
            skillSlug: skill.slug,
            skillName: skill.name,
            level,
            sessionDate: point.sessionDate,
            headline: `${skill.name} reached ${LEVEL_NAMES[level]}`,
          });
          seenLevels.add(level);
        } else if (level === 1) {
          // Record the level so a later jump to 2 reads as "reached
          // Developing". No win fires for level 1.
          seenLevels.add(1);
        }

        if (!seenRaceAtOrAbove3 && point.context === "race" && level >= 3) {
          wins.push({
            kind: "raceHeld",
            skillSlug: skill.slug,
            skillName: skill.name,
            level,
            sessionDate: point.sessionDate,
            headline: `${skill.name} held at ${LEVEL_NAMES[level]} in a race`,
          });
          seenRaceAtOrAbove3 = true;
        }
      }
    }
  }

  // Newest first, trimmed to `maxWins`.
  wins.sort((left, right) => (left.sessionDate < right.sessionDate ? 1 : left.sessionDate > right.sessionDate ? -1 : 0));
  return wins.slice(0, maxWins);
}

// ── Latest coaching priority byline ──────────────────────────────────────

// "From Coach <name>, <Mon D>" — composed from the latest priority plus
// the coach's full name. The parent progress response doesn't currently
// carry the coach's name on the priority object, so the caller resolves
// it from elsewhere and hands in a `coachName` fallback.
export function coachPriorityByline(
  sessionDate: string,
  coachName: string | null,
): string {
  const date = formatShortMonthDay(sessionDate);
  if (!coachName) return `From your coach, ${date}`;
  return `From Coach ${coachName.split(" ")[0] ?? coachName}, ${date}`;
}

// ── Score-history session dates ──────────────────────────────────────────

// Flat list of unique session dates across a parent score-history payload.
// Used by the summary tiles to count "evaluations since <month>" and to
// find the latest-evaluated date without needing a `.sessionId` field
// (which the parent schema doesn't carry).
export function scoreHistorySessionDates(
  scoreHistory: ParentSwimmerProgressResponse extends unknown
    ? { points: ReadonlyArray<{ sessionDate: string }> }
    : never,
): string[] {
  const dates = new Set<string>();
  for (const point of scoreHistory.points) {
    dates.add(point.sessionDate);
  }
  return Array.from(dates);
}
