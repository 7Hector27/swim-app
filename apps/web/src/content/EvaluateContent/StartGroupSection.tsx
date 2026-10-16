"use client";

import type { SkillForRating, StartGradeResult, RatingRecord } from "@swim-app/shared";
import { calculateStartGrade } from "@swim-app/shared";
import type { SkillDraft } from "./helpers";
import SkillGradeRow from "./SkillGradeRow";
import SideRatedRowPair from "./SideRatedRowPair";
import { defaultSkillDraft } from "./helpers";

interface StartGradePillProps {
  result: StartGradeResult;
}

function StartGradePill({ result }: StartGradePillProps) {
  if (result.status === "in_progress") {
    return (
      <span className="text-xs px-2 py-0.5 rounded border" style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}>
        In progress
      </span>
    );
  }
  if (result.status === "graded") {
    return (
      <span data-testid="start-grade-pill" className="text-xs px-2 py-0.5 rounded border font-bold" style={{ borderColor: "var(--color-accent)", color: "var(--color-accent)" }}>
        {result.grade}
      </span>
    );
  }
  if (result.status === "not_legal") {
    return (
      <span className="text-xs px-2 py-0.5 rounded border font-bold" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}>
        DQ
      </span>
    );
  }
  // no_concept
  return (
    <span className="text-xs px-2 py-0.5 rounded border" style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}>
      No concept
    </span>
  );
}

interface StartGroupSectionProps {
  parent: SkillForRating;
  components: SkillForRating[];
  draftSkills: Record<string, SkillDraft>;
  onChange: (key: string, patch: Partial<SkillDraft>) => void;
}

export default function StartGroupSection({ parent, components, draftSkills, onChange }: StartGroupSectionProps) {
  // Build RatingRecords from current draft for the component skills
  const ratingRecords: RatingRecord[] = [];
  for (const skill of components) {
    const keys = skill.ratedPerSide
      ? [`${skill.id}:left`, `${skill.id}:right`]
      : [skill.id];
    for (const key of keys) {
      const draft = draftSkills[key];
      if (!draft) continue;
      const side = skill.ratedPerSide
        ? (key.endsWith(":left") ? "left" : "right") as "left" | "right"
        : null;
      if (draft.noConcept) {
        ratingRecords.push({
          skillSlug: skill.slug,
          side,
          grade: null,
          notLegal: false,
          noConcept: true,
          ratedAt: new Date().toISOString(),
          voidedAt: null,
        });
      } else if (draft.grade !== null) {
        ratingRecords.push({
          skillSlug: skill.slug,
          side,
          grade: draft.grade,
          notLegal: draft.notLegal,
          noConcept: false,
          ratedAt: new Date().toISOString(),
          voidedAt: null,
        });
      }
    }
  }

  const componentSlugs = components.map((skill) => skill.slug);
  const startResult = calculateStartGrade(componentSlugs, ratingRecords);

  return (
    <div id={`skill-${parent.id}`} className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h3 className="font-semibold text-sm" style={{ color: "var(--color-text)" }}>
          {parent.name}
        </h3>
        <StartGradePill result={startResult} />
      </div>
      <div className="flex flex-col gap-3 pl-4 border-l" style={{ borderColor: "var(--color-border)" }}>
        {components.map((skill) => {
          if (skill.ratedPerSide) {
            return (
              <SideRatedRowPair
                key={skill.id}
                skill={skill}
                leftDraft={draftSkills[`${skill.id}:left`] ?? defaultSkillDraft()}
                rightDraft={draftSkills[`${skill.id}:right`] ?? defaultSkillDraft()}
                onChange={onChange}
              />
            );
          }
          return (
            <SkillGradeRow
              key={skill.id}
              skill={skill}
              draftKey={skill.id}
              label={skill.name}
              draft={draftSkills[skill.id] ?? defaultSkillDraft()}
              onChange={onChange}
            />
          );
        })}
      </div>
    </div>
  );
}
