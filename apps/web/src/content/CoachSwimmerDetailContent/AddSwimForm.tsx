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
  isValidEvent,
} from "@swim-app/shared";

import EventPicker from "@/components/EventPicker";
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

  // Inline, per-field validation errors. Nothing in `handleValidate` clears
  // a typed value — these only toggle the error text + which field pulls
  // focus on next submit.
  const [timeError, setTimeError] = useState<string | null>(null);
  const [meetError, setMeetError] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  const [timeFocusKey, setTimeFocusKey] = useState(0);
  const meetSelectRef = useRef<HTMLSelectElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);

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
      setMeetError(null);
      setShowCreateMeet(false);
      setNewMeetName("");
      setNewMeetDate("");
      setNewMeetCourse("scy");
      router.refresh();
    });
  }

  // Always-enabled submit. Validate inline, surface messages next to the
  // field, and focus the first invalid field. Return `false` to short-circuit
  // the server action — React 19 form actions call the function regardless,
  // so we use `onSubmit` + preventDefault to control the flow.
  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    let hasError = false;
    let focus: (() => void) | null = null;

    if (meetId === "") {
      setMeetError("Choose a meet");
      hasError = true;
      if (focus === null) focus = () => meetSelectRef.current?.focus();
    } else {
      setMeetError(null);
    }

    if (
      timeHundredths === null ||
      timeHundredths <= 0 ||
      timeHundredths > MAX_SWIM_HUNDREDTHS ||
      !isValidEvent(distance, stroke)
    ) {
      const message =
        timeHundredths === null || timeHundredths <= 0 ? "Enter a time" : "That time is out of range";
      setTimeError(message);
      hasError = true;
      if (focus === null) focus = () => setTimeFocusKey((tick) => tick + 1);
    } else {
      setTimeError(null);
    }

    if (swumOn === "") {
      setDateError("Pick a date");
      hasError = true;
      if (focus === null) focus = () => dateInputRef.current?.focus();
    } else {
      setDateError(null);
    }

    if (hasError) {
      event.preventDefault();
      focus?.();
    }
  }

  return (
    <form
      action={action}
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 p-4 tablet:p-5 rounded-lg border border-border bg-surface-soft"
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

      <EventPicker
        stroke={stroke}
        distance={distance}
        onStrokeChange={setStroke}
        onDistanceChange={setDistance}
      />

      <div className="flex flex-col gap-4 tablet:flex-row tablet:items-start tablet:gap-5">
        <div className="flex flex-col gap-2">
          <TimeInput
            size="lg"
            value={timeHundredths}
            focusKey={timeFocusKey}
            onChange={(next) => {
              setTimeHundredths(next);
              setTimeError(null);
            }}
          />
          {timeError !== null && (
            <p role="alert" className="text-xs text-danger">
              {timeError}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1 tablet:flex-1 tablet:min-w-[160px]">
          <label htmlFor="add-swim-course" className="text-xs font-semibold text-text-secondary">
            Course
          </label>
          <select
            id="add-swim-course"
            value={course}
            onChange={(event) => setCourse(event.target.value as Course)}
            className="h-11 min-h-[44px] px-3 rounded-lg border border-border bg-background text-text text-base focus:outline focus:outline-2 focus:outline-focus-ring"
          >
            {(Object.keys(COURSE_LABELS) as Course[]).map((value) => (
              <option key={value} value={value}>
                {COURSE_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1 tablet:flex-1 tablet:min-w-[160px]">
          <label htmlFor="add-swim-date" className="text-xs font-semibold text-text-secondary">
            Date
          </label>
          <input
            id="add-swim-date"
            ref={dateInputRef}
            type="date"
            value={swumOn}
            aria-invalid={dateError !== null}
            onChange={(event) => {
              setSwumOn(event.target.value);
              setDateError(null);
            }}
            className="h-11 min-h-[44px] px-3 rounded-lg border border-border bg-background text-text text-base focus:outline focus:outline-2 focus:outline-focus-ring aria-[invalid=true]:border-danger"
          />
          {dateError !== null && (
            <p role="alert" className="text-xs text-danger">
              {dateError}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="add-swim-meet" className="text-xs font-semibold text-text-secondary">
          Meet
        </label>
        <select
          id="add-swim-meet"
          ref={meetSelectRef}
          value={meetId}
          aria-invalid={meetError !== null}
          onChange={(event) => {
            const next = event.target.value;
            if (next === "__new__") {
              setShowCreateMeet(true);
              return;
            }
            setMeetId(next);
            setMeetError(null);
            const picked = meets.find((meet) => meet.id === next);
            if (picked) {
              setCourse(picked.course);
              if (swumOn === "") setSwumOn(picked.meetDate);
            }
          }}
          className="h-11 min-h-[44px] px-3 rounded-lg border border-border bg-background text-text text-base focus:outline focus:outline-2 focus:outline-focus-ring aria-[invalid=true]:border-danger"
        >
          <option value="">Pick a meet…</option>
          {meets.map((meet) => (
            <option key={meet.id} value={meet.id}>
              {meet.name} — {meet.meetDate}
            </option>
          ))}
          <option value="__new__">+ Create a new meet</option>
        </select>
        {meetError !== null && (
          <p role="alert" className="text-xs text-danger">
            {meetError}
          </p>
        )}
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

      <div className="flex flex-col gap-2 tablet:flex-row tablet:justify-end">
        <button
          type="button"
          onClick={onSuccess}
          className="inline-flex items-center justify-center px-4 min-h-[44px] font-semibold text-sm rounded-button text-text-secondary"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center justify-center px-5 min-h-[44px] font-bold text-sm rounded-button disabled:opacity-60 bg-button-primary-background text-button-primary-text w-full tablet:w-auto"
        >
          {isPending ? "Saving…" : "Save time"}
        </button>
      </div>
    </form>
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
