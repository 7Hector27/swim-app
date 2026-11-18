"use client";

import type { SessionDraft, EvaluateFieldIssue } from "./helpers";
import { DOM_IDS } from "./helpers";

// Freestyle/butterfly breathing-pattern picker. Per the Oct 14 decisions doc
// this records on fly and free ratings, but storage stays at the session
// level (one value per session). The field is rendered inside "The swim"
// section on those two screens; the DOM id matches the validation anchor so
// scroll-to-first-error still works.

const BREATHING_OPTIONS = [
  { value: "every_1", label: "Every stroke" },
  { value: "every_2", label: "Every 2" },
  { value: "every_3", label: "Every 3" },
  { value: "every_4", label: "Every 4" },
  { value: "every_5", label: "Every 5" },
  { value: "other", label: "Other" },
] as const;

interface BreathingPatternFieldProps {
  value: SessionDraft["breathingPattern"];
  onChange: (next: SessionDraft["breathingPattern"]) => void;
  issue?: EvaluateFieldIssue;
}

export default function BreathingPatternField({ value, onChange, issue }: BreathingPatternFieldProps) {
  return (
    <fieldset id={DOM_IDS.breathingPattern} className="flex flex-col gap-2">
      <legend className="font-bold text-sm" style={{ color: "var(--color-text)" }}>
        Breathing pattern
      </legend>
      <div
        className="flex gap-2 flex-wrap"
        role="group"
        aria-invalid={issue !== undefined || undefined}
        aria-describedby={issue ? `${DOM_IDS.breathingPattern}-error` : undefined}
      >
        {BREATHING_OPTIONS.map(({ value: optionValue, label }) => (
          <button
            key={optionValue}
            type="button"
            onClick={() => onChange(optionValue)}
            className="min-h-[44px] px-4 rounded border text-sm font-semibold transition-colors"
            style={{
              borderColor:
                value === optionValue
                  ? "var(--color-accent)"
                  : issue
                    ? "var(--color-danger)"
                    : "var(--color-border)",
              color: value === optionValue ? "var(--color-accent)" : "var(--color-text-secondary)",
              backgroundColor: "transparent",
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {issue && (
        <p id={`${DOM_IDS.breathingPattern}-error`} className="text-xs" style={{ color: "var(--color-danger)" }}>
          {issue.message}
        </p>
      )}
    </fieldset>
  );
}
