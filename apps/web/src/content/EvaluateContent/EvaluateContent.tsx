"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type {
  CoachSwimmerDetail,
  CategoriesResponse,
  SkillCategoryWithSkills,
  SkillForRating,
} from "@swim-app/shared";
import SiteNav from "@/components/SiteNav";
import SiteFooter from "@/components/SiteFooter";
import { submitEvaluation } from "./actions";
import type { EvaluateState, SessionDraft, SkillDraft } from "./helpers";
import {
  defaultSkillDraft,
  initialSessionDraft,
  todayLA,
  canSubmit,
  buildRatingsArray,
} from "./helpers";
import SessionSetup from "./SessionSetup";
import CoachingPriorityField from "./CoachingPriorityField";
import StartGroupSection from "./StartGroupSection";
import SkillGradeRow from "./SkillGradeRow";
import SideRatedRowPair from "./SideRatedRowPair";
import UndoToast from "./UndoToast";

interface EvaluateContentProps {
  swimmer: CoachSwimmerDetail;
  categories: CategoriesResponse;
  accessToken: string;
}

export default function EvaluateContent({ swimmer, categories, accessToken }: EvaluateContentProps) {
  const metaKey = `evaluate-draft-meta-${swimmer.id}`;
  const skillsKey = (catId: string) => `evaluate-draft-skills-${swimmer.id}-${catId}`;

  const [draft, setDraft] = useState<SessionDraft>(() => initialSessionDraft());
  const [depSuggestion, setDepSuggestion] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "loaded"; chain: Array<{ slug: string; grade: unknown; sortOrder: number }> | null }
    | { status: "error" }
  >({ status: "idle" });
  const mountedRef = useRef(false);
  const savedAtRef = useRef<number>(0);

  // Restore draft from localStorage on mount (Fix 6: keyed by swimmer AND category)
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    try {
      const meta = JSON.parse(localStorage.getItem(metaKey) ?? "null");
      if (meta && typeof meta === "object") {
        const { categoryId, sessionDate, context, coachingPriority } = meta as Partial<SessionDraft>;
        const storedCategoryId = typeof categoryId === "string" ? categoryId : "";
        let skills: Record<string, SkillDraft> = {};
        if (storedCategoryId) {
          const skillsStored = JSON.parse(localStorage.getItem(skillsKey(storedCategoryId)) ?? "null");
          if (skillsStored && typeof skillsStored === "object" && "skills" in skillsStored) {
            skills = skillsStored.skills as Record<string, SkillDraft>;
          }
        }
        setDraft({
          categoryId: storedCategoryId,
          sessionDate: typeof sessionDate === "string" ? sessionDate : todayLA(),
          context: context === "drill" || context === "practice" || context === "race" ? context : null,
          coachingPriority: typeof coachingPriority === "string" ? coachingPriority : "",
          skills,
        });
      }
    } catch {
      // ignore
    }
  }, [swimmer.id]); // mount-only: intentionally omits metaKey/skillsKey (stable derivations of swimmer.id)

  // Persist draft to localStorage on every change (Fix 6)
  useEffect(() => {
    try {
      localStorage.setItem(metaKey, JSON.stringify({
        categoryId: draft.categoryId,
        sessionDate: draft.sessionDate,
        context: draft.context,
        coachingPriority: draft.coachingPriority,
      }));
      if (draft.categoryId) {
        localStorage.setItem(skillsKey(draft.categoryId), JSON.stringify({ skills: draft.skills }));
      }
    } catch {
      // ignore
    }
  }, [draft, swimmer.id]); // metaKey/skillsKey are stable derivations of swimmer.id

  // Fetch dep suggestion when categoryId changes
  useEffect(() => {
    if (!draft.categoryId) {
      setDepSuggestion({ status: "idle" });
      return;
    }
    setDepSuggestion({ status: "loading" });
    let cancelled = false;
    fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/swimmers/${swimmer.id}/sessions/dependency-map?categoryId=${draft.categoryId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
      .then(async (response) => {
        if (cancelled) return;
        if (!response.ok) {
          setDepSuggestion({ status: "error" });
          return;
        }
        const body = await response.json() as { suggestion: Array<{ slug: string; grade: unknown; sortOrder: number }> | null };
        if (!cancelled) {
          setDepSuggestion({ status: "loaded", chain: body.suggestion });
        }
      })
      .catch(() => {
        if (!cancelled) setDepSuggestion({ status: "error" });
      });
    return () => { cancelled = true; };
  }, [draft.categoryId, swimmer.id, accessToken]);

  const boundAction = submitEvaluation.bind(null, swimmer.id);
  const [state, formAction, isPending] = useActionState<EvaluateState, FormData>(
    boundAction,
    { status: "idle" },
  );

  // Capture savedAt and clear localStorage on success
  useEffect(() => {
    if (state.status === "saved") {
      savedAtRef.current = Date.now();
      try {
        localStorage.removeItem(metaKey);
        if (draft.categoryId) {
          localStorage.removeItem(skillsKey(draft.categoryId));
        }
      } catch {
        // ignore
      }
    }
  }, [state.status]); // savedAtRef, metaKey, skillsKey, draft.categoryId are stable at save time

  function handleCategoryChange(newCategoryId: string) {
    let skills: Record<string, SkillDraft> = {};
    try {
      const stored = JSON.parse(localStorage.getItem(skillsKey(newCategoryId)) ?? "null");
      if (stored && typeof stored === "object" && "skills" in stored) {
        skills = stored.skills as Record<string, SkillDraft>;
      }
    } catch { /* ignore */ }
    setDraft((prev) => ({ ...prev, categoryId: newCategoryId, skills }));
  }

  function patchSkill(key: string, patch: Partial<SkillDraft>) {
    setDraft((prev) => ({
      ...prev,
      skills: {
        ...prev.skills,
        [key]: { ...(prev.skills[key] ?? defaultSkillDraft()), ...patch },
      },
    }));
  }

  const selectedCategory = categories.find((cat) => cat.id === draft.categoryId) ?? null;

  function buildSkillGroups(category: SkillCategoryWithSkills) {
    const startParents = category.skills.filter(
      (skill) =>
        skill.parentSkillId === null &&
        category.skills.some((other) => other.parentSkillId === skill.id),
    );
    const startParentIds = new Set(startParents.map((skill) => skill.id));
    const standaloneSkills = category.skills.filter(
      (skill) => !startParentIds.has(skill.id) && (skill.parentSkillId === null || !startParentIds.has(skill.parentSkillId)),
    );
    const componentSkillsOf = (parentId: string): SkillForRating[] =>
      category.skills.filter((skill) => skill.parentSkillId === parentId);

    return { startParents, standaloneSkills, componentSkillsOf };
  }

  const ratingsArray = selectedCategory
    ? buildRatingsArray(selectedCategory.skills, draft.skills)
    : [];
  const submitEnabled = canSubmit(draft, ratingsArray.length, isPending);

  const bodyJson = JSON.stringify({
    categoryId: draft.categoryId,
    sessionDate: draft.sessionDate,
    context: draft.context,
    coachingPriority: draft.coachingPriority,
    ratings: ratingsArray,
  });

  // ── Success screen ────────────────────────────────────────────────────────────

  if (state.status === "saved") {
    return (
      <div className="flex flex-col min-h-screen">
        <SiteNav />
        <main className="flex-1 px-page py-8">
          <div className="mx-auto max-w-content flex flex-col gap-6">
            <h1 className="text-heading" style={{ color: "var(--color-text)" }}>
              Evaluation saved for {swimmer.firstName}
            </h1>

            <UndoToast
              swimmer={swimmer}
              sessionId={state.sessionId}
              accessToken={accessToken}
              savedAt={savedAtRef.current}
            />

            <a
              href={`/coach/swimmers/${swimmer.id}`}
              className="text-sm underline"
              style={{ color: "var(--color-link)" }}
            >
              ← Back to {swimmer.firstName}
            </a>
          </div>
        </main>
        <SiteFooter />
      </div>
    );
  }

  // ── Main form ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col min-h-screen">
      <SiteNav />
      <main className="flex-1 px-page py-8">
        <div className="mx-auto max-w-content flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <a
              href={`/coach/swimmers/${swimmer.id}`}
              className="text-sm underline"
              style={{ color: "var(--color-link)" }}
            >
              ← {swimmer.firstName} {swimmer.lastName}
            </a>
            <h1 className="text-heading" style={{ color: "var(--color-text)" }}>
              Evaluate {swimmer.firstName}
            </h1>
          </div>

          {state.status === "error" && (
            <p role="alert" className="text-sm" style={{ color: "var(--color-danger)" }}>
              {state.message}
            </p>
          )}

          <form action={formAction} noValidate className="flex flex-col gap-6">
            <input type="hidden" name="bodyJson" value={bodyJson} />

            <SessionSetup
              draft={draft}
              categories={categories}
              onCategoryChange={handleCategoryChange}
              onChange={(patch) => setDraft((prev) => ({ ...prev, ...patch }))}
            />

            <CoachingPriorityField
              value={draft.coachingPriority}
              onChange={(value) => setDraft((prev) => ({ ...prev, coachingPriority: value }))}
              suggestion={depSuggestion}
            />

            {/* Skills */}
            {selectedCategory !== null && (() => {
              const { startParents, standaloneSkills, componentSkillsOf } = buildSkillGroups(selectedCategory);
              return (
                <div className="flex flex-col gap-4">
                  <h2 className="font-bold text-sm" style={{ color: "var(--color-text)" }}>
                    Skills — {selectedCategory.name}
                  </h2>

                  {startParents.map((parent) => (
                    <StartGroupSection
                      key={parent.id}
                      parent={parent}
                      components={componentSkillsOf(parent.id)}
                      draftSkills={draft.skills}
                      onChange={patchSkill}
                    />
                  ))}

                  {standaloneSkills.map((skill) => {
                    if (skill.ratedPerSide) {
                      return (
                        <SideRatedRowPair
                          key={skill.id}
                          skill={skill}
                          leftDraft={draft.skills[`${skill.id}:left`] ?? defaultSkillDraft()}
                          rightDraft={draft.skills[`${skill.id}:right`] ?? defaultSkillDraft()}
                          onChange={patchSkill}
                        />
                      );
                    }
                    return (
                      <SkillGradeRow
                        key={skill.id}
                        skill={skill}
                        draftKey={skill.id}
                        label={skill.name}
                        draft={draft.skills[skill.id] ?? defaultSkillDraft()}
                        onChange={patchSkill}
                      />
                    );
                  })}
                </div>
              );
            })()}

            <button
              type="submit"
              disabled={!submitEnabled}
              className="inline-flex items-center justify-center px-5 min-h-[44px] font-bold text-sm rounded"
              style={{
                borderRadius: "var(--radius-button)",
                backgroundColor: "var(--color-button-primary-background)",
                color: "var(--color-button-primary-text)",
                opacity: submitEnabled ? 1 : 0.5,
                cursor: submitEnabled ? "pointer" : "not-allowed",
              }}
            >
              {isPending ? "Saving…" : "Save evaluation"}
            </button>
          </form>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
