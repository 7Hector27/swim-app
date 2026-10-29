export function parseSwimTime(value: string): number | null {
  if (!value) return null;
  const withMin = /^(\d+):(\d{2})\.(\d{1,2})$/.exec(value);
  if (withMin) {
    const minutes = parseInt(withMin[1]!, 10);
    const seconds = parseInt(withMin[2]!, 10);
    if (seconds >= 60) return null;
    const fracStr = withMin[3]!;
    const hundredths = fracStr.length === 1 ? parseInt(fracStr, 10) * 10 : parseInt(fracStr, 10);
    return minutes * 6000 + seconds * 100 + hundredths;
  }
  const noMin = /^(\d+)\.(\d{1,2})$/.exec(value);
  if (noMin) {
    const seconds = parseInt(noMin[1]!, 10);
    const fracStr = noMin[2]!;
    const hundredths = fracStr.length === 1 ? parseInt(fracStr, 10) * 10 : parseInt(fracStr, 10);
    return seconds * 100 + hundredths;
  }
  return null;
}

export function formatSwimTime(hundredths: number): string {
  const minutes = Math.floor(hundredths / 6000);
  const remaining = hundredths % 6000;
  const seconds = Math.floor(remaining / 100);
  const frac = remaining % 100;
  const secStr = seconds.toString().padStart(2, "0");
  const fracStr = frac.toString().padStart(2, "0");
  if (minutes > 0) return `${minutes}:${secStr}.${fracStr}`;
  return `${secStr}.${fracStr}`;
}

// Fills the time format as the user types digits:
//   "3215"  → 32.15      (hundredths of a second)
//   "10234" → 1:02.34
// Rightmost two digits are hundredths, next two are seconds, remainder is
// minutes. Returns the normalized "SS.HH" / "M:SS.HH" string and the parsed
// hundredths, or null for an empty / invalid input (e.g. seconds >= 60).
export function parseDigitsToSwimTime(
  digits: string,
): { timeString: string; timeHundredths: number } | null {
  if (!/^\d*$/.test(digits)) return null;
  if (digits.length === 0) return null;

  // Pad to at least 3 digits so we always have at least one digit of seconds.
  const padded = digits.padStart(3, "0");
  const hundredthsPart = padded.slice(-2);
  const secondsPart = padded.slice(-4, -2);
  const minutesPart = padded.slice(0, -4);

  const hundredths = parseInt(hundredthsPart, 10);
  const seconds = parseInt(secondsPart, 10);
  if (seconds >= 60) return null;
  const minutes = minutesPart.length > 0 ? parseInt(minutesPart, 10) : 0;

  const total = minutes * 6000 + seconds * 100 + hundredths;
  return { timeString: formatSwimTime(total), timeHundredths: total };
}

// Signed fractional deviation of a time from a reference (prior best).
// Returns 0 when ref is 0 to avoid divide-by-zero. Positive = slower,
// negative = faster. Example: new=55, ref=50 → 0.10 (10% slower).
export function deviationFromBest(
  timeHundredths: number,
  bestHundredths: number,
): number {
  if (bestHundredths <= 0) return 0;
  return (timeHundredths - bestHundredths) / bestHundredths;
}
