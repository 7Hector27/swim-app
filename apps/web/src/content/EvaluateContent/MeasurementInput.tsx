"use client";

import type { SkillForRating } from "@swim-app/shared";
import { MeasurementUnitSchema, displayUnitToMeasurementEnum } from "@swim-app/shared";
import type { EvaluateFieldIssue, SkillDraft } from "./helpers";

// Pass 2b: the measurement number box moved from DetailsPanel onto the row.
// Pass 2c: for golf-score skills (`type: "score"`) the row shows two
// number inputs (Time, Stroke count) with the derived golf score below.
// The coach types a time like 14.25 and a stroke count like 18; the UI
// never asks them to type a sum.

interface MeasurementInputProps {
  skill: SkillForRating;
  draft: SkillDraft;
  draftKey: string;
  onChange: (key: string, patch: Partial<SkillDraft>) => void;
  issue?: EvaluateFieldIssue;
}

export default function MeasurementInput({ skill, draft, draftKey, onChange, issue }: MeasurementInputProps) {
  // Golf-score path — two paired numeric inputs. Time has hundredths-of-a-
  // second precision (numeric(6,2) at the DB layer). Stroke count is a
  // non-negative integer. The derived golf score shows below when both are
  // numeric. Labels mention race pace per the Oct 14 doc; see the Pass 2c
  // PR for the "also easy pace?" open item.
  if (skill.type === "score") {
    const timeParsed = draft.timeSeconds === "" ? null : parseFloat(draft.timeSeconds);
    const strokesParsed = draft.strokeCountValue === "" ? null : parseInt(draft.strokeCountValue, 10);
    const derived =
      timeParsed !== null &&
      strokesParsed !== null &&
      !Number.isNaN(timeParsed) &&
      !Number.isNaN(strokesParsed)
        ? timeParsed + strokesParsed
        : null;
    return (
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold" style={{ color: "var(--color-text-secondary)" }}>
          25 at race pace
        </span>
        <div className="flex gap-2 items-center flex-wrap">
          <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--color-text-secondary)" }}>
            <span>Time (s)</span>
            <input
              id={`${draftKey}-time-input`}
              type="number"
              step="0.01"
              inputMode="decimal"
              value={draft.timeSeconds}
              onChange={(event) => onChange(draftKey, { timeSeconds: event.target.value })}
              placeholder="14.25"
              aria-invalid={issue !== undefined || undefined}
              className="border rounded px-3 py-2 text-sm min-h-[44px] w-24"
              style={{
                borderColor: issue ? "var(--color-danger)" : "var(--color-border)",
                color: "var(--color-text)",
                backgroundColor: "transparent",
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--color-text-secondary)" }}>
            <span>Stroke count</span>
            <input
              id={`${draftKey}-strokes-input`}
              type="number"
              step="1"
              inputMode="numeric"
              value={draft.strokeCountValue}
              onChange={(event) => onChange(draftKey, { strokeCountValue: event.target.value })}
              placeholder="18"
              aria-invalid={issue !== undefined || undefined}
              className="border rounded px-3 py-2 text-sm min-h-[44px] w-24"
              style={{
                borderColor: issue ? "var(--color-danger)" : "var(--color-border)",
                color: "var(--color-text)",
                backgroundColor: "transparent",
              }}
            />
          </label>
        </div>
        {derived !== null && (
          <p className="text-xs tabular-nums" style={{ color: "var(--color-text-secondary)" }}>
            Golf score: <span className="font-semibold text-text">{derived.toFixed(1)}</span> ({timeParsed!.toFixed(2)}s + {strokesParsed} strokes, lower is better)
          </p>
        )}
        {issue && (
          <p className="text-xs" style={{ color: "var(--color-danger)" }}>
            {issue.message}
          </p>
        )}
      </div>
    );
  }

  // Non-score measured skills — single number box with the unit beside.
  // A measured skill is "savable" when either (a) it has no catalog unit
  // and the coach picks the enum via the dropdown, or (b) the catalog
  // unit maps to a `measurement_unit` enum value.
  const canSave = skill.unit === null || displayUnitToMeasurementEnum(skill.unit) !== null;
  const measurementUnits = MeasurementUnitSchema.options;

  if (!canSave) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold" style={{ color: "var(--color-text-secondary)" }}>
          Measurement
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
        Measurement
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
