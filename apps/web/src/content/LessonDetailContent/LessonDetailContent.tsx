"use client";

import { useRef, useActionState, useTransition, useState, useEffect } from "react";
import Link from "next/link";

import type { AvailableSlot, LessonLocation, UpcomingLesson } from "@swim-app/shared";

import AddNoteForm from "@/components/AddNoteForm";
import ConfirmDialog from "@/components/ConfirmDialog";
import { fetchSlotsDirectAction, findFirstAvailableDayAction } from "@/content/BookCalendarContent/actions";
import { cancelLessonAction, rescheduleLessonAction, type LessonDetailState } from "./actions";

interface Props {
  lesson: UpcomingLesson;
  locations: LessonLocation[];
  isViewer: boolean;
  isCoach: boolean;
}

export default function LessonDetailContent({ lesson, locations, isViewer, isCoach }: Props) {
  const cancelDialogRef = useRef<HTMLDialogElement>(null);
  const rescheduleDialogRef = useRef<HTMLDialogElement>(null);

  const [cancelState, cancelFormAction, isCanceling] = useActionState<LessonDetailState, FormData>(
    cancelLessonAction,
    { status: "idle" },
  );
  const [rescheduleState, rescheduleFormAction, isRescheduling] = useActionState<LessonDetailState, FormData>(
    rescheduleLessonAction,
    { status: "idle" },
  );

  const [rescheduleLocationId, setRescheduleLocationId] = useState(lesson.locationId);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleDuration, setRescheduleDuration] = useState<30 | 45 | 60>(
    lesson.durationMinutes,
  );
  const [rescheduleSlot, setRescheduleSlot] = useState<string | null>(null);
  const [availableSlots, setAvailableSlots] = useState<AvailableSlot[]>([]);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [noRescheduleAvailability, setNoRescheduleAvailability] = useState(false);
  const [isFetchingSlots, startFetchingSlots] = useTransition();

  const todayLAStr = new Date().toLocaleDateString("sv", { timeZone: "America/Los_Angeles" });

  const lessonHasStarted = new Date() >= new Date(lesson.startsAt);

  useEffect(() => {
    if (lessonHasStarted) return;
    setNoRescheduleAvailability(false);
    setRescheduleDate("");
    setAvailableSlots([]);
    setRescheduleSlot(null);
    setSlotsError(null);
    startFetchingSlots(async () => {
      const result = await findFirstAvailableDayAction({
        fromDate: todayLAStr,
        durationMinutes: rescheduleDuration,
        locationId: rescheduleLocationId,
        excludeLessonId: lesson.id,
      });
      if (result === null) {
        setSlotsError("Could not load availability. Try again.");
        return;
      }
      if (result.firstAvailableDate === null) {
        setNoRescheduleAvailability(true);
        return;
      }
      setRescheduleDate(result.firstAvailableDate);
      const slotsResult = await fetchSlotsDirectAction(
        result.firstAvailableDate,
        rescheduleDuration,
        rescheduleLocationId,
      );
      if ("error" in slotsResult) {
        setSlotsError(slotsResult.error);
      } else {
        setAvailableSlots(slotsResult.slots);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rescheduleLocationId, rescheduleDuration]);

  const canFindSlots = rescheduleLocationId && rescheduleDate;

  function handleFindSlots() {
    setSlotsError(null);
    setAvailableSlots([]);
    setRescheduleSlot(null);
    startFetchingSlots(async () => {
      const result = await fetchSlotsDirectAction(
        rescheduleDate,
        rescheduleDuration,
        rescheduleLocationId,
      );
      if ("error" in result) {
        setSlotsError(result.error);
      } else {
        setAvailableSlots(result.slots);
      }
    });
  }

  const rescheduleLocation = locations.find((loc) => loc.id === rescheduleLocationId);
  const rescheduleConfirmDescription = rescheduleSlot
    ? `Move to ${formatDateLabel(rescheduleSlot)} at ${formatTime(new Date(rescheduleSlot))} at ${rescheduleLocation?.name ?? "selected pool"}.`
    : "Confirm the new lesson time.";

  const startsAt = new Date(lesson.startsAt);
  const endsAt = new Date(startsAt.getTime() + lesson.durationMinutes * 60 * 1000);
  const lessonType = lesson.type === "private" ? "Private lesson" : "Family lesson";
  const swimmerNames = lesson.swimmers.map((swimmer) => swimmer.firstName).join(", ");

  const maxDateLA = new Date(Date.now() + 70 * 24 * 60 * 60 * 1000).toLocaleDateString("sv", {
    timeZone: "America/Los_Angeles",
  });

  return (
    <div className="flex flex-col flex-1 bg-background">

      <main id="main-content" className="flex-1">
        <div className="mx-auto max-w-content px-page pt-10 pb-20 tablet:pt-14 tablet:pb-32">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-link hover:text-link-hover transition-colors duration-150 mb-6"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back to dashboard
          </Link>

          <h1 className="text-3xl tablet:text-4xl text-heading mb-8">Lesson details</h1>

          <div className="flex flex-col gap-6 desktop:max-w-[640px]">
            {/* Lesson summary */}
            <div className="rounded-card border border-border p-5 tablet:p-6">
              <h2 className="text-xl text-heading mb-4">Summary</h2>
              <dl className="flex flex-col gap-3">
                <Row label="Date">{formatDateLabel(lesson.startsAt)}</Row>
                <Row label="Time">{`${formatTime(startsAt)} to ${formatTime(endsAt)}`}</Row>
                <Row label="Location">{lesson.locationName}</Row>
                <Row label="Duration">{`${lesson.durationMinutes} min`}</Row>
                <Row label="Swimmers">{swimmerNames || "—"}</Row>
                <Row label="Type">{lessonType}</Row>
                <Row label="Status">
                  {lesson.status === "approved" ? (
                    <span className="inline-flex items-center rounded-full text-xs font-semibold px-2.5 py-1 bg-success/10 text-success">
                      Confirmed
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full text-xs font-semibold px-2.5 py-1 bg-surface-soft text-text-secondary border border-border">
                      Pending
                    </span>
                  )}
                </Row>
              </dl>
            </div>

            {!isViewer && lessonHasStarted && (
              <p className="text-sm text-text-secondary">This lesson has already started.</p>
            )}

            {!isViewer && !lessonHasStarted && (
              <>
                {/* Reschedule */}
                <div className="rounded-card border border-border p-5 tablet:p-6">
                  <h2 className="text-xl text-heading mb-1">Reschedule</h2>
                  <p className="text-sm text-text-secondary mb-5">
                    Pick a new location, date, and time. The new slot must be at least 16 hours from now.
                  </p>

                  <form id="reschedule-form" action={rescheduleFormAction} className="flex flex-col gap-4">
                    <input type="hidden" name="lessonId" value={lesson.id} />
                    <input type="hidden" name="startsAt" value={rescheduleSlot ?? ""} />
                    <input type="hidden" name="durationMinutes" value={rescheduleDuration} />
                    <input type="hidden" name="locationId" value={rescheduleLocationId} />

                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="reschedule-location" className="text-sm font-semibold text-text">
                        Location
                      </label>
                      <select
                        id="reschedule-location"
                        value={rescheduleLocationId}
                        onChange={(event) => {
                          setRescheduleLocationId(event.target.value);
                          setAvailableSlots([]);
                          setRescheduleSlot(null);
                        }}
                        className="h-11 rounded-[8px] border border-border bg-background text-text px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                      >
                        {locations.map((loc) => (
                          <option key={loc.id} value={loc.id}>
                            {loc.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="reschedule-date" className="text-sm font-semibold text-text">
                        Date
                      </label>
                      <input
                        id="reschedule-date"
                        type="date"
                        min={todayLAStr}
                        max={maxDateLA}
                        value={rescheduleDate}
                        onChange={(event) => {
                          setRescheduleDate(event.target.value);
                          setAvailableSlots([]);
                          setRescheduleSlot(null);
                        }}
                        className="h-11 rounded-[8px] border border-border bg-background text-text px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="reschedule-duration" className="text-sm font-semibold text-text">
                        Duration
                      </label>
                      <select
                        id="reschedule-duration"
                        value={rescheduleDuration}
                        onChange={(event) => {
                          setRescheduleDuration(Number(event.target.value) as 30 | 45 | 60);
                          setAvailableSlots([]);
                          setRescheduleSlot(null);
                        }}
                        className="h-11 rounded-[8px] border border-border bg-background text-text px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                      >
                        <option value={30}>30 min</option>
                        <option value={45}>45 min</option>
                        <option value={60}>60 min</option>
                      </select>
                    </div>

                    <button
                      type="button"
                      onClick={handleFindSlots}
                      disabled={!canFindSlots || isFetchingSlots}
                      className="self-start inline-flex items-center justify-center rounded-button border-2 border-button-outline text-button-outline font-bold text-sm px-5 h-11 transition-colors duration-150 hover:opacity-80 disabled:opacity-50"
                    >
                      {isFetchingSlots ? "Finding times…" : "Find times"}
                    </button>

                    {slotsError && (
                      <p role="alert" className="text-sm text-danger">{slotsError}</p>
                    )}

                    {!isFetchingSlots && noRescheduleAvailability && (
                      <p className="text-sm text-text-secondary">No open times in the next 10 weeks.</p>
                    )}

                    {!isFetchingSlots && availableSlots.length === 0 && rescheduleDate && !slotsError && (
                      <p className="text-sm text-text-secondary">No available slots for that date.</p>
                    )}

                    {availableSlots.length > 0 && (
                      <div className="flex flex-col gap-1.5">
                        <p className="text-sm font-semibold text-text">Available times</p>
                        <div className="flex flex-wrap gap-2">
                          {availableSlots.map((slot) => (
                            <button
                              key={slot.startsAt}
                              type="button"
                              onClick={() => setRescheduleSlot(slot.startsAt)}
                              className={`inline-flex items-center justify-center rounded-button text-sm font-semibold px-4 h-10 border transition-colors duration-150 ${
                                rescheduleSlot === slot.startsAt
                                  ? "bg-button-primary-background text-button-primary-text border-transparent"
                                  : "bg-background text-text border-border hover:border-accent"
                              }`}
                            >
                              {formatTime(new Date(slot.startsAt))}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </form>

                  <button
                    type="button"
                    disabled={!rescheduleSlot}
                    onClick={() => rescheduleDialogRef.current?.showModal()}
                    className="mt-5 inline-flex items-center justify-center rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm px-5 h-11 transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    Review reschedule
                  </button>
                </div>

                {/* Cancel */}
                <div className="rounded-card border border-border p-5 tablet:p-6">
                  <h2 className="text-xl text-heading mb-1">Cancel lesson</h2>
                  <p className="text-sm text-text-secondary mb-5">
                    Canceling is permanent. Jason will be notified.
                  </p>

                  <form id="cancel-form" action={cancelFormAction}>
                    <input type="hidden" name="lessonId" value={lesson.id} />
                  </form>

                  <button
                    type="button"
                    onClick={() => cancelDialogRef.current?.showModal()}
                    className="inline-flex items-center justify-center rounded-button bg-danger text-button-danger-text font-bold text-sm px-5 h-11 transition-opacity hover:opacity-90"
                  >
                    Cancel this lesson
                  </button>
                </div>
              </>
            )}
          </div>

          {isCoach && lesson.swimmers.length > 0 && (
            <div className="flex flex-col gap-4 mt-2 desktop:max-w-[640px]">
              <h2 className="text-xl text-heading">Lesson notes</h2>
              {lesson.swimmers.map((swimmer) => (
                <div key={swimmer.swimmerId} className="rounded-card border border-border p-5 tablet:p-6 flex flex-col gap-3">
                  <p className="text-sm font-semibold text-text">{swimmer.firstName} {swimmer.lastName}</p>
                  <AddNoteForm
                    swimmerId={swimmer.swimmerId}
                    lessonId={lesson.id}
                    label="Note"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      <ConfirmDialog
        dialogRef={cancelDialogRef}
        title="Cancel this lesson?"
        description={`${formatDateLabel(lesson.startsAt)} at ${formatTime(startsAt)} at ${lesson.locationName}. This can't be undone.`}
        formId="cancel-form"
        confirmLabel="Cancel lesson"
        confirmDanger
        cancelLabel="Keep it"
        isPending={isCanceling}
        {...(cancelState.status === "error" ? { errorMessage: cancelState.message } : {})}
        onCancel={() => cancelDialogRef.current?.close()}
      />

      <ConfirmDialog
        dialogRef={rescheduleDialogRef}
        title="Confirm reschedule?"
        description={rescheduleConfirmDescription}
        formId="reschedule-form"
        confirmLabel="Reschedule"
        isPending={isRescheduling}
        {...(rescheduleState.status === "error" ? { errorMessage: rescheduleState.message } : {})}
        onCancel={() => rescheduleDialogRef.current?.close()}
      />
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <dt className="text-sm text-text-secondary w-24 flex-shrink-0">{label}</dt>
      <dd className="text-sm text-text">{children}</dd>
    </div>
  );
}

function formatDateLabel(startsAt: string): string {
  const date = new Date(startsAt);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(date);
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}
