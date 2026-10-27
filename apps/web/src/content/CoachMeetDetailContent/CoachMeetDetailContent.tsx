"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { MeetWithSwimsResponse, CoachSwimmer } from "@swim-app/shared";
import { VALID_EVENTS } from "@swim-app/shared";

import { addSwim } from "./actions";
import type { AddSwimState } from "./actions";

const COURSE_LABELS: Record<string, string> = {
  scy: "SCY",
  scm: "SCM",
  lcm: "LCM",
};

const STROKE_LABELS: Record<string, string> = {
  free: "Freestyle",
  back: "Backstroke",
  breast: "Breaststroke",
  fly: "Butterfly",
  im: "IM",
};

interface AddSwimFormProps {
  meet: MeetWithSwimsResponse;
  swimmers: CoachSwimmer[];
}

function AddSwimForm({ meet, swimmers }: AddSwimFormProps) {
  const [open, setOpen] = useState(false);
  const [selectedStroke, setSelectedStroke] = useState<string>("free");
  const [distanceValue, setDistanceValue] = useState<string>("");
  const [swimmerId, setSwimmerId] = useState<string>("");
  const [timeString, setTimeString] = useState<string>("");
  const [swumOn, setSwumOn] = useState<string>(meet.meetDate);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const [state, action, isPending] = useActionState<AddSwimState, FormData>(
    addSwim.bind(null, meet.id),
    { status: "idle" },
  );

  useEffect(() => {
    if (state.status === "success") {
      setOpen(false);
    }
  }, [state.status]);

  useEffect(() => {
    if (open) {
      setSelectedStroke("free");
      setDistanceValue("");
      setSwimmerId("");
      setTimeString("");
      setSwumOn(meet.meetDate);
    }
  }, [open, meet.meetDate]);

  useEffect(() => {
    if (state.status === "error") {
      errorRef.current?.focus();
    }
  }, [state]);

  const distances = VALID_EVENTS[selectedStroke as keyof typeof VALID_EVENTS] ?? [];

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center px-5 min-h-[44px] font-bold text-sm rounded-button"
        style={{
          backgroundColor: "var(--color-button-primary-background)",
          color: "var(--color-button-primary-text)",
        }}
      >
        Add swim
      </button>
    );
  }

  return (
    <form
      action={action}
      className="flex flex-col gap-4 p-5 rounded-card border border-border bg-background"
    >
      <h3 className="font-heading font-semibold text-base text-heading" style={{ fontVariationSettings: '"SOFT" 100, "WONK" 0' }}>
        Add swim
      </h3>

      <div className="flex flex-col gap-1">
        <label htmlFor="swim-swimmer" className="text-sm font-semibold text-text">
          Swimmer
        </label>
        <select
          id="swim-swimmer"
          name="swimmerId"
          required
          value={swimmerId}
          onChange={(e) => setSwimmerId(e.target.value)}
          className="h-11 px-3 rounded-lg border border-border bg-background text-text text-sm focus:outline focus:outline-2 focus:outline-focus-ring"
        >
          <option value="">Select swimmer…</option>
          {swimmers.map((swimmer) => (
            <option key={swimmer.id} value={swimmer.id}>
              {swimmer.firstName} {swimmer.lastName}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-3">
        <div className="flex flex-col gap-1 flex-1">
          <label htmlFor="swim-stroke" className="text-sm font-semibold text-text">
            Stroke
          </label>
          <select
            id="swim-stroke"
            name="eventStroke"
            required
            value={selectedStroke}
            onChange={(event) => {
              setSelectedStroke(event.target.value);
              setDistanceValue("");
            }}
            className="h-11 px-3 rounded-lg border border-border bg-background text-text text-sm focus:outline focus:outline-2 focus:outline-focus-ring"
          >
            {Object.entries(STROKE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1 flex-1">
          <label htmlFor="swim-distance" className="text-sm font-semibold text-text">
            Distance
          </label>
          <select
            id="swim-distance"
            name="eventDistance"
            required
            value={distanceValue}
            onChange={(e) => setDistanceValue(e.target.value)}
            className="h-11 px-3 rounded-lg border border-border bg-background text-text text-sm focus:outline focus:outline-2 focus:outline-focus-ring"
          >
            <option value="">Select…</option>
            {distances.map((dist) => (
              <option key={dist} value={dist}>{dist}y / {dist}m</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="swim-course" className="text-sm font-semibold text-text">
          Course
        </label>
        <select
          id="swim-course"
          name="course"
          required
          defaultValue={meet.course}
          className="h-11 px-3 rounded-lg border border-border bg-background text-text text-sm focus:outline focus:outline-2 focus:outline-focus-ring"
        >
          <option value="scy">SCY (Short Course Yards)</option>
          <option value="scm">SCM (Short Course Meters)</option>
          <option value="lcm">LCM (Long Course Meters)</option>
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="swim-time" className="text-sm font-semibold text-text">
          Time
        </label>
        <input
          id="swim-time"
          name="timeString"
          type="text"
          required
          placeholder="e.g. 1:02.34 or 58.30"
          inputMode="decimal"
          value={timeString}
          onChange={(e) => setTimeString(e.target.value)}
          className="h-11 px-3 rounded-lg border border-border bg-background text-text text-sm font-variant-numeric tabular-nums focus:outline focus:outline-2 focus:outline-focus-ring"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="swim-date" className="text-sm font-semibold text-text">
          Date
        </label>
        <input
          id="swim-date"
          name="swumOn"
          type="date"
          required
          value={swumOn}
          onChange={(e) => setSwumOn(e.target.value)}
          className="h-11 px-3 rounded-lg border border-border bg-background text-text text-sm focus:outline focus:outline-2 focus:outline-focus-ring"
        />
      </div>

      {state.status === "error" && (
        <p
          ref={errorRef}
          role="alert"
          aria-live="assertive"
          tabIndex={-1}
          style={{ outline: "none" }}
          className="text-sm text-danger"
        >
          {state.message}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center justify-center px-5 min-h-[44px] font-bold text-sm rounded-button disabled:opacity-60"
          style={{
            backgroundColor: "var(--color-button-primary-background)",
            color: "var(--color-button-primary-text)",
          }}
        >
          {isPending ? "Saving…" : "Save swim"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex items-center justify-center px-5 min-h-[44px] font-semibold text-sm rounded-button border"
          style={{
            borderColor: "var(--color-button-outline)",
            color: "var(--color-button-outline)",
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

interface CoachMeetDetailContentProps {
  meet: MeetWithSwimsResponse;
  swimmers: CoachSwimmer[];
}

export default function CoachMeetDetailContent({ meet, swimmers }: CoachMeetDetailContentProps) {
  return (
    <div className="flex flex-col flex-1">
      <main className="flex-1 px-page py-16">
        <div className="mx-auto max-w-content flex flex-col gap-8">
          <div>
            <Link
              href="/coach/meets"
              className="text-sm text-link underline hover:text-link-hover mb-4 inline-block"
            >
              ← All meets
            </Link>
            <h1 className="text-heading font-heading font-semibold" style={{ fontVariationSettings: '"SOFT" 100, "WONK" 0' }}>
              {meet.name}
            </h1>
            <p className="text-sm text-text-secondary mt-1">
              {meet.meetDate} · {COURSE_LABELS[meet.course] ?? meet.course}
            </p>
          </div>

          <AddSwimForm meet={meet} swimmers={swimmers} />

          {meet.swims.length === 0 ? (
            <p className="text-sm text-text-secondary">No swims recorded for this meet yet.</p>
          ) : (
            <section className="flex flex-col gap-3">
              <h2 className="font-bold text-text">Swims</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left font-semibold text-text-secondary pb-2 pr-4">Event</th>
                      <th className="text-left font-semibold text-text-secondary pb-2 pr-4">Course</th>
                      <th className="text-right font-semibold text-text-secondary pb-2 pr-4">Time</th>
                      <th className="text-left font-semibold text-text-secondary pb-2">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {meet.swims.map((swim) => (
                      <tr key={swim.id} className="border-t border-border">
                        <td className="py-3 pr-4 text-text font-semibold">
                          {swim.eventDistance} {STROKE_LABELS[swim.eventStroke] ?? swim.eventStroke}
                        </td>
                        <td className="py-3 pr-4 text-text-secondary">
                          {COURSE_LABELS[swim.course] ?? swim.course}
                        </td>
                        <td className="py-3 pr-4 text-right font-variant-numeric tabular-nums text-text font-semibold">
                          {swim.timeString}
                        </td>
                        <td className="py-3 text-text-secondary">{swim.swumOn}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
