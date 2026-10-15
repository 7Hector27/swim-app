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
