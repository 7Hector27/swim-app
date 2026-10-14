"use client";

interface GradeSelectorProps {
  value: 1 | 2 | 3 | 4 | 5 | null;
  disabled: boolean;
  onChange: (grade: 1 | 2 | 3 | 4 | 5 | null) => void;
  labelPrefix: string;
}

export default function GradeSelector({ value, disabled, onChange, labelPrefix }: GradeSelectorProps) {
  const options: Array<{ label: string; grade: 1 | 2 | 3 | 4 | 5 | null }> = [
    { label: "N/A", grade: null },
    { label: "1", grade: 1 },
    { label: "2", grade: 2 },
    { label: "3", grade: 3 },
    { label: "4", grade: 4 },
    { label: "5", grade: 5 },
  ];
  return (
    <div role="radiogroup" aria-label={`${labelPrefix} grade`} className="flex gap-1 flex-wrap">
      {options.map(({ label, grade }) => {
        const selected = value === grade;
        return (
          <button
            key={label}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(grade)}
            className="min-h-[44px] min-w-[44px] px-3 rounded border text-sm font-semibold transition-colors"
            style={{
              borderColor: selected ? "var(--color-accent)" : "var(--color-border)",
              color: selected ? "var(--color-accent)" : "var(--color-text-secondary)",
              backgroundColor: "transparent",
              opacity: disabled ? 0.4 : 1,
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
