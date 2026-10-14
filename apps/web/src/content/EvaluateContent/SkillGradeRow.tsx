"use client";

import type { SkillForRating } from "@swim-app/shared";
import type { SkillDraft } from "./helpers";
import GradeSelector from "./GradeSelector";
import DetailsPanel from "./DetailsPanel";

interface SkillGradeRowProps {
  skill: SkillForRating;
  draftKey: string;
  label: string;
  draft: SkillDraft;
  onChange: (key: string, patch: Partial<SkillDraft>) => void;
}

export default function SkillGradeRow({ skill, draftKey, label, draft, onChange }: SkillGradeRowProps) {
  return (
    <fieldset
      className="flex flex-col gap-3 p-3 rounded border"
      style={{
        borderColor: draft.notLegal ? "var(--color-danger)" : "var(--color-border)",
        borderLeftWidth: draft.notLegal ? "3px" : "1px",
      }}
    >
      <legend className="font-semibold text-sm px-1" style={{ color: "var(--color-text)" }}>
        {label}
        {draft.notLegal && (
          <span
            className="ml-2 text-xs font-bold px-1.5 py-0.5 rounded"
            style={{ color: "var(--color-danger)", backgroundColor: "transparent", border: "1px solid var(--color-danger)" }}
          >
            DQ
          </span>
        )}
      </legend>

      <GradeSelector
        value={draft.grade}
        disabled={draft.noConcept}
        onChange={(grade) => {
          const patch: Partial<SkillDraft> = { grade };
          if (grade === null) patch.notLegal = false;
          onChange(draftKey, patch);
        }}
        labelPrefix={label}
      />

      <div className="flex gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => {
            const next = !draft.noConcept;
            onChange(draftKey, {
              noConcept: next,
              ...(next && { grade: null, notLegal: false }),
            });
          }}
          className="min-h-[44px] px-3 rounded border text-xs font-semibold transition-colors"
          style={{
            borderColor: draft.noConcept ? "var(--color-text-secondary)" : "var(--color-border)",
            color: draft.noConcept ? "var(--color-text)" : "var(--color-text-secondary)",
            backgroundColor: draft.noConcept ? "color-mix(in srgb, var(--color-text-secondary) 15%, transparent)" : "transparent",
          }}
        >
          No concept
        </button>

        <button
          type="button"
          disabled={draft.grade === null || draft.noConcept}
          onClick={() => onChange(draftKey, { notLegal: !draft.notLegal })}
          className="min-h-[44px] px-3 rounded border text-xs font-semibold transition-colors"
          style={{
            borderColor: draft.notLegal ? "var(--color-danger)" : "var(--color-border)",
            color: draft.notLegal ? "var(--color-danger)" : "var(--color-text-secondary)",
            opacity: (draft.grade === null || draft.noConcept) ? 0.4 : 1,
            cursor: (draft.grade === null || draft.noConcept) ? "not-allowed" : "pointer",
            backgroundColor: "transparent",
          }}
        >
          Not legal
        </button>

        <button
          type="button"
          onClick={() => onChange(draftKey, { detailsOpen: !draft.detailsOpen })}
          className="min-h-[44px] px-3 rounded border text-xs font-semibold transition-colors flex items-center gap-1"
          style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)", backgroundColor: "transparent" }}
          aria-expanded={draft.detailsOpen}
        >
          {draft.detailsOpen ? "Hide details" : "Add details"}
          <span aria-hidden="true">{draft.detailsOpen ? "▲" : "▼"}</span>
        </button>
      </div>

      {draft.detailsOpen && (
        <DetailsPanel skill={skill} draft={draft} draftKey={draftKey} onChange={onChange} />
      )}
    </fieldset>
  );
}
