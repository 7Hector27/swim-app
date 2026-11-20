"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  type Course,
  type MeetResponse,
  type PersonalBest,
  type SwimStroke,
  VALID_EVENTS,
  deviationFromBest,
  formatSwimTime,
  MAX_SWIM_HUNDREDTHS,
} from "@swim-app/shared";

import TimeInput from "@/components/TimeInput";
import { addSwimForSwimmer } from "./actions";
import type { AddSwimState } from "./actions";
import { createMeetInline } from "../CoachMeetsContent/actions";

interface AddSwimFormProps {
  swimmerId: string;
  swimmerName: string;
  // Every meet swim must belong to a meet (ADR 0045). The picker also
  // offers "Create a new meet" inline so coaches don't bounce to the Meets
  // page mid-entry.
  meets: MeetResponse[];
  personalBests: PersonalBest[];
  onSuccess: () => void;
}

const STROKE_LABELS: Record<SwimStroke, string> = {
  free: "Free",
  back: "Back",
  breast: "Breast",
  fly: "Fly",
  im: "IM",
};

const COURSE_LABELS: Record<Course, string> = { scy: "SCY", scm: "SCM", lcm: "LCM" };

const DEVIATION_THRESHOLD = 0.2;

export default function AddSwimForm({
  swimmerId,
  swimmerName,
  meets,
  personalBests,
  onSuccess,
}: AddSwimFormProps) {
  const router = useRouter();

  const [stroke, setStroke] = useState<SwimStroke>("free");
  const [distance, setDistance] = useState<number>(() => VALID_EVENTS.free[0] ?? 50);
  const [course, setCourse] = useState<Course>("scy");
  const [timeHundredths, setTimeHundredths] = useState<number | null>(null);
  const [swumOn, setSwumOn] = useState<string>("");
  const [meetId, setMeetId] = useState<string>("");

  // Inline create-meet popover.
  const [showCreateMeet, setShowCreateMeet] = useState(false);
  const [newMeetName, setNewMeetName] = useState("");
  const [newMeetDate, setNewMeetDate] = useState("");
  const [newMeetCourse, setNewMeetCourse] = useState<Course>("scy");
  const [createMeetError, setCreateMeetError] = useState<string | null>(null);
  const [isCreatingMeet, startCreatingMeet] = useTransition();

  const [state, action, isPending] = useActionState<AddSwimState, FormData>(
    addSwimForSwimmer.bind(null, swimmerId),
    { status: "idle" },
  );

  useEffect(() => {
    if (state.status === "success") onSuccess();
  }, [state.status, onSuccess]);

  const distances = VALID_EVENTS[stroke] ?? [];

  const canSubmit =
    meetId !== "" &&
    timeHundredths !== null &&
    timeHundredths > 0 &&
    timeHundredths <= MAX_SWIM_HUNDREDTHS &&
    swumOn !== "";

  const matchingBest = personalBests.find(
    (pb) => pb.eventDistance === distance && pb.eventStroke === stroke && pb.course === course,
  );
  const deviation =
    matchingBest !== undefined && timeHundredths !== null
      ? deviationFromBest(timeHundredths, matchingBest.timeHundredths)
      : null;
  const deviationWarning =
    deviation !== null && Math.abs(deviation) > DEVIATION_THRESHOLD
      ? deviation > 0
        ? `This time is ${Math.round(deviation * 100)}% slower than ${swimmerName}'s best (${matchingBest!.timeString}). Double-check before saving.`
        : `This time is ${Math.round(Math.abs(deviation) * 100)}% faster than ${swimmerName}'s best (${matchingBest!.timeString}). Double-check before saving.`
      : null;

  function handleCreateMeet(): void {
    setCreateMeetError(null);
    startCreatingMeet(async () => {
      const result = await createMeetInline({
        name: newMeetName,
        meetDate: newMeetDate,
        course: newMeetCourse,
      });
      if (result.status === "error") {
        setCreateMeetError(result.message);
        return;
      }
      setMeetId(result.meet.id);
      setCourse(result.meet.course);
      setSwumOn(result.meet.meetDate);
      setShowCreateMeet(false);
      setNewMeetName("");
      setNewMeetDate("");
      setNewMeetCourse("scy");
      router.refresh();
    });
  }

  return (
    <form
      action={action}
      className="flex flex-col gap-3 p-4 rounded-lg border border-border bg-surface-soft"
    >
      {/* All fields are strictly controlled via React state and travel as hidden
          inputs on submit. Nothing uses `defaultValue`, so React 19's
          post-action form reset can't wipe a typed value. */}
      <input type="hidden" name="eventStroke" value={stroke} />
      <input type="hidden" name="eventDistance" value={distance} />
      <input type="hidden" name="course" value={course} />
      <input type="hidden" name="timeString" value={timeHundredths === null ? "" : formatSwimTime(timeHundredths)} />
      <input type="hidden" name="swumOn" value={swumOn} />
      <input type="hidden" name="meetId" value={meetId} />

      <div className="flex flex-col gap-3 tablet:flex-row tablet:flex-wrap">
        <div className="flex flex-col gap-1 flex-1 min-w-[140px]">
          <label htmlFor="add-swim-stroke" className="text-xs font-semibold text-text-secondary">
            Stroke
          </label>
          <select
            id="add-swim-stroke"
            value={stroke}
            onChange={(event) => {
              const next = event.target.value as SwimStroke;
              setStroke(next);
              const d = VALID_EVENTS[next] ?? [];
              const first = d[0];
              if (first !== undefined && !d.includes(distance)) setDistance(first);
            }}
            className="h-11 px-3 rounded-lg border border-border bg-background text-text text-base focus:outline focus:outline-2 focus:outline-focus-ring"
          >
            {(Object.keys(STROKE_LABELS) as SwimStroke[]).map((value) => (
              <option key={value} value={value}>
                {STROKE_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1 flex-1 min-w-[120px]">
          <label htmlFor="add-swim-distance" className="text-xs font-semibold text-text-secondary">
            Distance
          </label>
          <select
            id="add-swim-distance"
            value={distance}
            onChange={(event) => setDistance(Number(event.target.value))}
            className="h-11 px-3 rounded-lg border border-border bg-background text-text text-base focus:outline focus:outline-2 focus:outline-focus-ring"
          >
            {distances.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1 flex-1 min-w-[120px]">
          <label htmlFor="add-swim-course" className="text-xs font-semibold text-text-secondary">
            Course
          </label>
          <select
            id="add-swim-course"
            value={course}
            onChange={(event) => setCourse(event.target.value as Course)}
            className="h-11 px-3 rounded-lg border border-border bg-background text-text text-base focus:outline focus:outline-2 focus:outline-focus-ring"
          >
            {(Object.keys(COURSE_LABELS) as Course[]).map((value) => (
              <option key={value} value={value}>
                {COURSE_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-3 tablet:flex-row tablet:flex-wrap tablet:items-end">
        <TimeInput value={timeHundredths} onChange={setTimeHundredths} />

        <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
          <label htmlFor="add-swim-date" className="text-xs font-semibold text-text-secondary">
            Date
          </label>
          <input
            id="add-swim-date"
            type="date"
            required
            value={swumOn}
            onChange={(event) => setSwumOn(event.target.value)}
            className="h-11 px-3 rounded-lg border border-border bg-background text-text text-base focus:outline focus:outline-2 focus:outline-focus-ring"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="add-swim-meet" className="text-xs font-semibold text-text-secondary">
          Meet
        </label>
        <select
          id="add-swim-meet"
          required
          value={meetId}
          onChange={(event) => {
            const next = event.target.value;
            if (next === "__new__") {
              setShowCreateMeet(true);
              return;
            }
            setMeetId(next);
            const picked = meets.find((meet) => meet.id === next);
            if (picked) {
              setCourse(picked.course);
              if (swumOn === "") setSwumOn(picked.meetDate);
            }
          }}
          className="h-11 px-3 rounded-lg border border-border bg-background text-text text-base focus:outline focus:outline-2 focus:outline-focus-ring"
        >
          <option value="">Pick a meet…</option>
          {meets.map((meet) => (
            <option key={meet.id} value={meet.id}>
              {meet.name} — {meet.meetDate}
            </option>
          ))}
          <option value="__new__">+ Create a new meet</option>
        </select>
      </div>

      {showCreateMeet && (
        <InlineCreateMeet
          name={newMeetName}
          onNameChange={setNewMeetName}
          meetDate={newMeetDate}
          onMeetDateChange={setNewMeetDate}
          course={newMeetCourse}
          onCourseChange={setNewMeetCourse}
          error={createMeetError}
          isPending={isCreatingMeet}
          onCreate={handleCreateMeet}
          onCancel={() => {
            setShowCreateMeet(false);
            setCreateMeetError(null);
          }}
        />
      )}

      {deviationWarning !== null && (
        <p
          role="alert"
          data-testid="deviation-warning"
          className="text-xs font-semibold text-accent bg-background border border-accent rounded px-3 py-2"
        >
          {deviationWarning}
        </p>
      )}

      {state.status === "error" && (
        <p role="alert" className="text-xs text-danger">
          {state.message}
        </p>
      )}

      <div className="flex flex-col gap-2 tablet:flex-row">
        <SubmitButton disabled={!canSubmit || isPending} label={isPending ? "Saving…" : "Save time"} />
        <button
          type="button"
          onClick={onSuccess}
          className="inline-flex items-center justify-center px-4 h-11 font-semibold text-sm rounded-button text-text-secondary"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function SubmitButton({ disabled, label }: { disabled: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="inline-flex items-center justify-center px-4 h-11 font-bold text-sm rounded-button disabled:opacity-60 bg-button-primary-background text-button-primary-text w-full tablet:w-auto"
    >
      {label}
    </button>
  );
}

function InlineCreateMeet({
  name,
  onNameChange,
  meetDate,
  onMeetDateChange,
  course,
  onCourseChange,
  error,
  isPending,
  onCreate,
  onCancel,
}: {
  name: string;
  onNameChange: (next: string) => void;
  meetDate: string;
  onMeetDateChange: (next: string) => void;
  course: Course;
  onCourseChange: (next: Course) => void;
  error: string | null;
  isPending: boolean;
  onCreate: () => void;
  onCancel: () => void;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3">
      <p className="text-xs font-semibold text-text">New meet</p>
      <div className="flex flex-col gap-2 tablet:flex-row">
        <input
          ref={nameRef}
          type="text"
          placeholder="Meet name"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          className="h-11 px-3 rounded-lg border border-border bg-background text-text text-base flex-1 focus:outline focus:outline-2 focus:outline-focus-ring"
        />
        <input
          type="date"
          value={meetDate}
          onChange={(event) => onMeetDateChange(event.target.value)}
          className="h-11 px-3 rounded-lg border border-border bg-background text-text text-base focus:outline focus:outline-2 focus:outline-focus-ring"
        />
        <select
          value={course}
          onChange={(event) => onCourseChange(event.target.value as Course)}
          className="h-11 px-3 rounded-lg border border-border bg-background text-text text-base focus:outline focus:outline-2 focus:outline-focus-ring"
        >
          <option value="scy">SCY</option>
          <option value="scm">SCM</option>
          <option value="lcm">LCM</option>
        </select>
      </div>
      {error !== null && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCreate}
          disabled={isPending || name.trim() === "" || meetDate === ""}
          className="inline-flex items-center justify-center px-3 min-h-[36px] text-xs font-semibold rounded-button bg-button-primary-background text-button-primary-text disabled:opacity-60"
        >
          {isPending ? "Creating…" : "Create meet"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center justify-center px-3 min-h-[36px] text-xs font-semibold rounded-button border border-border text-text"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
