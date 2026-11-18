"use client";

import type { SkillForRating } from "@swim-app/shared";
import type { SkillDraft, EvaluateFieldIssue } from "./helpers";

// Pass 2b: the measurement number box moved out of the details panel and
// onto the row (MeasurementInput). The panel now keeps only fault tags,
// capacity, and the free-text note.

interface DetailsPanelProps {
  skill: SkillForRating;
  draft: SkillDraft;
  draftKey: string;
  onChange: (key: string, patch: Partial<SkillDraft>) => void;
  issues?: EvaluateFieldIssue[];
}

export default function DetailsPanel({ skill, draft, draftKey, onChange, issues = [] }: DetailsPanelProps) {
  const capacityIssue = issues.find((issue) => issue.field === "capacityValue");
  const showCapacity = skill.type === "measured" || skill.type === "score";

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

      {showCapacity && (
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
              aria-label={`${skill.name} capacity unit`}
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
