"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CategoriesResponse, TimelineItem, TimelineItemType, TimelineResponse } from "@swim-app/shared";

import { updateNoteAction, deleteNoteAction, type NoteActionState } from "@/lib/actions/notes";

const NOTE_IDLE: NoteActionState = { status: "idle" };

type FilterType = TimelineItemType | "all";

const FILTER_LABELS: Record<FilterType, string> = {
  all: "All",
  note: "Note",
  rating_note: "Rating note",
  coaching_priority: "Priority",
};
const FILTERS: FilterType[] = ["all", "note", "rating_note", "coaching_priority"];

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

interface EditRowProps {
  item: TimelineItem;
  swimmerId: string;
  onCancel: () => void;
  onSuccess: () => void;
}

function EditRow({ item, swimmerId, onCancel, onSuccess }: EditRowProps) {
  const boundUpdate = updateNoteAction.bind(null, swimmerId, item.id);
  const [state, formAction, isPending] = useActionState<NoteActionState, FormData>(boundUpdate, NOTE_IDLE);

  useEffect(() => {
    if (state.status === "success") onSuccess();
  }, [state.status, onSuccess]);

  return (
    <form action={formAction} className="flex flex-col gap-2">
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

interface DeleteButtonProps {
  item: TimelineItem;
  swimmerId: string;
  onSuccess: () => void;
}

function DeleteButton({ item, swimmerId, onSuccess }: DeleteButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const boundDelete = deleteNoteAction.bind(null, swimmerId, item.id);
  const [state, formAction, isPending] = useActionState<NoteActionState, FormData>(boundDelete, NOTE_IDLE);

  useEffect(() => {
    if (state.status === "success") onSuccess();
  }, [state.status, onSuccess]);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-xs text-text-secondary hover:text-danger transition-colors duration-150 min-h-[32px] px-2"
      >
        Delete
      </button>
    );
  }

  return (
    <form action={formAction} className="flex items-center gap-2">
      <span className="text-xs text-text-secondary">Delete this note?</span>
      {state.status === "error" && (
        <span className="text-xs text-danger">{state.message}</span>
      )}
      <button
        type="submit"
        disabled={isPending}
        className="text-xs font-semibold text-danger min-h-[32px] px-2 disabled:opacity-50"
      >
        {isPending ? "Deleting…" : "Confirm"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={isPending}
        className="text-xs text-text-secondary min-h-[32px] px-2 disabled:opacity-50"
      >
        Cancel
      </button>
    </form>
  );
}

interface SwimmerTimelineProps {
  swimmerId: string;
  items: TimelineResponse;
  categories: CategoriesResponse;
}

export default function SwimmerTimeline({ swimmerId, items, categories }: SwimmerTimelineProps) {
  const router = useRouter();
  const [typeFilter, setTypeFilter] = useState<FilterType>("all");
  const [skillFilter, setSkillFilter] = useState<string>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const onMutated = useRef(() => { router.refresh(); });

  const skillMap = buildSkillMap(categories);

  const skillsWithRatings = Array.from(
    new Map(
      items
        .filter((item) => item.tiedTo?.skillId !== undefined)
        .map((item) => [item.tiedTo!.skillId!, skillMap.get(item.tiedTo!.skillId!) ?? item.tiedTo!.skillId!]),
    ).entries(),
  );

  const filtered = items.filter((item) => {
    if (typeFilter !== "all" && item.type !== typeFilter) return false;
    if (skillFilter !== "all" && item.tiedTo?.skillId !== skillFilter) return false;
    return true;
  });

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-bold text-text">Timeline</h2>

      <div className="flex gap-2 flex-wrap">
        {FILTERS.map((filter) => (
          <button
            key={filter}
            type="button"
            onClick={() => setTypeFilter(filter)}
            className={`text-xs font-semibold rounded-full px-3 py-1 border transition-colors duration-150 min-h-[28px] ${
              typeFilter === filter
                ? "border-accent text-accent"
                : "border-border text-text-secondary hover:border-text-secondary"
            }`}
          >
            {FILTER_LABELS[filter]}
          </button>
        ))}
      </div>

      {skillsWithRatings.length > 0 && (
        <select
          value={skillFilter}
          onChange={(event) => setSkillFilter(event.target.value)}
          className="self-start text-xs border border-border rounded-lg px-2 py-1 bg-background text-text focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
          aria-label="Filter by skill"
        >
          <option value="all">All skills</option>
          {skillsWithRatings.map(([skillId, skillName]) => (
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
                  {FILTER_LABELS[item.type]}
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
                  <DeleteButton
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
