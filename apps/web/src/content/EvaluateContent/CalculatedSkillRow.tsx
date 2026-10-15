import type { SkillForRating } from "@swim-app/shared";

interface CalculatedSkillRowProps {
  skill: SkillForRating;
  label: string;
}

export default function CalculatedSkillRow({ skill, label }: CalculatedSkillRowProps) {
  return (
    <div
      className="flex items-center justify-between p-3 rounded border"
      style={{ borderColor: "var(--color-border)" }}
      aria-label={`${skill.name}, calculated automatically`}
    >
      <span className="font-semibold text-sm" style={{ color: "var(--color-text)" }}>
        {label}
      </span>
      <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
        Calculated automatically
      </span>
    </div>
  );
}
