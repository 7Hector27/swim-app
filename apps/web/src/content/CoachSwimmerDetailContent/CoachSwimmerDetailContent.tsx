"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import {
  type CoachSwimmerDetail,
  type EvaluationDraft,
  type GolfScoreTrend,
  type League,
  type CategoriesResponse,
  type SwimmerSkillsResponse,
  type StartGradeResult,
  type TimelineResponse,
  type MeetSwimResponse,
  type PersonalBest,
  type MeetResponse,
  SCREEN_NAMES,
} from "@swim-app/shared";

import AddNoteForm from "@/components/AddNoteForm";
import ConfirmDialog from "@/components/ConfirmDialog";
import AddSwimForm from "./AddSwimForm";
import GolfScoreTrends from "./GolfScoreTrends";
import HidePublicButton from "./HidePublicButton";
import SwimmerSkillsHistory from "./SwimmerSkillsHistory";
import SwimTimeInput from "./SwimTimeInput";
import SwimmerTimeline from "./SwimmerTimeline";
import { editSwimForSwimmer, deleteSwimForSwimmer } from "./actions";
import type { EditSwimState, DeleteSwimState } from "./actions";

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
  if (grade === "not_legal") return "Not legal";
  if (grade === "no_concept") return "No concept";
  return String(grade);
}

function formatStartGrade(result: StartGradeResult, slugToName: Map<string, string>): string {
  if (result.status === "not_legal") return "Not legal";
  if (result.status === "no_concept") return "No concept";
  if (result.status === "graded") return String(result.grade);
  if (result.missing.length === 0) return "In progress";
  const names = result.missing.slice(0, 2).map((slug) => slugToName.get(slug) ?? slug).join(", ");
  return `In progress · needs ${names}`;
}

// ── Date helpers (LA timezone, same as the rest of the project) ────────────

const LA = "America/Los_Angeles";

