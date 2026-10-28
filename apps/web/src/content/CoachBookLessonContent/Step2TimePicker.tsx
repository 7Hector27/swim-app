"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import type {
  CoachHouseholdSearchResult,
  LessonLocation,
  WeekAvailabilityResponse,
} from "@swim-app/shared";
import { LESSON_DURATION_MINUTES } from "@swim-app/shared";
import WeekGrid from "@/content/BookCalendarContent/WeekGrid";
import PhoneDayStrip from "@/content/BookCalendarContent/PhoneDayStrip";
import PhoneTimeList from "@/content/BookCalendarContent/PhoneTimeList";
import WeekNav, { type WeekNavDot } from "@/content/BookCalendarContent/WeekNav";
import Legend from "@/content/BookCalendarContent/Legend";
import {
  addDaysToDateStr,
  getMondayOfWeek,
  formatDayLabel,
  maxBookableDateLA,
} from "@/content/BookCalendarContent/helpers";
import { useWeekPrefetch } from "@/content/BookCalendarContent/useWeekPrefetch";
import {
  fetchCoachRangeAction,
  fetchCoachWeekLessonsAction,
  type CoachWeekLesson,
} from "./actions";
import {
  buildLocationOptions,
  detectLocalOverlap,
  formatLessonTimeDisplay,
  laDateTimeToUtcIso,
  todayLA,
  type SelectedLocation,
} from "./helpers";

interface Props {
  household: CoachHouseholdSearchResult;
  swimmerIds: string[];
  namedPools: LessonLocation[];
  // Called when the coach taps Confirm. Receives the selected slot's UTC ISO
  // string plus the current overrideWindow intent + duration + locationId.
  onConfirm: (args: {
    startsAtUtc: string;
    durationMinutes: 30 | 45 | 60;
    locationId: string;
    locationName: string;
    overrideWindow: boolean;
    customTime: boolean;
  }) => void;
  onBack: () => void;
}

const TIME_OPTIONS: readonly string[] = (() => {
  const options: string[] = [];
  for (let hour = 0; hour < 24; hour++) {
    for (const min of [0, 15, 30, 45]) {
      options.push(`${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`);
    }
  }
  return options;
})();

// When the custom date is today, drop every 15-minute step that has
// already passed in LA. For future dates return the full day.
function timeOptionsFor(date: string, todayStr: string): readonly string[] {
  if (date !== todayStr) return TIME_OPTIONS;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const nowMinutes = hour * 60 + minute;
  return TIME_OPTIONS.filter((option) => {
    const [h, m] = option.split(":").map(Number);
    const optionMinutes = (h ?? 0) * 60 + (m ?? 0);
    return optionMinutes > nowMinutes;
  });
}

