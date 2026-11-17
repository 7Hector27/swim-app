"use client";

// Quiet one-liner legend that sits under the week grid: "Open, Your
// pick, Full or closed". No swatches — the grid itself teaches which
// color is which; this line is just a reminder that uses design tokens
// so it stays consistent in light and dark.

export default function Legend() {
  return (
    <p
      className="text-xs text-text-secondary"
      data-testid="calendar-legend"
    >
      Open, Your pick, Full or closed
    </p>
  );
}
