"use client";

import type { SkillForRating } from "@swim-app/shared";
import type { SkillDraft } from "./helpers";
import SkillGradeRow from "./SkillGradeRow";

interface SideRatedRowPairProps {
  skill: SkillForRating;
  leftDraft: SkillDraft;
  rightDraft: SkillDraft;
  onChange: (key: string, patch: Partial<SkillDraft>) => void;
}

export default function SideRatedRowPair({ skill, leftDraft, rightDraft, onChange }: SideRatedRowPairProps) {
  return (
    <div className="flex flex-col gap-2">
      <SkillGradeRow
        skill={skill}
        draftKey={`${skill.id}:left`}
        label={`${skill.name} — Left`}
        draft={leftDraft}
        onChange={onChange}
      />
      <SkillGradeRow
        skill={skill}
        draftKey={`${skill.id}:right`}
        label={`${skill.name} — Right`}
        draft={rightDraft}
        onChange={onChange}
      />
    </div>
  );
}
