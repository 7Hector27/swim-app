"use client";

import { useState, useTransition, useActionState, useEffect, startTransition } from "react";
import { useRouter } from "next/navigation";
import { todayLA } from "@swim-app/shared";
import type { ParentSwimmer, WeekAvailabilityResponse } from "@swim-app/shared";

import { fetchRangeAction, createBookingAction, findFirstAvailableDayAction } from "./actions";
import { getMondayOfWeek, addDaysToDateStr, formatDayLabel, formatWeekLabel } from "./helpers";
import type { BookingState } from "./helpers";
import CalendarConfigRow from "./CalendarConfigRow";
import WeekNav from "./WeekNav";
import Legend from "./Legend";
import WeekGrid from "./WeekGrid";
import MonthGrid from "./MonthGrid";
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
  initialView?: "week" | "month";
  initialDate?: string;
}

type CalendarView = "week" | "month";

function formatMonthLabel(dateStr: string): string {
  const date = new Date(`${dateStr}T12:00:00`);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(date);
}

function getMonthStr(dateStr: string): string {
  return dateStr.slice(0, 7);
}

export default function BookCalendarContent({
  locations,
  swimmers,
  isViewer,
  householdFailed = false,
  initialView = "week",
  initialDate,
}: Props) {
  const router = useRouter();

  const today = todayLA();

  const [calendarView, setCalendarView] = useState<CalendarView>(initialView);
  const [currentDate, setCurrentDate] = useState<string>(initialDate ?? today);
  const [locationId, setLocationId] = useState<string | null>(locations[0]?.id ?? null);
  const [durationMinutes, setDurationMinutes] = useState<30 | 45 | 60>(30);
  const [swimmerIds, setSwimmerIds] = useState<string[]>([]);
  const [selectedStartsAt, setSelectedStartsAt] = useState<string | null>(null);
  const [tooSoon, setTooSoon] = useState(false);
  const [weekData, setWeekData] = useState<WeekAvailabilityResponse | null>(null);
  const [monthData, setMonthData] = useState<WeekAvailabilityResponse | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedPhoneDay, setSelectedPhoneDay] = useState<string | null>(null);
  const [noAvailability, setNoAvailability] = useState(false);

  type FetchSpec =
    | { mode: "search"; key: number }
    | { mode: "week"; monday: string; key: number }
    | { mode: "month"; monthStr: string; key: number };

  const [fetchSpec, setFetchSpec] = useState<FetchSpec>({ mode: "search", key: 0 });

  const [isFetching, startFetching] = useTransition();
  const [bookingState, bookingFormAction, isBooking] = useActionState(
    createBookingAction,
    { status: "idle" } as BookingState,
  );

  const mondayStr = getMondayOfWeek(currentDate);
  const monthStr = getMonthStr(currentDate);

  // Fetch data whenever spec, view, location, or duration changes
  useEffect(() => {
    if (!locationId) return;
    setNoAvailability(false);
    setFetchError(null);
    startFetching(async () => {
      if (calendarView === "month") {
        const result = await fetchRangeAction({
          view: "month",
          date: currentDate,
          durationMinutes,
          locationId,
        });
        if (result !== null) {
          setMonthData(result);
        } else {
          setFetchError("Could not load availability. Try again.");
        }
        return;
      }

      if (fetchSpec.mode === "search") {
        const result = await findFirstAvailableDayAction({
          fromDate: today,
          durationMinutes,
          locationId,
        });
        if (result === null) {
          setFetchError("Could not load availability. Try again.");
          return;
        }
        setWeekData(result.weekData);
        if (result.firstAvailableDate !== null) {
          setCurrentDate(result.firstAvailableDate);
          setSelectedPhoneDay(result.firstAvailableDate);
        } else {
          setCurrentDate(today);
          setSelectedPhoneDay(null);
          setNoAvailability(true);
        }
      } else if (fetchSpec.mode === "week") {
        const result = await fetchRangeAction({
          view: "week",
          date: fetchSpec.monday,
          durationMinutes,
          locationId,
        });
        if (result !== null) {
          setWeekData(result);
        } else {
          setFetchError("Could not load availability. Try again.");
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchSpec, locationId, durationMinutes, calendarView]);

  useEffect(() => {
    if (bookingState.status !== "success") return;
    router.push(`/dashboard?booked=${bookingState.lessonId}`);
  }, [bookingState, router]);

  function handleLocationChange(id: string) {
    setLocationId(id);
    setSelectedStartsAt(null);
    setTooSoon(false);
    setFetchSpec((prev) => ({ mode: "search", key: prev.key + 1 }));
  }

  function handleDurationChange(d: 30 | 45 | 60) {
    setDurationMinutes(d);
    setSelectedStartsAt(null);
    setTooSoon(false);
    setFetchSpec((prev) => ({ mode: "search", key: prev.key + 1 }));
  }

  function prevWeek() {
    const newMonday = addDaysToDateStr(mondayStr, -7);
    setCurrentDate(newMonday);
    setSelectedStartsAt(null);
    setTooSoon(false);
    setFetchSpec((prev) => ({ mode: "week", monday: newMonday, key: prev.key + 1 }));
  }

  function nextWeek() {
    const newMonday = addDaysToDateStr(mondayStr, 7);
    setCurrentDate(newMonday);
    setSelectedStartsAt(null);
    setTooSoon(false);
    setFetchSpec((prev) => ({ mode: "week", monday: newMonday, key: prev.key + 1 }));
  }

  function prevMonth() {
    const [yearStr, monthIndexStr] = monthStr.split("-").map(Number);
    const year = yearStr ?? 2026;
    const monthIndex = monthIndexStr ?? 10;
    const prevDate = new Date(year, monthIndex - 2, 1);
    const newDate = prevDate.toISOString().slice(0, 10);
    setCurrentDate(newDate);
    setSelectedStartsAt(null);
    setTooSoon(false);
    setFetchSpec((prev) => ({
      mode: "month",
      monthStr: getMonthStr(newDate),
      key: prev.key + 1,
    }));
  }

  function nextMonth() {
    const [yearStr, monthIndexStr] = monthStr.split("-").map(Number);
    const year = yearStr ?? 2026;
    const monthIndex = monthIndexStr ?? 10;
    const nextDate = new Date(year, monthIndex, 1);
    const newDate = nextDate.toISOString().slice(0, 10);
    setCurrentDate(newDate);
    setSelectedStartsAt(null);
    setTooSoon(false);
    setFetchSpec((prev) => ({
      mode: "month",
      monthStr: getMonthStr(newDate),
      key: prev.key + 1,
    }));
  }

  function goToday() {
    setCurrentDate(today);
    setSelectedStartsAt(null);
    setTooSoon(false);
    setFetchSpec((prev) => ({ mode: "search", key: prev.key + 1 }));
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

  function handleMonthDayClick(date: string) {
    // Switch to week view for the clicked date
    setCurrentDate(date);
    setCalendarView("week");
    setSelectedStartsAt(null);
    setTooSoon(false);
    setFetchSpec((prev) => ({
      mode: "week",
      monday: getMondayOfWeek(date),
      key: prev.key + 1,
    }));
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
    startTransition(() => {
      bookingFormAction(form);
    });
  }

  const errorMessage =
    bookingState.status === "error" ? bookingState.message : fetchError;

  const selectedPhoneDayData =
    weekData?.days.find((day) => day.date === selectedPhoneDay) ?? null;

  const VIEW_TOGGLE_BASE =
    "min-h-[36px] px-4 rounded-full border text-sm font-semibold transition-colors duration-150 motion-reduce:transition-none";
  const VIEW_TOGGLE_ACTIVE = "bg-heading text-background border-heading";
  const VIEW_TOGGLE_INACTIVE = "border-border text-text hover:bg-surface-soft";

  if (householdFailed) {
    return (
      <div>
        <h1 className="font-heading text-3xl tablet:text-4xl text-heading mb-6">
          Book a lesson
        </h1>
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
        <h1 className="font-heading text-3xl tablet:text-4xl text-heading mb-6">
          Book a lesson
        </h1>
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
        <h1 className="font-heading text-3xl tablet:text-4xl text-heading mb-6">
          Book a lesson
        </h1>
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
      {/* Heading + view toggle */}
      <div className="flex items-center gap-4 flex-wrap">
        <h1 className="font-heading text-3xl tablet:text-4xl text-heading flex-1">
          Book a lesson
        </h1>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => {
              setCalendarView("week");
              setFetchSpec((prev) => ({ mode: "search", key: prev.key + 1 }));
            }}
            className={`${VIEW_TOGGLE_BASE} ${calendarView === "week" ? VIEW_TOGGLE_ACTIVE : VIEW_TOGGLE_INACTIVE}`}
          >
            Week
          </button>
          <button
            type="button"
            onClick={() => {
              setCalendarView("month");
              setFetchSpec((prev) => ({
                mode: "month",
                monthStr: getMonthStr(currentDate),
                key: prev.key + 1,
              }));
            }}
            className={`${VIEW_TOGGLE_BASE} ${calendarView === "month" ? VIEW_TOGGLE_ACTIVE : VIEW_TOGGLE_INACTIVE}`}
          >
            Month
          </button>
        </div>
      </div>

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

      {/* Nav row */}
      {calendarView === "week" ? (
        <WeekNav
          mondayStr={mondayStr}
          onPrev={prevWeek}
          onNext={nextWeek}
          onToday={goToday}
          todayStr={today}
        />
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={prevMonth}
            aria-label="Previous month"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-button border border-border text-text hover:bg-surface-soft transition-colors duration-150"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={nextMonth}
            aria-label="Next month"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-button border border-border text-text hover:bg-surface-soft transition-colors duration-150"
          >
            ›
          </button>
          <span className="text-sm font-semibold text-heading flex-1 text-center tablet:text-left">
            {formatMonthLabel(currentDate)}
          </span>
          <button
            type="button"
            onClick={goToday}
            className="min-h-[44px] px-4 rounded-button border border-border text-sm text-text hover:bg-surface-soft transition-colors duration-150"
          >
            Today
          </button>
        </div>
      )}

      {calendarView === "week" && <Legend />}

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
          {calendarView === "week" && (
            <div className="hidden tablet:grid grid-cols-7 gap-1 w-full">
              {Array.from({ length: 7 }, (_, index) => (
                <div key={index} className="text-center text-xs text-text-secondary py-2">
                  {formatDayLabel(addDaysToDateStr(mondayStr, index))}
                </div>
              ))}
            </div>
          )}
          <p className="text-sm text-text-secondary">{fetchError}</p>
          <button
            type="button"
            onClick={() => setFetchSpec((spec) => ({ ...spec, key: spec.key + 1 }))}
            className="min-h-[44px] px-5 rounded-button border-2 border-button-outline text-button-outline text-sm font-semibold transition-opacity hover:opacity-70 active:scale-[0.97]"
          >
            Retry
          </button>
        </div>
      )}

      {!isFetching && noAvailability && calendarView === "week" && (
        <p className="text-sm text-text-secondary py-4 text-center">
          No open times in the next 10 weeks. Check back later or contact Jason directly.
        </p>
      )}

      {/* Month view */}
      {calendarView === "month" && !isFetching && monthData !== null && (
        <MonthGrid
          monthStr={monthStr}
          days={monthData.days.map((day) => ({
            date: day.date,
            dayState: day.dayState,
            openCount: day.openCount,
            totalCount: day.totalCount,
          }))}
          todayStr={today}
          onDayClick={handleMonthDayClick}
        />
      )}

      {/* Week view */}
      {calendarView === "week" && !isFetching && weekData !== null && !noAvailability && (
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
