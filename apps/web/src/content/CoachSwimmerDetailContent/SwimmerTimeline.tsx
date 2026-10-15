"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  CategoriesResponse,
  CoachNoteType,
  TimelineItem,
  TimelineResponse,
} from "@swim-app/shared";

import ConfirmDialog from "@/components/ConfirmDialog";
import { updateNoteAction, deleteNoteAction, type NoteActionState } from "@/lib/actions/notes";

const NOTE_IDLE: NoteActionState = { status: "idle" };

type NoteSubFilter = CoachNoteType;
type TimelineFilter = "all" | NoteSubFilter | "rating_note" | "coaching_priority";

interface FilterSpec {
  value: TimelineFilter;
  label: string;
}

const FILTERS: FilterSpec[] = [
  { value: "all", label: "All" },
  { value: "observation", label: "Observation" },
  { value: "correction", label: "Correction" },
  { value: "drill", label: "Drill" },
  { value: "recommendation", label: "Recommendation" },
  { value: "rating_note", label: "Rating note" },
  { value: "coaching_priority", label: "Priority" },
];

const NOTE_TYPE_LABELS: Record<CoachNoteType, string> = {
  observation: "Observation",
  correction: "Correction",
  drill: "Drill",
  recommendation: "Recommendation",
};

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

function buildSkillMap(categories: CategoriesResponse): Map<string, string> {
  const map = new Map<string, string>();
  for (const cat of categories) {
    for (const skill of cat.skills) {
      map.set(skill.id, skill.name);
    }
  }
  return map;
}

function matchesFilter(item: TimelineItem, filter: TimelineFilter): boolean {
  if (filter === "all") return true;
  if (filter === "rating_note" || filter === "coaching_priority") return item.type === filter;
  // observation | correction | drill | recommendation — sub-filters for note type
  return item.type === "note" && item.noteType === filter;
}

const NOTE_TYPES: { value: CoachNoteType; label: string }[] = [
  { value: "observation", label: "Observation" },
  { value: "correction", label: "Correction" },
  { value: "drill", label: "Drill" },
  { value: "recommendation", label: "Recommendation" },
];

const selectClass =
  "rounded-lg border border-border bg-background text-text text-sm px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] disabled:opacity-50";

// ── EditRow ───────────────────────────────────────────────────────────────────

interface EditRowProps {
  item: TimelineItem;
  swimmerId: string;
  categories: CategoriesResponse;
  onCancel: () => void;
  onSuccess: () => void;
}

