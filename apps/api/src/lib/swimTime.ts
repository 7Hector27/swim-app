// Parses a swim time string into total seconds.
// Accepted formats:
//   M:SS.hh  (e.g. "1:23.45")
//   SS.hh    (e.g. "58.30")
//   H:MM:SS.hh (e.g. "1:05:30.00")
//
// Returns null if the string is not a valid swim time.
export function parseSwimTime(timeString: string): number | null {
  const trimmed = timeString.trim();

  // H:MM:SS.hh
  const longMatch = /^(\d+):(\d{2}):(\d{2})\.(\d{2})$/.exec(trimmed);
  if (longMatch) {
    const hours = parseInt(longMatch[1]!, 10);
    const minutes = parseInt(longMatch[2]!, 10);
    const seconds = parseInt(longMatch[3]!, 10);
    const hundredths = parseInt(longMatch[4]!, 10);
    if (minutes >= 60 || seconds >= 60) return null;
    return hours * 3600 + minutes * 60 + seconds + hundredths / 100;
  }

  // M:SS.hh
  const midMatch = /^(\d+):(\d{2})\.(\d{2})$/.exec(trimmed);
  if (midMatch) {
    const minutes = parseInt(midMatch[1]!, 10);
    const seconds = parseInt(midMatch[2]!, 10);
    const hundredths = parseInt(midMatch[3]!, 10);
    if (seconds >= 60) return null;
    return minutes * 60 + seconds + hundredths / 100;
  }

  // SS.hh
  const shortMatch = /^(\d+)\.(\d{2})$/.exec(trimmed);
  if (shortMatch) {
    const seconds = parseInt(shortMatch[1]!, 10);
    const hundredths = parseInt(shortMatch[2]!, 10);
    return seconds + hundredths / 100;
  }

  return null;
}

// Formats total seconds into a swim time string.
// Uses M:SS.hh format, collapsing minutes if zero.
export function formatSwimTime(totalSeconds: number): string {
  const hundredths = Math.round((totalSeconds % 1) * 100);
  const wholeSeconds = Math.floor(totalSeconds);
  const minutes = Math.floor(wholeSeconds / 60);
  const seconds = wholeSeconds % 60;

  const hhStr = String(hundredths).padStart(2, "0");
  const ssStr = String(seconds).padStart(2, "0");

  if (minutes === 0) {
    return `${ssStr}.${hhStr}`;
  }
  return `${minutes}:${ssStr}.${hhStr}`;
}
