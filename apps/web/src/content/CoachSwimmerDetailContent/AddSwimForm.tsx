"use client";

import { useActionState, useState } from "react";
import {
  type MeetResponse,
  type PersonalBest,
  type SwimStroke,
  type Course,
  VALID_EVENTS,
  deviationFromBest,
} from "@swim-app/shared";

import { addSwimForSwimmer } from "./actions";
import type { AddSwimState } from "./actions";
import SwimTimeInput from "./SwimTimeInput";

interface AddSwimFormProps {
  swimmerId: string;
  swimmerName: string;
  // When present, the form records a meet swim. When omitted, it records a
  // practice swim and the meet picker is hidden.
  meets?: MeetResponse[];
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

const COURSE_LABELS: Record<Course, string> = {
  scy: "SCY",
  scm: "SCM",
  lcm: "LCM",
};

// 20% of best, in either direction, flags the time for a sanity check.
const DEVIATION_THRESHOLD = 0.2;

export default function AddSwimForm({
  swimmerId,
  swimmerName,
  meets,
  personalBests,
  onSuccess,
}: AddSwimFormProps) {
  const [step, setStep] = useState<"edit" | "review">("edit");

  const [stroke, setStroke] = useState<SwimStroke>("free");
  const [distance, setDistance] = useState<number>(() => VALID_EVENTS.free[0] ?? 50);
  const [course, setCourse] = useState<Course>("scy");
  const [timeString, setTimeString] = useState<string | null>(null);
  const [timeHundredths, setTimeHundredths] = useState<number | null>(null);
  const [swumOn, setSwumOn] = useState<string>("");
  const [meetId, setMeetId] = useState<string>("");

  const [state, action, isPending] = useActionState<AddSwimState, FormData>(
    addSwimForSwimmer.bind(null, swimmerId),
    { status: "idle" },
  );

  if (state.status === "success") {
    onSuccess();
  }

  const distances = VALID_EVENTS[stroke] ?? [];
  const canReview =
    timeString !== null && swumOn !== "" && (meets === undefined || true);

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

  const selectedMeet = meets?.find((meet) => meet.id === meetId) ?? null;

  function goToReview(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!canReview) return;
    setStep("review");
  }

  // ── Review step ─────────────────────────────────────────────────────────────
  if (step === "review") {
    return (
      <form action={action} className="flex flex-col gap-4 p-4 rounded-lg border border-border bg-surface-soft">
        <input type="hidden" name="eventStroke" value={stroke} />
        <input type="hidden" name="eventDistance" value={distance} />
        <input type="hidden" name="course" value={course} />
        <input type="hidden" name="timeString" value={timeString ?? ""} />
        <input type="hidden" name="swumOn" value={swumOn} />
        {meetId && <input type="hidden" name="meetId" value={meetId} />}

        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Review</p>
          <dl className="flex flex-col gap-2 text-sm">
            <ReviewRow label="Swimmer" value={swimmerName} />
            <ReviewRow label="Event" value={`${distance} ${STROKE_LABELS[stroke]}`} />
            <ReviewRow label="Course" value={COURSE_LABELS[course]} />
            <ReviewRow
              label="Time"
              value={<span className="tabular-nums font-semibold text-text">{timeString}</span>}
            />
            <ReviewRow label="Date" value={swumOn} />
            {meets !== undefined && (
              <ReviewRow
                label="Meet"
                value={selectedMeet !== null ? selectedMeet.name : "Practice"}
              />
            )}
          </dl>
        </div>

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
          <p role="alert" className="text-xs text-danger">{state.message}</p>
        )}

        <div className="flex gap-2 flex-wrap">
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex items-center justify-center px-4 h-11 font-bold text-sm rounded-button disabled:opacity-60 bg-button-primary-background text-button-primary-text"
          >
            {isPending ? "Saving…" : "Confirm & save"}
          </button>
          <button
            type="button"
            onClick={() => setStep("edit")}
            disabled={isPending}
            className="inline-flex items-center justify-center px-4 h-11 font-semibold text-sm rounded-button border border-border text-text disabled:opacity-60"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onSuccess}
            disabled={isPending}
            className="inline-flex items-center justify-center px-4 h-11 font-semibold text-sm rounded-button text-text-secondary disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  // ── Edit step ───────────────────────────────────────────────────────────────
  return (
    <form onSubmit={goToReview} className="flex flex-col gap-3 p-4 rounded-lg border border-border bg-surface-soft">
      <div className="flex flex-col gap-3 tablet:flex-row tablet:flex-wrap">
        <div className="flex flex-col gap-1 flex-1 min-w-[140px]">
          <label htmlFor="add-swim-stroke" className="text-xs font-semibold text-text-secondary">
            Stroke
          </label>
          <select
            id="add-swim-stroke"
            value={stroke}
            onChange={(event) => {
              const nextStroke = event.target.value as SwimStroke;
              setStroke(nextStroke);
              const nextDistances = VALID_EVENTS[nextStroke] ?? [];
              const first = nextDistances[0];
              if (first !== undefined && !nextDistances.includes(distance)) {
                setDistance(first);
              }
            }}
            className="h-11 px-3 rounded-lg border border-border bg-background text-text text-base focus:outline focus:outline-2 focus:outline-focus-ring"
          >
            {(Object.keys(STROKE_LABELS) as SwimStroke[]).map((value) => (
              <option key={value} value={value}>{STROKE_LABELS[value]}</option>
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
            {distances.map((dist) => (
              <option key={dist} value={dist}>{dist}</option>
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
              <option key={value} value={value}>{COURSE_LABELS[value]}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-3 tablet:flex-row tablet:flex-wrap">
        <SwimTimeInput
          name="timeString"
          onParsedChange={(nextString, nextHundredths) => {
            setTimeString(nextString);
            setTimeHundredths(nextHundredths);
          }}
        />

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

        {meets !== undefined && meets.length > 0 && (
          <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
            <label htmlFor="add-swim-meet" className="text-xs font-semibold text-text-secondary">
              Meet (optional)
            </label>
            <select
              id="add-swim-meet"
              value={meetId}
              onChange={(event) => setMeetId(event.target.value)}
              className="h-11 px-3 rounded-lg border border-border bg-background text-text text-base focus:outline focus:outline-2 focus:outline-focus-ring"
            >
              <option value="">Practice</option>
              {meets.map((meet) => (
                <option key={meet.id} value={meet.id}>{meet.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex gap-2 flex-wrap">
        <button
          type="submit"
          disabled={!canReview}
          className="inline-flex items-center justify-center px-4 h-11 font-bold text-sm rounded-button disabled:opacity-60 bg-button-primary-background text-button-primary-text"
        >
          Review
        </button>
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

interface ReviewRowProps {
  label: string;
  value: React.ReactNode;
}

function ReviewRow({ label, value }: ReviewRowProps) {
  return (
    <div className="flex gap-3 items-baseline">
      <dt className="text-text-secondary text-xs font-semibold uppercase tracking-wide w-20 shrink-0">
        {label}
      </dt>
      <dd className="text-text">{value}</dd>
    </div>
  );
}
