// Balance-page-only formatters. `formatDollars` is shared across the app
// and lives at @/lib/formatDollars so other content folders don't have
// to cross-import this one. Pure, no "use client" directive.

import { formatDollars } from "@/lib/formatDollars";

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
