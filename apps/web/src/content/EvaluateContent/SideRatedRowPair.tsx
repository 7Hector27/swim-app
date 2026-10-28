"use client";

import type { SkillForRating } from "@swim-app/shared";
import type { EvaluateFieldIssue, SkillDraft } from "./helpers";
import SkillGradeRow from "./SkillGradeRow";

interface SideRatedRowPairProps {
  skill: SkillForRating;
  leftDraft: SkillDraft;
  rightDraft: SkillDraft;
  onChange: (key: string, patch: Partial<SkillDraft>) => void;
  label?: string;
  leftIssues?: EvaluateFieldIssue[];
  rightIssues?: EvaluateFieldIssue[];
}

export default function SideRatedRowPair({
  skill,
  leftDraft,
  rightDraft,
  onChange,
  label,
  leftIssues,
  rightIssues,
}: SideRatedRowPairProps) {
  const displayName = label ?? skill.name;
  return (
    <div id={`skill-${skill.id}`} className="flex flex-col gap-2">
      <SkillGradeRow
        skill={skill}
        draftKey={`${skill.id}:left`}
        label={`${displayName} — Left`}
        draft={leftDraft}
        onChange={onChange}
        {...(leftIssues !== undefined && { issues: leftIssues })}
      />
      <SkillGradeRow
        skill={skill}
        draftKey={`${skill.id}:right`}
        label={`${displayName} — Right`}
        draft={rightDraft}
        onChange={onChange}
        {...(rightIssues !== undefined && { issues: rightIssues })}
      />
    </div>
  );
}
