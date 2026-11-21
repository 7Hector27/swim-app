import type {
  ParentProgressRatingPoint,
  ParentSkillProgress,
  SkillCurrentLevel,
  StartGradeResult,
} from "@swim-app/shared";
import { LEVEL_NAMES } from "@/components/LevelLadder/helpers";
import type { CatalogIndexEntry } from "@/lib/screenGroups";

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
function firstGradeFromHistory(history: ReadonlyArray<ParentProgressRatingPoint>): 1 | 2 | 3 | 4 | 5 | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const point = history[index];
    if (!point) continue;
    if (point.grade === 1 || point.grade === 2 || point.grade === 3 || point.grade === 4 || point.grade === 5) {
      return point.grade;
    }
  }
  return null;
}

// Per-side variant of firstGradeFromHistory: walks the history oldest-
// first (the array is newest-first, so we iterate backwards) and returns
// the earliest numeric grade for the requested side only. Used to compute
// a sided skill's "first level" independently for each side before the
// two values are collapsed by lowerOfTwoSides.
function firstGradeForSide(
  history: ReadonlyArray<ParentProgressRatingPoint>,
  side: "left" | "right",
): 1 | 2 | 3 | 4 | 5 | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const point = history[index];
    if (!point) continue;
    if (point.side !== side) continue;
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

// Collapse rule for sided skills: the lower of the two sides is the
// growth edge, so "the skill's level" is the smaller number. When only
// one side is rated, that side stands alone. Mirrors rowPipCount so a
// sided skill reports one consistent level everywhere.
function lowerOfTwoSides(
  left: 1 | 2 | 3 | 4 | 5 | null,
  right: 1 | 2 | 3 | 4 | 5 | null,
): 1 | 2 | 3 | 4 | 5 | null {
  if (left === null && right === null) return null;
  if (left === null) return right;
  if (right === null) return left;
  return left <= right ? left : right;
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
//
// `catalogIndex` is used to decorate skill names with their stroke when
// another skill shares the same raw name ("Freestyle tempo" rather than
// "Tempo"). Without the index the four tempo skills all read "Tempo",
// which looks like the same win fired three times. Pass an empty Map
// when the catalog hasn't loaded — the function then falls back to the
// raw skill name.
//
// Final stage before returning: dedupe by headline, preferring variety
// across strokes when several skills land the same type of win on the
// same day. Two wins with identical headlines never surface.
export function buildRecentWins(
  skills: ReadonlyArray<ParentSkillProgress>,
  catalogIndex: ReadonlyMap<string, CatalogIndexEntry> = new Map(),
  maxWins: number = 3,
): RecentWin[] {
  const wins: RecentWin[] = [];

  for (const skill of skills) {
    // Walk the history oldest → newest to detect first occurrences.
    const oldestFirst = [...skill.history].reverse();
    const seenLevels = new Set<1 | 2 | 3 | 4 | 5>();
    let seenRaceAtOrAbove3 = false;
    // Wins read as sentences ("Freestyle tempo reached Competent"), so
    // we use the catalog's sentence-form name rather than the parenthetical
    // displayName used in skill lists. Falls back to the raw skill name
    // when no catalog index is available.
    const displayName = catalogIndex.get(skill.slug)?.sentenceName ?? skill.name;

    for (const point of oldestFirst) {
      if (point.grade === 1 || point.grade === 2 || point.grade === 3 || point.grade === 4 || point.grade === 5) {
        const level = point.grade;
        // Mastery takes precedence when level === 5.
        if (level === 5 && !seenLevels.has(5)) {
          wins.push({
            kind: "mastery",
            skillSlug: skill.slug,
            skillName: displayName,
            level: 5,
            sessionDate: point.sessionDate,
            headline: `${displayName} reached Mastery`,
          });
          seenLevels.add(5);
        } else if (level >= 2 && !seenLevels.has(level)) {
          wins.push({
            kind: "newLevel",
            skillSlug: skill.slug,
            skillName: displayName,
            level,
            sessionDate: point.sessionDate,
            headline: `${displayName} reached ${LEVEL_NAMES[level]}`,
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
            skillName: displayName,
            level,
            sessionDate: point.sessionDate,
            headline: `${displayName} held at ${LEVEL_NAMES[level]} in a race`,
          });
          seenRaceAtOrAbove3 = true;
        }
      }
    }
  }

  // Newest first.
  wins.sort((left, right) => (left.sessionDate < right.sessionDate ? 1 : left.sessionDate > right.sessionDate ? -1 : 0));

  // Dedupe by headline. If two wins share identical text (same raw-named
  // skill before catalog decoration, or coincidentally identical copy),
  // only the first is kept. This also fires when several per-stroke
  // skills reach the same level on the same day *without* catalog
  // decoration — the decorated headlines now carry the stroke prefix so
  // ordinarily that case produces distinct text.
  const deduped: RecentWin[] = [];
  const seenHeadlines = new Set<string>();
  for (const win of wins) {
    if (seenHeadlines.has(win.headline)) continue;
    seenHeadlines.add(win.headline);
    deduped.push(win);
  }

  return deduped.slice(0, maxWins);
}

// ── Summary card ─────────────────────────────────────────────────────────

export interface LevelDistributionEntry {
  level: 1 | 2 | 3 | 4 | 5;
  count: number;
}

export interface SummaryCardData {
  // "<First name> has moved up in N skills" or "<First name> is getting
  // started" when N === 0. Noun agreement is baked in: "skill" at N === 1,
  // "skills" otherwise.
  headline: string;
  // "Last lesson graded <Mon D> · N evaluations since <Mon>". Dates only
  // appear when the swimmer actually has sessions; a brand-new swimmer
  // gets null and the caller skips the line.
  lessonLine: string | null;
  // Current level counts — one entry per level 1-5. Rollups (`type ===
  // "rollup"`) and DQ / NC states don't count. The stacked bar label is
  // "Where <first name>'s N rated skills are now" where N === total.
  levelCounts: ReadonlyArray<LevelDistributionEntry>;
  total: number;
  // Sentence-form text alternative so a screen reader hears the
  // distribution without having to interpret the SVG bar segments.
  levelsScreenReaderText: string;
}

// Counts current level per rated non-rollup skill. DQ / NC / unrated
// skills don't appear in the distribution. Always returns the five
// buckets in level-ascending order, even when counts are zero — the
// stacked bar needs a slot per level so the segments render in a stable
// order when counts change.
function levelDistribution(skills: ReadonlyArray<ParentSkillProgress>): LevelDistributionEntry[] {
  const counts: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const skill of skills) {
    if (skill.type === "rollup") continue;
    const current = skill.ratedPerSide ? (skill.currentLeft ?? skill.currentRight) : skill.current;
    if (current === null) continue;
    if (current.notLegal || current.noConcept) continue;
    const grade = current.grade;
    if (grade === 1 || grade === 2 || grade === 3 || grade === 4 || grade === 5) {
      counts[grade] += 1;
    }
  }
  return [1, 2, 3, 4, 5].map((level) => ({ level: level as 1 | 2 | 3 | 4 | 5, count: counts[level as 1 | 2 | 3 | 4 | 5] }));
}

