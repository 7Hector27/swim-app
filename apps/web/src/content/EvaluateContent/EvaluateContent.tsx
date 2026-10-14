"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type {
  CoachSwimmerDetail,
  CategoriesResponse,
  SkillCategoryWithSkills,
  SkillForRating,
  RatingRecord,
  StartGradeResult,
} from "@swim-app/shared";
import { calculateStartGrade, MeasurementUnitSchema } from "@swim-app/shared";
import SiteNav from "@/components/SiteNav";
import SiteFooter from "@/components/SiteFooter";
import { submitEvaluation } from "./actions";
import type { EvaluateState } from "./helpers";

// ── UI-only state types ────────────────────────────────────────────────────────

type SkillDraft = {
  grade: 1 | 2 | 3 | 4 | 5 | null;
  notLegal: boolean;
  noConcept: boolean;
  capacityValue: string;
  capacityUnit: "yards" | "reps" | null;
  measurementValue: string;
  measurementUnit: string | null;
  note: string;
  faultTags: string[];
  detailsOpen: boolean;
};

type SessionDraft = {
  categoryId: string;
  sessionDate: string;
  context: "drill" | "practice" | "race" | null;
  coachingPriority: string;
  skills: Record<string, SkillDraft>;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function todayLA(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
}

function defaultSkillDraft(): SkillDraft {
  return {
    grade: null,
    notLegal: false,
    noConcept: false,
    capacityValue: "",
    capacityUnit: null,
    measurementValue: "",
    measurementUnit: null,
    note: "",
    faultTags: [],
    detailsOpen: false,
  };
}

function initialSessionDraft(): SessionDraft {
  return {
    categoryId: "",
    sessionDate: todayLA(),
    context: null,
    coachingPriority: "",
    skills: {},
  };
}

// ── Grade selector ─────────────────────────────────────────────────────────────

interface GradeSelectorProps {
  value: 1 | 2 | 3 | 4 | 5 | null;
  disabled: boolean;
  onChange: (grade: 1 | 2 | 3 | 4 | 5 | null) => void;
  labelPrefix: string;
}

function GradeSelector({ value, disabled, onChange, labelPrefix }: GradeSelectorProps) {
  const options: Array<{ label: string; grade: 1 | 2 | 3 | 4 | 5 | null }> = [
    { label: "—", grade: null },
    { label: "1", grade: 1 },
    { label: "2", grade: 2 },
    { label: "3", grade: 3 },
    { label: "4", grade: 4 },
    { label: "5", grade: 5 },
  ];

  return (
    <div role="radiogroup" aria-label={`${labelPrefix} grade`} className="flex gap-1 flex-wrap">
      {options.map(({ label, grade }) => {
        const selected = value === grade;
        return (
          <button
            key={label}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(grade)}
            className="min-h-[44px] min-w-[44px] px-3 rounded border text-sm font-semibold transition-colors"
            style={{
              borderColor: selected ? "var(--color-accent)" : "var(--color-border)",
              color: selected ? "var(--color-accent)" : "var(--color-text-secondary)",
              backgroundColor: "transparent",
              opacity: disabled ? 0.4 : 1,
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ── Start grade pill ───────────────────────────────────────────────────────────

function StartGradePill({ result }: { result: StartGradeResult }) {
  if (result.status === "in_progress") {
    return (
      <span className="text-xs px-2 py-0.5 rounded border" style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}>
        In progress
      </span>
    );
  }
  if (result.status === "graded") {
    return (
      <span className="text-xs px-2 py-0.5 rounded border font-bold" style={{ borderColor: "var(--color-accent)", color: "var(--color-accent)" }}>
        {result.grade}
      </span>
    );
  }
  if (result.status === "not_legal") {
    return (
      <span className="text-xs px-2 py-0.5 rounded border font-bold" style={{ borderColor: "var(--color-button-danger-text)", color: "var(--color-button-danger-text)" }}>
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

// ── Per-skill row ──────────────────────────────────────────────────────────────

interface SkillRowProps {
  skill: SkillForRating;
  draftKey: string;
  label: string;
  draft: SkillDraft;
  onChange: (key: string, patch: Partial<SkillDraft>) => void;
}

function SkillRow({ skill, draftKey, label, draft, onChange }: SkillRowProps) {
  const measurementUnits = MeasurementUnitSchema.options;

  return (
    <fieldset
      className="flex flex-col gap-3 p-3 rounded border"
      style={{
        borderColor: draft.notLegal ? "var(--color-button-danger-text)" : "var(--color-border)",
        borderLeftWidth: draft.notLegal ? "3px" : "1px",
      }}
    >
      <legend className="font-semibold text-sm px-1" style={{ color: "var(--color-text)" }}>
        {label}
        {draft.notLegal && (
          <span
            className="ml-2 text-xs font-bold px-1.5 py-0.5 rounded"
            style={{ color: "var(--color-button-danger-text)", backgroundColor: "transparent", border: "1px solid var(--color-button-danger-text)" }}
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
          // If clearing grade, also clear notLegal
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
            borderColor: draft.notLegal ? "var(--color-button-danger-text)" : "var(--color-border)",
            color: draft.notLegal ? "var(--color-button-danger-text)" : "var(--color-text-secondary)",
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

          {skill.type === "measured" && (
            <>
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
                    className="border rounded px-3 py-2 text-sm min-h-[44px] w-24"
                    style={{ borderColor: "var(--color-border)", color: "var(--color-text)", backgroundColor: "transparent" }}
                  />
                  <select
                    value={draft.capacityUnit ?? ""}
                    onChange={(event) =>
                      onChange(draftKey, {
                        capacityUnit: event.target.value === "" ? null : event.target.value as "yards" | "reps",
                      })
                    }
                    className="border rounded px-3 py-2 text-sm min-h-[44px]"
                    style={{ borderColor: "var(--color-border)", color: "var(--color-text)", backgroundColor: "transparent" }}
                  >
                    <option value="">Unit</option>
                    <option value="yards">yards</option>
                    <option value="reps">reps</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold" style={{ color: "var(--color-text-secondary)" }}>
                  Measurement
                </label>
                <div className="flex gap-2 items-center">
                  <input
                    type="number"
                    value={draft.measurementValue}
                    onChange={(event) => onChange(draftKey, { measurementValue: event.target.value })}
                    placeholder="Value"
                    className="border rounded px-3 py-2 text-sm min-h-[44px] w-24"
                    style={{ borderColor: "var(--color-border)", color: "var(--color-text)", backgroundColor: "transparent" }}
                  />
                  {skill.unit !== null ? (
                    <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>{skill.unit}</span>
                  ) : (
                    <select
                      value={draft.measurementUnit ?? ""}
                      onChange={(event) =>
                        onChange(draftKey, {
                          measurementUnit: event.target.value === "" ? null : event.target.value,
                        })
                      }
                      className="border rounded px-3 py-2 text-sm min-h-[44px]"
                      style={{ borderColor: "var(--color-border)", color: "var(--color-text)", backgroundColor: "transparent" }}
                    >
                      <option value="">Unit</option>
                      {measurementUnits.map((unit) => (
                        <option key={unit} value={unit}>{unit}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            </>
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
      )}
    </fieldset>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface EvaluateContentProps {
  swimmer: CoachSwimmerDetail;
  categories: CategoriesResponse;
  accessToken: string;
}

export default function EvaluateContent({ swimmer, categories, accessToken }: EvaluateContentProps) {
  const draftKey = `evaluate-draft-${swimmer.id}`;

  const [draft, setDraft] = useState<SessionDraft>(() => initialSessionDraft());
  const [depSuggestion, setDepSuggestion] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "loaded"; chain: Array<{ slug: string; grade: unknown; sortOrder: number }> | null }
    | { status: "error" }
  >({ status: "idle" });
  const [undoError, setUndoError] = useState<string | null>(null);
  const [undoInProgress, setUndoInProgress] = useState(false);
  const mountedRef = useRef(false);

  // Restore draft from localStorage on mount
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    try {
      const stored = localStorage.getItem(draftKey);
      if (stored) {
        const parsed: unknown = JSON.parse(stored);
        if (parsed && typeof parsed === "object") {
          setDraft(parsed as SessionDraft);
        }
      }
    } catch {
      // ignore
    }
  }, [draftKey]);

  // Persist draft to localStorage on every change
  useEffect(() => {
    try {
      localStorage.setItem(draftKey, JSON.stringify(draft));
    } catch {
      // ignore
    }
  }, [draft, draftKey]);

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

  // Clear localStorage on success
  useEffect(() => {
    if (state.status === "saved") {
      try {
        localStorage.removeItem(draftKey);
      } catch {
        // ignore
      }
    }
  }, [state.status, draftKey]);

  const selectedCategory = categories.find((cat) => cat.id === draft.categoryId) ?? null;

  // Build skill groups with start parents
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
    const componentSkillsOf = (parentId: string) =>
      category.skills.filter((skill) => skill.parentSkillId === parentId);

    return { startParents, standaloneSkills, componentSkillsOf };
  }

  // Build RatingRecords from current draft for a set of component skills
  function buildRatingRecords(componentSkills: SkillForRating[]): RatingRecord[] {
    const records: RatingRecord[] = [];
    for (const skill of componentSkills) {
      const keys = skill.ratedPerSide
        ? [`${skill.id}:left`, `${skill.id}:right`]
        : [skill.id];
      for (const key of keys) {
        const d = draft.skills[key];
        if (!d) continue;
        const side = skill.ratedPerSide
          ? (key.endsWith(":left") ? "left" : "right") as "left" | "right"
          : null;
        if (d.noConcept) {
          records.push({
            skillSlug: skill.slug,
            side,
            grade: null,
            notLegal: false,
            noConcept: true,
            ratedAt: new Date().toISOString(),
            voidedAt: null,
          });
        } else if (d.grade !== null) {
          records.push({
            skillSlug: skill.slug,
            side,
            grade: d.grade,
            notLegal: d.notLegal,
            noConcept: false,
            ratedAt: new Date().toISOString(),
            voidedAt: null,
          });
        }
      }
    }
    return records;
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

  // Build ratings array for submission
  function buildRatingsArray() {
    if (!selectedCategory) return [];
    const ratings: Array<{
      skillId: string;
      grade: 1 | 2 | 3 | 4 | 5 | null;
      notLegal: boolean;
      noConcept: boolean;
      side: "left" | "right" | null;
      capacityValue: string | null;
      capacityUnit: "yards" | "reps" | null;
      measurementValue: string | null;
      measurementUnit: string | null;
      note: string | null;
      faultTags: string[];
      ratedAt: string;
    }> = [];

    for (const skill of selectedCategory.skills) {
      const keys = skill.ratedPerSide
        ? [`${skill.id}:left`, `${skill.id}:right`]
        : [skill.id];

      for (const key of keys) {
        const d = draft.skills[key];
        if (!d) continue;
        if (d.grade === null && !d.noConcept) continue;

        const side = skill.ratedPerSide
          ? (key.endsWith(":left") ? "left" : "right") as "left" | "right"
          : null;

        ratings.push({
          skillId: skill.id,
          grade: d.grade,
          notLegal: d.notLegal,
          noConcept: d.noConcept,
          side,
          capacityValue: d.capacityValue !== "" ? d.capacityValue : null,
          capacityUnit: d.capacityUnit,
          measurementValue: d.measurementValue !== "" ? d.measurementValue : null,
          measurementUnit: d.measurementUnit,
          note: d.note !== "" ? d.note : null,
          faultTags: d.faultTags,
          ratedAt: new Date().toISOString(),
        });
      }
    }
    return ratings;
  }

  const ratingsArray = buildRatingsArray();
  const canSubmit =
    draft.categoryId !== "" &&
    draft.sessionDate !== "" &&
    draft.context !== null &&
    draft.coachingPriority.trim().length > 0 &&
    ratingsArray.length > 0 &&
    !isPending;

  const bodyJson = JSON.stringify({
    categoryId: draft.categoryId,
    sessionDate: draft.sessionDate,
    context: draft.context,
    coachingPriority: draft.coachingPriority,
    ratings: ratingsArray,
  });

  // ── Success screen ────────────────────────────────────────────────────────────

  if (state.status === "saved") {
    const { sessionId: _sessionId, ratingIds } = state;
    const UNDO_WINDOW_MS = 10 * 60 * 1000;
    const savedAt = Date.now();
    const withinUndoWindow = Date.now() - savedAt < UNDO_WINDOW_MS;

    async function handleUndo() {
      setUndoInProgress(true);
      setUndoError(null);
      try {
        const results = await Promise.all(
          ratingIds.map((ratingId) =>
            fetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/ratings/${ratingId}`, {
              method: "DELETE",
              headers: { Authorization: `Bearer ${accessToken}` },
            }),
          ),
        );
        const anyFailed = results.some((response) => !response.ok);
        if (anyFailed) {
          setUndoError("Some ratings could not be undone. The undo window may have passed.");
          setUndoInProgress(false);
          return;
        }
        window.location.href = `/coach/swimmers/${swimmer.id}`;
      } catch {
        setUndoError("Something went wrong. Please try again.");
        setUndoInProgress(false);
      }
    }

    return (
      <div className="flex flex-col min-h-screen">
        <SiteNav />
        <main className="flex-1 px-page py-8">
          <div className="mx-auto max-w-content flex flex-col gap-6">
            <h1 className="text-heading" style={{ color: "var(--color-text)" }}>
              Evaluation saved for {swimmer.firstName}
            </h1>

            {withinUndoWindow && (
              <div className="flex flex-col gap-3">
                <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
                  Need to undo? You can remove this evaluation within 10 minutes of saving.
                </p>
                {undoError && (
                  <p role="alert" className="text-sm" style={{ color: "var(--color-button-danger-text)" }}>
                    {undoError}
                  </p>
                )}
                <button
                  type="button"
                  disabled={undoInProgress}
                  onClick={() => { void handleUndo(); }}
                  className="inline-flex items-center justify-center px-5 min-h-[44px] rounded border text-sm font-semibold"
                  style={{
                    borderColor: "var(--color-button-danger-text)",
                    color: "var(--color-button-danger-text)",
                    backgroundColor: "transparent",
                    opacity: undoInProgress ? 0.6 : 1,
                  }}
                >
                  {undoInProgress ? "Undoing…" : "Undo this evaluation"}
                </button>
              </div>
            )}

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
            <p role="alert" className="text-sm" style={{ color: "var(--color-button-danger-text)" }}>
              {state.message}
            </p>
          )}

          <form action={formAction} noValidate className="flex flex-col gap-6">
            <input type="hidden" name="bodyJson" value={bodyJson} />

            {/* Category */}
            <fieldset className="flex flex-col gap-2">
              <legend className="font-bold text-sm" style={{ color: "var(--color-text)" }}>
                Category
              </legend>
              <select
                value={draft.categoryId}
                onChange={(event) => setDraft((prev) => ({ ...prev, categoryId: event.target.value, skills: {} }))}
                className="border rounded px-3 py-2 text-sm min-h-[44px] max-w-xs"
                style={{ borderColor: "var(--color-border)", color: "var(--color-text)", backgroundColor: "transparent" }}
              >
                <option value="">Select category…</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </fieldset>

            {/* Session date */}
            <fieldset className="flex flex-col gap-2">
              <legend className="font-bold text-sm" style={{ color: "var(--color-text)" }}>
                Session date
              </legend>
              <input
                type="date"
                value={draft.sessionDate}
                onChange={(event) => setDraft((prev) => ({ ...prev, sessionDate: event.target.value }))}
                className="border rounded px-3 py-2 text-sm min-h-[44px] max-w-xs"
                style={{ borderColor: "var(--color-border)", color: "var(--color-text)", backgroundColor: "transparent" }}
              />
            </fieldset>

            {/* Context */}
            <fieldset className="flex flex-col gap-2">
              <legend className="font-bold text-sm" style={{ color: "var(--color-text)" }}>
                Context
              </legend>
              <div className="flex gap-2 flex-wrap">
                {(["drill", "practice", "race"] as const).map((ctx) => (
                  <button
                    key={ctx}
                    type="button"
                    onClick={() => setDraft((prev) => ({ ...prev, context: ctx }))}
                    className="min-h-[44px] px-4 rounded border text-sm font-semibold capitalize transition-colors"
                    style={{
                      borderColor: draft.context === ctx ? "var(--color-accent)" : "var(--color-border)",
                      color: draft.context === ctx ? "var(--color-accent)" : "var(--color-text-secondary)",
                      backgroundColor: "transparent",
                    }}
                  >
                    {ctx}
                  </button>
                ))}
              </div>
            </fieldset>

            {/* Coaching priority + dep suggestion */}
            <fieldset className="flex flex-col gap-2">
              <legend className="font-bold text-sm" style={{ color: "var(--color-text)" }}>
                Coaching priority
              </legend>
              {depSuggestion.status === "loading" && (
                <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>Loading suggestion…</p>
              )}
              {depSuggestion.status === "loaded" && depSuggestion.chain !== null && depSuggestion.chain.length > 0 && (
                <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
                  Suggestion: Focus on{" "}
                  <strong style={{ color: "var(--color-text)" }}>
                    {depSuggestion.chain[depSuggestion.chain.length - 1]?.slug ?? ""}
                  </strong>
                </p>
              )}
              {depSuggestion.status === "loaded" && (depSuggestion.chain === null || depSuggestion.chain.length === 0) && (
                <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
                  All assessed skills are at expected levels
                </p>
              )}
              {depSuggestion.status === "error" && (
                <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
                  Not assessed yet — check individually
                </p>
              )}
              <textarea
                value={draft.coachingPriority}
                onChange={(event) => setDraft((prev) => ({ ...prev, coachingPriority: event.target.value }))}
                rows={3}
                aria-required="true"
                placeholder="What is the main focus for this swimmer?"
                className="border rounded px-3 py-2 text-sm resize-y"
                style={{ borderColor: "var(--color-border)", color: "var(--color-text)", backgroundColor: "transparent" }}
              />
            </fieldset>

            {/* Skills */}
            {selectedCategory !== null && (() => {
              const { startParents, standaloneSkills, componentSkillsOf } = buildSkillGroups(selectedCategory);
              return (
                <div className="flex flex-col gap-4">
                  <h2 className="font-bold text-sm" style={{ color: "var(--color-text)" }}>
                    Skills — {selectedCategory.name}
                  </h2>

                  {/* Start parent groups */}
                  {startParents.map((parent) => {
                    const components = componentSkillsOf(parent.id);
                    const ratingRecords = buildRatingRecords(components);
                    const componentSlugs = components.map((skill) => skill.slug);
                    const startResult = calculateStartGrade(componentSlugs, ratingRecords);

                    return (
                      <div key={parent.id} className="flex flex-col gap-3">
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
                                <div key={skill.id} className="flex flex-col gap-2">
                                  <SkillRow
                                    skill={skill}
                                    draftKey={`${skill.id}:left`}
                                    label={`${skill.name} — Left`}
                                    draft={draft.skills[`${skill.id}:left`] ?? defaultSkillDraft()}
                                    onChange={patchSkill}
                                  />
                                  <SkillRow
                                    skill={skill}
                                    draftKey={`${skill.id}:right`}
                                    label={`${skill.name} — Right`}
                                    draft={draft.skills[`${skill.id}:right`] ?? defaultSkillDraft()}
                                    onChange={patchSkill}
                                  />
                                </div>
                              );
                            }
                            return (
                              <SkillRow
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
                      </div>
                    );
                  })}

                  {/* Standalone skills */}
                  {standaloneSkills.map((skill) => {
                    if (skill.ratedPerSide) {
                      return (
                        <div key={skill.id} className="flex flex-col gap-2">
                          <SkillRow
                            skill={skill}
                            draftKey={`${skill.id}:left`}
                            label={`${skill.name} — Left`}
                            draft={draft.skills[`${skill.id}:left`] ?? defaultSkillDraft()}
                            onChange={patchSkill}
                          />
                          <SkillRow
                            skill={skill}
                            draftKey={`${skill.id}:right`}
                            label={`${skill.name} — Right`}
                            draft={draft.skills[`${skill.id}:right`] ?? defaultSkillDraft()}
                            onChange={patchSkill}
                          />
                        </div>
                      );
                    }
                    return (
                      <SkillRow
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
              disabled={!canSubmit}
              className="inline-flex items-center justify-center px-5 min-h-[44px] font-bold text-sm rounded"
              style={{
                borderRadius: "var(--radius-button)",
                backgroundColor: "var(--color-button-primary-background)",
                color: "var(--color-button-primary-text)",
                opacity: canSubmit ? 1 : 0.5,
                cursor: canSubmit ? "pointer" : "not-allowed",
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
