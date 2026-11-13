"use client";

import type { SkillForRating, SwimmerSkillsResponse } from "@swim-app/shared";
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
  // Previous grades keyed per side so each row shows its own history.
  prevGradeLeft?: SwimmerSkillsResponse["grades"][string];
  prevGradeRight?: SwimmerSkillsResponse["grades"][string];
  onMastery?: (draftKey: string) => void;
  masteredKey?: string | null;
}

export default function SideRatedRowPair({
  skill,
  leftDraft,
  rightDraft,
  onChange,
  label,
  leftIssues,
  rightIssues,
  prevGradeLeft,
  prevGradeRight,
  onMastery,
  masteredKey,
}: SideRatedRowPairProps) {
  const displayName = label ?? skill.name;
  // The side labels use a middle dot, not an em dash — the project style
  // avoids em dashes in UI copy.
  return (
    <div id={`skill-${skill.id}`} className="flex flex-col gap-2">
      <SkillGradeRow
        skill={skill}
        draftKey={`${skill.id}:left`}
        label={`${displayName} · Left`}
        draft={leftDraft}
        onChange={onChange}
        {...(leftIssues !== undefined && { issues: leftIssues })}
        {...(prevGradeLeft !== undefined && { prevGrade: prevGradeLeft })}
        {...(onMastery !== undefined && { onMastery })}
        {...(masteredKey !== undefined && { masteredKey })}
      />
      <SkillGradeRow
        skill={skill}
        draftKey={`${skill.id}:right`}
        label={`${displayName} · Right`}
        draft={rightDraft}
        onChange={onChange}
        {...(rightIssues !== undefined && { issues: rightIssues })}
        {...(prevGradeRight !== undefined && { prevGrade: prevGradeRight })}
        {...(onMastery !== undefined && { onMastery })}
        {...(masteredKey !== undefined && { masteredKey })}
      />
    </div>
  );
}