export function buildSummaryCard(
  skills: ReadonlyArray<ParentSkillProgress>,
  sessionDates: ReadonlyArray<string>,
  firstName: string,
): SummaryCardData {
  let skillsLeveledUp = 0;
  for (const skill of skills) {
    let latest: 1 | 2 | 3 | 4 | 5 | null;
    let first: 1 | 2 | 3 | 4 | 5 | null;
    if (skill.ratedPerSide) {
      // Sided skills carry their data in currentLeft / currentRight (and
      // per-side history points); skill.current is always null. Collapse
      // both sides to a single value with the lower-side rule for both
      // ends of the comparison so the headline only credits a move-up
      // when the growth-edge side actually improved.
      latest = lowerOfTwoSides(
        latestGradeFromCurrent(skill.currentLeft),
        latestGradeFromCurrent(skill.currentRight),
      );
      first = lowerOfTwoSides(
        firstGradeForSide(skill.history, "left"),
        firstGradeForSide(skill.history, "right"),
      );
    } else {
      latest = latestGradeFromCurrent(skill.current);
      first = firstGradeFromHistory(skill.history);
    }
    if (latest !== null && first !== null && latest > first) {
      skillsLeveledUp += 1;
    }
  }

  const headline =
    skillsLeveledUp === 0
      ? `${firstName} is getting started`
      : `${firstName} has moved up in ${skillsLeveledUp} ${skillsLeveledUp === 1 ? "skill" : "skills"}`;

  const sortedDates = [...sessionDates].sort();
  const earliest = sortedDates[0] ?? null;
  const latestDate = sortedDates[sortedDates.length - 1] ?? null;
  const lessonLine =
    latestDate !== null
      ? `Last lesson graded ${formatShortMonthDay(latestDate)} · ${sessionDates.length} ${sessionDates.length === 1 ? "evaluation" : "evaluations"}${earliest ? ` since ${formatMonth(earliest)}` : ""}`
      : null;

  const levelCounts = levelDistribution(skills);
  const total = levelCounts.reduce((sum, entry) => sum + entry.count, 0);

  // "3 skills at Emerging, 6 at Developing, …". Includes every level so
  // the a11y description stays consistent with the visual bar's five
  // segments.
  const parts = levelCounts.map((entry, index) => {
    const name = LEVEL_NAMES[entry.level];
    if (index === 0) return `${entry.count} ${entry.count === 1 ? "skill" : "skills"} at ${name}`;
    return `${entry.count} at ${name}`;
  });
  const levelsScreenReaderText = parts.join(", ");

  return { headline, lessonLine, levelCounts, total, levelsScreenReaderText };
}

// ── Latest coaching priority byline ──────────────────────────────────────

// "From Coach <first name> · <Mon D>" when the coach's name is known;
// "From your coach" alone when it isn't. The API already returns only
// the coach's first name on this payload, derived server-side from the
// first token of profiles.full_name — so the last name never leaves the
// API. The nameless fallback also drops the date, since without an
// authoring coach the byline stops functioning as attribution.
export function coachPriorityByline(
  sessionDate: string,
  coachFirstName: string | null,
): string {
  if (coachFirstName === null || coachFirstName.trim().length === 0) {
    return "From your coach";
  }
  return `From Coach ${coachFirstName} · ${formatShortMonthDay(sessionDate)}`;
}

