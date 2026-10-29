import type { ScoreHistoryResponse, StartGradeResult } from "@swim-app/shared";

// Session dates are stored as YYYY-MM-DD strings (no timezone). The server
// may be in UTC and the client in any zone; constructing a Date with the
// local-time constructor would produce different instants on each side and
// the Intl formatter could land on a different calendar day. Build the
// instant at noon UTC so the LA zone (UTC-7/-8) always resolves to the same
// Y-M-D on both server and client.
function utcNoon(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 12));
}

export function formatSessionDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Los_Angeles",
  }).format(utcNoon(year!, month!, day!));
}

export function formatMonthDay(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  }).format(utcNoon(year!, month!, day!));
}

// Pulls head-position-overall as an oldest-first series from score history.
// sessionId is threaded through so HeroTrendChart can deep-link to edit mode.
export function headPositionSeries(
  history: ScoreHistoryResponse,
): Array<{ sessionDate: string; value: number | null; sessionId: string }> {
  return history.points.map((point) => ({
    sessionDate: point.sessionDate,
    value: point.headPositionOverall,
    sessionId: point.sessionId,
  }));
}

// Per-category trend series indexed from the first point's rollups so the
// shape stays stable across time.
export function categoryTrendSeries(history: ScoreHistoryResponse): Array<{
  categoryId: string;
  name: string;
  points: Array<{ sessionDate: string; value: number | null }>;
}> {
  const first = history.points[0];
  if (!first) return [];
  return first.categoryRollups.map((rollup, categoryIndex) => ({
    categoryId: rollup.categoryId,
    name: rollup.categoryName,
    points: history.points.map((point) => ({
      sessionDate: point.sessionDate,
      value: point.categoryRollups[categoryIndex]?.average ?? null,
    })),
  }));
}

export function latestCategorySnapshot(history: ScoreHistoryResponse): Array<{
  categoryId: string;
  name: string;
  average: number | null;
  assessedCount: number;
  totalCount: number;
}> {
  const latest = history.points[history.points.length - 1];
  if (!latest) return [];
  return latest.categoryRollups.map((rollup) => ({
    categoryId: rollup.categoryId,
    name: rollup.categoryName,
    average: rollup.average,
    assessedCount: rollup.assessedCount,
    totalCount: rollup.totalCount,
  }));
}

// Per-start progression series from score history. Order and names are taken
// from the first point so a newly-rated start doesn't rearrange earlier points.
// sessionId is threaded through so StartProgression can deep-link to edit mode.
export function startSeries(history: ScoreHistoryResponse): Array<{
  slug: string;
  name: string;
  points: Array<{ sessionDate: string; grade: StartGradeResult; sessionId: string }>;
}> {
  const first = history.points[0];
  if (!first) return [];
  return first.starts.map((startAtFirst) => ({
    slug: startAtFirst.slug,
    name: startAtFirst.name,
    points: history.points.map((point) => {
      const match = point.starts.find((entry) => entry.slug === startAtFirst.slug);
      return {
        sessionDate: point.sessionDate,
        grade: match?.grade ?? { status: "in_progress", missing: [] },
        sessionId: point.sessionId,
      };
    }),
  }));
}
