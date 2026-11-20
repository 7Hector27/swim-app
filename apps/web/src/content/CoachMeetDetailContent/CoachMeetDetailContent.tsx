"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  BatchRowError,
  CoachSwimmer,
  Course,
  MeetDetailSwimResponse,
  MeetWithSwimsResponse,
  PersonalBest,
  SwimStroke,
  SwimmerBestsRow,
} from "@swim-app/shared";
import {
  deviationFromBest,
  formatSwimTime,
  MAX_SWIM_HUNDREDTHS,
  VALID_EVENTS,
  isValidEvent,
} from "@swim-app/shared";

import EventPicker from "@/components/EventPicker";
import SwimmerSelect from "@/components/SwimmerSelect";
import TimeInput from "@/components/TimeInput";
import {
  deleteSavedSwim,
  patchMeetHeader,
  patchSavedSwim,
  saveBatchForMeet,
} from "./actions";

const COURSE_LABELS: Record<Course, string> = { scy: "SCY", scm: "SCM", lcm: "LCM" };
const STROKE_LABELS: Record<SwimStroke, string> = {
  free: "Free",
  back: "Back",
  breast: "Breast",
  fly: "Fly",
  im: "IM",
};
const DEVIATION_THRESHOLD = 0.2;
const STROKE_ORDER: SwimStroke[] = ["free", "back", "breast", "fly", "im"];

// ── Pending row shape ────────────────────────────────────────────────────────

interface PendingRow {
  // Client-side id so React keys stay stable even if swimmerId/event changes
  // during an edit.
  id: string;
  swimmerId: string;
  eventDistance: number;
  eventStroke: SwimStroke;
  course: Course;
  timeHundredths: number;
  // Per-row server error returned by the batch endpoint. Cleared when the
  // user edits or the whole batch is saved again.
  serverError?: string;
}

interface CoachMeetDetailContentProps {
  meet: MeetWithSwimsResponse;
  swimmers: CoachSwimmer[];
  swimmerBests: SwimmerBestsRow[];
}

function storageKey(meetId: string): string {
  return `axiom-aquatics:meet-pending:${meetId}`;
}

function newRowId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function CoachMeetDetailContent({
  meet,
  swimmers,
  swimmerBests,
}: CoachMeetDetailContentProps) {
  // Pending rows: not yet saved. Persisted to localStorage keyed by meet.
  const [pending, setPending] = useState<PendingRow[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey(meet.id));
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) setPending(parsed as PendingRow[]);
      }
    } catch {
      // ignore malformed storage
    }
    setHydrated(true);
  }, [meet.id]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      if (pending.length === 0) window.localStorage.removeItem(storageKey(meet.id));
      else window.localStorage.setItem(storageKey(meet.id), JSON.stringify(pending));
    } catch {
      // ignore quota / disabled storage
    }
  }, [pending, meet.id, hydrated]);

  // Index bests by swimmerId for O(1) lookup during feedback.
  const bestsBySwimmer = useMemo(() => {
    const map = new Map<string, PersonalBest[]>();
    for (const row of swimmerBests) map.set(row.swimmerId, row.personalBests);
    return map;
  }, [swimmerBests]);

  const activeSwimmers = useMemo(
    () => swimmers.filter((swimmer) => !swimmer.isPublic || swimmer.isPublic), // archived already filtered server-side
    [swimmers],
  );

  function addPending(row: Omit<PendingRow, "id">): void {
    setPending((prev) => [...prev, { id: newRowId(), ...row }]);
  }
  function removePending(id: string): void {
    setPending((prev) => prev.filter((row) => row.id !== id));
  }
  function editPending(id: string, next: Partial<PendingRow>): void {
    setPending((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        // Any edit clears the server error for that row.
        const { serverError: _unused, ...rest } = row;
        void _unused;
        return { ...rest, ...next };
      }),
    );
  }

  return (
    <div className="flex flex-col flex-1">
      <main className="flex-1 px-page py-8 tablet:py-16">
        <div className="mx-auto max-w-content flex flex-col gap-8">
          <Link
            href="/coach/meets"
            className="text-sm text-link underline hover:text-link-hover inline-block"
          >
            ← All meets
          </Link>

          <MeetHeader meet={meet} />

          <EntryRow
            meet={meet}
            swimmers={activeSwimmers}
            pending={pending}
            savedSwims={meet.swims}
            bestsBySwimmer={bestsBySwimmer}
            onAdd={addPending}
          />

          <PendingList
            rows={pending}
            swimmers={activeSwimmers}
            meet={meet}
            savedSwims={meet.swims}
            bestsBySwimmer={bestsBySwimmer}
            onEdit={editPending}
            onRemove={removePending}
            onSavedAll={() => setPending([])}
            onRowErrors={(errors) => {
              setPending((prev) =>
                prev.map((row, index) => {
                  const match = errors.find((error) => error.index === index);
                  if (!match) return row;
                  return { ...row, serverError: match.error };
                }),
              );
            }}
          />

          <SavedResults meet={meet} />
        </div>
      </main>
    </div>
  );
}

