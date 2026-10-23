"use client";

import { useActionState, useRef, useState } from "react";
import { type CoachSwimmerDetail, type EvaluationDraft, type GolfScoreTrend, type League, type CategoriesResponse, type SwimmerSkillsResponse, type StartGradeResult, type TimelineResponse, type MeetSwimResponse, type PersonalBest, type MeetResponse, VALID_EVENTS, SCREEN_NAMES } from "@swim-app/shared";

import AddNoteForm from "@/components/AddNoteForm";
import ConfirmDialog from "@/components/ConfirmDialog";
import GolfScoreTrends from "./GolfScoreTrends";
import HidePublicButton from "./HidePublicButton";
import SwimmerSkillsHistory from "./SwimmerSkillsHistory";
import SwimmerTimeline from "./SwimmerTimeline";
import { addSwimForSwimmer, editSwimForSwimmer, deleteSwimForSwimmer } from "./actions";
import type { AddSwimState, EditSwimState, DeleteSwimState } from "./actions";

interface CoachSwimmerDetailContentProps {
  swimmer: CoachSwimmerDetail;
  grades: SwimmerSkillsResponse["grades"];
  startGrades: SwimmerSkillsResponse["startGrades"];
  coachingPriorities: SwimmerSkillsResponse["coachingPriorities"];
  categories: CategoriesResponse;
  timelineItems: TimelineResponse;
  swims: MeetSwimResponse[];
  personalBests: PersonalBest[];
  meets: MeetResponse[];
  drafts: EvaluationDraft[];
  golfScoreTrends: GolfScoreTrend[];
}

const LEAGUE_LABELS: Record<League, string> = {
  club: "Club",
  summer_league: "Summer League",
};

const STROKE_SHORT: Record<string, string> = {
  free: "Free",
  back: "Back",
  breast: "Breast",
  fly: "Fly",
  im: "IM",
};

const COURSE_LABELS: Record<string, string> = {
  scy: "SCY",
  scm: "SCM",
  lcm: "LCM",
};

function gradeDisplay(grade: number | "not_legal" | "no_concept"): string {
  if (grade === "not_legal") return "DQ";
  if (grade === "no_concept") return "NC";
  return String(grade);
}

function formatStartGrade(result: StartGradeResult, slugToName: Map<string, string>): string {
  if (result.status === "not_legal") return "DQ";
  if (result.status === "no_concept") return "NC";
  if (result.status === "graded") return String(result.grade);
  if (result.missing.length === 0) return "In progress";
  const names = result.missing.slice(0, 2).map((slug) => slugToName.get(slug) ?? slug).join(", ");
  return `In progress — needs ${names}`;
}

// ── Times sub-components ──────────────────────────────────────────────────────

interface AddSwimFormProps {
  swimmerId: string;
  meets: MeetResponse[];
  onSuccess: () => void;
}

