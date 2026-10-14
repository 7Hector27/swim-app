"use client";

import type { SkillForRating } from "@swim-app/shared";
import { MeasurementUnitSchema } from "@swim-app/shared";
import type { SkillDraft } from "./helpers";

interface DetailsPanelProps {
  skill: SkillForRating;
  draft: SkillDraft;
  draftKey: string;
  onChange: (key: string, patch: Partial<SkillDraft>) => void;
}

export default function DetailsPanel({ skill, draft, draftKey, onChange }: DetailsPanelProps) {
  const measurementUnits = MeasurementUnitSchema.options;

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
                className="border rounded px-3 py-2 text-sm min-h-[44px] w-24"
                style={{ borderColor: "var(--color-border)", color: "var(--color-text)", backgroundColor: "transparent" }}
              />
              <select
                value={draft.capacityUnit ?? ""}
                onChange={(event) =>
                  onChange(draftKey, {
                    capacityUnit: event.target.value === "" ? null : event.target.value as "yards" | "reps",
                  })
                }
                className="border rounded px-3 py-2 text-sm min-h-[44px]"
                style={{ borderColor: "var(--color-border)", color: "var(--color-text)", backgroundColor: "transparent" }}
              >
                <option value="">Unit</option>
                <option value="yards">yards</option>
                <option value="reps">reps</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold" style={{ color: "var(--color-text-secondary)" }}>
              Measurement
            </label>
            <div className="flex gap-2 items-center">
              <input
                type="number"
                value={draft.measurementValue}
                onChange={(event) => onChange(draftKey, { measurementValue: event.target.value })}
                placeholder="Value"
                className="border rounded px-3 py-2 text-sm min-h-[44px] w-24"
                style={{ borderColor: "var(--color-border)", color: "var(--color-text)", backgroundColor: "transparent" }}
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
                  className="border rounded px-3 py-2 text-sm min-h-[44px]"
                  style={{ borderColor: "var(--color-border)", color: "var(--color-text)", backgroundColor: "transparent" }}
                >
                  <option value="">Unit</option>
                  {measurementUnits.map((unit) => (
                    <option key={unit} value={unit}>{unit}</option>
                  ))}
                </select>
              )}
            </div>
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
