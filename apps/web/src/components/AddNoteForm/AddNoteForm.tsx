"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { CategoriesResponse, CoachNoteType } from "@swim-app/shared";

import { createNoteAction, type NoteActionState } from "@/lib/actions/notes";

interface AddNoteFormProps {
  swimmerId: string;
  sessionId?: string;
  lessonId?: string;
  categories?: CategoriesResponse;
  label?: string;
}

const NOTE_TYPES: { value: CoachNoteType; label: string }[] = [
  { value: "observation", label: "Observation" },
  { value: "correction", label: "Correction" },
  { value: "drill", label: "Drill" },
  { value: "recommendation", label: "Recommendation" },
];

const INITIAL: NoteActionState = { status: "idle" };

const selectClass =
  "rounded-lg border border-border bg-background text-text text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] disabled:opacity-50";

export default function AddNoteForm({
  swimmerId,
  sessionId,
  lessonId,
  categories = [],
  label = "Add note",
}: AddNoteFormProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const boundAction = createNoteAction.bind(null, swimmerId, sessionId ?? null, lessonId ?? null);
  const [state, formAction, isPending] = useActionState<NoteActionState, FormData>(boundAction, INITIAL);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
      router.refresh();
    }
  }, [state.status, router]);

  const allSkills = categories.flatMap((cat) =>
    cat.skills.map((skill) => ({ id: skill.id, name: skill.name, category: cat.name })),
  );

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3">
      <span className="text-xs font-semibold text-text-secondary">{label}</span>

      <div className="flex gap-2 flex-wrap">
        <select name="noteType" defaultValue="observation" disabled={isPending} className={selectClass}>
          {NOTE_TYPES.map(({ value, label: optLabel }) => (
            <option key={value} value={value}>{optLabel}</option>
          ))}
        </select>

        {allSkills.length > 0 && (
          <select name="skillId" defaultValue="" disabled={isPending} className={selectClass} aria-label="Tie to skill (optional)">
            <option value="">No skill</option>
            {allSkills.map((skill) => (
              <option key={skill.id} value={skill.id}>{skill.name}</option>
            ))}
          </select>
        )}
      </div>

      <textarea
        name="body"
        rows={3}
        required
        disabled={isPending}
        placeholder="Write a note…"
        className="w-full rounded-lg border border-border bg-background text-text text-sm px-3 py-2 resize-none placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] disabled:opacity-50"
      />

      {state.status === "error" && (
        <p className="text-sm text-danger" role="alert">{state.message}</p>
      )}
      {state.status === "success" && (
        <p className="text-sm text-success" role="status">Note saved.</p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="self-start inline-flex items-center justify-center px-4 min-h-[36px] text-sm font-bold rounded-[var(--radius-button)] disabled:opacity-50"
        style={{
          backgroundColor: "var(--color-button-primary-background)",
          color: "var(--color-button-primary-text)",
        }}
      >
        {isPending ? "Saving…" : "Save note"}
      </button>
    </form>
  );
}
