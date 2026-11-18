"use client";

import type { SkillForRating, SwimmerSkillsResponse } from "@swim-app/shared";
import type { EvaluateFieldIssue, SkillDraft } from "./helpers";
import GradeSelector from "./GradeSelector";
import DetailsPanel from "./DetailsPanel";
import MasteryBadge from "./MasteryBadge";
import MeasurementInput from "./MeasurementInput";
import PrevBadge from "./PrevBadge";

interface SkillGradeRowProps {
  skill: SkillForRating;
  draftKey: string;
  label: string;
  draft: SkillDraft;
  onChange: (key: string, patch: Partial<SkillDraft>) => void;
  issues?: EvaluateFieldIssue[];
  // Latest saved grade for this skill (and side, for per-side skills). Fed
  // from SwimmerSkillsResponse["grades"] on the server page.
  prevGrade?: SwimmerSkillsResponse["grades"][string];
  // ADR 036 Phase 8 Part B Stop 3 piece 12 (animation audit #2):
  // mastered-moment hooks. `onMastery` fires the first time the row's
  // grade crosses to 5 (from a non-5 saved grade and a non-5 draft);
  // the parent decides whether to show the badge via `masteredKey`
  // and auto-dismisses after ~2s.
  onMastery?: (draftKey: string) => void;
  masteredKey?: string | null;
  // Overrides the default `skill-<draftKey>` DOM id so a shared skill
  // rendered in two sections on the same screen (push-off,
  // streamline-in-motion) keeps unique ids across occurrences.
  anchorId?: string;
}

