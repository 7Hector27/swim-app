// Pure formatters shared by the balance page and the insufficient-funds
// modal. Lives outside the "use client" boundary so both server pages
// and client components can import it without crossing the boundary.

export function formatDollars(cents: number): string {
  const absCents = Math.abs(cents);
  const dollars = Math.floor(absCents / 100);
  const remainder = absCents % 100;
  const sign = cents < 0 ? "-" : "";
  const formattedDollars = dollars.toLocaleString("en-US");
  return `${sign}$${formattedDollars}.${String(remainder).padStart(2, "0")}`;
}

export function formatSignedDollars(cents: number): string {
  if (cents > 0) return `+${formatDollars(cents)}`;
  if (cents < 0) return formatDollars(cents);
  return formatDollars(0);
}

export function formatApproxHours(hours: number): string {
  // Server derives half-hour-precision floor already. "≈ 3 hours" vs
  // "≈ 3.5 hours" — never a decimal that isn't x.0 or x.5.
  if (hours === 0) return "≈ 0 hours";
  const str = hours % 1 === 0 ? hours.toString() : hours.toFixed(1);
  const noun = hours === 1 ? "hour" : "hours";
  return `≈ ${str} ${noun}`;
}

export function formatHistoryDate(iso: string): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Los_Angeles",
  }).format(date);
}