function formatTimeOption(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const hour = h ?? 0;
  const minute = m ?? 0;
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${period}`;
}

export default function Step2TimePicker({
  household,
  swimmerIds,
  namedPools,
  onConfirm,
  onBack,
}: Props) {
  const today = todayLA();

  const locationOptions: SelectedLocation[] = useMemo(
    () => buildLocationOptions(household, namedPools),
    [household, namedPools],
  );

  const [locationId, setLocationId] = useState<string | null>(
    locationOptions[0]?.id ?? null,
  );
  const [durationMinutes, setDurationMinutes] = useState<30 | 45 | 60>(30);
  const [mondayStr, setMondayStr] = useState<string>(getMondayOfWeek(today));
  const [selectedPhoneDay, setSelectedPhoneDay] = useState<string | null>(today);

  const [weekData, setWeekData] = useState<WeekAvailabilityResponse | null>(null);
  // All pending/approved lessons in the current week, across every location.
  // Used by the custom-time overlap check — the server's hard reject
  // (ADR 029) is "any time overlap at any pool", so this list must span
  // every location, not just the one the coach picked for this booking.
  const [weekLessons, setWeekLessons] = useState<CoachWeekLesson[]>([]);
  const [isFetching, startFetching] = useTransition();
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [selectedStartsAt, setSelectedStartsAt] = useState<string | null>(null);

  const [customOpen, setCustomOpen] = useState(false);
  const [customDate, setCustomDate] = useState<string>(today);
  const [customTime, setCustomTime] = useState<string>("16:00");

  const selectedLocation =
    locationOptions.find((option) => option.id === locationId) ?? null;

  const todayMondayStr = useMemo(() => getMondayOfWeek(today), [today]);
  const bookingMaxAdvanceWeeks = weekData?.bookingMaxAdvanceWeeks ?? 10;
  const maxAdvanceDateLA = useMemo(
    () => maxBookableDateLA(bookingMaxAdvanceWeeks, Date.now()),
    [bookingMaxAdvanceWeeks],
  );
  const nextMondayStr = addDaysToDateStr(mondayStr, 7);
  const prevMondayStr = addDaysToDateStr(mondayStr, -7);
  const disableNextWeek = nextMondayStr > maxAdvanceDateLA;
  const disablePrevWeek = prevMondayStr < todayMondayStr;

  const weekMondays = useMemo(() => {
    const list: string[] = [];
    let monday = todayMondayStr;
    while (monday <= maxAdvanceDateLA) {
      list.push(monday);
      monday = addDaysToDateStr(monday, 7);
    }
    return list;
  }, [todayMondayStr, maxAdvanceDateLA]);

  const weekPrefetch = useWeekPrefetch({
    windowStart: todayMondayStr,
    windowEnd: maxAdvanceDateLA,
    fetchWeek: useCallback(
      (monday: string) => {
        if (locationId === null) return Promise.resolve(null);
        return fetchCoachRangeAction({
          date: monday,
          durationMinutes,
          locationId,
        });
      },
      [locationId, durationMinutes],
    ),
  });

  useEffect(() => {
    if (locationId === null) return;
    setFetchError(null);
    const cached = weekPrefetch.readFromCache(mondayStr);
    if (cached !== null) setWeekData(cached);
    const fetchEpoch = weekPrefetch.beginFetch();
    startFetching(async () => {
      const result = await fetchCoachRangeAction({
        date: mondayStr,
        durationMinutes,
        locationId,
      });
      if (result === null) {
        setFetchError("Could not load availability. Try again.");
        return;
      }
      setWeekData(result);
      weekPrefetch.onWeekFetched(mondayStr, result, fetchEpoch);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mondayStr, durationMinutes, locationId]);

  const weekDots = useMemo<WeekNavDot[]>(() => {
    return weekMondays.map((weekMonday) => {
      const hasOpenValue = weekPrefetch.hasOpenByMonday.get(weekMonday);
      return {
        mondayStr: weekMonday,
        ...(hasOpenValue !== undefined && { hasOpen: hasOpenValue }),
      };
    });
  }, [weekMondays, weekPrefetch.hasOpenByMonday]);

  // Fetch every lesson in the week (any location) for the overlap check.
  // Decoupled from the slot-grid fetch above because location + duration
  // changes don't affect which lessons exist — just which slots render.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await fetchCoachWeekLessonsAction(mondayStr);
      if (!cancelled) setWeekLessons(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [mondayStr]);

  // When the custom-date flips to today (or the day rolls forward in a long
  // session), the current customTime may now be in the past. Snap to the
  // first still-valid option so the dropdown and selected value stay in sync.
  useEffect(() => {
    if (!customOpen) return;
    const options = timeOptionsFor(customDate, today);
    if (options.length === 0) return;
    if (!options.includes(customTime)) {
      setCustomTime(options[0]!);
    }
  }, [customOpen, customDate, customTime, today]);

  function handleWeekPrev() {
    setMondayStr((prev) => addDaysToDateStr(prev, -7));
    setSelectedStartsAt(null);
  }

  function handleWeekNext() {
    setMondayStr((prev) => addDaysToDateStr(prev, 7));
    setSelectedStartsAt(null);
  }

  function handleWeekToday() {
    setMondayStr(getMondayOfWeek(today));
    setSelectedStartsAt(null);
  }

  function handleJumpToMonday(monday: string) {
    if (monday === mondayStr) return;
    setMondayStr(monday);
    setSelectedStartsAt(null);
  }

  function handleLocationChange(id: string) {
    weekPrefetch.reset();
    setLocationId(id);
    setSelectedStartsAt(null);
  }

  function handleDurationChange(d: 30 | 45 | 60) {
    weekPrefetch.reset();
    setDurationMinutes(d);
    setSelectedStartsAt(null);
  }

  // Coach booking has no 16-hour notice rule — the server never emits
  // "too_soon" for coaches, so we only need to handle "available".
  function handleGridSlotClick(slot: { startsAt: string; state: string }) {
    if (slot.state === "available") {
      setSelectedStartsAt(slot.startsAt);
      setCustomOpen(false);
    }
  }

  const customStartsAtUtc = customOpen
    ? laDateTimeToUtcIso(customDate, customTime)
    : "";

  // Custom-time guard: start in the past is a hard server reject
  // (start_in_past, 422). Mirror that client-side so Confirm is disabled
  // and the picker never offers past dates/times today.
  const customInPast =
    customOpen && customStartsAtUtc !== ""
      ? new Date(customStartsAtUtc).getTime() <= Date.now()
      : false;

  // Local overlap detection against EVERY lesson in the week, regardless of
  // pool. Matches the server's hard-reject rule (ADR 029). We surface the
  // first collision inline so the coach retries without a server round
  // trip; the server has the final say.
  const customOverlap = useMemo(() => {
    if (!customOpen || !customStartsAtUtc) return { overlaps: false };
    return detectLocalOverlap({
      startsAtUtc: customStartsAtUtc,
      durationMinutes,
      existing: weekLessons,
    });
  }, [customOpen, customStartsAtUtc, weekLessons, durationMinutes]);

  const canConfirmGrid =
    !customOpen && selectedStartsAt !== null && selectedLocation !== null;
  const canConfirmCustom =
    customOpen &&
    customStartsAtUtc !== "" &&
    selectedLocation !== null &&
    !customOverlap.overlaps &&
    !customInPast;

  const confirmDisabled = !canConfirmGrid && !canConfirmCustom;

  function handleConfirm() {
    if (!selectedLocation) return;
    if (canConfirmCustom) {
      onConfirm({
        startsAtUtc: customStartsAtUtc,
        durationMinutes,
        locationId: selectedLocation.id,
        locationName: selectedLocation.name,
        overrideWindow: true,
        customTime: true,
      });
      return;
    }
    if (canConfirmGrid && selectedStartsAt) {
      onConfirm({
        startsAtUtc: selectedStartsAt,
        durationMinutes,
        locationId: selectedLocation.id,
        locationName: selectedLocation.name,
        overrideWindow: false,
        customTime: false,
      });
    }
  }

  const selectedPhoneDayData =
    weekData?.days.find((day) => day.date === selectedPhoneDay) ?? null;

  const activeTabClass = "bg-accent text-on-accent border-accent";
  const inactiveTabClass = "border-border text-text hover:bg-surface-soft";

  return (
    <div className="flex flex-col gap-5">
      {/* Context strip: who you're booking for */}
      <div className="rounded-card border border-border p-4 flex flex-col gap-2">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
          Booking for
        </p>
        <p className="text-sm font-semibold text-text">
          {household.householdName}
          <span className="text-text-secondary font-normal">
            {" "}· {swimmerIds.length} swimmer{swimmerIds.length === 1 ? "" : "s"}
          </span>
        </p>
      </div>

      {/* Location */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Pool</p>
        <div className="flex flex-wrap gap-2">
          {locationOptions.length === 0 && (
            <p className="text-sm text-text-secondary">
              No pools available. Set a home pool or add a named pool.
            </p>
          )}
          {!locationOptions.some((option) => option.isHomePool) && (
            <span className="min-h-[40px] px-3 inline-flex items-center rounded-button border border-dashed border-border text-text-secondary text-sm">
              Home pool: not set for this family
            </span>
          )}
          {locationOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => handleLocationChange(option.id)}
              aria-pressed={option.id === locationId}
              className={`min-h-[40px] px-4 rounded-button border text-sm font-semibold transition-colors duration-150 motion-reduce:transition-none active:scale-[0.97] ${
                option.id === locationId ? activeTabClass : inactiveTabClass
              }`}
            >
              {option.name}
            </button>
          ))}
        </div>
      </div>

      {/* Duration */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Duration</p>
        <div className="flex flex-wrap gap-2">
          {LESSON_DURATION_MINUTES.map((minutes) => (
            <button
              key={minutes}
              type="button"
              onClick={() => handleDurationChange(minutes)}
              aria-pressed={minutes === durationMinutes}
              className={`min-h-[40px] px-4 rounded-button border text-sm font-semibold transition-colors duration-150 motion-reduce:transition-none active:scale-[0.97] ${
                minutes === durationMinutes ? activeTabClass : inactiveTabClass
              }`}
            >
              {minutes} min
            </button>
          ))}
        </div>
      </div>

      {/* Calendar + custom time toggle */}
      {!customOpen && (
        <>
          <WeekNav
            mondayStr={mondayStr}
            onPrev={handleWeekPrev}
            onNext={handleWeekNext}
            onToday={handleWeekToday}
            todayStr={today}
            disablePrev={disablePrevWeek}
            disableNext={disableNextWeek}
            dots={{ weeks: weekDots, onJump: handleJumpToMonday }}
          />
          <Legend />

          {locationId === null && (
            <p className="text-sm text-text-secondary py-8 text-center" role="status">
              Pick a pool to see available times.
            </p>
          )}

          {locationId !== null && isFetching && (
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

          {locationId !== null && !isFetching && fetchError !== null && (
            <div className="rounded-card border border-border p-6 flex flex-col items-center gap-4">
              <p className="text-sm text-text-secondary">{fetchError}</p>
              <button
                type="button"
                onClick={() => {
                  setFetchError(null);
                  setMondayStr((prev) => prev);
                }}
                className="min-h-[44px] px-5 rounded-button border-2 border-button-outline text-button-outline text-sm font-semibold transition-opacity hover:opacity-70 active:scale-[0.97]"
              >
                Retry
              </button>
            </div>
          )}

          {locationId !== null && !isFetching && weekData !== null && (
            <>
              {/* Day labels for the desktop view, mirrors parent calendar */}
              <div className="hidden tablet:grid grid-cols-7 gap-1 w-full">
                {Array.from({ length: 7 }, (_, index) => (
                  <div
                    key={index}
                    className="text-center text-xs text-text-secondary py-2"
                  >
                    {formatDayLabel(addDaysToDateStr(mondayStr, index))}
                  </div>
                ))}
              </div>
              <div className="hidden tablet:block">
                <WeekGrid
                  days={weekData.days}
                  durationMinutes={durationMinutes}
                  selectedStartsAt={selectedStartsAt}
                  todayStr={today}
                  onSlotClick={handleGridSlotClick}
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
                  onSlotClick={handleGridSlotClick}
                />
              </div>
            </>
          )}

          <button
            type="button"
            onClick={() => {
              setCustomOpen(true);
              setSelectedStartsAt(null);
            }}
            className="self-start text-sm font-semibold text-link underline hover:text-link-hover transition-colors duration-150 motion-reduce:transition-none"
          >
            Pick a custom time
          </button>
        </>
      )}

      {customOpen && (
        <div className="flex flex-col gap-4 rounded-card border border-border p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-text">Custom time</p>
            <button
              type="button"
              onClick={() => setCustomOpen(false)}
              className="text-sm font-semibold text-text-secondary hover:text-text min-h-[44px] px-2"
            >
              Use the calendar instead
            </button>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col gap-1 min-w-[160px]">
              <label htmlFor="custom-date" className="text-xs font-semibold text-text-secondary">
                Date
              </label>
              <input
                id="custom-date"
                type="date"
                min={today}
                value={customDate}
                onChange={(event) => setCustomDate(event.target.value)}
                className="h-11 px-3 rounded-button border border-border bg-background text-text text-sm focus:outline focus:outline-2 focus:outline-focus-ring"
              />
            </div>
            <div className="flex flex-col gap-1 min-w-[160px]">
              <label htmlFor="custom-time" className="text-xs font-semibold text-text-secondary">
                Time (15-minute steps)
              </label>
              <select
                id="custom-time"
                value={customTime}
                onChange={(event) => setCustomTime(event.target.value)}
                className="h-11 px-3 rounded-button border border-border bg-background text-text text-sm focus:outline focus:outline-2 focus:outline-focus-ring"
              >
                {timeOptionsFor(customDate, today).map((option) => (
                  <option key={option} value={option}>
                    {formatTimeOption(option)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {customStartsAtUtc && (
            <p className="text-sm text-text-secondary">
              {formatLessonTimeDisplay(customStartsAtUtc)} ·{" "}
              {durationMinutes} min at {selectedLocation?.name ?? "a pool"}
            </p>
          )}

          <div
            role="alert"
            className="rounded-card border border-border bg-surface-soft p-3 text-sm text-text"
          >
            <p className="font-semibold">Overrides may apply</p>
            <p className="mt-1 text-text-secondary">
              The server will compute which warnings apply (teaching hours,
              travel buffer, daily cap, blocked times) and surface them in
              the confirmation step. You&apos;ll be asked to acknowledge each
              before the lesson is booked.
            </p>
          </div>

          {customInPast && (
            <p role="alert" className="text-sm text-danger font-semibold">
              That time has already passed. Pick a time in the future.
            </p>
          )}

          {customOverlap.overlaps && (
            <p role="alert" className="text-sm text-danger font-semibold">
              {customOverlap.overlapLabel}
            </p>
          )}
        </div>
      )}

      {/* Bottom bar */}
      <div className="sticky bottom-4 flex items-center gap-3 justify-end flex-wrap pt-2 bg-background">
        <button
          type="button"
          onClick={onBack}
          className="min-h-[44px] px-5 rounded-button border-2 border-button-outline text-button-outline text-sm font-semibold transition-opacity hover:opacity-70 active:scale-[0.97]"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={confirmDisabled}
          className="inline-flex items-center justify-center min-h-[52px] px-6 rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm transition-opacity duration-150 motion-reduce:transition-none hover:opacity-90 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Confirm
        </button>
      </div>
    </div>
  );
}