function formatRelativeDay(iso: string | null): string {
  if (!iso) return "Never";
  const date = new Date(iso);
  const now = new Date();
  const dayMs = 86_400_000;
  const start = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((start(now) - start(date)) / dayMs);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff > 1 && diff < 7) return `${diff} days ago`;
  if (diff >= 7 && diff < 14) return "Last week";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: LA,
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatShortDate(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: LA,
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

// ── Times sub-components ──────────────────────────────────────────────────────

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
            <span
              className="tabular-nums font-semibold text-text"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
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
            {swim.swumOn}
            {swim.meetName ? ` · ${swim.meetName}` : ""}
          </p>

          {editing && (
            <form action={editAction} className="flex flex-col gap-2 mt-2">
              <div className="flex gap-2 flex-wrap">
                <SwimTimeInput name="timeString" initialTime={swim.timeString} />
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor={`edit-date-${swim.id}`}
                    className="text-xs font-semibold text-text-secondary"
                  >
                    Date
                  </label>
                  <input
                    id={`edit-date-${swim.id}`}
                    name="swumOn"
                    type="date"
                    defaultValue={swim.swumOn}
                    className="h-11 px-3 rounded-lg border border-border bg-background text-text text-base focus:outline focus:outline-2 focus:outline-focus-ring"
                  />
                </div>
              </div>
              {editState.status === "error" && (
                <p role="alert" className="text-xs text-danger">
                  {editState.message}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={isEditing}
                  className="inline-flex items-center justify-center px-3 h-9 font-bold text-xs rounded-button disabled:opacity-60 bg-accent text-on-accent transition-transform duration-150 active:scale-[0.97]"
                >
                  {isEditing ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="inline-flex items-center justify-center px-3 h-9 font-semibold text-xs rounded-button border border-border text-text"
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
        description={`${eventLabel} · ${swim.timeString} on ${swim.swumOn} will be permanently removed.`}
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

// Section that renders Times tab contents. formMode is lifted to the parent
// so the header "Add time" button can open the form from outside the tab.

interface TimesPaneProps {
  swimmerId: string;
  swimmerName: string;
  swims: MeetSwimResponse[];
  personalBests: PersonalBest[];
  meets: MeetResponse[];
  formMode: "closed" | "meet" | "practice";
  onFormModeChange: (mode: "closed" | "meet" | "practice") => void;
}

function TimesPane({
  swimmerId,
  swimmerName,
  swims,
  personalBests,
  meets,
  formMode,
  onFormModeChange,
}: TimesPaneProps) {
  const pbSet = new Set(personalBests.map((pb) => pb.swimId));
  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-bold text-text">Times</h2>
        {formMode === "closed" && (
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => onFormModeChange("meet")}
              className="text-xs font-semibold text-accent hover:opacity-80 min-h-[44px] px-2"
            >
              + Add meet time
            </button>
            <button
              type="button"
              onClick={() => onFormModeChange("practice")}
              className="text-xs font-semibold text-text-secondary hover:text-text min-h-[44px] px-2"
            >
              + Add practice swim
            </button>
          </div>
        )}
      </div>

      {formMode === "meet" && (
        <AddSwimForm
          swimmerId={swimmerId}
          swimmerName={swimmerName}
          meets={meets}
          personalBests={personalBests}
          onSuccess={() => onFormModeChange("closed")}
        />
      )}

      {formMode === "practice" && (
        <AddSwimForm
          swimmerId={swimmerId}
          swimmerName={swimmerName}
          personalBests={personalBests}
          onSuccess={() => onFormModeChange("closed")}
        />
      )}

      {personalBests.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
            Personal bests
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left font-semibold text-text-secondary pb-1 pr-4 text-xs">
                    Event
                  </th>
                  <th className="text-left font-semibold text-text-secondary pb-1 pr-4 text-xs">
                    Course
                  </th>
                  <th className="text-right font-semibold text-text-secondary pb-1 text-xs">
                    Time
                  </th>
                </tr>
              </thead>
              <tbody>
                {personalBests.map((pb) => (
                  <tr
                    key={`${pb.eventDistance}-${pb.eventStroke}-${pb.course}`}
                    className="border-t border-border"
                  >
                    <td className="py-2 pr-4 font-semibold text-text">
                      {pb.eventDistance} {STROKE_SHORT[pb.eventStroke] ?? pb.eventStroke}
                    </td>
                    <td className="py-2 pr-4 text-text-secondary">
                      {COURSE_LABELS[pb.course] ?? pb.course}
                    </td>
                    <td
                      className="py-2 text-right tabular-nums font-semibold text-accent"
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
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
        formMode === "closed" && (
          <p className="text-sm text-text-secondary">No times recorded yet.</p>
        )
      ) : (
        <ul className="flex flex-col">
          {swims.map((swim) => (
            <SwimRow key={swim.id} swim={swim} swimmerId={swimmerId} isPB={pbSet.has(swim.id)} />
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type TabId = "feed" | "times" | "levels";

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
  const [activeTab, setActiveTab] = useState<TabId>("feed");
  const [timesFormMode, setTimesFormMode] = useState<"closed" | "meet" | "practice">("closed");

  // ── Derived "at a glance" values ─────────────────────────────────────────
  //
  // Current focus: prefer the latest coach-authored priority note (freshest
  // narrative), falling back to the algorithmic focus-skill name derived
  // from coachingPriorities. The latter matches what the old "Focus on …"
  // list surfaced.
  const slugToName = useMemo(() => {
    const map = new Map<string, string>();
    for (const category of categories) {
      for (const skill of category.skills) {
        map.set(skill.slug, skill.name);
      }
    }
    return map;
  }, [categories]);

  const latestPriorityNote = timelineItems.find((item) => item.type === "coaching_priority");

  const focusSkillNames = useMemo(() => {
    const names: string[] = [];
    const seen = new Set<string>();
    for (const priority of coachingPriorities) {
      const lastSlug = priority.chain[priority.chain.length - 1]?.slug;
      if (!lastSlug) continue;
      const name = slugToName.get(lastSlug) ?? lastSlug;
      if (seen.has(name)) continue;
      seen.add(name);
      names.push(name);
      if (names.length >= 3) break;
    }
    return names;
  }, [coachingPriorities, slugToName]);

  // Last evaluated: timeline items of type "coaching_priority" or
  // "rating_note" are only produced inside an evaluation session, so the
  // first of either marks the most recent eval. See GAP in /dev/ preview —
  // a dedicated `latestSessionDate` would be cheaper, but this works today.
  const lastEvaluatedISO =
    timelineItems.find(
      (item) => item.type === "coaching_priority" || item.type === "rating_note",
    )?.createdAt ?? null;

  // Recent evaluations: timeline is flat, so we group by tiedTo.sessionId
  // and take the newest createdAt per session. This gives Jason a tidy
  // "Oct 25 · 11 ratings" row even without a session-container endpoint.
  const recentEvaluations = useMemo(() => {
    const bySession = new Map<
      string,
      { sessionId: string; createdAt: string; ratingCount: number; priorityBody: string | null }
    >();
    for (const item of timelineItems) {
      const sessionId = item.tiedTo?.sessionId;
      if (!sessionId) continue;
      if (item.type !== "rating_note" && item.type !== "coaching_priority") continue;
      const existing = bySession.get(sessionId);
      if (!existing) {
        bySession.set(sessionId, {
          sessionId,
          createdAt: item.createdAt,
          ratingCount: item.type === "rating_note" ? 1 : 0,
          priorityBody: item.type === "coaching_priority" ? item.body : null,
        });
      } else {
        if (item.type === "rating_note") existing.ratingCount += 1;
        if (item.type === "coaching_priority" && !existing.priorityBody) {
          existing.priorityBody = item.body;
        }
        if (new Date(item.createdAt) > new Date(existing.createdAt)) {
          existing.createdAt = item.createdAt;
        }
      }
    }
    return Array.from(bySession.values())
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 5);
  }, [timelineItems]);

  // The primary club name shown next to age. Mirrors the resolver used by
  // the roster: otherClubName takes precedence, then resolved clubName.
  const primaryClub =
    swimmer.clubs[0]?.otherClubName ?? swimmer.clubs[0]?.clubName ?? null;

  function handleAddTimeFromHeader(): void {
    setActiveTab("times");
    setTimesFormMode("meet");
  }

  return (
    <div className="flex flex-col flex-1">
      <main className="flex-1 px-page py-8 tablet:py-10">
        <div className="mx-auto max-w-content">
          <a
            href="/coach/swimmers"
            className="text-sm text-link underline hover:text-link-hover mb-4 inline-block"
          >
            ← All swimmers
          </a>

          {/*
            Desktop (1248+): sticky left rail + content.
            Phone / tablet: single column, header card on top, stats strip,
            then tabs. The rail content (family, drafts, hide-public) moves
            below the tabs on narrow widths so nothing competes with the
            tabbed content for the top of the screen.
          */}
          <div className="flex flex-col gap-6 desktop:grid desktop:grid-cols-[280px_1fr] desktop:gap-8 desktop:items-start">
            {/* ── Left rail ──────────────────────────────────────────── */}
            <aside className="desktop:sticky desktop:top-6 flex flex-col gap-4">
              <section
                aria-label="Swimmer summary"
                className="rounded-lg border border-border bg-background p-5 flex flex-col gap-4"
              >
                <div className="flex items-start gap-4">
                  <InitialsAvatar firstName={swimmer.firstName} lastName={swimmer.lastName} />
                  <div className="min-w-0 flex-1">
                    <h1 className="font-heading text-2xl text-heading leading-tight">
                      {swimmer.firstName} {swimmer.lastName}
                    </h1>
                    <p className="text-sm text-text-secondary mt-1">
                      Age {swimmer.age}
                      {primaryClub ? ` · ${primaryClub}` : ""}
                    </p>
                    <div className="mt-2 flex gap-1 flex-wrap">
                      {swimmer.currentLeagues.map((league) => (
                        <span
                          key={league}
                          className="inline-flex items-center h-6 px-2 rounded-full border border-border bg-background text-xs font-semibold text-text-secondary"
                        >
                          {LEAGUE_LABELS[league]}
                        </span>
                      ))}
                      {!swimmer.isPublic && (
                        <span className="inline-flex items-center h-6 px-2 rounded-full border border-border bg-background text-xs font-semibold text-text-secondary">
                          Hidden
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/*
                  Header actions. On phone they wrap under the name instead
                  of squeezing; min-height stays at least 44px. Evaluate is
                  the primary CTA; Book lesson and Add time are secondary.
                  View progress keeps the existing destination accessible
                  as a tertiary text link beneath.
                */}
                <div className="flex gap-2 flex-wrap">
                  <a
                    href={`/coach/swimmers/${swimmer.id}/evaluate`}
                    className="inline-flex items-center justify-center h-11 px-4 rounded-full font-bold text-sm bg-accent text-on-accent transition-transform duration-150 active:scale-[0.97] focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-focus-ring"
                  >
                    Evaluate {swimmer.firstName}
                  </a>
                  <a
                    href={`/coach/book?household=${swimmer.householdId}&swimmer=${swimmer.id}`}
                    className="inline-flex items-center justify-center h-11 px-4 rounded-full font-semibold text-sm border border-border text-text bg-background transition-transform duration-150 active:scale-[0.97] focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-focus-ring"
                  >
                    Book lesson
                  </a>
                  <button
                    type="button"
                    onClick={handleAddTimeFromHeader}
                    className="inline-flex items-center justify-center h-11 px-4 rounded-full font-semibold text-sm border border-border text-text bg-background transition-transform duration-150 active:scale-[0.97] focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-focus-ring"
                  >
                    Add time
                  </button>
                </div>

                <a
                  href={`/coach/swimmers/${swimmer.id}/progress`}
                  className="text-sm text-link underline underline-offset-2 self-start"
                >
                  View progress
                </a>
              </section>

              {drafts.length > 0 && (
                <section
                  aria-label="Drafts"
                  className="rounded-lg border border-accent bg-background p-4 flex flex-col gap-2"
                >
                  <p className="text-[10px] font-bold uppercase tracking-wider text-accent">
                    Drafts waiting
                  </p>
                  {drafts.map((draft) => (
                    <a
                      key={draft.id}
                      href={`/coach/swimmers/${swimmer.id}/evaluate?resumeDraft=${draft.id}`}
                      className="inline-flex items-center justify-center min-h-[44px] px-3 rounded-full border border-accent text-accent text-xs font-bold transition-transform duration-150 active:scale-[0.97]"
                    >
                      Resume {SCREEN_NAMES[draft.screenSlug] ?? draft.screenSlug}
                    </a>
                  ))}
                </section>
              )}

              {swimmer.members.length > 0 && (
                <section
                  aria-label="Household"
                  className="rounded-lg border border-border bg-background p-4 flex flex-col gap-2"
                >
                  <h2 className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">
                    Household
                  </h2>
                  <ul className="flex flex-col gap-2">
                    {swimmer.members.map((guardian) => (
                      <li
                        key={`${guardian.fullName ?? ""}\u001f${guardian.phone ?? ""}`}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="text-sm text-text truncate">
                          {guardian.fullName ?? "Unknown"}
                        </span>
                        {guardian.phone !== null && (
                          <a
                            href={`tel:${guardian.phone}`}
                            className="text-sm text-link tabular-nums underline underline-offset-2 shrink-0"
                          >
                            {guardian.phone}
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {swimmer.clubs.length > 0 && (
                <section
                  aria-label="Clubs"
                  className="rounded-lg border border-border bg-background p-4 flex flex-col gap-2"
                >
                  <h2 className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">
                    Clubs
                  </h2>
                  <ul className="flex flex-col gap-1 text-sm text-text">
                    {swimmer.clubs.map((club) => (
                      <li key={club.id}>
                        {club.otherClubName ?? club.clubName ?? "Unknown club"}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {swimmer.isPublic && (
                <section
                  aria-label="Public visibility"
                  className="rounded-lg border border-border bg-background p-4"
                >
                  <HidePublicButton swimmerId={swimmer.id} firstName={swimmer.firstName} />
                </section>
              )}
            </aside>

            {/* ── Content column ─────────────────────────────────────── */}
            <div className="flex flex-col gap-6 min-w-0">
              {/* At-a-glance stats. Three columns on tablet+, stacked on phone. */}
              <section
                aria-label="At a glance"
                className="grid grid-cols-1 tablet:grid-cols-3 gap-3"
              >
                <GlanceTile
                  label="Current focus"
                  primary={focusSkillNames[0] ?? "Not set"}
                  tone={focusSkillNames.length > 0 ? "accent" : "muted"}
                  {...(latestPriorityNote?.body !== undefined && {
                    secondary: latestPriorityNote.body,
                  })}
                />
                <GlanceTile
                  label="Last evaluated"
                  primary={formatRelativeDay(lastEvaluatedISO)}
                  secondary={lastEvaluatedISO ? formatShortDate(lastEvaluatedISO) : "No evaluations yet"}
                />
                <GlanceTile
                  label="Next lesson"
                  primary="Not scheduled"
                  secondary="Tap Book lesson above"
                />
              </section>

              {/* Tabs. Tab list is sticky-free (no sticky header on this page
                  yet) and horizontally scrollable on phone via the shared
                  scrollbar-none utility. */}
              <div className="rounded-lg border border-border bg-background">
                <div
                  role="tablist"
                  aria-label="Swimmer sections"
                  className="flex items-center gap-1 px-3 pt-3 border-b border-border overflow-x-auto scrollbar-none"
                >
                  <Tab active={activeTab === "feed"} onClick={() => setActiveTab("feed")}>
                    Notes &amp; evaluations
                  </Tab>
                  <Tab active={activeTab === "times"} onClick={() => setActiveTab("times")}>
                    Times
                  </Tab>
                  <Tab active={activeTab === "levels"} onClick={() => setActiveTab("levels")}>
                    Current levels
                  </Tab>
                </div>

                <div className="p-5 tablet:p-6">
                  {activeTab === "feed" && (
                    <FeedPane
                      swimmerId={swimmer.id}
                      categories={categories}
                      timelineItems={timelineItems}
                      recentEvaluations={recentEvaluations}
                    />
                  )}
                  {activeTab === "times" && (
                    <TimesPane
                      swimmerId={swimmer.id}
                      swimmerName={swimmer.firstName}
                      swims={swims}
                      personalBests={personalBests}
                      meets={meets}
                      formMode={timesFormMode}
                      onFormModeChange={setTimesFormMode}
                    />
                  )}
                  {activeTab === "levels" && (
                    <LevelsPane
                      swimmer={swimmer}
                      categories={categories}
                      grades={grades}
                      startGrades={startGrades}
                      coachingPriorities={coachingPriorities}
                      golfScoreTrends={golfScoreTrends}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

// ── Supporting sub-components ─────────────────────────────────────────────────

interface InitialsAvatarProps {
  firstName: string;
  lastName: string;
}

function InitialsAvatar({ firstName, lastName }: InitialsAvatarProps) {
  const initials = `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase();
  return (
    <div
      aria-hidden
      className="w-12 h-12 shrink-0 rounded-full bg-surface-soft flex items-center justify-center"
    >
      <span className="font-heading text-lg text-text-secondary select-none">{initials}</span>
    </div>
  );
}

interface GlanceTileProps {
  label: string;
  primary: string;
  secondary?: string;
  tone?: "neutral" | "accent" | "muted";
}

function GlanceTile({ label, primary, secondary, tone = "neutral" }: GlanceTileProps) {
  const border = tone === "accent" ? "border-accent" : "border-border";
  const primaryColor = tone === "accent" ? "text-accent" : tone === "muted" ? "text-text-secondary" : "text-heading";
  return (
    <section className={`rounded-lg border ${border} bg-background p-4 flex flex-col gap-1`}>
      <span className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">
        {label}
      </span>
      <span className={`font-heading text-lg leading-tight ${primaryColor}`}>{primary}</span>
      {secondary && (
        <span className="text-xs text-text-secondary leading-snug line-clamp-2">{secondary}</span>
      )}
    </section>
  );
}

interface TabProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function Tab({ active, onClick, children }: TabProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={[
        "relative px-3 h-11 inline-flex items-center font-semibold text-sm whitespace-nowrap",
        active ? "text-text" : "text-text-secondary",
        "transition-colors duration-150 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-focus-ring",
      ].join(" ")}
    >
      {children}
      {active && (
        <span
          aria-hidden
          className="absolute left-3 right-3 bottom-0 h-[2px] rounded-full bg-accent"
        />
      )}
    </button>
  );
}

// ── Panes ─────────────────────────────────────────────────────────────────────

interface FeedPaneProps {
  swimmerId: string;
  categories: CategoriesResponse;
  timelineItems: TimelineResponse;
  recentEvaluations: Array<{
    sessionId: string;
    createdAt: string;
    ratingCount: number;
    priorityBody: string | null;
  }>;
}

function FeedPane({ swimmerId, categories, timelineItems, recentEvaluations }: FeedPaneProps) {
  return (
    <div className="flex flex-col gap-6">
      {recentEvaluations.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-bold text-sm text-text uppercase tracking-wider">
            Recent evaluations
          </h2>
          <ul className="flex flex-col divide-y divide-border">
            {recentEvaluations.map((session) => (
              <li
                key={session.sessionId}
                className="py-2.5 first:pt-0 last:pb-0 flex flex-col gap-1"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="font-bold text-sm text-text">
                    {formatShortDate(session.createdAt)}
                  </span>
                  <span className="text-xs text-text-secondary tabular-nums">
                    {session.ratingCount === 1
                      ? "1 rating note"
                      : `${session.ratingCount} rating notes`}
                  </span>
                </div>
                {session.priorityBody && (
                  <p className="text-sm text-text-secondary leading-snug">{session.priorityBody}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <SwimmerTimeline swimmerId={swimmerId} items={timelineItems} categories={categories} />

      <section className="flex flex-col gap-3 pt-2 border-t border-border">
        <h2 className="font-bold text-text">Add note</h2>
        <AddNoteForm swimmerId={swimmerId} categories={categories} />
      </section>
    </div>
  );
}

interface LevelsPaneProps {
  swimmer: CoachSwimmerDetail;
  categories: CategoriesResponse;
  grades: SwimmerSkillsResponse["grades"];
  startGrades: SwimmerSkillsResponse["startGrades"];
  coachingPriorities: SwimmerSkillsResponse["coachingPriorities"];
  golfScoreTrends: GolfScoreTrend[];
}

function LevelsPane({
  swimmer,
  categories,
  grades,
  startGrades,
  coachingPriorities,
  golfScoreTrends,
}: LevelsPaneProps) {
  // Mirrors the pre-rewrite "Current Levels" rendering so no coach-visible
  // signal moves between pages.
  const categoriesWithData = categories.filter((cat) => {
    const startParentIds = new Set(
      cat.skills.filter((s) => s.parentSkillId !== null).map((s) => s.parentSkillId!),
    );
    return cat.skills.some((skill) => {
      if (startParentIds.has(skill.id)) return startGrades[skill.slug] !== undefined;
      if (skill.ratedPerSide) {
        return (
          grades[`${skill.slug}:left`] !== undefined ||
          grades[`${skill.slug}:right`] !== undefined
        );
      }
      return grades[skill.slug] !== undefined;
    });
  });

  const slugToName = new Map<string, string>();
  for (const cat of categories) {
    for (const skill of cat.skills) slugToName.set(skill.slug, skill.name);
  }

  const prioritySuggestions = coachingPriorities
    .map((priority) => {
      const lastSlug = priority.chain[priority.chain.length - 1]?.slug;
      if (!lastSlug) return null;
      return slugToName.get(lastSlug) ?? lastSlug;
    })
    .filter((name): name is string => name !== null);
  const uniquePrioritySuggestions = [...new Set(prioritySuggestions)].slice(0, 3);

  return (
    <div className="flex flex-col gap-6">
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

      {categoriesWithData.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-bold text-text">Current Levels</h2>
          {categoriesWithData.map((category) => {
            const startParentIds = new Set(
              category.skills
                .filter((s) => s.parentSkillId !== null)
                .map((s) => s.parentSkillId!),
            );
            const slugToNameMap = new Map(category.skills.map((s) => [s.slug, s.name]));
            const startParents = category.skills.filter(
              (skill) => startParentIds.has(skill.id) && startGrades[skill.slug] !== undefined,
            );
            const ratedSkills = category.skills.filter((skill) => {
              if (startParentIds.has(skill.id)) return false;
              if (skill.ratedPerSide) {
                return (
                  grades[`${skill.slug}:left`] !== undefined ||
                  grades[`${skill.slug}:right`] !== undefined
                );
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
                              <span>
                                L:{" "}
                                <span className="font-semibold">
                                  {gradeDisplay(grades[`${skill.slug}:left`]!)}
                                </span>
                              </span>
                            )}
                            {grades[`${skill.slug}:right`] !== undefined && (
                              <span>
                                R:{" "}
                                <span className="font-semibold">
                                  {gradeDisplay(grades[`${skill.slug}:right`]!)}
                                </span>
                              </span>
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
          {uniquePrioritySuggestions.length > 0 && (
            <div className="flex flex-col gap-1 pt-2">
              <p className="text-xs font-semibold text-text-secondary">Coaching priorities</p>
              <ul className="flex flex-col gap-0.5 text-sm">
                {uniquePrioritySuggestions.map((name) => (
                  <li key={name} className="text-text">
                    Focus on <span className="font-semibold">{name}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <GolfScoreTrends trends={golfScoreTrends} />

      <SwimmerSkillsHistory
        swimmerId={swimmer.id}
        categories={categories}
        grades={grades}
      />
    </div>
  );
}
