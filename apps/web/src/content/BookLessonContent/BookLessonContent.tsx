"use client";

import { useState, useTransition, useActionState } from "react";
import Link from "next/link";

import type { AvailableSlot, LessonLocation } from "@swim-app/shared";
import type { ParentSwimmer } from "@swim-app/shared";

import { fetchSlotsDirectAction, createLessonAction } from "./actions";
import type { BookLessonState } from "./helpers";

type Step = "location" | "datetime" | "slot" | "swimmers" | "confirm";

const STEP_ORDER: Step[] = [
  "location",
  "datetime",
  "slot",
  "swimmers",
  "confirm",
];

interface Props {
  locations: LessonLocation[];
  swimmers: ParentSwimmer[];
  isViewer: boolean;
}

export default function BookLessonContent({ locations, swimmers, isViewer }: Props) {
  const [step, setStep] = useState<Step>("location");
  const [locationId, setLocationId] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [duration, setDuration] = useState<30 | 45 | 60>(30);
  const [slotStartsAt, setSlotStartsAt] = useState<string | null>(null);
  const [selectedSwimmerIds, setSelectedSwimmerIds] = useState<string[]>([]);
  const [swimmerError, setSwimmerError] = useState<string | null>(null);

  const [isFetchingSlots, startFetchingSlots] = useTransition();
  const [availableSlots, setAvailableSlots] = useState<AvailableSlot[]>([]);
  const [slotsError, setSlotsError] = useState<string | null>(null);

  const [bookingState, bookingFormAction, isBooking] = useActionState(
    createLessonAction,
    { status: "idle" } as BookLessonState,
  );

  const todayLA = new Date().toLocaleDateString("sv", {
    timeZone: "America/Los_Angeles",
  });
  const maxDateLA = new Date(Date.now() + 70 * 24 * 60 * 60 * 1000).toLocaleDateString("sv", {
    timeZone: "America/Los_Angeles",
  });

  function handleSeekSlots() {
    setSlotsError(null);
    setAvailableSlots([]);
    setSlotStartsAt(null);
    setStep("slot");
    startFetchingSlots(async () => {
      const result = await fetchSlotsDirectAction(date, duration, locationId!);
      if ("error" in result) {
        setSlotsError(result.error);
      } else {
        setAvailableSlots(result.slots);
      }
    });
  }

  function toggleSwimmer(swimmerId: string) {
    setSelectedSwimmerIds((prev) =>
      prev.includes(swimmerId)
        ? prev.filter((id) => id !== swimmerId)
        : [...prev, swimmerId],
    );
    setSwimmerError(null);
  }

  function handleProceedFromSwimmers() {
    if (selectedSwimmerIds.length === 0) {
      setSwimmerError("Please select at least one swimmer.");
      return;
    }
    setStep("confirm");
  }

  function goBack() {
    if (step === "datetime") setStep("location");
    else if (step === "slot") setStep("datetime");
    else if (step === "swimmers") setStep("slot");
    else if (step === "confirm") setStep("swimmers");
  }

  const currentStepIndex = STEP_ORDER.indexOf(step);
  const showStepIndicator = step !== "location";

  const selectedLocation = locations.find((loc) => loc.id === locationId);

  const laTimeFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
  });

  const hasHomePool = locations.some((loc) => loc.isHomePool);

  if (isViewer) {
    return (
      <div>
        <h1 className="text-3xl tablet:text-4xl text-heading mb-6">Book a lesson</h1>
        <div className="rounded-card border border-border p-5 text-center max-w-lg mx-auto">
          <p className="font-semibold text-text">
            Booking is for household owners and managers.
          </p>
          <p className="text-text-secondary text-sm mt-1">
            Ask the household owner for booking access.
          </p>
        </div>
      </div>
    );
  }

  if (bookingState.status === "success") {
    return (
      <div>
        <h1 className="text-3xl tablet:text-4xl text-heading mb-6">Book a lesson</h1>
        <div className="rounded-card border border-border p-5 tablet:p-6 max-w-lg mx-auto text-center">
          <p className="text-xl font-semibold text-heading">
            {bookingState.autoApproved
              ? "Confirmed — you're all set!"
              : "Request sent — Jason will confirm shortly."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-3xl tablet:text-4xl text-heading mb-6">Book a lesson</h1>

      {showStepIndicator && (
        <p className="text-sm text-text-secondary mb-4">
          Step {currentStepIndex + 1} of {STEP_ORDER.length - 1}
        </p>
      )}

      <div className="rounded-card border border-border p-5 tablet:p-6 max-w-lg mx-auto">
        {step !== "location" && (
          <button
            type="button"
            onClick={goBack}
            className="text-sm text-link hover:text-link-hover transition-colors duration-150 mb-5 flex items-center gap-1 min-h-[44px]"
          >
            ← Back
          </button>
        )}

        {step === "location" && (
          <div>
            <h2 className="text-lg font-semibold text-heading mb-4">Choose a location</h2>
            <div className="grid grid-cols-1 gap-3">
              {locations.map((loc) => (
                <button
                  key={loc.id}
                  type="button"
                  onClick={() => {
                    setLocationId(loc.id);
                    setStep("datetime");
                  }}
                  className="rounded-button border border-border text-left px-4 py-3 hover:bg-surface-soft transition-colors duration-150 min-h-[52px] flex items-center justify-between"
                >
                  <span className="font-semibold text-text">{loc.name}</span>
                  {loc.isHomePool && (
                    <span className="text-xs text-text-secondary border border-border rounded-button px-2 py-0.5 ml-3 flex-shrink-0">
                      Home pool
                    </span>
                  )}
                </button>
              ))}
            </div>
            {!hasHomePool && (
              <p className="text-sm text-text-secondary mt-4">
                Want to swim at home?{" "}
                <Link
                  href="/household"
                  className="text-link hover:text-link-hover transition-colors duration-150"
                >
                  Set up your home pool →
                </Link>
              </p>
            )}
          </div>
        )}

        {step === "datetime" && (
          <div>
            <h2 className="text-lg font-semibold text-heading mb-4">Choose a date and duration</h2>
            <div className="flex flex-col gap-5">
              <div>
                <label htmlFor="lesson-date" className="block text-sm font-semibold text-text mb-1.5">
                  Date
                </label>
                <input
                  id="lesson-date"
                  type="date"
                  value={date}
                  min={todayLA}
                  max={maxDateLA}
                  onChange={(event) => setDate(event.target.value)}
                  className="w-full rounded-button border border-border px-3 h-11 text-text bg-background focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>

              <fieldset>
                <legend className="text-sm font-semibold text-text mb-2">Duration</legend>
                <div className="flex gap-3">
                  {([30, 45, 60] as const).map((minutes) => (
                    <label
                      key={minutes}
                      className="flex items-center gap-2 cursor-pointer min-h-[44px]"
                    >
                      <input
                        type="radio"
                        name="duration"
                        value={minutes}
                        checked={duration === minutes}
                        onChange={() => setDuration(minutes)}
                        className="accent-accent"
                      />
                      <span className="text-sm text-text">{minutes} min</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <button
                type="button"
                disabled={!date}
                onClick={handleSeekSlots}
                className="w-full rounded-button bg-button-primary-background text-button-primary-text font-semibold text-sm h-[52px] transition-opacity hover:opacity-90 active:scale-[0.97] disabled:opacity-50"
              >
                See available times
              </button>
            </div>
          </div>
        )}

        {step === "slot" && (
          <div>
            <h2 className="text-lg font-semibold text-heading mb-4">Choose a time</h2>
            {isFetchingSlots && (
              <div className="flex items-center gap-3 text-text-secondary py-6 justify-center">
                <svg
                  className="animate-spin"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                <span className="text-sm">Checking availability…</span>
              </div>
            )}
            {!isFetchingSlots && slotsError && (
              <p role="alert" className="text-sm text-danger">
                {slotsError}
              </p>
            )}
            {!isFetchingSlots && !slotsError && availableSlots.length === 0 && (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-text-secondary">
                  No available slots for this day. Try a different date.
                </p>
                <button
                  type="button"
                  onClick={() => setStep("datetime")}
                  className="rounded-button border border-border text-text font-semibold text-sm h-11 px-5 hover:bg-surface-soft transition-colors duration-150 self-start"
                >
                  Change date
                </button>
              </div>
            )}
            {!isFetchingSlots && availableSlots.length > 0 && (
              <div className="flex flex-col gap-2">
                {availableSlots.map((slot) => (
                  <button
                    key={slot.startsAt}
                    type="button"
                    onClick={() => {
                      setSlotStartsAt(slot.startsAt);
                      setStep("swimmers");
                    }}
                    className="rounded-button border border-border text-left px-4 h-11 font-semibold text-sm text-text hover:bg-surface-soft transition-colors duration-150 min-h-[44px]"
                  >
                    {laTimeFormatter.format(new Date(slot.startsAt))}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {step === "swimmers" && (
          <div>
            <h2 className="text-lg font-semibold text-heading mb-4">Who is this lesson for?</h2>
            {swimmers.length === 0 ? (
              <p className="text-sm text-text-secondary">
                No swimmers found. Add swimmers to your household first.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {swimmers.map((swimmer) => (
                  <label
                    key={swimmer.id}
                    className="flex items-center gap-3 cursor-pointer min-h-[44px]"
                  >
                    <input
                      type="checkbox"
                      checked={selectedSwimmerIds.includes(swimmer.id)}
                      onChange={() => toggleSwimmer(swimmer.id)}
                      className="accent-accent w-4 h-4"
                    />
                    <span className="text-sm font-semibold text-text">
                      {swimmer.firstName} {swimmer.lastName}
                    </span>
                  </label>
                ))}
              </div>
            )}
            {swimmerError && (
              <p role="alert" className="text-sm text-danger mt-3">
                {swimmerError}
              </p>
            )}
            <button
              type="button"
              onClick={handleProceedFromSwimmers}
              disabled={swimmers.length === 0}
              className="mt-5 w-full rounded-button bg-button-primary-background text-button-primary-text font-semibold text-sm h-[52px] transition-opacity hover:opacity-90 active:scale-[0.97] disabled:opacity-50"
            >
              Next
            </button>
          </div>
        )}

        {step === "confirm" && slotStartsAt && (
          <div>
            <h2 className="text-lg font-semibold text-heading mb-4">Confirm your booking</h2>

            {bookingState.status === "error" && (
              <div
                role="alert"
                className="rounded-button border border-danger text-danger text-sm px-4 py-3 mb-4"
              >
                {bookingState.message}
              </div>
            )}

            <div className="flex flex-col gap-3 mb-6 text-sm text-text">
              <div className="flex justify-between">
                <span className="text-text-secondary">Location</span>
                <span className="font-semibold">{selectedLocation?.name ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">Date</span>
                <span className="font-semibold">
                  {new Intl.DateTimeFormat("en-US", {
                    timeZone: "America/Los_Angeles",
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  }).format(new Date(slotStartsAt))}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">Time</span>
                <span className="font-semibold">
                  {new Intl.DateTimeFormat("en-US", {
                    timeZone: "America/Los_Angeles",
                    hour: "numeric",
                    minute: "2-digit",
                  }).format(new Date(slotStartsAt))}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">Duration</span>
                <span className="font-semibold">{duration} min</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">Swimmers</span>
                <span className="font-semibold text-right">
                  {swimmers
                    .filter((swimmer) => selectedSwimmerIds.includes(swimmer.id))
                    .map((swimmer) => `${swimmer.firstName} ${swimmer.lastName}`)
                    .join(", ")}
                </span>
              </div>
            </div>

            <form action={bookingFormAction}>
              <input type="hidden" name="startsAt" value={slotStartsAt} />
              <input type="hidden" name="durationMinutes" value={duration} />
              <input type="hidden" name="locationId" value={locationId ?? ""} />
              {selectedSwimmerIds.map((swimmerId) => (
                <input key={swimmerId} type="hidden" name="swimmerIds" value={swimmerId} />
              ))}
              <button
                type="submit"
                disabled={isBooking}
                className="w-full rounded-button bg-button-primary-background text-button-primary-text font-semibold text-sm h-[52px] transition-opacity hover:opacity-90 active:scale-[0.97] disabled:opacity-50"
              >
                {isBooking ? "Booking…" : "Book lesson"}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
