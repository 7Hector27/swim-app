"use client";

import { useState, useTransition, useActionState, useEffect, useRef } from "react";
import Link from "next/link";
import { todayLA } from "@swim-app/shared";
import type {
  CoachLessonDetail,
  LessonLocation,
  WeekAvailabilityResponse,
  MonthAvailabilityResponse,
} from "@swim-app/shared";

import {
  fetchRangeAction,
  fetchMonthRangeAction,
  findFirstAvailableDayAction,
} from "@/content/BookCalendarContent/actions";
import {
  getMondayOfWeek,
  addDaysToDateStr,
  formatSlotTime,
  formatSlotRangeWithDate,
  getSlotHHMM,
  formatDayLabel,
} from "@/content/BookCalendarContent/helpers";
import WeekNav from "@/content/BookCalendarContent/WeekNav";
import MonthGrid from "@/content/BookCalendarContent/MonthGrid";
import PhoneDayStrip from "@/content/BookCalendarContent/PhoneDayStrip";
import ConfirmDialog from "@/components/ConfirmDialog";

import RescheduleLegend from "@/content/RescheduleContent/RescheduleLegend";
import RescheduleWeekGrid from "@/content/RescheduleContent/RescheduleWeekGrid";
import ReschedulePhoneTimeList from "@/content/RescheduleContent/ReschedulePhoneTimeList";
import RescheduleBottomBar from "@/content/RescheduleContent/RescheduleBottomBar";
import {
  coachRescheduleLessonAction,
  coachCancelLessonAction,
  type CoachRescheduleState,
} from "./actions";

interface Props {
  lesson: CoachLessonDetail;
  locations: LessonLocation[];
}

type CalendarView = "week" | "month";

type FetchSpec =
  | { mode: "week"; monday: string; key: number }
  | { mode: "month"; monthStr: string; key: number };

function getMonthStr(dateStr: string): string {
  return dateStr.slice(0, 7);
}

function formatMonthLabel(dateStr: string): string {
  const date = new Date(`${dateStr}T12:00:00`);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(date);
}

function getLessonDateLA(startsAt: string): string {
  return new Intl.DateTimeFormat("sv", { timeZone: "America/Los_Angeles" }).format(
    new Date(startsAt),
  );
}

function formatLessonTimeRange(startsAt: string, durationMinutes: number): string {
  const start = new Date(startsAt);
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  const fmt = (date: Date) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date);
  return `${fmt(start)} – ${fmt(end)}`;
}

function formatLessonDateFull(startsAt: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(startsAt));
}

function getDowAbbr(dateStr: string): string {
  const dow = new Date(`${dateStr}T12:00:00`).getDay();
  return ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][dow] ?? "";
}

