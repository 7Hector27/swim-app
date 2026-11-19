// Shared formatters and small predicates used by the coach + parent
// progress pages. Pass 3 pulled the truly identical ones here so there's
// one source. Label-shaped variants ("Not legal" vs "DQ", "No concept"
// vs "NC") intentionally stay per-page.

import type { SkillCurrentLevel } from "@swim-app/shared";

export function currentLevelIsDanger(level: SkillCurrentLevel): boolean {
  return level.notLegal;
}

// Numeric grade for arithmetic: not_legal → 0 (so an average sees the
// disqualification), no_concept → null (dropped from averages). Takes
// the loosest point shape so coach and parent progress points both
// satisfy it without an adapter.
interface GradedPointLoose {
  grade: number | null;
  notLegal: boolean;
  noConcept: boolean;
}
export function pointGradeNumber(point: GradedPointLoose): number | null {
  if (point.notLegal) return 0;
  if (point.noConcept) return null;
  return point.grade;
}

// Pass 3: 6-week stale rule for the grey-out and "X weeks ago" label on
// the row. `sessionDate` is the day the swim happened (not when the
// rating was entered). Returns null for an undefined date (skill never
// rated). The 42-day threshold matches the Oct 14 doc's six weeks.
export function isStaleBySessionDate(
  sessionDate: string | undefined,
  now: Date = new Date(),
): boolean {
  if (!sessionDate) return false;
  const [year, month, day] = sessionDate.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return false;
  const then = new Date(Date.UTC(year, month - 1, day));
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const days = Math.max(0, Math.round((today.getTime() - then.getTime()) / (24 * 60 * 60 * 1000)));
  return days >= 42;
}

// Minimum effective-rating count a skill needs before we draw a trend
// line on its row. Below this we show the current grade + last-rated
// date but no micro-chart. Group-level trends aren't gated by this.
export const MIN_RATINGS_FOR_TREND = 3;

// Short date for "X of Y" and session byline text. Always LA time, so
// server-rendered and client-rendered copies agree.
export function formatSessionDateShort(sessionDate: string): string {
  const [year, month, day] = sessionDate.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return sessionDate;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Los_Angeles",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

// Human-friendly "rated X ago" using the given `now` for deterministic
// rendering. Null for an undefined session date. Pulled out of
// SwimmerProgressContent/helpers.ts so the parent page can import it too.
export function formatRecency(sessionDate: string | undefined, now: Date = new Date()): string | null {
  if (!sessionDate) return null;
  const [year, month, day] = sessionDate.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return null;
  const then = new Date(Date.UTC(year, month - 1, day));
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const days = Math.max(0, Math.round((today.getTime() - then.getTime()) / (24 * 60 * 60 * 1000)));
  if (days === 0) return "Rated today";
  if (days === 1) return "Rated 1 day ago";
  if (days < 7) return `Rated ${days} days ago`;
  if (days < 14) return "Rated 1 week ago";
  if (days < 60) return `Rated ${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `Rated ${Math.floor(days / 30)} months ago`;
  return "Rated over a year ago";
}
