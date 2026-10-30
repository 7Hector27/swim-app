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

// Pins session_date strings to a stable instant (noon UTC) so day-math and
// chart x positions produce the same number on server and client regardless
// of the host time zone.
export function sessionDateToUtcMillis(sessionDate: string): number {
  const [yearRaw, monthRaw, dayRaw] = sessionDate.split("-").map(Number);
  return Date.UTC(yearRaw ?? 1970, (monthRaw ?? 1) - 1, dayRaw ?? 1, 12);
}

// Maps each session_date to an x pixel inside [padLeft, padLeft + plotWidth]
// using real elapsed days from the earliest to latest date. When all dates
// are equal (one-evaluation state) every x collapses to the plot center.
export function realDateXFor(
  sessionDates: string[],
  padLeft: number,
  plotWidth: number,
): (sessionDate: string) => number {
  if (sessionDates.length === 0) {
    return () => padLeft + plotWidth / 2;
  }
  const millis = sessionDates.map(sessionDateToUtcMillis);
  const minMillis = Math.min(...millis);
  const maxMillis = Math.max(...millis);
  const span = maxMillis - minMillis;
  return (sessionDate) => {
    if (span === 0) return padLeft + plotWidth / 2;
    const current = sessionDateToUtcMillis(sessionDate);
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
