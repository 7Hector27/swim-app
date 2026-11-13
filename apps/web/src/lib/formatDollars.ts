// Shared dollar formatter for anything that renders a USD cents figure
// (balance, prices, refund previews, package tiers, coach adjustments).
// Pure, no "use client" directive, so both server pages and client
// components can import it without crossing the RSC boundary.

export function formatDollars(cents: number): string {
  const absCents = Math.abs(cents);
  const dollars = Math.floor(absCents / 100);
  const remainder = absCents % 100;
  const sign = cents < 0 ? "-" : "";
  const formattedDollars = dollars.toLocaleString("en-US");
  return `${sign}$${formattedDollars}.${String(remainder).padStart(2, "0")}`;
}