function EditRow({ item, swimmerId, categories, onCancel, onSuccess }: EditRowProps) {
  const boundUpdate = updateNoteAction.bind(null, swimmerId, item.id);
  const [state, formAction, isPending] = useActionState<NoteActionState, FormData>(boundUpdate, NOTE_IDLE);

  useEffect(() => {
    if (state.status === "success") onSuccess();
  }, [state.status, onSuccess]);

  const allSkills = categories.flatMap((cat) =>
    cat.skills.map((skill) => ({ id: skill.id, name: skill.name })),
  );
  const currentSkillId = item.tiedTo?.skillId ?? "";

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex gap-2 flex-wrap">
        <select
          name="noteType"
          defaultValue={item.noteType ?? "observation"}
          disabled={isPending}
          className={selectClass}
        >
          {NOTE_TYPES.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>

        {allSkills.length > 0 && (
          <select
            name="skillId"
            defaultValue={currentSkillId}
            disabled={isPending}
            className={selectClass}
            aria-label="Tie to skill (optional)"
          >
            <option value="">No skill</option>
            {allSkills.map((skill) => (
              <option key={skill.id} value={skill.id}>{skill.name}</option>
            ))}
          </select>
        )}
      </div>

      <textarea
        name="body"
        defaultValue={item.body}
        rows={3}
        required
        disabled={isPending}
        className="w-full rounded-lg border border-border bg-background text-text text-sm px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] disabled:opacity-50"
      />
      {state.status === "error" && (
        <p className="text-xs text-danger" role="alert">{state.message}</p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="text-xs font-semibold px-3 min-h-[32px] rounded-[var(--radius-button)] disabled:opacity-50"
          style={{ backgroundColor: "var(--color-button-primary-background)", color: "var(--color-button-primary-text)" }}
        >
          {isPending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="text-xs font-semibold px-3 min-h-[32px] rounded-[var(--radius-button)] border disabled:opacity-50"
          style={{ borderColor: "var(--color-button-outline)", color: "var(--color-button-outline)" }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── DeleteRow ─────────────────────────────────────────────────────────────────

interface DeleteRowProps {
  item: TimelineItem;
  swimmerId: string;
  onSuccess: () => void;
}

function DeleteRow({ item, swimmerId, onSuccess }: DeleteRowProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formId = `delete-note-${item.id}`;
  const boundDelete = deleteNoteAction.bind(null, swimmerId, item.id);
  const [state, formAction, isPending] = useActionState<NoteActionState, FormData>(boundDelete, NOTE_IDLE);

  useEffect(() => {
    if (state.status === "success") onSuccess();
  }, [state.status, onSuccess]);

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="text-xs text-text-secondary hover:text-danger transition-colors duration-150 min-h-[32px] px-2"
      >
        Delete
      </button>

      <form id={formId} action={formAction} />

      <ConfirmDialog
        dialogRef={dialogRef}
        title="Delete note?"
        description="This note will be permanently removed."
        formId={formId}
        confirmLabel="Delete"
        confirmDanger
        isPending={isPending}
        {...(state.status === "error" && { errorMessage: state.message })}
        onCancel={() => dialogRef.current?.close()}
      />
    </>
  );
}

// ── SwimmerTimeline ───────────────────────────────────────────────────────────

interface SwimmerTimelineProps {
  swimmerId: string;
  items: TimelineResponse;
  categories: CategoriesResponse;
}

export default function SwimmerTimeline({ swimmerId, items, categories }: SwimmerTimelineProps) {
  const router = useRouter();
  const [activeFilter, setActiveFilter] = useState<TimelineFilter>("all");
  const [skillFilter, setSkillFilter] = useState<string>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const onMutated = useRef(() => { router.refresh(); });

  const skillMap = buildSkillMap(categories);

  const skillsInTimeline = Array.from(
    new Map(
      items
        .filter((item) => item.tiedTo?.skillId !== undefined)
        .map((item) => [item.tiedTo!.skillId!, skillMap.get(item.tiedTo!.skillId!) ?? item.tiedTo!.skillId!]),
    ).entries(),
  );

  const filtered = items.filter((item) => {
    if (!matchesFilter(item, activeFilter)) return false;
    if (skillFilter !== "all" && item.tiedTo?.skillId !== skillFilter) return false;
    return true;
  });

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-bold text-text">Timeline</h2>

      <div className="flex gap-2 flex-wrap">
        {FILTERS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => setActiveFilter(value)}
            className={`text-xs font-semibold rounded-full px-3 py-1 border transition-colors duration-150 min-h-[28px] ${
              activeFilter === value
                ? "border-accent text-accent"
                : "border-border text-text-secondary hover:border-text-secondary"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {skillsInTimeline.length > 0 && (
        <select
          value={skillFilter}
          onChange={(event) => setSkillFilter(event.target.value)}
          className="self-start text-xs border border-border rounded-lg px-2 py-1 bg-background text-text focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
          aria-label="Filter by skill"
        >
          <option value="all">All skills</option>
          {skillsInTimeline.map(([skillId, skillName]) => (
            <option key={skillId} value={skillId}>{skillName}</option>
          ))}
        </select>
      )}

      {filtered.length === 0 ? (
        <p className="text-sm text-text-secondary">No timeline entries yet.</p>
      ) : (
        <ul className="flex flex-col">
          {filtered.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-1.5 py-3 border-t border-border first:border-0 first:pt-0"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`text-xs font-semibold rounded-full px-2 py-0.5 border ${
                    item.type === "coaching_priority"
                      ? "text-accent border-accent"
                      : "text-text-secondary border-border"
                  }`}
                >
                  {item.type === "note" && item.noteType
                    ? NOTE_TYPE_LABELS[item.noteType]
                    : item.type === "rating_note"
                    ? "Rating note"
                    : "Priority"}
                </span>
                <time className="text-xs text-text-secondary" dateTime={item.createdAt}>
                  {formatDate(item.createdAt)}
                </time>
                {item.tiedTo?.skillId !== undefined && (
                  <span className="text-xs text-text-secondary">
                    {skillMap.get(item.tiedTo.skillId) ?? "skill"}
                  </span>
                )}
              </div>

              {item.type === "note" && editingId === item.id ? (
                <EditRow
                  item={item}
                  swimmerId={swimmerId}
                  categories={categories}
                  onCancel={() => setEditingId(null)}
                  onSuccess={() => {
                    setEditingId(null);
                    onMutated.current();
                  }}
                />
              ) : (
                <p className="text-sm text-text">{item.body}</p>
              )}

              {item.type === "note" && editingId !== item.id && (
                <div className="flex items-center gap-1 -ml-2">
                  <button
                    type="button"
                    onClick={() => setEditingId(item.id)}
                    className="text-xs text-text-secondary hover:text-text transition-colors duration-150 min-h-[32px] px-2"
                  >
                    Edit
                  </button>
                  <DeleteRow
                    item={item}
                    swimmerId={swimmerId}
                    onSuccess={onMutated.current}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
