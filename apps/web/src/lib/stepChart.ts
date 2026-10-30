// Helpers for the detail-section step charts (per-skill history, starts,
// category trends, golf score). Three invariants:
//
// 1. The x axis is spaced by *real* calendar days, not by index. Two sessions
//    one day apart sit side by side; two sessions a year apart stretch all
//    the way across. This is what makes a cadence drop visible.
// 2. The connecting path is a step (horizontal to the next x, vertical to
//    the next y), not a smooth polyline. A smooth line reads as "the grade
//    rose gradually between sessions", which is not what the data says —
//    the grade stayed what it was until the next session's measurement
//    changed it.
// 3. Only dates with an actual rating draw a point. Missing dates are skipped,
//    not interpolated.

// Strict YYYY-MM-DD. Upstream validators (z.string().date()) usually catch
// malformed inputs before they reach the charts, but these helpers are
// imported by multiple components and a stray truncated string ("2026-10")
// used to parse silently as epoch 0 via `Number("")`. Returning `null` for
// anything that isn't a 10-char ISO calendar date lets the caller fall back
// to a safe default (center of the plot) rather than render a wildly wrong
// x position.
const SESSION_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// Pins session_date strings to a stable instant (noon UTC) so day-math and
// chart x positions produce the same number on server and client regardless
// of the host time zone. Returns null when the input doesn't match
// YYYY-MM-DD — callers fall back to the plot center.
export function sessionDateToUtcMillis(sessionDate: string): number | null {
  const match = SESSION_DATE_PATTERN.exec(sessionDate);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return Date.UTC(year, month - 1, day, 12);
}

// Maps each session_date to an x pixel inside [padLeft, padLeft + plotWidth]
// using real elapsed days from the earliest to latest date. When all dates
// are equal (one-evaluation state) every x collapses to the plot center.
// A session date that fails to parse (shouldn't happen with Zod-validated
// payloads) also collapses to center so the chart stays renderable.
export function realDateXFor(
  sessionDates: string[],
  padLeft: number,
  plotWidth: number,
): (sessionDate: string) => number {
  const centerX = padLeft + plotWidth / 2;
  if (sessionDates.length === 0) {
    return () => centerX;
  }
  const millis = sessionDates
    .map(sessionDateToUtcMillis)
    .filter((value): value is number => value !== null);
  if (millis.length === 0) {
    return () => centerX;
  }
  const minMillis = Math.min(...millis);
  const maxMillis = Math.max(...millis);
  const span = maxMillis - minMillis;
  return (sessionDate) => {
    if (span === 0) return centerX;
    const current = sessionDateToUtcMillis(sessionDate);
    if (current === null) return centerX;
    return padLeft + ((current - minMillis) / span) * plotWidth;
  };
}

// Builds a step-line SVG path from a list of (x, y) pairs. The step goes
// horizontally first, then vertically — "the value held steady until this
// session changed it." Returns an empty string when there are no points so
// callers can skip rendering.
export function stepLinePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return "";
  const first = points[0]!;
  let out = `M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`;
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    out += ` L ${current.x.toFixed(2)} ${previous.y.toFixed(2)}`;
    out += ` L ${current.x.toFixed(2)} ${current.y.toFixed(2)}`;
  }
  return out;
}