function AddSwimForm({ swimmerId, meets, onSuccess }: AddSwimFormProps) {
  const [selectedStroke, setSelectedStroke] = useState<string>("free");
  const [state, action, isPending] = useActionState<AddSwimState, FormData>(
    addSwimForSwimmer.bind(null, swimmerId),
    { status: "idle" },
  );

  if (state.status === "success") {
    onSuccess();
  }

  const distances = VALID_EVENTS[selectedStroke as keyof typeof VALID_EVENTS] ?? [];

  return (
    <form action={action} className="flex flex-col gap-3 p-4 rounded-lg border border-border bg-surface-soft">
      <div className="flex gap-3 flex-wrap">
        <div className="flex flex-col gap-1 flex-1 min-w-[120px]">
          <label htmlFor="add-stroke" className="text-xs font-semibold text-text-secondary">Stroke</label>
          <select
            id="add-stroke"
            name="eventStroke"
            required
            value={selectedStroke}
            onChange={(event) => setSelectedStroke(event.target.value)}
            className="h-10 px-2 rounded-lg border border-border bg-background text-text text-sm focus:outline focus:outline-2 focus:outline-focus-ring"
          >
            {Object.entries(STROKE_SHORT).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1 flex-1 min-w-[100px]">
          <label htmlFor="add-distance" className="text-xs font-semibold text-text-secondary">Distance</label>
          <select
            id="add-distance"
            name="eventDistance"
            required
            className="h-10 px-2 rounded-lg border border-border bg-background text-text text-sm focus:outline focus:outline-2 focus:outline-focus-ring"
          >
            {distances.map((dist) => (
              <option key={dist} value={dist}>{dist}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1 flex-1 min-w-[100px]">
          <label htmlFor="add-course" className="text-xs font-semibold text-text-secondary">Course</label>
          <select
            id="add-course"
            name="course"
            required
            className="h-10 px-2 rounded-lg border border-border bg-background text-text text-sm focus:outline focus:outline-2 focus:outline-focus-ring"
          >
            <option value="scy">SCY</option>
            <option value="scm">SCM</option>
            <option value="lcm">LCM</option>
          </select>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="flex flex-col gap-1 flex-1 min-w-[120px]">
          <label htmlFor="add-time" className="text-xs font-semibold text-text-secondary">Time</label>
          <input
            id="add-time"
            name="timeString"
            type="text"
            required
            placeholder="e.g. 1:02.34"
            inputMode="decimal"
            className="h-10 px-2 rounded-lg border border-border bg-background text-text text-sm tabular-nums focus:outline focus:outline-2 focus:outline-focus-ring"
          />
        </div>

        <div className="flex flex-col gap-1 flex-1 min-w-[140px]">
          <label htmlFor="add-date" className="text-xs font-semibold text-text-secondary">Date</label>
          <input
            id="add-date"
            name="swumOn"
            type="date"
            required
            className="h-10 px-2 rounded-lg border border-border bg-background text-text text-sm focus:outline focus:outline-2 focus:outline-focus-ring"
          />
        </div>

        {meets.length > 0 && (
          <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
            <label htmlFor="add-meet" className="text-xs font-semibold text-text-secondary">Meet (optional)</label>
            <select
              id="add-meet"
              name="meetId"
              className="h-10 px-2 rounded-lg border border-border bg-background text-text text-sm focus:outline focus:outline-2 focus:outline-focus-ring"
            >
              <option value="">Practice</option>
              {meets.map((meet) => (
                <option key={meet.id} value={meet.id}>{meet.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {state.status === "error" && (
        <p role="alert" className="text-xs text-danger">{state.message}</p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center justify-center px-4 h-9 font-bold text-xs rounded-button disabled:opacity-60"
          style={{ backgroundColor: "var(--color-button-primary-background)", color: "var(--color-button-primary-text)" }}
        >
          {isPending ? "Saving…" : "Save time"}
        </button>
        <button
          type="button"
          onClick={onSuccess}
          className="inline-flex items-center justify-center px-4 h-9 font-semibold text-xs rounded-button border"
          style={{ borderColor: "var(--color-button-outline)", color: "var(--color-button-outline)" }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

interface AddPracticeSwimFormProps {
  swimmerId: string;
  onSuccess: () => void;
}

function AddPracticeSwimForm({ swimmerId, onSuccess }: AddPracticeSwimFormProps) {
  const [selectedStroke, setSelectedStroke] = useState<string>("free");
  const [state, action, isPending] = useActionState<AddSwimState, FormData>(
    addSwimForSwimmer.bind(null, swimmerId),
    { status: "idle" },
  );

  if (state.status === "success") {
    onSuccess();
  }

  const distances = VALID_EVENTS[selectedStroke as keyof typeof VALID_EVENTS] ?? [];

  return (
    <form action={action} className="flex flex-col gap-3 p-4 rounded-lg border border-border bg-surface-soft">
      <div className="flex gap-3 flex-wrap">
        <div className="flex flex-col gap-1 flex-1 min-w-[120px]">
          <label htmlFor="practice-stroke" className="text-xs font-semibold text-text-secondary">Stroke</label>
          <select
            id="practice-stroke"
            name="eventStroke"
            required
            value={selectedStroke}
            onChange={(event) => setSelectedStroke(event.target.value)}
            className="h-10 px-2 rounded-lg border border-border bg-background text-text text-sm focus:outline focus:outline-2 focus:outline-focus-ring"
          >
            {Object.entries(STROKE_SHORT).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1 flex-1 min-w-[100px]">
          <label htmlFor="practice-distance" className="text-xs font-semibold text-text-secondary">Distance</label>
          <select
            id="practice-distance"
            name="eventDistance"
            required
            className="h-10 px-2 rounded-lg border border-border bg-background text-text text-sm focus:outline focus:outline-2 focus:outline-focus-ring"
          >
            {distances.map((dist) => (
              <option key={dist} value={dist}>{dist}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1 flex-1 min-w-[100px]">
          <label htmlFor="practice-course" className="text-xs font-semibold text-text-secondary">Course</label>
          <select
            id="practice-course"
            name="course"
            required
            className="h-10 px-2 rounded-lg border border-border bg-background text-text text-sm focus:outline focus:outline-2 focus:outline-focus-ring"
          >
            <option value="scy">SCY</option>
            <option value="scm">SCM</option>
            <option value="lcm">LCM</option>
          </select>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="flex flex-col gap-1 flex-1 min-w-[120px]">
          <label htmlFor="practice-time" className="text-xs font-semibold text-text-secondary">Time</label>
          <input
            id="practice-time"
            name="timeString"
            type="text"
            required
            placeholder="e.g. 1:02.34"
            inputMode="decimal"
            className="h-10 px-2 rounded-lg border border-border bg-background text-text text-sm tabular-nums focus:outline focus:outline-2 focus:outline-focus-ring"
          />
        </div>

        <div className="flex flex-col gap-1 flex-1 min-w-[140px]">
          <label htmlFor="practice-date" className="text-xs font-semibold text-text-secondary">Date</label>
          <input
            id="practice-date"
            name="swumOn"
            type="date"
            required
            className="h-10 px-2 rounded-lg border border-border bg-background text-text text-sm focus:outline focus:outline-2 focus:outline-focus-ring"
          />
        </div>
      </div>

      {state.status === "error" && (
        <p role="alert" className="text-xs text-danger">{state.message}</p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center justify-center px-4 h-9 font-bold text-xs rounded-button disabled:opacity-60"
          style={{ backgroundColor: "var(--color-button-primary-background)", color: "var(--color-button-primary-text)" }}
        >
          {isPending ? "Saving…" : "Save practice time"}
        </button>
        <button
          type="button"
          onClick={onSuccess}
          className="inline-flex items-center justify-center px-4 h-9 font-semibold text-xs rounded-button border"
          style={{ borderColor: "var(--color-button-outline)", color: "var(--color-button-outline)" }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

interface SwimRowProps {
  swim: MeetSwimResponse;
  swimmerId: string;
  isPB: boolean;
}

function SwimRow({ swim, swimmerId, isPB }: SwimRowProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [editing, setEditing] = useState(false);

  const [deleteState, deleteAction, isDeleting] = useActionState<DeleteSwimState, FormData>(
    deleteSwimForSwimmer.bind(null, swimmerId, swim.id),
    { status: "idle" },
  );
  const [editState, editAction, isEditing] = useActionState<EditSwimState, FormData>(
    editSwimForSwimmer.bind(null, swimmerId, swim.id),
    { status: "idle" },
  );

  if (editState.status === "success" && editing) setEditing(false);

  const eventLabel = `${swim.eventDistance} ${STROKE_SHORT[swim.eventStroke] ?? swim.eventStroke}`;

  return (
    <>
      <li className="flex items-start gap-3 py-3 border-t border-border first:border-t-0">
        <div className="flex flex-col gap-0.5 flex-1 min-w-0 text-sm">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-text">{eventLabel}</span>
            <span className="text-text-secondary">{COURSE_LABELS[swim.course] ?? swim.course}</span>
            <span className="tabular-nums font-semibold text-text" style={{ fontVariantNumeric: "tabular-nums" }}>
              {swim.timeString}
            </span>
            {swim.swimType === "practice" && (
              <span className="text-xs font-semibold text-text-secondary border border-border px-1.5 py-0.5 rounded">
                Practice
              </span>
            )}
            {isPB && swim.swimType !== "practice" && (
              <span className="text-xs font-semibold text-accent-on-section bg-section px-1.5 py-0.5 rounded">
                PB
              </span>
            )}
          </div>
          <p className="text-xs text-text-secondary">
            {swim.swumOn}{swim.meetName ? ` · ${swim.meetName}` : ""}
          </p>

          {editing && (
            <form action={editAction} className="flex flex-col gap-2 mt-2">
              <div className="flex gap-2 flex-wrap">
                <div className="flex flex-col gap-1">
                  <label htmlFor={`edit-time-${swim.id}`} className="text-xs font-semibold text-text-secondary">Time</label>
                  <input
                    id={`edit-time-${swim.id}`}
                    name="timeString"
                    type="text"
                    defaultValue={swim.timeString}
                    placeholder="e.g. 1:02.34"
                    inputMode="decimal"
                    className="h-9 px-2 w-28 rounded-lg border border-border bg-background text-text text-sm tabular-nums focus:outline focus:outline-2 focus:outline-focus-ring"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor={`edit-date-${swim.id}`} className="text-xs font-semibold text-text-secondary">Date</label>
                  <input
                    id={`edit-date-${swim.id}`}
                    name="swumOn"
                    type="date"
                    defaultValue={swim.swumOn}
                    className="h-9 px-2 rounded-lg border border-border bg-background text-text text-sm focus:outline focus:outline-2 focus:outline-focus-ring"
                  />
                </div>
              </div>
              {editState.status === "error" && (
                <p role="alert" className="text-xs text-danger">{editState.message}</p>
              )}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={isEditing}
                  className="inline-flex items-center justify-center px-3 h-8 font-bold text-xs rounded-button disabled:opacity-60"
                  style={{ backgroundColor: "var(--color-button-primary-background)", color: "var(--color-button-primary-text)" }}
                >
                  {isEditing ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="inline-flex items-center justify-center px-3 h-8 font-semibold text-xs rounded-button border"
                  style={{ borderColor: "var(--color-button-outline)", color: "var(--color-button-outline)" }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>

        {!editing && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs font-semibold text-text-secondary hover:text-text min-h-[44px] px-2"
            >
              Edit
            </button>
            <form id={`delete-swim-${swim.id}`} action={deleteAction} className="hidden" />
            <button
              type="button"
              onClick={() => dialogRef.current?.showModal()}
              className="text-xs font-semibold text-danger hover:opacity-80 min-h-[44px] px-2"
            >
              Delete
            </button>
          </div>
        )}
      </li>

      <ConfirmDialog
        dialogRef={dialogRef}
        title="Delete this swim?"
        description={`${eventLabel} — ${swim.timeString} on ${swim.swumOn} will be permanently removed.`}
        formId={`delete-swim-${swim.id}`}
        confirmLabel="Delete"
        confirmDanger
        isPending={isDeleting}
        {...(deleteState.status === "error" && { errorMessage: deleteState.message })}
        onCancel={() => dialogRef.current?.close()}
      />
    </>
  );
}

interface SwimmerTimesSectionProps {
  swimmerId: string;
  swims: MeetSwimResponse[];
  personalBests: PersonalBest[];
  meets: MeetResponse[];
}

function SwimmerTimesSection({ swimmerId, swims, personalBests, meets }: SwimmerTimesSectionProps) {
  const [showMeetForm, setShowMeetForm] = useState(false);
  const [showPracticeForm, setShowPracticeForm] = useState(false);
  const pbSet = new Set(personalBests.map((pb) => pb.swimId));

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-bold text-text">Times</h2>
        {!showMeetForm && !showPracticeForm && (
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setShowMeetForm(true)}
              className="text-xs font-semibold text-accent hover:opacity-80 min-h-[44px] px-2"
            >
              + Add meet time
            </button>
            <button
              type="button"
              onClick={() => setShowPracticeForm(true)}
              className="text-xs font-semibold text-text-secondary hover:text-text min-h-[44px] px-2"
            >
              + Add practice swim
            </button>
          </div>
        )}
      </div>

      {showMeetForm && (
        <AddSwimForm swimmerId={swimmerId} meets={meets} onSuccess={() => setShowMeetForm(false)} />
      )}

      {showPracticeForm && (
        <AddPracticeSwimForm swimmerId={swimmerId} onSuccess={() => setShowPracticeForm(false)} />
      )}

      {personalBests.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-text-secondary">Personal bests</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left font-semibold text-text-secondary pb-1 pr-4 text-xs">Event</th>
                  <th className="text-left font-semibold text-text-secondary pb-1 pr-4 text-xs">Course</th>
                  <th className="text-right font-semibold text-text-secondary pb-1 text-xs">Time</th>
                </tr>
              </thead>
              <tbody>
                {personalBests.map((pb) => (
                  <tr key={`${pb.eventDistance}-${pb.eventStroke}-${pb.course}`} className="border-t border-border">
                    <td className="py-2 pr-4 font-semibold text-text">
                      {pb.eventDistance} {STROKE_SHORT[pb.eventStroke] ?? pb.eventStroke}
                    </td>
                    <td className="py-2 pr-4 text-text-secondary">
                      {COURSE_LABELS[pb.course] ?? pb.course}
                    </td>
                    <td className="py-2 text-right tabular-nums font-semibold text-accent" style={{ fontVariantNumeric: "tabular-nums" }}>
                      {pb.timeString}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {swims.length === 0 ? (
        !showMeetForm && !showPracticeForm && <p className="text-sm text-text-secondary">No times recorded yet.</p>
      ) : (
        <ul className="flex flex-col">
          {swims.map((swim) => (
            <SwimRow
              key={swim.id}
              swim={swim}
              swimmerId={swimmerId}
              isPB={pbSet.has(swim.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CoachSwimmerDetailContent({
  swimmer,
  grades,
  startGrades,
  coachingPriorities,
  categories,
  timelineItems,
  swims,
  personalBests,
  meets,
  drafts,
  golfScoreTrends,
}: CoachSwimmerDetailContentProps) {

  return (
    <div className="flex flex-col flex-1">
      <main className="flex-1 px-page py-16">
        <div className="mx-auto max-w-content flex flex-col gap-8">
          <div>
            <a
              href="/coach/swimmers"
              className="text-sm text-link underline hover:text-link-hover mb-4 inline-block"
            >
              ← All swimmers
            </a>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-heading">
                {swimmer.firstName} {swimmer.lastName}
              </h1>
              {!swimmer.isPublic && (
                <span className="text-xs text-text-secondary border border-border rounded px-2 py-0.5">
                  Hidden from public
                </span>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-3 flex-wrap">
            <a
              href={`/coach/swimmers/${swimmer.id}/evaluate`}
              className="inline-flex items-center justify-center px-5 min-h-[44px] font-bold text-sm rounded-[var(--radius-button)]"
              style={{
                backgroundColor: "var(--color-button-primary-background)",
                color: "var(--color-button-primary-text)",
              }}
            >
              Evaluate {swimmer.firstName}
            </a>
            <a
              href={`/coach/book?household=${swimmer.householdId}&swimmer=${swimmer.id}`}
              className="inline-flex items-center justify-center px-5 min-h-[44px] font-bold text-sm rounded-[var(--radius-button)] border"
              style={{
                borderColor: "var(--color-button-outline)",
                color: "var(--color-button-outline)",
              }}
            >
              Book lesson
            </a>
            <a
              href={`/coach/swimmers/${swimmer.id}/progress`}
              className="inline-flex items-center justify-center px-5 min-h-[44px] font-bold text-sm rounded-[var(--radius-button)] border"
              style={{
                borderColor: "var(--color-button-outline)",
                color: "var(--color-button-outline)",
              }}
            >
              View progress
            </a>
          </div>

          {drafts.length > 0 && (
            <div className="flex flex-col gap-2 w-full">
              {drafts.map((draft) => (
                <a
                  key={draft.id}
                  href={`/coach/swimmers/${swimmer.id}/evaluate?resumeDraft=${draft.id}`}
                  className="inline-flex items-center justify-center px-5 min-h-[44px] font-semibold text-sm rounded-[var(--radius-button)] border border-border text-text"
                >
                  Resume draft — {SCREEN_NAMES[draft.screenSlug] ?? draft.screenSlug}
                </a>
              ))}
            </div>
          )}

          <section className="flex flex-col gap-2">
            <h2 className="font-bold text-text">Details</h2>
            <dl className="flex flex-col gap-1 text-sm">
              <div className="flex gap-2">
                <dt className="text-text-secondary w-24 shrink-0">Age</dt>
                <dd className="text-text">{swimmer.age}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-text-secondary w-24 shrink-0">Sex</dt>
                <dd className="text-text capitalize">{swimmer.sex}</dd>
              </div>
            </dl>
          </section>

          {categories.length > 0 && (() => {
            const categoriesWithData = categories.filter((cat) => {
              const startParentIds = new Set(
                cat.skills.filter((s) => s.parentSkillId !== null).map((s) => s.parentSkillId!),
              );
              return cat.skills.some((skill) => {
                if (startParentIds.has(skill.id)) return startGrades[skill.slug] !== undefined;
                if (skill.ratedPerSide) {
                  return grades[`${skill.slug}:left`] !== undefined || grades[`${skill.slug}:right`] !== undefined;
                }
                return grades[skill.slug] !== undefined;
              });
            });
            if (categoriesWithData.length === 0) return null;
            return (
              <section className="flex flex-col gap-3">
                <h2 className="font-bold text-text">Current Levels</h2>
                {categoriesWithData.map((category) => {
                  const startParentIds = new Set(
                    category.skills.filter((s) => s.parentSkillId !== null).map((s) => s.parentSkillId!),
                  );
                  const slugToNameMap = new Map(category.skills.map((s) => [s.slug, s.name]));
                  const startParents = category.skills.filter(
                    (skill) => startParentIds.has(skill.id) && startGrades[skill.slug] !== undefined,
                  );
                  const ratedSkills = category.skills.filter((skill) => {
                    if (startParentIds.has(skill.id)) return false;
                    if (skill.ratedPerSide) {
                      return grades[`${skill.slug}:left`] !== undefined || grades[`${skill.slug}:right`] !== undefined;
                    }
                    return grades[skill.slug] !== undefined;
                  });
                  return (
                    <div key={category.id} className="flex flex-col gap-1">
                      <p className="text-xs font-semibold text-text-secondary">{category.name}</p>
                      <dl className="flex flex-col gap-1">
                        {startParents.map((skill) => (
                          <div key={skill.id} className="flex gap-2 text-sm">
                            <dt className="text-text-secondary w-48 shrink-0">{skill.name}</dt>
                            <dd className="font-semibold text-text">
                              {formatStartGrade(startGrades[skill.slug]!, slugToNameMap)}
                            </dd>
                          </div>
                        ))}
                        {ratedSkills.map((skill) => {
                          if (skill.ratedPerSide) {
                            return (
                              <div key={skill.id} className="flex gap-2 text-sm">
                                <dt className="text-text-secondary w-48 shrink-0">{skill.name}</dt>
                                <dd className="text-text flex gap-2">
                                  {grades[`${skill.slug}:left`] !== undefined && (
                                    <span>L: <span className="font-semibold">{gradeDisplay(grades[`${skill.slug}:left`]!)}</span></span>
                                  )}
                                  {grades[`${skill.slug}:right`] !== undefined && (
                                    <span>R: <span className="font-semibold">{gradeDisplay(grades[`${skill.slug}:right`]!)}</span></span>
                                  )}
                                </dd>
                              </div>
                            );
                          }
                          const grade = grades[skill.slug];
                          if (grade === undefined) return null;
                          return (
                            <div key={skill.id} className="flex gap-2 text-sm">
                              <dt className="text-text-secondary w-48 shrink-0">{skill.name}</dt>
                              <dd className="font-semibold text-text">{gradeDisplay(grade)}</dd>
                            </div>
                          );
                        })}
                      </dl>
                    </div>
                  );
                })}
                {coachingPriorities.length > 0 && (() => {
                  const slugToName = new Map<string, string>();
                  for (const cat of categories) {
                    for (const skill of cat.skills) {
                      slugToName.set(skill.slug, skill.name);
                    }
                  }
                  const suggestions = coachingPriorities
                    .map((priority) => {
                      const lastSlug = priority.chain[priority.chain.length - 1]?.slug;
                      if (!lastSlug) return null;
                      return slugToName.get(lastSlug) ?? lastSlug;
                    })
                    .filter((name): name is string => name !== null);
                  const uniqueSuggestions = [...new Set(suggestions)].slice(0, 3);
                  if (uniqueSuggestions.length === 0) return null;
                  return (
                    <div className="flex flex-col gap-1">
                      <p className="text-xs font-semibold text-text-secondary">Coaching priorities</p>
                      <ul className="flex flex-col gap-0.5 text-sm">
                        {uniqueSuggestions.map((name) => (
                          <li key={name} className="text-text">Focus on <span className="font-semibold">{name}</span></li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}
              </section>
            );
          })()}

          {swimmer.currentLeagues.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="font-bold text-text">Leagues</h2>
              <div className="flex gap-2 flex-wrap">
                {swimmer.currentLeagues.map((league) => (
                  <span
                    key={league}
                    className="text-xs font-semibold text-accent border border-accent rounded px-2 py-0.5"
                  >
                    {LEAGUE_LABELS[league]}
                  </span>
                ))}
              </div>
            </section>
          )}

          {swimmer.clubs.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="font-bold text-text">Clubs</h2>
              <ul className="flex flex-col gap-1 text-sm text-text">
                {swimmer.clubs.map((club) => (
                  <li key={club.id}>
                    {club.otherClubName !== null ? club.otherClubName : club.clubId}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <SwimmerTimesSection
            swimmerId={swimmer.id}
            swims={swims}
            personalBests={personalBests}
            meets={meets}
          />

          <GolfScoreTrends trends={golfScoreTrends} />

          <SwimmerSkillsHistory
            swimmerId={swimmer.id}
            categories={categories}
            grades={grades}
          />

          <SwimmerTimeline
            swimmerId={swimmer.id}
            items={timelineItems}
            categories={categories}
          />

          <section className="flex flex-col gap-3">
            <h2 className="font-bold text-text">Add note</h2>
            <AddNoteForm swimmerId={swimmer.id} categories={categories} />
          </section>

          {swimmer.members.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="font-bold text-text">Household</h2>
              <ul className="flex flex-col gap-3">
                {swimmer.members.map((guardian) => (
                  <li key={`${guardian.fullName ?? ""}\u001f${guardian.phone ?? ""}`} className="flex flex-col gap-1 text-sm">
                    <p className="text-text font-semibold">{guardian.fullName ?? "—"}</p>
                    {guardian.phone !== null && (
                      <a
                        href={`tel:${guardian.phone}`}
                        className="text-link underline hover:text-link-hover"
                      >
                        {guardian.phone}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {swimmer.isPublic && (
            <section>
              <HidePublicButton swimmerId={swimmer.id} firstName={swimmer.firstName} />
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
