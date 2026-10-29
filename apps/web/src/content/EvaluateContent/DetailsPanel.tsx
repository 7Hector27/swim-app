"use client";

import type { SkillForRating } from "@swim-app/shared";
import { MeasurementUnitSchema, displayUnitToMeasurementEnum } from "@swim-app/shared";
import type { SkillDraft, EvaluateFieldIssue } from "./helpers";

interface DetailsPanelProps {
  skill: SkillForRating;
  draft: SkillDraft;
  draftKey: string;
  onChange: (key: string, patch: Partial<SkillDraft>) => void;
  issues?: EvaluateFieldIssue[];
}

export default function DetailsPanel({ skill, draft, draftKey, onChange, issues = [] }: DetailsPanelProps) {
  const measurementUnits = MeasurementUnitSchema.options;
  // A measured skill is "savable" when either (a) it has no catalog unit and
  // the coach can pick the enum via dropdown, or (b) the catalog unit maps to
  // a `measurement_unit` enum value. "kicks/min" (and other labels without an
  // enum) can't persist a measurement — hide the input instead of letting the
  // coach type a value we can't save.
  const canSaveMeasurement =
    skill.unit === null || displayUnitToMeasurementEnum(skill.unit) !== null;
  const measurementIssue = issues.find((issue) => issue.field === "measurementValue");
  const capacityIssue = issues.find((issue) => issue.field === "capacityValue");

  return (
    <div className="flex flex-col gap-3 pt-1">
      {skill.faultTags.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold" style={{ color: "var(--color-text-secondary)" }}>Fault tags</span>
          <div className="flex gap-2 flex-wrap">
            {skill.faultTags.map((tag) => {
              const active = draft.faultTags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => {
                    const next = active
                      ? draft.faultTags.filter((ft) => ft !== tag)
                      : [...draft.faultTags, tag];
                    onChange(draftKey, { faultTags: next });
                  }}
                  className="min-h-[44px] px-3 rounded border text-xs transition-colors"
                  style={{
                    borderColor: active ? "var(--color-accent)" : "var(--color-border)",
                    color: active ? "var(--color-accent)" : "var(--color-text-secondary)",
                    backgroundColor: "transparent",
                  }}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {skill.type === "measured" && (
        <>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold" style={{ color: "var(--color-text-secondary)" }}>
              Capacity
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                value={draft.capacityValue}
                onChange={(event) => onChange(draftKey, { capacityValue: event.target.value })}
                placeholder="Amount"
                aria-invalid={capacityIssue !== undefined || undefined}
                aria-describedby={capacityIssue ? `${draftKey}-capacity-error` : undefined}
                className="border rounded px-3 py-2 text-sm min-h-[44px] w-24"
                style={{
                  borderColor: capacityIssue ? "var(--color-danger)" : "var(--color-border)",
                  color: "var(--color-text)",
                  backgroundColor: "transparent",
                }}
              />
              <select
                value={draft.capacityUnit ?? ""}
                onChange={(event) =>
                  onChange(draftKey, {
                    capacityUnit: event.target.value === "" ? null : event.target.value as "yards" | "reps",
                  })
                }
                aria-invalid={capacityIssue !== undefined || undefined}
                className="border rounded px-3 py-2 text-sm min-h-[44px]"
                style={{
                  borderColor: capacityIssue ? "var(--color-danger)" : "var(--color-border)",
                  color: "var(--color-text)",
                  backgroundColor: "transparent",
                }}
              >
                <option value="">Unit</option>
                <option value="yards">yards</option>
                <option value="reps">reps</option>
              </select>
            </div>
            {capacityIssue && (
              <p
                id={`${draftKey}-capacity-error`}
                className="text-xs"
                style={{ color: "var(--color-danger)" }}
              >
                {capacityIssue.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold" style={{ color: "var(--color-text-secondary)" }}>
              Measurement
            </label>
            {canSaveMeasurement ? (
              <>
                <div className="flex gap-2 items-center">
                  <input
                    type="number"
                    value={draft.measurementValue}
                    onChange={(event) => onChange(draftKey, { measurementValue: event.target.value })}
                    placeholder="Value"
                    aria-invalid={measurementIssue !== undefined || undefined}
                    aria-describedby={measurementIssue ? `${draftKey}-measurement-error` : undefined}
                    className="border rounded px-3 py-2 text-sm min-h-[44px] w-24"
                    style={{
                      borderColor: measurementIssue ? "var(--color-danger)" : "var(--color-border)",
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
                      aria-invalid={measurementIssue !== undefined || undefined}
                      className="border rounded px-3 py-2 text-sm min-h-[44px]"
                      style={{
                        borderColor: measurementIssue ? "var(--color-danger)" : "var(--color-border)",
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
                {measurementIssue && (
                  <p
                    id={`${draftKey}-measurement-error`}
                    className="text-xs"
                    style={{ color: "var(--color-danger)" }}
                  >
                    {measurementIssue.message}
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
                Measurements in {skill.unit} can&apos;t be saved yet — record this in the note below.
              </p>
            )}
          </div>
        </>
      )}

      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold" style={{ color: "var(--color-text-secondary)" }}>
          Note <span className="font-normal">({draft.note.length}/500)</span>
        </label>
        <textarea
          value={draft.note}
          onChange={(event) => onChange(draftKey, { note: event.target.value.slice(0, 500) })}
          rows={3}
          className="border rounded px-3 py-2 text-sm resize-y"
          style={{ borderColor: "var(--color-border)", color: "var(--color-text)", backgroundColor: "transparent" }}
        />
      </div>
    </div>
  );
}
