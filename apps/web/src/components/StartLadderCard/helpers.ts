import type {
  MeasurementUnit,
  SkillCurrentLevel,
  StartComponentProgress,
  StartGradeResult,
} from "@swim-app/shared";
import type { LadderPoint } from "@/components/LevelLadder/helpers";

// One of the four branches the StartLadderCard renders. Picked from the
// combination of (overall start grade status, how many components are rated).
// "notStarted": grade is in_progress AND zero components have a current rating
// "inProgress": grade is in_progress AND at least one component is rated
// "graded":     grade.status is "graded" or "not_legal" (a numeric level or a DQ)
// "noConcept":  grade.status is "no_concept" — vanishingly rare for starts;
//               rendered as a one-line summary with an NC badge.
export type StartBranch = "notStarted" | "inProgress" | "graded" | "noConcept";

export function pickBranch(grade: StartGradeResult, components: StartComponentProgress[]): StartBranch {
  if (grade.status === "graded" || grade.status === "not_legal") return "graded";
  if (grade.status === "no_concept") return "noConcept";
  // in_progress
  const anyGraded = components.some((component) => component.current !== null);
  return anyGraded ? "inProgress" : "notStarted";
}

// How many components have any current rating, out of the total. Used by the
// "N of M components graded" subhead.
export function componentCounts(components: StartComponentProgress[]): { graded: number; total: number } {
  let graded = 0;
  for (const component of components) {
    if (component.current !== null) graded += 1;
  }
  return { graded, total: components.length };
}

// Status-badge text + tone for the top-right chip. Mirrors the existing
// StartProgression badge ("Grade N", "Not legal", "In progress",
// "No concept") so the vocabulary doesn't shift across the page.
export interface StatusBadgeData {
  label: string;
  tone: "neutral" | "danger" | "muted" | "accent";
}

export function statusBadge(grade: StartGradeResult): StatusBadgeData {
  if (grade.status === "graded") return { label: `Grade ${grade.grade}`, tone: "accent" };
  if (grade.status === "not_legal") return { label: "Not legal", tone: "danger" };
  if (grade.status === "no_concept") return { label: "No concept", tone: "muted" };
  return { label: "In progress", tone: "neutral" };
}

// Turns the scoreHistory per-start history into LadderPoint[] the shared
// LevelLadder renders. Rules:
// - status "graded" → graded dot at level N
// - status "not_legal" → notLegal: true (gets the NL marker row)
// - status "no_concept" → noConcept: true (gets the NC marker row)
// - status "in_progress" → skipped entirely: the start didn't have a legal
//   grade at that date, so there's no rating to show at that session.
// The ladder's own helpers treat the result as oldest-first — this helper is
// handed the series in the same (oldest-first) order startSeries() returns.
export function startHistoryToLadderPoints(
  history: Array<{ sessionDate: string; grade: StartGradeResult; sessionId?: string }>,
): LadderPoint[] {
  const points: LadderPoint[] = [];
  history.forEach((entry, index) => {
    if (entry.grade.status === "in_progress") return;
    const id = entry.sessionId ?? `start-point-${entry.sessionDate}-${index}`;
    if (entry.grade.status === "graded") {
      points.push({
        id,
        sessionDate: entry.sessionDate,
        grade: entry.grade.grade,
        notLegal: false,
        noConcept: false,
        // Starts don't carry a context — they're the composite of their
        // components — so we pick a shape that reads neutrally. "practice"
        // (circle) is the simplest and matches what score-history points
        // use when contextless.
        context: "practice",
        side: null,
      });
    } else if (entry.grade.status === "not_legal") {
      points.push({
        id,
        sessionDate: entry.sessionDate,
        grade: null,
        notLegal: true,
        noConcept: false,
        context: "practice",
        side: null,
      });
    } else if (entry.grade.status === "no_concept") {
      points.push({
        id,
        sessionDate: entry.sessionDate,
        grade: null,
        notLegal: false,
        noConcept: true,
        context: "practice",
        side: null,
      });
    }
  });
  // startSeries() builds history oldest-first; the LevelLadder's helpers
  // expect newest-first (they reverse internally via buildLadderSeries).
  // Reversing here keeps the invariants aligned without the ladder knowing
  // it's being fed a starts-flavored series.
  return points.reverse();
}

// Short unit label for measured components on the compact list. The DB enum
// uses machine-readable strings; the ladder card renders them as pool-deck
// shorthand so the row stays narrow at phone width. Units the brief calls
// out explicitly (seconds, feet) get a dedicated short form.
export function formatMeasurementUnit(unit: MeasurementUnit | null): string {
  if (unit === null) return "";
  switch (unit) {
    case "seconds":
      return "s";
    case "feet":
      return "ft";
    case "stroke_count":
      return "strokes";
    case "stroke_cycles_per_minute":
      return "spm";
    case "kicks_per_minute":
      return "kpm";
  }
}

// Short unit label for capacity values (yards | reps).
export function formatCapacityUnit(unit: "yards" | "reps" | null): string {
  if (unit === null) return "";
  if (unit === "yards") return "yd";
  return "reps";
}

// Measurement value to show inline with the component's bar. When there is
// no measurement (rubric-only component), returns null so the caller omits
// the segment. Capacity is included after the measurement when both exist.
export function componentValueLabel(current: SkillCurrentLevel | null): string | null {
  if (current === null) return null;
  const pieces: string[] = [];
  if (current.measurementValue !== null) {
    pieces.push(`${current.measurementValue}${formatMeasurementUnit(current.measurementUnit)}`);
  }
  if (current.capacityValue !== null) {
    pieces.push(`${current.capacityValue}${formatCapacityUnit(current.capacityUnit)}`);
  }
  if (pieces.length === 0) return null;
  return pieces.join(" · ");
}

// 1..5 for the filled-block count on the mini bar. Null when the component
// isn't gradeable (DQ or NC) — the caller renders a status badge instead.
export function componentBarFill(current: SkillCurrentLevel | null): number | null {
  if (current === null) return null;
  if (current.notLegal || current.noConcept) return null;
  if (current.grade === null) return null;
  return current.grade;
}