function getDayNumber(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00`).getDate();
}

const VIEW_TOGGLE_BASE =
  "min-h-[36px] px-4 rounded-full border text-sm font-semibold transition-colors duration-150 motion-reduce:transition-none";
const VIEW_TOGGLE_ACTIVE = "bg-heading text-background border-heading";
const VIEW_TOGGLE_INACTIVE = "border-border text-text hover:bg-surface-soft";

export default function CoachRescheduleContent({ lesson, locations }: Props) {
  const today = todayLA();
  const lessonDateLA = getLessonDateLA(lesson.startsAt);
  const lessonStartHHMM = getSlotHHMM(lesson.startsAt);

  const [calendarView, setCalendarView] = useState<CalendarView>("week");
  const [currentDate, setCurrentDate] = useState<string>(lessonDateLA);
  const [locationId, setLocationId] = useState<string>(lesson.locationId);
  const [durationMinutes, setDurationMinutes] = useState<30 | 45 | 60>(lesson.durationMinutes);
  const [selectedStartsAt, setSelectedStartsAt] = useState<string | null>(null);
  const [weekData, setWeekData] = useState<WeekAvailabilityResponse | null>(null);
  const [monthData, setMonthData] = useState<MonthAvailabilityResponse | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedPhoneDay, setSelectedPhoneDay] = useState<string | null>(lessonDateLA);
  const [changePoolOpen, setChangePoolOpen] = useState(false);

  const [fetchSpec, setFetchSpec] = useState<FetchSpec>({
    mode: "week",
    monday: getMondayOfWeek(lessonDateLA),
    key: 0,
  });

  const [isFetching, startFetching] = useTransition();

  const [rescheduleState, rescheduleFormAction, isRescheduling] = useActionState<
    CoachRescheduleState,
    FormData
  >(coachRescheduleLessonAction, { status: "idle" });

  const [cancelState, cancelFormAction, isCanceling] = useActionState<
    CoachRescheduleState,
    FormData
  >(coachCancelLessonAction, { status: "idle" });

  const confirmDialogRef = useRef<HTMLDialogElement>(null);
  const cancelDialogRef = useRef<HTMLDialogElement>(null);

  const mondayStr = getMondayOfWeek(currentDate);
  const monthStr = getMonthStr(currentDate);

  const currentLesson = {
    date: lessonDateLA,
    startHHMM: lessonStartHHMM,
    durationMinutes: lesson.durationMinutes,
  };

  useEffect(() => {
    setFetchError(null);
    startFetching(async () => {
      if (calendarView === "month") {
        const result = await fetchMonthRangeAction({
          date: currentDate,
          durationMinutes,
          locationId,
          excludeLessonId: lesson.id,
        });
        if (result !== null) {
          setMonthData(result);
        } else {
          setFetchError("Could not load availability. Try again.");
        }
        return;
      }

      if (fetchSpec.mode === "week") {
        const result = await fetchRangeAction({
          view: "week",
          date: fetchSpec.monday,
          durationMinutes,
          locationId,
          excludeLessonId: lesson.id,
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

  function prevWeek() {
    const newMonday = addDaysToDateStr(mondayStr, -7);
    setCurrentDate(newMonday);
    setSelectedStartsAt(null);
    setFetchSpec((prev) => ({ mode: "week", monday: newMonday, key: prev.key + 1 }));
  }

  function nextWeek() {
    const newMonday = addDaysToDateStr(mondayStr, 7);
    setCurrentDate(newMonday);
    setSelectedStartsAt(null);
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
    setFetchSpec((prev) => ({
      mode: "month",
      monthStr: getMonthStr(newDate),
      key: prev.key + 1,
    }));
  }

  function goToday() {
    const newMonday = getMondayOfWeek(today);
    setCurrentDate(today);
    setSelectedStartsAt(null);
    setFetchSpec((prev) => ({ mode: "week", monday: newMonday, key: prev.key + 1 }));
  }

  function handleSlotClick(slot: { startsAt: string; state: string }) {
    if (slot.state === "available") {
      setSelectedStartsAt(slot.startsAt);
    }
  }

  function handleMonthDayClick(date: string) {
    setCurrentDate(date);
    setCalendarView("week");
    setSelectedStartsAt(null);
    setFetchSpec((prev) => ({
      mode: "week",
      monday: getMondayOfWeek(date),
      key: prev.key + 1,
    }));
  }

  function handleLocationChange(id: string) {
    setLocationId(id);
    setSelectedStartsAt(null);
    startFetching(async () => {
      const result = await findFirstAvailableDayAction({
        fromDate: today,
        durationMinutes,
        locationId: id,
        excludeLessonId: lesson.id,
      });
      if (result !== null && result.firstAvailableDate !== null) {
        const newDate = result.firstAvailableDate;
        setCurrentDate(newDate);
        setSelectedPhoneDay(newDate);
        setWeekData(result.weekData);
        setFetchSpec((prev) => ({
          mode: "week",
          monday: getMondayOfWeek(newDate),
          key: prev.key + 1,
        }));
      } else if (result !== null) {
        setWeekData(result.weekData);
        setFetchSpec((prev) => ({
          mode: "week",
          monday: getMondayOfWeek(today),
          key: prev.key + 1,
        }));
      }
    });
  }

  function handleDurationChange(duration: 30 | 45 | 60) {
    setDurationMinutes(duration);
    setSelectedStartsAt(null);
    startFetching(async () => {
      const result = await findFirstAvailableDayAction({
        fromDate: today,
        durationMinutes: duration,
        locationId,
        excludeLessonId: lesson.id,
      });
      if (result !== null && result.firstAvailableDate !== null) {
        const newDate = result.firstAvailableDate;
        setCurrentDate(newDate);
        setSelectedPhoneDay(newDate);
        setWeekData(result.weekData);
        setFetchSpec((prev) => ({
          mode: "week",
          monday: getMondayOfWeek(newDate),
          key: prev.key + 1,
        }));
      } else if (result !== null) {
        setWeekData(result.weekData);
        setFetchSpec((prev) => ({
          mode: "week",
          monday: getMondayOfWeek(today),
          key: prev.key + 1,
        }));
      }
    });
  }

  function handleConfirm() {
    if (!selectedStartsAt) return;
    confirmDialogRef.current?.showModal();
  }

  const selectedPhoneDayData =
    weekData?.days.find((day) => day.date === selectedPhoneDay) ?? null;

  const swimmerNames = lesson.swimmers.map((swimmer) => swimmer.firstName).join(", ");
  const lessonDateFull = formatLessonDateFull(lesson.startsAt);
  const lessonTimeRange = formatLessonTimeRange(lesson.startsAt, lesson.durationMinutes);
  const currentLocationName =
    locations.find((loc) => loc.id === locationId)?.name ?? lesson.locationName;

  const cancelDescription = `${lessonDateFull} at ${formatSlotTime(lesson.startsAt)} at ${lesson.locationName}. This can't be undone.`;
  const rescheduleDescription = selectedStartsAt
    ? `Move to ${formatSlotRangeWithDate(selectedStartsAt, durationMinutes)} at ${currentLocationName}.`
    : "";

  return (
    <div className="flex flex-col gap-5 pb-32">
      {/* Title */}
      <div>
        <h1 className="font-heading text-3xl tablet:text-4xl text-heading">
          Reschedule lesson
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          Pick a new time. The min-advance window does not apply.
        </p>
      </div>

      {/* Current appointment card */}
      <div className="rounded-card border border-border p-4 tablet:p-5 flex flex-col gap-3 tablet:flex-row tablet:items-center tablet:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-11 h-11 rounded-[10px] border-2 border-dashed border-accent flex flex-col items-center justify-center">
            <span className="text-[9px] font-bold uppercase text-accent tracking-wide">
              {getDowAbbr(lessonDateLA)}
            </span>
            <span className="text-base font-bold text-accent leading-none">
              {getDayNumber(lessonDateLA)}
            </span>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-0.5">
              Current appointment
            </p>
            <p className="text-sm font-semibold text-heading">
              {lessonDateFull} · {lessonTimeRange}
            </p>
            <p className="text-xs text-text-secondary mt-0.5">
              {lesson.locationName} · {lesson.durationMinutes} min · {swimmerNames}
            </p>
          </div>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <Link
            href={`/coach/lessons/${lesson.id}`}
            className="inline-flex items-center justify-center rounded-button border border-border text-text font-semibold text-sm px-4 h-10 transition-colors duration-150 hover:bg-surface-soft"
          >
            Keep this time
          </Link>
          <button
            type="button"
            onClick={() => cancelDialogRef.current?.showModal()}
            className="inline-flex items-center justify-center rounded-button border border-danger text-danger font-semibold text-sm px-4 h-10 transition-opacity hover:opacity-80"
          >
            Cancel appointment
          </button>
        </div>
      </div>

      {/* View toggle row */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex gap-1 ml-auto">
          <button
            type="button"
            onClick={() => {
              setCalendarView("week");
              setFetchSpec((prev) => ({
                mode: "week",
                monday: getMondayOfWeek(currentDate),
                key: prev.key + 1,
              }));
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

      {calendarView === "week" && <RescheduleLegend />}

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
      {calendarView === "week" && !isFetching && weekData !== null && (
        <>
          <div className="hidden tablet:block">
            <RescheduleWeekGrid
              days={weekData.days}
              durationMinutes={durationMinutes}
              selectedStartsAt={selectedStartsAt}
              todayStr={today}
              currentLesson={currentLesson}
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
            <ReschedulePhoneTimeList
              day={selectedPhoneDayData}
              durationMinutes={durationMinutes}
              selectedStartsAt={selectedStartsAt}
              onSlotClick={handleSlotClick}
              currentLesson={currentLesson}
            />
          </div>
        </>
      )}

      {/* Change pool or length collapsible */}
      <div className="rounded-card border border-border overflow-hidden">
        <button
          type="button"
          onClick={() => setChangePoolOpen((open) => !open)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-text hover:bg-surface-soft transition-colors duration-150"
          aria-expanded={changePoolOpen}
        >
          <span>Change pool or length</span>
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            className={`transition-transform duration-150 ${changePoolOpen ? "rotate-180" : ""}`}
          >
            <path
              d="M4 6l4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {changePoolOpen && (
          <div className="px-4 pb-4 flex flex-col gap-4 border-t border-border pt-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="reschedule-location" className="text-sm font-semibold text-text">
                Pool
              </label>
              <select
                id="reschedule-location"
                value={locationId}
                onChange={(event) => handleLocationChange(event.target.value)}
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
              <label htmlFor="reschedule-duration" className="text-sm font-semibold text-text">
                Length
              </label>
              <select
                id="reschedule-duration"
                value={durationMinutes}
                onChange={(event) =>
                  handleDurationChange(Number(event.target.value) as 30 | 45 | 60)
                }
                className="h-11 rounded-[8px] border border-border bg-background text-text px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value={30}>30 min</option>
                <option value={45}>45 min</option>
                <option value={60}>60 min</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {rescheduleState.status === "error" && (
        <p role="alert" className="text-sm text-danger text-center">
          {rescheduleState.message}
        </p>
      )}

      {/* Hidden forms */}
      <form
        id="coach-reschedule-confirm-form"
        action={rescheduleFormAction}
        aria-hidden="true"
        className="sr-only"
      >
        <input type="hidden" name="lessonId" value={lesson.id} />
        <input type="hidden" name="newStartsAt" value={selectedStartsAt ?? ""} />
        <input type="hidden" name="durationMinutes" value={durationMinutes} />
        <input type="hidden" name="locationId" value={locationId} />
      </form>

      <form
        id="coach-reschedule-cancel-form"
        action={cancelFormAction}
        aria-hidden="true"
        className="sr-only"
      >
        <input type="hidden" name="lessonId" value={lesson.id} />
      </form>

      {/* Confirm reschedule dialog */}
      <ConfirmDialog
        dialogRef={confirmDialogRef}
        title="Confirm reschedule?"
        description={rescheduleDescription}
        formId="coach-reschedule-confirm-form"
        confirmLabel="Reschedule"
        isPending={isRescheduling}
        {...(rescheduleState.status === "error" ? { errorMessage: rescheduleState.message } : {})}
        onCancel={() => confirmDialogRef.current?.close()}
      />

      {/* Cancel appointment dialog */}
      <ConfirmDialog
        dialogRef={cancelDialogRef}
        title="Cancel this lesson?"
        description={cancelDescription}
        formId="coach-reschedule-cancel-form"
        confirmLabel="Cancel lesson"
        confirmDanger
        cancelLabel="Keep it"
        isPending={isCanceling}
        {...(cancelState.status === "error" ? { errorMessage: cancelState.message } : {})}
        onCancel={() => cancelDialogRef.current?.close()}
      />

      {/* Sticky bottom bar */}
      <RescheduleBottomBar
        oldStartsAt={lesson.startsAt}
        newStartsAt={selectedStartsAt}
        durationMinutes={durationMinutes}
        needsApproval={false}
        onConfirm={handleConfirm}
        isConfirming={isRescheduling}
      />
    </div>
  );
}
