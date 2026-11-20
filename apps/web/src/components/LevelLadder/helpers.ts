// Pure logic for the level ladder: label lookup, series construction,
// summary chips, and date-tick selection. These stay free of React so the
// next chart in the "charts/*" series can reuse them.

// The rating-scale names (1 → Emerging … 5 → Mastery) live in the API
// catalog at apps/api/src/db/reference/skillsCatalog.ts (RATING_SCALE). We
// mirror the names here so the ladder doesn't need an extra network call
// just to render band labels. Keep this in sync with the catalog's labels;
// the meanings column is not used by the ladder.
export const LEVEL_NAMES: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "Emerging",
  2: "Developing",
  3: "Competent",
  4: "Advanced",
  5: "Mastery",
};

// Drawing-order of the bands, top to bottom (5 at the top, 1 at the bottom).
export const BAND_ORDER: Array<1 | 2 | 3 | 4 | 5> = [5, 4, 3, 2, 1];

export interface LadderPoint {
  id: string;
  grade: number | null;
  notLegal: boolean;
  noConcept: boolean;
  context: string;
  sessionDate: string;
  side: "left" | "right" | null;
}

// Null when the point is Not legal / No concept (no numeric level), otherwise
// the 1–5 grade. Keeps the "don't plot NL/NC as a level" rule in one place.
export function ladderEffectiveLevel(point: LadderPoint): 1 | 2 | 3 | 4 | 5 | null {
  if (point.notLegal || point.noConcept) return null;
  if (point.grade === 1 || point.grade === 2 || point.grade === 3 || point.grade === 4 || point.grade === 5) {
    return point.grade;
  }
  return null;
}

// Takes the history (newest first, as served by the progress endpoint) and
// returns the chronological series (oldest → newest). Side filter is applied
// first so left and right can be drawn as two separate lines.
export function buildLadderSeries(
  history: LadderPoint[],
  side: "left" | "right" | null = null,
): LadderPoint[] {
  const filtered = side === null ? history : history.filter((point) => point.side === side);
  return [...filtered].reverse();
}

// First rating with a numeric level (chronological). Used by the Up/Held/Down
// chip. Returns null when every rating is NL/NC — then we have no baseline to
// compare against and the chip is suppressed.
function firstGradedPoint(series: LadderPoint[]): LadderPoint | null {
  for (const point of series) {
    if (ladderEffectiveLevel(point) !== null) return point;
  }
  return null;
}

function lastGradedPoint(series: LadderPoint[]): LadderPoint | null {
  for (let index = series.length - 1; index >= 0; index -= 1) {
    const point = series[index];
    if (point && ladderEffectiveLevel(point) !== null) return point;
  }
  return null;
}

