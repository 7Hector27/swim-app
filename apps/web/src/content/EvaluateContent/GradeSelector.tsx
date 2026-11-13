"use client";

// Jason taps grade buttons hundreds of times per session, often
// one-handed at the pool. The animate skill's 100+/day tier only
// allows near-imperceptible feedback — and that's exactly what the
// button needs today: a 160ms press scale(0.97) so the tap registers
// in the hand, plus a 140ms transition on the color flip so the
// selected state reads obviously without a hard cut.
//
// Selected state is a filled accent pill, not just an outlined one,
// because at pool-deck viewing angles + wet-screen contrast an outline
// loses to an interior fill. Reduced-motion drops the transform; the
// color transition is non-motion and stays.

const GRADE_BUTTON_CLASS = [
  "min-h-[44px] min-w-[44px] px-3 rounded border text-sm font-semibold",
  "transition-[transform,background-color,border-color,color]",
  "duration-150 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]",
  "active:scale-[0.97] motion-reduce:transform-none",
  "disabled:opacity-40 disabled:cursor-not-allowed",
].join(" ");

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
            className={GRADE_BUTTON_CLASS}
            style={{
              borderColor: selected ? "var(--color-accent)" : "var(--color-border)",
              color: selected ? "var(--color-on-accent)" : "var(--color-text-secondary)",
              backgroundColor: selected ? "var(--color-accent)" : "transparent",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
