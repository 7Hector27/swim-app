"use client";

import { useState, useTransition, useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { todayLA } from "@swim-app/shared";
import type { ParentSwimmer, WeekAvailabilityResponse } from "@swim-app/shared";

import { fetchRangeAction, createBookingAction } from "./actions";
import { getMondayOfWeek, addDaysToDateStr, formatDayLabel } from "./helpers";
import type { BookingState } from "./helpers";
import CalendarConfigRow from "./CalendarConfigRow";
import WeekNav from "./WeekNav";
import Legend from "./Legend";
import WeekGrid from "./WeekGrid";
import PhoneDayStrip from "./PhoneDayStrip";
import PhoneTimeList from "./PhoneTimeList";
import BottomBar from "./BottomBar";

interface Location {
  id: string;
  name: string;
  isHomePool: boolean;
}

interface Props {
  locations: Location[];
  swimmers: ParentSwimmer[];
  isViewer: boolean;
  householdFailed?: boolean;
}

export default function BookCalendarContent({
  locations,
  swimmers,
  isViewer,
  householdFailed = false,
}: Props) {
  const router = useRouter();

  const today = todayLA();

  const [currentDate, setCurrentDate] = useState<string>(today);
  const [locationId, setLocationId] = useState<string | null>(locations[0]?.id ?? null);
  const [durationMinutes, setDurationMinutes] = useState<30 | 45 | 60>(30);
  const [swimmerIds, setSwimmerIds] = useState<string[]>([]);
  const [selectedStartsAt, setSelectedStartsAt] = useState<string | null>(null);
  const [tooSoon, setTooSoon] = useState(false);
  const [weekData, setWeekData] = useState<WeekAvailabilityResponse | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [selectedPhoneDay, setSelectedPhoneDay] = useState<string | null>(null);

  const [isFetching, startFetching] = useTransition();
  const [bookingState, bookingFormAction, isBooking] = useActionState(
    createBookingAction,
    { status: "idle" } as BookingState,
  );

  const mondayStr = getMondayOfWeek(currentDate);

  useEffect(() => {
    if (!locationId) return;
    startFetching(async () => {
      const result = await fetchRangeAction({
        view: "week",
        date: mondayStr,
        durationMinutes,
        locationId,
      });
      if (result !== null) {
        setWeekData(result);
        setFetchError(null);
      } else {
        setFetchError("Could not load availability. Try again.");
      }
    });
  }, [locationId, durationMinutes, mondayStr, retryCount]);

  useEffect(() => {
    if (bookingState.status !== "success") return;
    router.push(`/dashboard?booked=${bookingState.lessonId}`);
  }, [bookingState, router]);

  function handleLocationChange(id: string) {
    setLocationId(id);
    setSelectedStartsAt(null);
    setTooSoon(false);
  }

  function handleDurationChange(d: 30 | 45 | 60) {
    setDurationMinutes(d);
    setSelectedStartsAt(null);
    setTooSoon(false);
  }

  function prevWeek() {
    setCurrentDate(addDaysToDateStr(mondayStr, -7));
    setSelectedStartsAt(null);
    setTooSoon(false);
  }

  function nextWeek() {
    setCurrentDate(addDaysToDateStr(mondayStr, 7));
    setSelectedStartsAt(null);
    setTooSoon(false);
  }

  function goToday() {
    setCurrentDate(today);
    setSelectedStartsAt(null);
    setTooSoon(false);
  }

  function handleSlotClick(slot: { startsAt: string; state: string }) {
    if (slot.state === "available") {
      setSelectedStartsAt(slot.startsAt);
      setTooSoon(false);
    } else if (slot.state === "too_soon") {
      setSelectedStartsAt(null);
      setTooSoon(true);
    }
  }

  function handleConfirm() {
    if (!selectedStartsAt || !locationId || swimmerIds.length === 0) return;

    const form = new FormData();
    form.append("startsAt", selectedStartsAt);
    form.append("durationMinutes", String(durationMinutes));
    form.append("locationId", locationId);
    for (const id of swimmerIds) {
      form.append("swimmerIds", id);
    }
    bookingFormAction(form);
  }

  const errorMessage =
    bookingState.status === "error" ? bookingState.message : fetchError;

  const selectedPhoneDayData =
    weekData?.days.find((day) => day.date === selectedPhoneDay) ?? null;

  if (householdFailed) {
    return (
      <div>
        <h1 className="text-3xl tablet:text-4xl text-heading mb-6">Book a lesson</h1>
        <div className="rounded-card border border-border p-5 text-center max-w-lg mx-auto">
          <p className="font-semibold text-text">Unable to load your account data.</p>
          <p className="text-text-secondary text-sm mt-1">Please refresh the page.</p>
        </div>
      </div>
    );
  }

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

  if (locations.length === 0) {
    return (
      <div>
        <h1 className="text-3xl tablet:text-4xl text-heading mb-6">Book a lesson</h1>
        <div className="rounded-card border border-border p-5 text-center max-w-lg mx-auto">
          <p className="font-semibold text-text">No pools configured.</p>
          <p className="text-text-secondary text-sm mt-1">
            Add a home pool in household settings.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 pb-32">
      <h1 className="text-3xl tablet:text-4xl text-heading">Book a lesson</h1>

      {swimmers.length === 0 && (
        <p className="text-sm text-text-secondary">
          Add swimmers to your household to book.
        </p>
      )}

      <CalendarConfigRow
        locations={locations}
        swimmers={swimmers}
        locationId={locationId}
        durationMinutes={durationMinutes}
        swimmerIds={swimmerIds}
        isLoading={isFetching}
        onLocationChange={handleLocationChange}
        onDurationChange={handleDurationChange}
        onSwimmersChange={setSwimmerIds}
      />

      <WeekNav
        mondayStr={mondayStr}
        onPrev={prevWeek}
        onNext={nextWeek}
        onToday={goToday}
        todayStr={today}
      />

      <Legend />

      {isFetching && (
        <div className="flex items-center gap-3 text-text-secondary py-8 justify-center">
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
          <span className="text-sm">Loading availability…</span>
        </div>
      )}

      {!isFetching && fetchError !== null && (
        <div className="rounded-card border border-border p-6 flex flex-col items-center gap-4">
          <div className="hidden tablet:grid grid-cols-7 gap-1 w-full">
            {Array.from({ length: 7 }, (_, index) => (
              <div key={index} className="text-center text-xs text-text-secondary py-2">
                {formatDayLabel(addDaysToDateStr(mondayStr, index))}
              </div>
            ))}
          </div>
          <p className="text-sm text-text-secondary">{fetchError}</p>
          <button
            type="button"
            onClick={() => setRetryCount((count) => count + 1)}
            className="min-h-[44px] px-5 rounded-button border-2 border-button-outline text-button-outline text-sm font-semibold transition-opacity hover:opacity-70 active:scale-[0.97]"
          >
            Retry
          </button>
        </div>
      )}

      {!isFetching && weekData !== null && (
        <>
          <div className="hidden tablet:block">
            <WeekGrid
              days={weekData.days}
              durationMinutes={durationMinutes}
              selectedStartsAt={selectedStartsAt}
              todayStr={today}
              onSlotClick={handleSlotClick}
            />
          </div>

          <div className="tablet:hidden flex flex-col gap-4">
            <PhoneDayStrip
              days={weekData.days}
              selectedDayDate={selectedPhoneDay}
              todayStr={today}
              onDaySelect={setSelectedPhoneDay}
            />
            <PhoneTimeList
              day={selectedPhoneDayData}
              durationMinutes={durationMinutes}
              selectedStartsAt={selectedStartsAt}
              onSlotClick={handleSlotClick}
            />
          </div>
        </>
      )}

      <BottomBar
        selectedStartsAt={selectedStartsAt}
        tooSoon={tooSoon}
        durationMinutes={durationMinutes}
        swimmerIds={swimmerIds}
        needsApproval={weekData?.needsApproval ?? false}
        onConfirm={handleConfirm}
        isConfirming={isBooking}
        errorMessage={errorMessage}
      />

      <form
        action={bookingFormAction}
        aria-hidden="true"
        className="sr-only"
        tabIndex={-1}
      >
        {selectedStartsAt !== null && (
          <input type="hidden" name="startsAt" value={selectedStartsAt} />
        )}
        <input type="hidden" name="durationMinutes" value={durationMinutes} />
        {locationId !== null && (
          <input type="hidden" name="locationId" value={locationId} />
        )}
        {swimmerIds.map((id) => (
          <input key={id} type="hidden" name="swimmerIds" value={id} />
        ))}
      </form>
    </div>
  );
}