// ── Header (editable) ────────────────────────────────────────────────────────

function MeetHeader({ meet }: { meet: MeetWithSwimsResponse }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(meet.name);
  const [meetDate, setMeetDate] = useState(meet.meetDate);
  const [course, setCourse] = useState<Course>(meet.course);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!editing) {
      // Keep displayed values in sync with props when not editing (revalidate).
      setName(meet.name);
      setMeetDate(meet.meetDate);
      setCourse(meet.course);
      setError(null);
    }
  }, [editing, meet.name, meet.meetDate, meet.course]);

  function onSave(): void {
    setError(null);
    startTransition(async () => {
      const result = await patchMeetHeader(meet.id, { name, meetDate, course });
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  if (!editing) {
    return (
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0">
          <h1
            className="text-heading font-heading font-semibold break-words"
            style={{ fontVariationSettings: '"SOFT" 100, "WONK" 0' }}
          >
            {meet.name}
          </h1>
          <p className="text-sm text-text-secondary">
            {meet.meetDate} · {COURSE_LABELS[meet.course]}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex items-center justify-center px-3 min-h-[44px] text-xs font-semibold rounded-button border border-border text-text shrink-0"
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-card border border-border p-4 bg-surface-soft">
      <div className="flex flex-col gap-1">
        <label htmlFor="meet-name" className="text-xs font-semibold text-text-secondary">
          Name
        </label>
        <input
          id="meet-name"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="h-11 px-3 rounded-lg border border-border bg-background text-text text-base focus:outline focus:outline-2 focus:outline-focus-ring"
        />
      </div>
      <div className="flex flex-col gap-3 tablet:flex-row">
        <div className="flex flex-col gap-1 flex-1">
          <label htmlFor="meet-date" className="text-xs font-semibold text-text-secondary">
            Date
          </label>
          <input
            id="meet-date"
            type="date"
            value={meetDate}
            onChange={(event) => setMeetDate(event.target.value)}
            className="h-11 px-3 rounded-lg border border-border bg-background text-text text-base focus:outline focus:outline-2 focus:outline-focus-ring"
          />
        </div>
        <div className="flex flex-col gap-1 flex-1">
          <label htmlFor="meet-course" className="text-xs font-semibold text-text-secondary">
            Course
          </label>
          <select
            id="meet-course"
            value={course}
            onChange={(event) => setCourse(event.target.value as Course)}
            className="h-11 px-3 rounded-lg border border-border bg-background text-text text-base focus:outline focus:outline-2 focus:outline-focus-ring"
          >
            {(["scy", "scm", "lcm"] as Course[]).map((value) => (
              <option key={value} value={value}>
                {COURSE_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error !== null && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-2 tablet:flex-row tablet:gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={isPending}
          className="inline-flex items-center justify-center px-5 min-h-[44px] font-bold text-sm rounded-button bg-button-primary-background text-button-primary-text disabled:opacity-60 w-full tablet:w-auto"
        >
          {isPending ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={isPending}
          className="inline-flex items-center justify-center px-5 min-h-[44px] font-semibold text-sm rounded-button border border-button-outline text-button-outline w-full tablet:w-auto"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Entry row ────────────────────────────────────────────────────────────────

interface EntryRowProps {
  meet: MeetWithSwimsResponse;
  swimmers: CoachSwimmer[];
  pending: PendingRow[];
  savedSwims: MeetDetailSwimResponse[];
  bestsBySwimmer: Map<string, PersonalBest[]>;
  onAdd: (row: Omit<PendingRow, "id">) => void;
}

function EntryRow({ meet, swimmers, pending, savedSwims, bestsBySwimmer, onAdd }: EntryRowProps) {
  const [swimmerId, setSwimmerId] = useState<string>("");
  const [stroke, setStroke] = useState<SwimStroke>("free");
  const [distance, setDistance] = useState<number>(() => VALID_EVENTS.free[0] ?? 50);
  const [time, setTime] = useState<number | null>(null);
  const [swimmerError, setSwimmerError] = useState<string | null>(null);
  const [timeError, setTimeError] = useState<string | null>(null);
  // Bumping this value re-focuses the TimeInput's minutes box. Used to pull
  // focus to the Time field when it's the first invalid input on submit.
  const [timeFocusKey, setTimeFocusKey] = useState(0);

  const swimmerSelectRef = useRef<HTMLSelectElement>(null);

  const bestForEvent = useMemo(() => {
    if (swimmerId === "") return null;
    const list = bestsBySwimmer.get(swimmerId) ?? [];
    return (
      list.find(
        (pb) =>
          pb.eventDistance === distance &&
          pb.eventStroke === stroke &&
          pb.course === meet.course,
      ) ?? null
    );
  }, [bestsBySwimmer, swimmerId, distance, stroke, meet.course]);

  // Note what's already in the batch or saved so the coach spots duplicates
  // sooner. PendingList also surfaces the formal flag per row.
  const duplicate = useMemo(() => {
    if (swimmerId === "" || time === null) return false;
    const key = (row: {
      swimmerId: string;
      eventDistance: number;
      eventStroke: SwimStroke;
      course: Course;
      timeHundredths: number;
    }): string =>
      `${row.swimmerId}|${row.eventDistance}|${row.eventStroke}|${row.course}|${row.timeHundredths}`;
    const target = key({
      swimmerId,
      eventDistance: distance,
      eventStroke: stroke,
      course: meet.course,
      timeHundredths: time,
    });
    if (pending.some((row) => key(row) === target)) return true;
    if (
      savedSwims.some(
        (swim) =>
          key({
            swimmerId: swim.swimmerId,
            eventDistance: swim.eventDistance,
            eventStroke: swim.eventStroke,
            course: swim.course,
            timeHundredths: swim.timeHundredths,
          }) === target,
      )
    ) {
      return true;
    }
    return false;
  }, [swimmerId, distance, stroke, time, meet.course, pending, savedSwims]);

  function handleAdd(): void {
    // Always-enabled Add button validates here. Errors are shown next to
    // the field at fault and focus moves there. State is never cleared.
    let firstErrorFocus: (() => void) | null = null;
    if (swimmerId === "") {
      setSwimmerError("Choose a swimmer");
      if (firstErrorFocus === null) firstErrorFocus = () => swimmerSelectRef.current?.focus();
    } else {
      setSwimmerError(null);
    }
    if (time === null || time <= 0 || time > MAX_SWIM_HUNDREDTHS || !isValidEvent(distance, stroke)) {
      const message = time === null || time <= 0 ? "Enter a time" : "That time is out of range";
      setTimeError(message);
      if (firstErrorFocus === null) firstErrorFocus = () => setTimeFocusKey((tick) => tick + 1);
    } else {
      setTimeError(null);
    }

    if (firstErrorFocus !== null) {
      firstErrorFocus();
      return;
    }

    if (time === null) return; // narrow for TypeScript
    onAdd({
      swimmerId,
      eventDistance: distance,
      eventStroke: stroke,
      course: meet.course,
      timeHundredths: time,
    });

    // After add: clear swimmer and time, keep stroke and distance, focus
    // the swimmer select.
    setSwimmerId("");
    setTime(null);
    setSwimmerError(null);
    setTimeError(null);
    // Imperatively focus — a useState tick + useEffect would also work but
    // synchronous focus() avoids any re-render flicker between pending list
    // updates and the focus call.
    swimmerSelectRef.current?.focus();
  }

  return (
    <section
      aria-label="Add result"
      className="flex flex-col gap-4 rounded-card border border-border p-4 tablet:p-5 bg-background"
    >
      <h2 className="text-sm font-semibold text-text">Add result</h2>

      <div className="flex flex-col gap-4 tablet:flex-row tablet:items-start tablet:gap-5">
        <div className="flex flex-col gap-2 tablet:flex-1 tablet:min-w-[220px]">
          <SwimmerSelect
            ref={swimmerSelectRef}
            swimmers={swimmers}
            value={swimmerId}
            onChange={(next) => {
              setSwimmerId(next);
              setSwimmerError(null);
            }}
            error={swimmerError}
          />
          {swimmerId !== "" && swimmerError === null && (
            <p className="text-xs text-text-secondary">
              {bestForEvent !== null ? (
                <>
                  Best: <span className="font-semibold text-text tabular-nums">{bestForEvent.timeString}</span>
                </>
              ) : (
                "No time in this event yet"
              )}
            </p>
          )}
        </div>

        <div className="tablet:flex-1 tablet:min-w-[240px]">
          <EventPicker
            stroke={stroke}
            distance={distance}
            onStrokeChange={setStroke}
            onDistanceChange={setDistance}
          />
        </div>

        <div className="flex flex-col gap-2">
          <TimeInput
            size="lg"
            value={time}
            focusKey={timeFocusKey}
            onChange={(next) => {
              setTime(next);
              setTimeError(null);
            }}
          />
          {timeError !== null && (
            <p role="alert" className="text-xs text-danger">
              {timeError}
            </p>
          )}
        </div>
      </div>

      {duplicate && (
        <p role="alert" className="text-xs text-warning">
          This exact result is already in the batch or saved to the meet.
        </p>
      )}

      <div className="tablet:flex tablet:justify-end">
        <button
          type="button"
          onClick={handleAdd}
          className="inline-flex items-center justify-center px-5 min-h-[44px] font-bold text-sm rounded-button bg-button-primary-background text-button-primary-text w-full tablet:w-auto"
        >
          Add result
        </button>
      </div>
    </section>
  );
}

// ── Pending list ─────────────────────────────────────────────────────────────

interface PendingListProps {
  rows: PendingRow[];
  swimmers: CoachSwimmer[];
  meet: MeetWithSwimsResponse;
  savedSwims: MeetDetailSwimResponse[];
  bestsBySwimmer: Map<string, PersonalBest[]>;
  onEdit: (id: string, next: Partial<PendingRow>) => void;
  onRemove: (id: string) => void;
  onSavedAll: () => void;
  onRowErrors: (errors: BatchRowError[]) => void;
}

interface Feedback {
  tone: "info" | "success" | "warning" | "danger";
  message: string;
}

function feedbackFor(
  row: PendingRow,
  bestsBySwimmer: Map<string, PersonalBest[]>,
  pendingBefore: PendingRow[],
  savedSwims: MeetDetailSwimResponse[],
): Feedback {
  const sameKey = (
    event: number,
    stroke: SwimStroke,
    course: Course,
    swimmerId: string,
  ): boolean =>
    row.eventDistance === event &&
    row.eventStroke === stroke &&
    row.course === course &&
    row.swimmerId === swimmerId;

  // Duplicate: identical (swimmer, event, course, time) already in pending or saved.
  const exactKey = (
    swimmerId: string,
    eventDistance: number,
    eventStroke: SwimStroke,
    course: Course,
    timeHundredths: number,
  ): string => `${swimmerId}|${eventDistance}|${eventStroke}|${course}|${timeHundredths}`;
  const target = exactKey(
    row.swimmerId,
    row.eventDistance,
    row.eventStroke,
    row.course,
    row.timeHundredths,
  );
  if (
    pendingBefore.some(
      (other) =>
        exactKey(
          other.swimmerId,
          other.eventDistance,
          other.eventStroke,
          other.course,
          other.timeHundredths,
        ) === target,
    ) ||
    savedSwims.some(
      (swim) =>
        exactKey(
          swim.swimmerId,
          swim.eventDistance,
          swim.eventStroke,
          swim.course,
          swim.timeHundredths,
        ) === target,
    )
  ) {
    return { tone: "danger", message: "Duplicate — already in this meet." };
  }

  // Find current best for (event, stroke, course). Consider all-time PBs and
  // any pending rows that come earlier for the same event.
  const allTimeBests = bestsBySwimmer.get(row.swimmerId) ?? [];
  const prior = allTimeBests.find(
    (pb) => sameKey(pb.eventDistance, pb.eventStroke, pb.course, row.swimmerId),
  );
  const earlierPending = pendingBefore
    .filter(
      (other) =>
        other.swimmerId === row.swimmerId &&
        sameKey(other.eventDistance, other.eventStroke, other.course, row.swimmerId),
    )
    .reduce<number | null>((min, other) => (min === null || other.timeHundredths < min ? other.timeHundredths : min), null);
  const earlierSaved = savedSwims
    .filter(
      (swim) =>
        swim.swimmerId === row.swimmerId &&
        sameKey(swim.eventDistance, swim.eventStroke, swim.course, row.swimmerId),
    )
    .reduce<number | null>((min, swim) => (min === null || swim.timeHundredths < min ? swim.timeHundredths : min), null);
  const bestCandidates = [prior?.timeHundredths, earlierPending, earlierSaved].filter(
    (value): value is number => typeof value === "number",
  );
  if (bestCandidates.length === 0) {
    return { tone: "info", message: "First time in this event." };
  }
  const bestHundredths = Math.min(...bestCandidates);
  if (row.timeHundredths < bestHundredths) {
    const diff = formatSwimTime(bestHundredths - row.timeHundredths);
    return { tone: "success", message: `New best, ${diff} faster.` };
  }
  const dev = deviationFromBest(row.timeHundredths, bestHundredths);
  if (Math.abs(dev) > DEVIATION_THRESHOLD) {
    const pct = Math.round(Math.abs(dev) * 100);
    const direction = dev > 0 ? "slower" : "faster";
    return {
      tone: "warning",
      message: `${pct}% ${direction} than best (${formatSwimTime(bestHundredths)}). Double-check.`,
    };
  }
  return { tone: "info", message: `Off best by ${formatSwimTime(row.timeHundredths - bestHundredths)}.` };
}

function PendingList({
  rows,
  swimmers,
  meet,
  savedSwims,
  bestsBySwimmer,
  onEdit,
  onRemove,
  onSavedAll,
  onRowErrors,
}: PendingListProps) {
  const router = useRouter();
  const [isSaving, startSaving] = useTransition();
  const [bannerError, setBannerError] = useState<string | null>(null);

  const swimmerById = useMemo(() => {
    const map = new Map<string, CoachSwimmer>();
    for (const swimmer of swimmers) map.set(swimmer.id, swimmer);
    return map;
  }, [swimmers]);

  const onSave = useCallback((): void => {
    setBannerError(null);
    const payload = rows.map((row) => ({
      swimmerId: row.swimmerId,
      eventDistance: row.eventDistance,
      eventStroke: row.eventStroke,
      course: row.course,
      timeString: formatSwimTime(row.timeHundredths),
      swumOn: meet.meetDate,
    }));
    startSaving(async () => {
      const result = await saveBatchForMeet(meet.id, payload);
      if (result.status === "success") {
        onSavedAll();
        router.refresh();
        return;
      }
      if (result.status === "row_errors") {
        onRowErrors(result.rowErrors);
        setBannerError(
          "Some results couldn't be saved — fix the flagged rows and try again. Nothing was saved.",
        );
        return;
      }
      setBannerError(result.message);
    });
  }, [rows, meet.id, meet.meetDate, onSavedAll, onRowErrors, router]);

  if (rows.length === 0) return null;

  return (
    <section aria-label="Pending results" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-text">
          Pending ({rows.length})
        </h2>
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className="inline-flex items-center justify-center px-5 min-h-[44px] font-bold text-sm rounded-button bg-button-primary-background text-button-primary-text disabled:opacity-60"
        >
          {isSaving ? "Saving…" : "Save results"}
        </button>
      </div>

      {bannerError !== null && (
        <p role="alert" className="text-sm text-danger">
          {bannerError}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {rows.map((row, index) => {
          const swimmer = swimmerById.get(row.swimmerId);
          const pendingBefore = rows.slice(0, index);
          const fb = feedbackFor(row, bestsBySwimmer, pendingBefore, savedSwims);
          return (
            <li
              key={row.id}
              data-testid="pending-row"
              className="flex flex-col gap-2 rounded-card border border-border p-3 bg-background"
            >
              <div className="flex flex-col gap-1 tablet:flex-row tablet:items-center tablet:justify-between">
                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                  <p className="font-semibold text-text text-sm">
                    {swimmer ? `${swimmer.firstName} ${swimmer.lastName}` : "(unknown swimmer)"}
                  </p>
                  <p className="text-xs text-text-secondary">
                    {row.eventDistance} {STROKE_LABELS[row.eventStroke]} · {COURSE_LABELS[row.course]} ·{" "}
                    <span className="tabular-nums">{formatSwimTime(row.timeHundredths)}</span>
                  </p>
                </div>
                <div className="flex gap-2">
                  <PendingRowEditor row={row} onChange={(next) => onEdit(row.id, next)} />
                  <button
                    type="button"
                    onClick={() => onRemove(row.id)}
                    className="text-xs font-semibold text-danger hover:opacity-80 min-h-[44px] px-2"
                  >
                    Remove
                  </button>
                </div>
              </div>
              <p
                data-testid="pending-row-feedback"
                className={
                  fb.tone === "success"
                    ? "text-xs font-semibold text-success"
                    : fb.tone === "warning"
                      ? "text-xs font-semibold text-warning"
                      : fb.tone === "danger"
                        ? "text-xs font-semibold text-danger"
                        : "text-xs text-text-secondary"
                }
              >
                {fb.message}
              </p>
              {row.serverError !== undefined && (
                <p role="alert" className="text-xs text-danger">
                  Server: {row.serverError}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Per-row edit: pop-over with the time editor so the coach can fix a typo
// without re-entering everything.
function PendingRowEditor({
  row,
  onChange,
}: {
  row: PendingRow;
  onChange: (next: Partial<PendingRow>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState<number | null>(row.timeHundredths);

  useEffect(() => {
    if (!open) setTime(row.timeHundredths);
  }, [open, row.timeHundredths]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-semibold text-link hover:text-link-hover min-h-[44px] px-2"
      >
        Edit
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-soft p-2">
      <TimeInput value={time} onChange={setTime} />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            if (time !== null) onChange({ timeHundredths: time });
            setOpen(false);
          }}
          className="inline-flex items-center justify-center px-3 min-h-[36px] text-xs font-semibold rounded-button bg-button-primary-background text-button-primary-text"
        >
          Apply
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex items-center justify-center px-3 min-h-[36px] text-xs font-semibold rounded-button border border-border text-text"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Saved results ────────────────────────────────────────────────────────────

function SavedResults({ meet }: { meet: MeetWithSwimsResponse }) {
  if (meet.swims.length === 0) {
    return <p className="text-sm text-text-secondary">No results saved yet.</p>;
  }

  // Group by (distance, stroke) and sort each group by time ascending.
  const groups = new Map<string, MeetDetailSwimResponse[]>();
  for (const swim of meet.swims) {
    const key = `${swim.eventDistance}|${swim.eventStroke}`;
    const list = groups.get(key) ?? [];
    list.push(swim);
    groups.set(key, list);
  }
  for (const list of groups.values()) list.sort((a, b) => a.timeHundredths - b.timeHundredths);

  // Order groups by distance then stroke.
  const orderedKeys = Array.from(groups.keys()).sort((a, b) => {
    const [da, sa] = a.split("|");
    const [db, sb] = b.split("|");
    const d = Number(da) - Number(db);
    if (d !== 0) return d;
    return STROKE_ORDER.indexOf(sa as SwimStroke) - STROKE_ORDER.indexOf(sb as SwimStroke);
  });

  return (
    <section aria-label="Saved results" className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-text">Saved results</h2>
      <div className="flex flex-col gap-4">
        {orderedKeys.map((key) => {
          const swims = groups.get(key)!;
          const first = swims[0]!;
          const bestTime = first.timeHundredths;
          return (
            <div key={key} className="flex flex-col gap-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                {first.eventDistance} {STROKE_LABELS[first.eventStroke]} · {COURSE_LABELS[first.course]}
              </p>
              <ul className="flex flex-col">
                {swims.map((swim) => (
                  <SavedSwimRow
                    key={swim.id}
                    swim={swim}
                    meetId={meet.id}
                    isPb={swim.timeHundredths === bestTime}
                  />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SavedSwimRow({
  swim,
  meetId,
  isPb,
}: {
  swim: MeetDetailSwimResponse;
  meetId: string;
  isPb: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [time, setTime] = useState<number | null>(swim.timeHundredths);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function apply(): void {
    if (time === null || time === swim.timeHundredths) {
      setEditing(false);
      return;
    }
    startTransition(async () => {
      const result = await patchSavedSwim(swim.swimmerId, swim.id, meetId, {
        timeString: formatSwimTime(time),
      });
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setEditing(false);
      setError(null);
      router.refresh();
    });
  }

  function remove(): void {
    startTransition(async () => {
      const result = await deleteSavedSwim(swim.swimmerId, swim.id, meetId);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <li className="flex flex-col gap-1 border-t border-border py-3 first:border-t-0">
      <div className="flex flex-col gap-1 tablet:flex-row tablet:items-center tablet:justify-between">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <p className="font-semibold text-text text-sm truncate">
            {swim.swimmerFirstName} {swim.swimmerLastName}
          </p>
          {isPb && (
            <span className="text-xs font-bold text-accent border border-accent rounded px-2 py-0.5">
              PB
            </span>
          )}
        </div>

        {!editing ? (
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-text tabular-nums">{swim.timeString}</span>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs font-semibold text-link hover:text-link-hover min-h-[44px] px-2"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={isPending}
              className="text-xs font-semibold text-danger hover:opacity-80 min-h-[44px] px-2 disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <TimeInput value={time} onChange={setTime} />
            <button
              type="button"
              onClick={apply}
              disabled={isPending}
              className="inline-flex items-center justify-center px-3 min-h-[44px] text-xs font-semibold rounded-button bg-button-primary-background text-button-primary-text disabled:opacity-60"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setTime(swim.timeHundredths);
                setError(null);
              }}
              disabled={isPending}
              className="inline-flex items-center justify-center px-3 min-h-[44px] text-xs font-semibold rounded-button border border-border text-text"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
      {error !== null && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </li>
  );
}
