"use client";

import type { SkillForRating } from "@swim-app/shared";
import { MeasurementUnitSchema, displayUnitToMeasurementEnum } from "@swim-app/shared";
import type { EvaluateFieldIssue, SkillDraft } from "./helpers";

// Pass 2b: the measurement number box moved from DetailsPanel onto the row,
// so a coach can type a measured value next to the 1-5 pills without
// opening another panel. Rendered for `type: "measured"` and `type: "score"`
// skills. For scores (golf score), the golf-score category pills still live
// on the row above this component.

interface MeasurementInputProps {
  skill: SkillForRating;
  draft: SkillDraft;
  draftKey: string;
  onChange: (key: string, patch: Partial<SkillDraft>) => void;
  issue?: EvaluateFieldIssue;
}

export default function MeasurementInput({ skill, draft, draftKey, onChange, issue }: MeasurementInputProps) {
  // A measured/score skill is "savable" when either (a) it has no catalog
  // unit and the coach picks the enum via the dropdown, or (b) the catalog
  // unit maps to a `measurement_unit` enum value. "kicks/min" (and any
  // other label without an enum) can't persist a measurement — surface a
  // short note instead of a trap input.
  const canSave = skill.unit === null || displayUnitToMeasurementEnum(skill.unit) !== null;
  const measurementUnits = MeasurementUnitSchema.options;
  const unitLabel = skill.type === "score" ? "Measurement" : "Measurement";

  if (!canSave) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold" style={{ color: "var(--color-text-secondary)" }}>
          {unitLabel}
        </span>
        <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
          Measurements in {skill.unit} can&apos;t be saved yet — record this in the note below.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={`${draftKey}-measurement-input`}
        className="text-xs font-semibold"
        style={{ color: "var(--color-text-secondary)" }}
      >
        {unitLabel}
      </label>
      <div className="flex gap-2 items-center flex-wrap">
        <input
          id={`${draftKey}-measurement-input`}
          type="number"
          inputMode="decimal"
          value={draft.measurementValue}
          onChange={(event) => onChange(draftKey, { measurementValue: event.target.value })}
          placeholder="Value"
          aria-invalid={issue !== undefined || undefined}
          aria-describedby={issue ? `${draftKey}-measurement-error` : undefined}
          className="border rounded px-3 py-2 text-sm min-h-[44px] w-24"
          style={{
            borderColor: issue ? "var(--color-danger)" : "var(--color-border)",
            color: "var(--color-text)",
            backgroundColor: "transparent",
          }}
        />
        {skill.unit !== null ? (
          <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>{skill.unit}</span>
        ) : (
          <select
            value={draft.measurementUnit ?? ""}
            onChange={(event) =>
              onChange(draftKey, {
                measurementUnit: event.target.value === "" ? null : event.target.value,
              })
            }
            aria-invalid={issue !== undefined || undefined}
            aria-label={`${skill.name} unit`}
            className="border rounded px-3 py-2 text-sm min-h-[44px]"
            style={{
              borderColor: issue ? "var(--color-danger)" : "var(--color-border)",
              color: "var(--color-text)",
              backgroundColor: "transparent",
            }}
          >
            <option value="">Unit</option>
            {measurementUnits.map((unit) => (
              <option key={unit} value={unit}>{unit}</option>
            ))}
          </select>
        )}
      </div>
      {issue && (
        <p
          id={`${draftKey}-measurement-error`}
          className="text-xs"
          style={{ color: "var(--color-danger)" }}
        >
          {issue.message}
        </p>
      )}
    </div>
  );
}
