"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CoachSwimmerDetail,
  ScreensResponse,
  SkillForRating,
} from "@swim-app/shared";
import { calculateBilateralBreathingGrade } from "@swim-app/shared";
import AddNoteForm from "@/components/AddNoteForm";
import { submitEvaluation } from "./actions";
import type { EvaluateState, SessionDraft, SkillDraft } from "./helpers";
import {
  defaultSkillDraft,
  initialSessionDraft,
  todayLA,
  canSubmit,
  buildRatingsArray,
  buildSectionGroups,
  skillDisplayLabel,
} from "./helpers";
import { SCREEN_SECTIONS } from "./screenSections";
import SessionSetup from "./SessionSetup";
import CoachingPriorityField from "./CoachingPriorityField";
import StartGroupSection from "./StartGroupSection";
import SkillGradeRow from "./SkillGradeRow";
import SideRatedRowPair from "./SideRatedRowPair";
import CalculatedSkillRow from "./CalculatedSkillRow";
import EvalSectionHeader from "./EvalSectionHeader";
import UndoToast from "./UndoToast";

interface EvaluateContentProps {
  swimmer: CoachSwimmerDetail;
  screens: ScreensResponse;
  accessToken: string;
}

export default function EvaluateContent({ swimmer, screens, accessToken }: EvaluateContentProps) {
  const metaKey = useMemo(() => `evaluate-draft-meta-${swimmer.id}`, [swimmer.id]);
  const skillsKey = useCallback((slug: string) => `evaluate-draft-skills-${swimmer.id}-${slug}`, [swimmer.id]);

  const [draft, setDraft] = useState<SessionDraft>(() => initialSessionDraft());
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [skillSearch, setSkillSearch] = useState("");
  const [depSuggestion, setDepSuggestion] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "loaded"; chain: Array<{ slug: string; grade: unknown; sortOrder: number }> | null }
    | { status: "error" }
  >({ status: "idle" });
  const mountedRef = useRef(false);
  const savedAtRef = useRef<number>(0);
  const savedScreenSlugRef = useRef<string>("");

  // Restore draft from localStorage on mount
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    try {
      const meta = JSON.parse(localStorage.getItem(metaKey) ?? "null");
      if (meta && typeof meta === "object") {
        const { screenSlug, sessionDate, context, coachingPriority, breathingPattern } = meta as Partial<SessionDraft>;
        const storedScreenSlug = typeof screenSlug === "string" ? screenSlug : "";
        let skills: Record<string, SkillDraft> = {};
        if (storedScreenSlug) {
          const skillsStored = JSON.parse(localStorage.getItem(skillsKey(storedScreenSlug)) ?? "null");
          if (skillsStored && typeof skillsStored === "object" && "skills" in skillsStored) {
            skills = skillsStored.skills as Record<string, SkillDraft>;
          }
        }
        setDraft({
          screenSlug: storedScreenSlug,
          sessionDate: typeof sessionDate === "string" ? sessionDate : todayLA(),
          context: context === "drill" || context === "practice" || context === "race" ? context : null,
          coachingPriority: typeof coachingPriority === "string" ? coachingPriority : "",
          breathingPattern:
            breathingPattern === "every_1" || breathingPattern === "every_2" ||
            breathingPattern === "every_3" || breathingPattern === "every_4" ||
            breathingPattern === "every_5" || breathingPattern === "other"
              ? breathingPattern
              : null,
          skills,
        });
      }
    } catch {
      // ignore
    }
  }, [swimmer.id, metaKey, skillsKey]);

  // Persist draft to localStorage on every change
  useEffect(() => {
    try {
      localStorage.setItem(metaKey, JSON.stringify({
        screenSlug: draft.screenSlug,
        sessionDate: draft.sessionDate,
        context: draft.context,
        coachingPriority: draft.coachingPriority,
        breathingPattern: draft.breathingPattern,
      }));
      if (draft.screenSlug) {
        localStorage.setItem(skillsKey(draft.screenSlug), JSON.stringify({ skills: draft.skills }));
      }
    } catch {
      // ignore
    }
  }, [draft, swimmer.id, metaKey, skillsKey]);

  // Fetch dep suggestion when screenSlug changes — use the screen's first category-like slug
  // The dependency map endpoint still accepts categoryId; we skip it for now (no category on screens)
  useEffect(() => {
    if (!draft.screenSlug) {
      setDepSuggestion({ status: "idle" });
      return;
    }
    // Dependency map requires a categoryId; screens are not category-scoped.
    // Set to idle until the dependency-map endpoint is updated to accept screenSlug.
    setDepSuggestion({ status: "idle" });
  }, [draft.screenSlug]);

  const boundAction = useMemo(() => submitEvaluation.bind(null, swimmer.id), [swimmer.id]);
  const [state, formAction, isPending] = useActionState<EvaluateState, FormData>(
    boundAction,
    { status: "idle" },
  );

  // Capture savedAt and clear localStorage on success.
  useEffect(() => {
    if (state.status === "saved") {
      savedAtRef.current = Date.now();
      try {
        localStorage.removeItem(metaKey);
        const slug = savedScreenSlugRef.current;
        if (slug) {
          localStorage.removeItem(skillsKey(slug));
        }
      } catch {
        // ignore
      }
    }
  }, [state.status, metaKey, skillsKey]);

  function handleScreenChange(newScreenSlug: string) {
    let skills: Record<string, SkillDraft> = {};
    try {
      const stored = JSON.parse(localStorage.getItem(skillsKey(newScreenSlug)) ?? "null");
      if (stored && typeof stored === "object" && "skills" in stored) {
        skills = stored.skills as Record<string, SkillDraft>;
      }
    } catch { /* ignore */ }
    const needsBreathing = newScreenSlug === "freestyle" || newScreenSlug === "butterfly";
    setDraft((prev) => ({
      ...prev,
      screenSlug: newScreenSlug,
      breathingPattern: needsBreathing ? prev.breathingPattern : null,
      skills,
    }));
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

  const selectedScreen = screens.find((screen) => screen.screenSlug === draft.screenSlug) ?? null;

  const slugToName = Object.fromEntries(
    screens.flatMap((screen) => screen.skills.map((skill) => [skill.slug, skill.name])),
  );

  const ratingsArray = selectedScreen
    ? buildRatingsArray(selectedScreen.skills, draft.skills)
    : [];
  const submitEnabled = canSubmit(draft, ratingsArray.length, isPending);

  const bodyJson = JSON.stringify({
    screenSlug: draft.screenSlug,
    sessionDate: draft.sessionDate,
    context: draft.context,
    coachingPriority: draft.coachingPriority,
    breathingPattern: draft.breathingPattern,
    ratings: ratingsArray,
  });

  const screenSections = selectedScreen !== null
    ? (SCREEN_SECTIONS[selectedScreen.screenSlug] ?? null)
    : null;

  const sectionGroups = selectedScreen !== null && screenSections !== null
    ? buildSectionGroups(selectedScreen, screenSections)
    : null;

  const searchResults = useMemo(() => {
    if (!skillSearch.trim() || !sectionGroups) return [];
    const query = skillSearch.toLowerCase();
    const seen = new Set<string>();
    const results: Array<{ skill: SkillForRating; sectionName: string }> = [];
    for (const section of sectionGroups) {
      for (const skill of section.skills) {
        if (skill.name.toLowerCase().includes(query) && !seen.has(skill.id)) {
          results.push({ skill, sectionName: section.name });
          seen.add(skill.id);
        }
      }
    }
    return results.slice(0, 8);
  }, [skillSearch, sectionGroups]);

  function jumpToSkill(skill: SkillForRating, sectionName: string) {
    setOpenSections((prev) => ({ ...prev, [sectionName]: true }));
    setSkillSearch("");
    requestAnimationFrame(() => {
      document.getElementById(`skill-${skill.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  // ── Success screen ────────────────────────────────────────────────────────────

  if (state.status === "saved") {
    return (
      <div className="flex flex-col flex-1">
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

            <section className="flex flex-col gap-3">
              <h2 className="font-bold text-sm" style={{ color: "var(--color-text)" }}>
                Add a session note
              </h2>
              <AddNoteForm
                swimmerId={swimmer.id}
                sessionId={state.sessionId}
              />
            </section>

            <a
              href={`/coach/swimmers/${swimmer.id}`}
              className="text-sm underline"
              style={{ color: "var(--color-link)" }}
            >
              ← Back to {swimmer.firstName}
            </a>
          </div>
        </main>
      </div>
    );
  }

  // ── Main form ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col flex-1">
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

          <form
            action={formAction}
            noValidate
            className="flex flex-col gap-6"
            onSubmit={() => { savedScreenSlugRef.current = draft.screenSlug; }}
          >
            <input type="hidden" name="bodyJson" value={bodyJson} />

            <SessionSetup
              draft={draft}
              screens={screens}
              onScreenChange={handleScreenChange}
              onChange={(patch) => setDraft((prev) => ({ ...prev, ...patch }))}
            />

            {/* Skills */}
            {selectedScreen !== null && (() => {
              const screen = selectedScreen;
              function renderSkill(skill: SkillForRating, sectionName: string) {
                const label = skillDisplayLabel(skill, sectionName);
                if (skill.type === "rollup") {
                  let calculatedGrade: 1 | 2 | 3 | 4 | 5 | null = null;
                  if (skill.slug === "free-bilateral-breathing") {
                    const breathingSkill = screen.skills.find((s) => s.slug === "breathing-timing-free");
                    if (breathingSkill) {
                      const leftGrade = draft.skills[`${breathingSkill.id}:left`]?.grade ?? null;
                      const rightGrade = draft.skills[`${breathingSkill.id}:right`]?.grade ?? null;
                      calculatedGrade = calculateBilateralBreathingGrade(leftGrade, rightGrade);
                    }
                  }
                  return (
                    <CalculatedSkillRow
                      key={skill.id}
                      skill={skill}
                      label={label}
                      calculatedGrade={calculatedGrade}
                    />
                  );
                }
                if (skill.ratedPerSide) {
                  return (
                    <SideRatedRowPair
                      key={skill.id}
                      skill={skill}
                      label={label}
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
                    label={label}
                    draft={draft.skills[skill.id] ?? defaultSkillDraft()}
                    onChange={patchSkill}
                  />
                );
              }

              if (sectionGroups !== null) {
                const startParentIds = new Set(
                  selectedScreen.skills
                    .filter(
                      (skill) =>
                        skill.parentSkillId === null &&
                        selectedScreen.skills.some((other) => other.parentSkillId === skill.id),
                    )
                    .map((skill) => skill.id),
                );
                return (
                  <div className="flex flex-col gap-4">
                    <h2 className="font-bold text-sm" style={{ color: "var(--color-text)" }}>
                      Skills — {selectedScreen.name}
                    </h2>
                    <div className="relative">
                      <input
                        type="search"
                        placeholder="Search skills…"
                        value={skillSearch}
                        onChange={(event) => setSkillSearch(event.target.value)}
                        className="w-full border rounded px-3 py-2 text-sm min-h-[44px]"
                        style={{
                          borderColor: "var(--color-border)",
                          color: "var(--color-text)",
                          backgroundColor: "transparent",
                        }}
                      />
                      {searchResults.length > 0 && (
                        <ul
                          className="absolute z-10 w-full mt-1 rounded border overflow-auto"
                          style={{
                            borderColor: "var(--color-border)",
                            backgroundColor: "var(--color-surface)",
                            maxHeight: "240px",
                          }}
                        >
                          {searchResults.map(({ skill, sectionName }) => (
                            <li key={`${skill.id}:${sectionName}`}>
                              <button
                                type="button"
                                onClick={() => jumpToSkill(skill, sectionName)}
                                className="w-full text-left px-3 py-2 text-sm"
                                style={{ color: "var(--color-text)" }}
                              >
                                {skill.name}
                                <span className="ml-2 text-xs" style={{ color: "var(--color-text-secondary)" }}>
                                  {sectionName}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    {sectionGroups.map((section) => (
                      <EvalSectionHeader
                        key={section.name}
                        name={section.name}
                        skillCount={section.skills.length}
                        isOpen={openSections[section.name] ?? true}
                        onToggle={() => setOpenSections((prev) => ({
                          ...prev,
                          [section.name]: !(prev[section.name] ?? true),
                        }))}
                      >
                        {section.skills.map((skill) => {
                          if (startParentIds.has(skill.id)) {
                            const components = selectedScreen.skills.filter(
                              (other) => other.parentSkillId === skill.id,
                            );
                            return (
                              <StartGroupSection
                                key={skill.id}
                                parent={skill}
                                components={components}
                                draftSkills={draft.skills}
                                onChange={patchSkill}
                              />
                            );
                          }
                          return renderSkill(skill, section.name);
                        })}
                      </EvalSectionHeader>
                    ))}
                  </div>
                );
              }

              // Fallback: flat list when no section config exists for this screen
              const startParentIds = new Set(
                selectedScreen.skills
                  .filter(
                    (skill) =>
                      skill.parentSkillId === null &&
                      selectedScreen.skills.some((other) => other.parentSkillId === skill.id),
                  )
                  .map((skill) => skill.id),
              );
              const startParents = selectedScreen.skills.filter((skill) => startParentIds.has(skill.id));
              const standaloneSkills = selectedScreen.skills.filter(
                (skill) =>
                  !startParentIds.has(skill.id) &&
                  (skill.parentSkillId === null || !startParentIds.has(skill.parentSkillId ?? "")),
              );
              return (
                <div className="flex flex-col gap-4">
                  <h2 className="font-bold text-sm" style={{ color: "var(--color-text)" }}>
                    Skills — {selectedScreen.name}
                  </h2>

                  {startParents.map((parent) => (
                    <StartGroupSection
                      key={parent.id}
                      parent={parent}
                      components={selectedScreen.skills.filter((other) => other.parentSkillId === parent.id)}
                      draftSkills={draft.skills}
                      onChange={patchSkill}
                    />
                  ))}

                  {standaloneSkills.map((skill) => renderSkill(skill, ""))}
                </div>
              );
            })()}

            <CoachingPriorityField
              value={draft.coachingPriority}
              onChange={(value) => setDraft((prev) => ({ ...prev, coachingPriority: value }))}
              suggestion={depSuggestion}
              slugToName={slugToName}
            />

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
    </div>
  );
}