export default function SkillGradeRow({ skill, draftKey, label, draft, onChange, issues = [], prevGrade, onMastery, masteredKey, anchorId }: SkillGradeRowProps) {
  const gradeIssue = issues.find((issue) => issue.field === "grade");
  const notLegalIssue = issues.find((issue) => issue.field === "notLegal");
  const measurementIssue = issues.find((issue) => issue.field === "measurementValue");
  // Pass 2c follow-up: golf-score pair + category errors route to the row.
  // timeSeconds is the Zod field for the paired-fields rule (time XOR
  // strokes); golfScoreCategory is the "pair without category" rule.
  const timePairIssue = issues.find((issue) => issue.field === "timeSeconds");
  const categoryIssue = issues.find((issue) => issue.field === "golfScoreCategory");
  // Pass 2b: the measurement number box now lives on the row, so it's no
  // longer a reason to open the details panel. Only capacity errors route
  // there.
  const detailsPanelIssues = issues.filter((issue) => issue.field === "capacityValue");
  const hasDetailsIssue = detailsPanelIssues.length > 0;
  const hasMeasurementSlot = skill.type === "measured" || skill.type === "score";
  return (
    <fieldset
      id={anchorId ?? `skill-${draftKey}`}
      className={`flex flex-col gap-3 p-4 rounded-lg border ${draft.notLegal ? "border-l-[3px]" : ""}`}
      style={{
        borderColor: draft.notLegal ? "var(--color-danger)" : "var(--color-border)",
      }}
    >
      <legend className="flex items-center gap-2 flex-wrap px-1">
        <span className="font-semibold text-sm" style={{ color: "var(--color-text)" }}>
          {label}
        </span>
        <PrevBadge value={prevGrade} />
        {masteredKey === draftKey ? <MasteryBadge /> : null}
        {draft.notLegal && (
          <span
            className="text-xs font-bold px-1.5 py-0.5 rounded"
            style={{ color: "var(--color-danger)", backgroundColor: "transparent", border: "1px solid var(--color-danger)" }}
          >
            Not legal
          </span>
        )}
      </legend>

      {skill.type === "score" && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold" style={{ color: "var(--color-text-secondary)" }}>
            Test category
          </span>
          <div
            className="flex gap-2 flex-wrap"
            role="group"
            aria-invalid={categoryIssue !== undefined || undefined}
            aria-describedby={categoryIssue ? `${draftKey}-category-error` : undefined}
          >
            {([
              { value: "push_off_in_water", label: "Push-off in water" },
              { value: "deck_dive", label: "Deck dive" },
              { value: "block_dive", label: "Block dive" },
            ] as const).map(({ value, label: catLabel }) => {
              const selected = draft.golfScoreCategory === value;
              const borderColor = selected
                ? "var(--color-accent)"
                : categoryIssue
                  ? "var(--color-danger)"
                  : "var(--color-border)";
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => onChange(draftKey, { golfScoreCategory: value })}
                  className="min-h-[44px] px-3 rounded border text-xs font-semibold transition-colors"
                  style={{
                    borderColor,
                    color: selected ? "var(--color-accent)" : "var(--color-text-secondary)",
                    backgroundColor: "transparent",
                  }}
                >
                  {catLabel}
                </button>
              );
            })}
          </div>
          {categoryIssue && (
            <p
              id={`${draftKey}-category-error`}
              className="text-xs"
              style={{ color: "var(--color-danger)" }}
            >
              {categoryIssue.message}
            </p>
          )}
        </div>
      )}

      <GradeSelector
        value={draft.grade}
        disabled={draft.noConcept}
        onChange={(grade) => {
          const patch: Partial<SkillDraft> = { grade };
          if (grade === null) patch.notLegal = false;
          // Mastery crossing: new grade is 5, the draft wasn't already
          // at 5, and the saved value wasn't 5 either. The parent
          // dedupes per-session so re-selecting 5 after bouncing to
          // another grade doesn't re-fire the badge.
          const crossedToMastery =
            grade === 5 && draft.grade !== 5 && prevGrade !== 5;
          onChange(draftKey, patch);
          if (crossedToMastery && onMastery) onMastery(draftKey);
        }}
        labelPrefix={label}
      />

      {gradeIssue && (
        <p
          id={`${draftKey}-grade-error`}
          className="text-xs"
          style={{ color: "var(--color-danger)" }}
        >
          {gradeIssue.message}
        </p>
      )}
      {notLegalIssue && (
        <p className="text-xs" style={{ color: "var(--color-danger)" }}>
          {notLegalIssue.message}
        </p>
      )}

      {skill.descriptors.length > 0 && draft.grade !== null && (() => {
        const descriptor = skill.descriptors.find((d) => d.level === draft.grade);
        return descriptor ? (
          <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
            {descriptor.text}
          </p>
        ) : null;
      })()}

      {hasMeasurementSlot && (
        <MeasurementInput
          skill={skill}
          draft={draft}
          draftKey={draftKey}
          onChange={onChange}
          {...(measurementIssue !== undefined && { issue: measurementIssue })}
          {...(timePairIssue !== undefined && { pairIssue: timePairIssue })}
        />
      )}

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
            backgroundColor: draft.noConcept ? "var(--color-surface-soft)" : "transparent",
          }}
        >
          No concept
        </button>

        {skill.notLegalAllowed && (
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
        )}

        <button
          type="button"
          onClick={() => onChange(draftKey, { detailsOpen: !draft.detailsOpen })}
          className="min-h-[44px] px-3 rounded border text-xs font-semibold transition-colors flex items-center gap-1"
          style={{
            borderColor: hasDetailsIssue ? "var(--color-danger)" : "var(--color-border)",
            color: hasDetailsIssue ? "var(--color-danger)" : "var(--color-text-secondary)",
            backgroundColor: "transparent",
          }}
          aria-expanded={draft.detailsOpen}
        >
          {draft.detailsOpen ? "Hide details" : hasDetailsIssue ? "Fix details" : "Add details"}
          <span aria-hidden="true">{draft.detailsOpen ? "▲" : "▼"}</span>
        </button>
      </div>

      {hasDetailsIssue && !draft.detailsOpen && (
        <p className="text-xs" style={{ color: "var(--color-danger)" }}>
          {detailsPanelIssues[0]!.message}
        </p>
      )}

      {draft.detailsOpen && (
        <DetailsPanel
          skill={skill}
          draft={draft}
          draftKey={draftKey}
          onChange={onChange}
          issues={detailsPanelIssues}
        />
      )}
    </fieldset>
  );
}
