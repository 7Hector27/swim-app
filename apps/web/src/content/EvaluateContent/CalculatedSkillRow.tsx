import type { SkillForRating, SwimmerSkillsResponse } from "@swim-app/shared";
import PrevBadge from "./PrevBadge";

interface CalculatedSkillRowProps {
  skill: SkillForRating;
  label: string;
  calculatedGrade?: 1 | 2 | 3 | 4 | 5 | null;
  prevGrade?: SwimmerSkillsResponse["grades"][string];
}

export default function CalculatedSkillRow({ skill, label, calculatedGrade, prevGrade }: CalculatedSkillRowProps) {
  return (
    <div
      className="flex items-center justify-between gap-2 p-4 rounded-lg border border-border"
      aria-label={`${skill.name}, calculated automatically`}
    >
      <div className="flex items-center gap-2 flex-wrap min-w-0">
        <span className="font-semibold text-sm text-text">{label}</span>
        <PrevBadge value={prevGrade} />
      </div>
      <span className="text-xs text-text-secondary shrink-0">
        {calculatedGrade !== undefined && calculatedGrade !== null
          ? `Grade: ${calculatedGrade}`
          : "Calculated automatically"}
      </span>
    </div>
  );
}
