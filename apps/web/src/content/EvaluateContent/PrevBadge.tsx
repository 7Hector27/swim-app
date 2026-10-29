import type { SwimmerSkillsResponse } from "@swim-app/shared";

// Compact pill shown next to each skill title with the swimmer's most recent
// grade for that skill (and that side, for per-side skills). Reads a value
// out of SwimmerSkillsResponse["grades"] keyed by the skill slug — or
// `${slug}:left` / `${slug}:right` for per-side skills — so this stays
// contract-aligned with the API map in /coach/swimmers/:id/skills.

interface PrevBadgeProps {
  value: SwimmerSkillsResponse["grades"][string] | undefined;
}

export default function PrevBadge({ value }: PrevBadgeProps) {
  if (value === undefined) {
    return (
      <span
        className="inline-flex items-center h-6 px-2 rounded-full text-[10px] font-bold uppercase tracking-wider border border-border text-text-secondary bg-background"
        aria-label="No previous rating"
      >
        New
      </span>
    );
  }
  const display =
    value === "not_legal" ? "Not legal" : value === "no_concept" ? "No concept" : String(value);
  return (
    <span
      className="inline-flex items-center h-6 px-2 gap-1 rounded-full text-xs font-semibold border border-border bg-background text-text-secondary tabular-nums"
      aria-label={`Previous rating: ${display}`}
    >
      <span className="text-[10px] uppercase tracking-wider opacity-70">Last</span>
      <span>{display}</span>
    </span>
  );
}