// Formats a YYYY-MM-DD as "Oct 25, 2026" in the LA zone, matching the
// existing SkillChart formatter so SSR/hydration stay byte-identical.
export function formatLadderDate(sessionDate: string): string {
  const parts = sessionDate.split("-").map(Number);
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  if (year === undefined || month === undefined || day === undefined) return sessionDate;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Los_Angeles",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

export interface ChipData {
  key: string;
  label: string;
  tone: "accent" | "neutral" | "muted";
}

// Chip set rendered in the details column of an opened skill row.
// Exactly two chips:
//   1. "Now: <levelName>" — or NL / NC when the latest point isn't graded.
//   2. The change chip:
//        - "Up N levels since <date>"   (improved)
//        - "Held since <date>"          (same first vs. last level)
//        - "Down N levels since <date>" (regressed)
//        - "First rating"               (single graded rating)
// The streak chip and the Next-level chip have been dropped — the Next
// descriptor renders as plain text under the chips (see buildNextDescriptor).
export function buildChips(series: LadderPoint[]): ChipData[] {
  const chips: ChipData[] = [];
  if (series.length === 0) return chips;

  const latest = series[series.length - 1];
  if (!latest) return chips;

  // Chip 1: Now
  const latestLevel = ladderEffectiveLevel(latest);
  if (latestLevel !== null) {
    chips.push({ key: "now", label: `Now: ${LEVEL_NAMES[latestLevel]}`, tone: "accent" });
  } else if (latest.notLegal) {
    chips.push({ key: "now", label: "Now: Not legal", tone: "muted" });
  } else if (latest.noConcept) {
    chips.push({ key: "now", label: "Now: No concept", tone: "muted" });
  }

  // Chip 2: change over time
  const first = firstGradedPoint(series);
  const last = lastGradedPoint(series);
  if (first && last && first.id !== last.id) {
    const firstLevel = ladderEffectiveLevel(first);
    const lastLevel = ladderEffectiveLevel(last);
    if (firstLevel !== null && lastLevel !== null) {
      const delta = lastLevel - firstLevel;
      const firstDate = formatLadderDate(first.sessionDate);
      if (delta > 0) {
        chips.push({
          key: "delta",
          label: `Up ${delta} level${delta === 1 ? "" : "s"} since ${firstDate}`,
          tone: "accent",
        });
      } else if (delta < 0) {
        const abs = Math.abs(delta);
        chips.push({
          key: "delta",
          label: `Down ${abs} level${abs === 1 ? "" : "s"} since ${firstDate}`,
          tone: "muted",
        });
      } else {
        chips.push({ key: "delta", label: `Held since ${firstDate}`, tone: "neutral" });
      }
    }
  } else if (first && last && first.id === last.id) {
    // Single graded rating — the brief calls this "First rating" so the
    // chip reads cleanly even when the swimmer has only one evaluation.
    chips.push({ key: "delta", label: "First rating", tone: "neutral" });
  }

  return chips;
}

// Next-level descriptor shown under the chips as plain text. Returns null
// when the skill has no descriptors, the latest rating is already at the
// max level, or the latest is NL / NC.
export function buildNextDescriptor(
  series: LadderPoint[],
  levelDescriptors?: Partial<Record<1 | 2 | 3 | 4 | 5, string>> | undefined,
): { levelName: string; text: string } | null {
  if (!levelDescriptors || series.length === 0) return null;
  const latest = series[series.length - 1];
  if (!latest) return null;
  const latestLevel = ladderEffectiveLevel(latest);
  if (latestLevel === null || latestLevel >= 5) return null;
  const nextLevel = (latestLevel + 1) as 1 | 2 | 3 | 4 | 5;
  const descriptor = levelDescriptors[nextLevel];
  if (!descriptor || descriptor.trim().length === 0) return null;
  return { levelName: LEVEL_NAMES[nextLevel], text: descriptor };
}

// Which point indices should carry a date label underneath. The ladder
// draws the first and last labels at every width and then adds at most
// one or two in between so dense series don't overflow. Default
// `maxLabels` of 4 covers first + last + up to two middle ticks.
export function pickDateTickIndices(count: number, maxLabels: number = 4): Set<number> {
  if (count <= 0) return new Set();
  if (count <= maxLabels) {
    const all = new Set<number>();
    for (let index = 0; index < count; index += 1) all.add(index);
    return all;
  }
  const picks = new Set<number>([0, count - 1]);
  const extras = Math.max(0, maxLabels - 2);
  for (let step = 1; step <= extras; step += 1) {
    const index = Math.round((step * (count - 1)) / (extras + 1));
    picks.add(index);
  }
  return picks;
}

// Keep at most `maxPoints` most-recent points. Returns the trimmed series in
// the same (oldest-first) order. Default 10 per the brief.
export function trimToRecent<T>(series: T[], maxPoints: number = 10): T[] {
  if (series.length <= maxPoints) return series;
  return series.slice(series.length - maxPoints);
}

// Short text alternative for screen readers describing the current state and
// the change over time. Separate from chips because the chip row includes
// decorative markup; this string is one flat sentence.
export function buildSrDescription(skillName: string, series: LadderPoint[]): string {
  if (series.length === 0) return `${skillName}: no ratings yet.`;
  const latest = series[series.length - 1];
  if (!latest) return `${skillName}: no ratings yet.`;
  const latestLevel = ladderEffectiveLevel(latest);
  const parts: string[] = [];
  if (latestLevel !== null) {
    parts.push(`${skillName}: currently ${LEVEL_NAMES[latestLevel]}`);
  } else if (latest.notLegal) {
    parts.push(`${skillName}: latest rating Not legal`);
  } else if (latest.noConcept) {
    parts.push(`${skillName}: latest rating No concept`);
  } else {
    parts.push(`${skillName}: ${series.length} rating${series.length === 1 ? "" : "s"}`);
  }
  const first = firstGradedPoint(series);
  const last = lastGradedPoint(series);
  if (first && last && first.id !== last.id) {
    const firstLevel = ladderEffectiveLevel(first);
    const lastLevel = ladderEffectiveLevel(last);
    if (firstLevel !== null && lastLevel !== null) {
      const delta = lastLevel - firstLevel;
      if (delta > 0) parts.push(`up ${delta} level${delta === 1 ? "" : "s"} since ${formatLadderDate(first.sessionDate)}`);
      else if (delta < 0) parts.push(`down ${Math.abs(delta)} level${Math.abs(delta) === 1 ? "" : "s"} since ${formatLadderDate(first.sessionDate)}`);
      else parts.push(`held since ${formatLadderDate(first.sessionDate)}`);
    }
  }
  return `${parts.join("; ")}.`;
}
