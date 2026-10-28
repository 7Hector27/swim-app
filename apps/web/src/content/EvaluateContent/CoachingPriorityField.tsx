"use client";

import type { EvaluateFieldIssue } from "./helpers";
import { DOM_IDS } from "./helpers";

interface CoachingPriorityFieldProps {
  value: string;
  onChange: (value: string) => void;
  suggestion:
    | { status: "idle" | "loading" | "error" }
    | { status: "loaded"; chain: Array<{ slug: string }> | null };
  slugToName: Record<string, string>;
  issue?: EvaluateFieldIssue | undefined;
}

export default function CoachingPriorityField({ value, onChange, suggestion, slugToName, issue }: CoachingPriorityFieldProps) {
  return (
    <fieldset id={DOM_IDS.coachingPriority} className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2 flex-wrap">
        <legend className="font-bold text-sm" style={{ color: "var(--color-text)" }}>
          Coaching priority
        </legend>
        <span className="text-xs text-text-secondary">Optional. Parents can see this.</span>
      </div>
      {suggestion.status === "loading" && (
        <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>Loading suggestion...</p>
      )}
      {suggestion.status === "loaded" && suggestion.chain !== null && suggestion.chain.length > 0 && (
        <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
          Suggestion: Focus on{" "}
          <strong style={{ color: "var(--color-text)" }}>
            {(() => {
              const lastSlug = suggestion.chain[suggestion.chain.length - 1]?.slug ?? "";
              return slugToName[lastSlug] ?? lastSlug;
            })()}
          </strong>
        </p>
      )}
      {suggestion.status === "loaded" && (suggestion.chain === null || suggestion.chain.length === 0) && (
        <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
          All assessed skills are at expected levels
        </p>
      )}
      {suggestion.status === "error" && (
        <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
          Not assessed yet. Check individually.
        </p>
      )}
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        aria-invalid={issue !== undefined || undefined}
        aria-describedby={issue ? `${DOM_IDS.coachingPriority}-error` : undefined}
        placeholder="What is the main focus for this swimmer? Leave blank to keep the previous priority."
        className="border rounded px-3 py-2 text-sm resize-y"
        style={{
          borderColor: issue ? "var(--color-danger)" : "var(--color-border)",
          color: "var(--color-text)",
          backgroundColor: "transparent",
        }}
      />
      {issue && (
        <p id={`${DOM_IDS.coachingPriority}-error`} className="text-xs" style={{ color: "var(--color-danger)" }}>
          {issue.message}
        </p>
      )}
    </fieldset>
  );
}
