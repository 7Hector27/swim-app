"use client";

import { useCallback, useEffect, useMemo, useState, useTransition, useActionState, startTransition } from "react";
import { useRouter } from "next/navigation";

import { redirectToPolicyUpdated } from "@/lib/policyAcceptanceRedirect";
import {
  BATCH_LESSON_MAX,
  BATCH_LESSON_MIN,
  LESSON_DURATION_MINUTES,
  priceForLesson,
  todayLA,
  type BatchPatternPair,
  type BatchPreviewBody,
  type BatchPreviewPick,
  type BatchSubmitBody,
  type BatchSubmitSuccessResponse,
  type LessonDurationMinutes,
  type MonthAvailabilityResponse,
  type ParentSwimmer,
  type SwimmerCount,
  type WeekAvailabilityResponse,
} from "@swim-app/shared";

import {
  createBookingAction,
  fetchMonthRangeAction,
  fetchRangeAction,
  findFirstAvailableDayAction,
  previewBatchAction,
  submitBatchAction,
} from "./actions";
import {
  addDaysToDateStr,
  formatDayLabel,
  formatPatternRangeAndLength,
  formatSlotRangeWithDate,
  getMondayOfWeek,
  maxBookableDateLA,
  type BookingState,
} from "./helpers";
import {
  doesSlotOverlapAnyPick,
  expandRecurring,
  findPickContainingSlot,
  isWithinAnyPickSpan,
  laDateFromIso,
  laIsoWeekday,
  laTimeOfDay,
  maxRecurringWeeksInWindow,
  pickReasonCopy,
  todayLaDateStr,
  wouldExceedDailyCap,
  type BookingMode,
  type MultiplePick,
  type PickWithDuration,
} from "./batchHelpers";
import { lessonPrice } from "@/lib/pricing";
import { formatDollars } from "@/lib/formatDollars";
import CalendarConfigRow from "./CalendarConfigRow";
import WeekNav, { type WeekNavDot } from "./WeekNav";
import { useWeekPrefetch } from "./useWeekPrefetch";
import Legend from "./Legend";
import WeekGrid from "./WeekGrid";
import MonthGrid from "./MonthGrid";
import PhoneDayStrip from "./PhoneDayStrip";
import PhoneTimeList from "./PhoneTimeList";
import BottomBar from "./BottomBar";
import ReviewSheet from "./ReviewSheet";
import ConfirmDiscardDialog from "./ConfirmDiscardDialog";
import InsufficientBalanceModal, {
  stashPendingBooking,
  readPendingBooking,
  clearPendingBooking,
} from "./InsufficientBalanceModal";
import BookResumeBanner from "./BookResumeBanner";
import { startBookingShortfallTopupAction } from "@/content/AccountBalanceContent/actions";
import modeStyles from "./BookCalendarContent.module.css";

interface Location {
  id: string;
  name: string;
  isHomePool: boolean;
}

interface Props {
  householdId: string | null;
  locations: Location[];
  swimmers: ParentSwimmer[];
  isViewer: boolean;
  householdFailed?: boolean;
  initialView?: "week" | "month";
  initialDate?: string;
  // Authoritative household balance in cents, fetched server-side and
  // passed down so the bottom bar and review sheet can show a pre-submit
  // shortfall guard. `null` means the fetch failed; the UI falls back to
  // "balance unknown" and relies on the server's 422 insufficient_balance
  // response.
  balanceCents?: number | null;
}

type CalendarView = "week" | "month";

const PREVIEW_DEBOUNCE_MS = 350;
const DEFAULT_RECURRING_WEEKS = 4;

function formatMonthLabel(dateStr: string): string {
  const date = new Date(`${dateStr}T12:00:00`);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(date);
}

function getMonthStr(dateStr: string): string {
  return dateStr.slice(0, 7);
}

// Shift a YYYY-MM month string forward by N months (negative for backward).
// Pure string + modular arithmetic so no TZ libraries are involved.
function addMonthsToMonthStr(monthStr: string, months: number): string {
  const [yearStr, monthDigits] = monthStr.split("-");
  const year = Number(yearStr);
  const monthIndex = Number(monthDigits) - 1 + months;
  const nextYear = year + Math.floor(monthIndex / 12);
  const nextMonth = ((monthIndex % 12) + 12) % 12;
  return `${nextYear}-${String(nextMonth + 1).padStart(2, "0")}`;
}

export default function BookCalendarContent({
  householdId,
  locations,
  swimmers,
  isViewer,
  householdFailed = false,
  initialView = "week",
  initialDate,
  balanceCents = null,
}: Props) {
  const router = useRouter();
  const today = todayLA();

  const [calendarView, setCalendarView] = useState<CalendarView>(initialView);
  // Clamp any deep-link / saved initial date so a past week or month opens
  // on the current one instead. The simple `< today` check covers both: a
  // date in a prior week or prior month lands before today's YYYY-MM-DD
  // string; a date in today's week on or after today passes through.
  const resolvedInitialDate =
    initialDate !== undefined && initialDate < today ? today : initialDate ?? today;
  const [currentDate, setCurrentDate] = useState<string>(resolvedInitialDate);
  const [locationId, setLocationId] = useState<string | null>(locations[0]?.id ?? null);
  const [durationMinutes, setDurationMinutes] = useState<30 | 45 | 60>(30);
  const [swimmerIds, setSwimmerIds] = useState<string[]>(
    swimmers.length === 1 ? [swimmers[0]!.id] : [],
  );
  // Nonce (not a boolean): CalendarConfigRow re-plays scroll + highlight +
  // focus on every new value, so repeated Confirm / Review taps keep working
  // after the user has already seen the message once.
  const [swimmerErrorNonce, setSwimmerErrorNonce] = useState(0);
  function flagMissingSwimmer() {
    setSwimmerErrorNonce((prev) => prev + 1);
  }
  // Nonce for the "no picks yet" state. Both bottom bars already show the
  // reason text persistently; keying the aria-live wrapper by this nonce
  // re-announces it to screen readers on every empty-picks Review tap so
  // the tap doesn't feel silent.
  const [emptyPicksNonce, setEmptyPicksNonce] = useState(0);
  const [selectedStartsAt, setSelectedStartsAt] = useState<string | null>(null);
  const [tooSoon, setTooSoon] = useState(false);
  const [weekData, setWeekData] = useState<WeekAvailabilityResponse | null>(null);
  const [monthData, setMonthData] = useState<MonthAvailabilityResponse | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedPhoneDay, setSelectedPhoneDay] = useState<string | null>(null);
  const [noAvailability, setNoAvailability] = useState(false);

  // ── Booking mode state ─────────────────────────────────────────────────────
  const [bookingMode, setBookingMode] = useState<BookingMode>("single");
  const [pendingMode, setPendingMode] = useState<BookingMode | null>(null);
  const [multiplePicks, setMultiplePicks] = useState<MultiplePick[]>([]);
  const [pattern, setPattern] = useState<BatchPatternPair[]>([]);
  const [recurringWeeks, setRecurringWeeks] = useState<number>(DEFAULT_RECURRING_WEEKS);
  const [recurringStartDate, setRecurringStartDate] = useState<string>(todayLaDateStr());
  const [showPickList, setShowPickList] = useState(false);

  // ── Review-sheet state ─────────────────────────────────────────────────────
  const [reviewOpen, setReviewOpen] = useState(false);
  const [previewPicks, setPreviewPicks] = useState<BatchPreviewPick[]>([]);
  const [previewNeedsApproval, setPreviewNeedsApproval] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [skippedIndexes, setSkippedIndexes] = useState<Set<number>>(new Set());
  const [removedIndexes, setRemovedIndexes] = useState<Set<number>>(new Set());
  const [overridesMap, setOverridesMap] = useState<Map<number, string>>(new Map());
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    confirmedCount: number;
    pendingCount: number;
    lessons: {
      startsAt: string;
      durationMinutes: LessonDurationMinutes;
      status: "approved" | "pending";
    }[];
  } | null>(null);
  const [isPreviewLoading, startPreviewLoading] = useTransition();
  const [isSubmitting, startSubmitting] = useTransition();

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
  const todayMondayStr = useMemo(() => getMondayOfWeek(today), [today]);

  const bookingMaxAdvanceWeeks =
    weekData?.bookingMaxAdvanceWeeks ?? monthData?.bookingMaxAdvanceWeeks ?? 10;
  // The Zod schema on both responses marks bookingMinAdvanceHours as
  // required, so when either response is loaded this is a number. Before
  // the first load lands, it is null — never a hardcoded 16, because the
  // coach-editable setting may differ from the old default.
  const bookingMinAdvanceHours =
    weekData?.bookingMinAdvanceHours ?? monthData?.bookingMinAdvanceHours ?? null;
  const maxAdvanceDateLA = useMemo(
    () => maxBookableDateLA(bookingMaxAdvanceWeeks, Date.now()),
    [bookingMaxAdvanceWeeks],
  );
  const nextMondayStr = addDaysToDateStr(mondayStr, 7);
  const prevMondayStr = addDaysToDateStr(mondayStr, -7);
  const disableNextWeek = nextMondayStr > maxAdvanceDateLA;
  const disablePrevWeek = prevMondayStr < todayMondayStr;

  // Every bookable Monday in the window, from today's Monday to the last
  // Monday whose week has at least one in-window day. Feeds the WeekNav dots.
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
        if (!locationId) return Promise.resolve(null);
        return fetchRangeAction({
          view: "week",
          date: monday,
          durationMinutes,
          locationId,
        });
      },
      [locationId, durationMinutes],
    ),
  });

  // Month-nav flags mirror the week-nav rules in LA. Previous is blocked on
  // the current month; next is blocked once the next month's first day is
  // already past the booking window (no day in that month would be bookable).
  const todayMonthStr = getMonthStr(today);
  const disablePrevMonth = monthStr === todayMonthStr;
  const nextMonthFirstDate = `${addMonthsToMonthStr(monthStr, 1)}-01`;
  const disableNextMonth = nextMonthFirstDate > maxAdvanceDateLA;

  // ── Availability fetch ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!locationId) return;
    setNoAvailability(false);
    setFetchError(null);

    // Hydrate instantly from the prefetch cache when flipping to a week we
    // already have. The fresh fetch still runs below so stale data gets
    // overwritten.
    if (calendarView === "week" && fetchSpec.mode === "week") {
      const cached = weekPrefetch.readFromCache(fetchSpec.monday);
      if (cached !== null) setWeekData(cached);
    }

    const fetchEpoch = weekPrefetch.beginFetch();
    startFetching(async () => {
      if (calendarView === "month") {
        const result = await fetchMonthRangeAction({
          date: currentDate,
          durationMinutes,
          locationId,
        });
        if (result !== null) setMonthData(result);
        else setFetchError("Could not load availability. Try again.");
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
        const resolvedDate =
          result.firstAvailableDate !== null ? result.firstAvailableDate : today;
        const resolvedMonday = getMondayOfWeek(resolvedDate);
        weekPrefetch.onWeekFetched(resolvedMonday, result.weekData, fetchEpoch);
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
          weekPrefetch.onWeekFetched(fetchSpec.monday, result, fetchEpoch);
        } else setFetchError("Could not load availability. Try again.");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchSpec, locationId, durationMinutes, calendarView]);

  // Single-mode booking success → navigate
  useEffect(() => {
    if (bookingState.status !== "success") return;
    router.push(`/dashboard?booked=${bookingState.lessonId}`);
  }, [bookingState, router]);

  // ADR 036 Phase 8 Part B Stop 3 piece 3: if the API gated this
  // booking on a stale policy acceptance, bounce to the re-acceptance
  // interstitial. The parent lands back here after they accept via
  // the `?next=` round-trip.
  useEffect(() => {
    if (bookingState.status !== "policy_acceptance_required") return;
    redirectToPolicyUpdated();
  }, [bookingState]);

  // Imperative state for the Phase-5 insufficient-balance modal — either
  // fed from a fresh POST /lessons 422 (bookingState.status) or from the
  // resume-banner path, which runs the same server action from the top
  // of the page.
  const [shortfall, setShortfall] = useState<
    Extract<BookingState, { status: "insufficient_balance" }> | null
  >(null);
  useEffect(() => {
    if (bookingState.status === "insufficient_balance") {
      setShortfall(bookingState);
    }
  }, [bookingState]);

  // Server-authoritative shortfall for a batch submit (Multiple / Recurring).
  // Set when POST /lessons/batch returns 422 insufficient_balance, so the
  // review sheet flips from "Book" to the insufficient-funds view with the
  // same numbers the server used to reject the batch.
  const [batchShortfall, setBatchShortfall] = useState<{
    balanceCents: number;
    priceCents: number;
    shortfallCents: number;
  } | null>(null);
  // Picks or pattern changed → the server's last "short by $N" number is
  // stale. Clearing lets the client-side derived guard take over so the
  // parent can get back to Book once they drop or shrink picks.
  useEffect(() => {
    setBatchShortfall(null);
  }, [multiplePicks, pattern, recurringWeeks]);

  // ADR 036 Phase 5 — resume. Tracks the "Add credit" top-up button so
  // the review sheet can show "Starting checkout…" while we wait for
  // the server to open the Stripe session.
  const [isAddingCredit, setIsAddingCredit] = useState(false);

  // Batch-mode resume. Runs once on mount when the URL carries ?resume=1
  // and a non-expired batch stash exists — rehydrates mode / picks /
  // pattern / weeks / pool and pops the review sheet open so the parent
  // picks up exactly where they were before the Stripe hop. "Nothing
  // books automatically" per ADR 036 Phase 5: the parent still has to
  // tap Book inside the sheet.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("resume") !== "1") return;
    const stored = readPendingBooking();
    if (stored === null) return;
    if (stored.mode === "single") return; // Handled by BookResumeBanner.
    if (stored.locationId !== locationId) {
      setLocationId(stored.locationId);
    }
    if (stored.mode === "multiple") {
      setBookingMode("multiple");
      setMultiplePicks(stored.picks);
      setReviewOpen(true);
    } else if (stored.mode === "recurring") {
      setBookingMode("recurring");
      setPattern(stored.pattern);
      setRecurringStartDate(stored.startDate);
      setRecurringWeeks(stored.weeks);
      setReviewOpen(true);
    }
    // Keep the stash until the parent books or starts over — a dropped
    // network on the preview could otherwise lose their picks if the
    // user refreshes the page mid-resume.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Derived values ─────────────────────────────────────────────────────────

  // Largest number of weeks whose pattern slots land inside the booking
  // window, capped by the 20-lesson batch limit. Drives the stepper's "+" and
  // keeps the state value from drifting past the window if the pattern or
  // start date changes.
  const maxRecurringWeeks = useMemo(
    () =>
      maxRecurringWeeksInWindow({
        pattern,
        startDate: recurringStartDate,
        maxAdvanceDateLA,
        maxLessons: BATCH_LESSON_MAX,
      }),
    [pattern, recurringStartDate, maxAdvanceDateLA],
  );

  useEffect(() => {
    if (recurringWeeks > maxRecurringWeeks) {
      setRecurringWeeks(maxRecurringWeeks);
    }
  }, [maxRecurringWeeks, recurringWeeks]);

  // Expand recurring pattern into { startsAt, durationMinutes } entries. Any
  // slot whose LA date falls past the booking window is dropped so planned
  // markers never appear outside the window.
  const plannedStartsAt = useMemo<PickWithDuration[]>(() => {
    if (bookingMode !== "recurring") return [];
    if (pattern.length === 0 || recurringWeeks < 1) return [];
    const expanded = expandRecurring({
      startDate: recurringStartDate,
      pattern,
      weeks: recurringWeeks,
    });
    return expanded.filter((pick) => laDateFromIso(pick.startsAt) <= maxAdvanceDateLA);
  }, [bookingMode, pattern, recurringStartDate, recurringWeeks, maxAdvanceDateLA]);

  const totalLessons =
    bookingMode === "multiple"
      ? multiplePicks.length
      : bookingMode === "recurring"
        ? plannedStartsAt.length
        : 0;

  const overCap = totalLessons > BATCH_LESSON_MAX;

  // Per-pick totals (minutes) summed across every current pick. Each pick
  // carries its own length so a batch can mix 30, 45, and 60-minute lessons.
  const totalPickMinutes =
    bookingMode === "multiple"
      ? multiplePicks.reduce((sum, pick) => sum + pick.durationMinutes, 0)
      : bookingMode === "recurring"
        ? plannedStartsAt.reduce((sum, pick) => sum + pick.durationMinutes, 0)
        : 0;

  // Total price in cents across every current pick, used for the balance
  // shortfall guard on the bottom bar and review sheet. Server-side pricing
  // is authoritative (packages/shared/lib/pricing); the browser never
  // overrides it — this value is display-only and must match what the API
  // would charge so the guard doesn't lie to the parent.
  function clampSwimmerCount(count: number): SwimmerCount {
    if (count <= 1) return 1;
    if (count >= 4) return 4;
    return count as SwimmerCount;
  }
  const totalPriceCents = useMemo(() => {
    if (bookingMode === "single") {
      if (selectedStartsAt === null || swimmerIds.length === 0) return 0;
      return priceForLesson(durationMinutes, clampSwimmerCount(swimmerIds.length));
    }
    if (bookingMode === "multiple") {
      return multiplePicks.reduce(
        (sum, pick) =>
          sum + priceForLesson(pick.durationMinutes, clampSwimmerCount(pick.swimmerIds.length)),
        0,
      );
    }
    if (bookingMode === "recurring") {
      return plannedStartsAt.reduce((sum, pick) => {
        const pair = pattern.find(
          (candidate) =>
            candidate.weekday === laIsoWeekday(pick.startsAt) &&
            candidate.timeOfDay === laTimeOfDay(pick.startsAt),
        );
        const count = pair ? pair.swimmerIds.length : 0;
        if (count === 0) return sum;
        return sum + priceForLesson(pick.durationMinutes, clampSwimmerCount(count));
      }, 0);
    }
    return 0;
  }, [
    bookingMode,
    selectedStartsAt,
    swimmerIds,
    durationMinutes,
    multiplePicks,
    plannedStartsAt,
    pattern,
  ]);

  const batchShortBy =
    balanceCents !== null && totalPriceCents > balanceCents
      ? totalPriceCents - balanceCents
      : 0;

  // Flat per-pick list for span, overlap, and daily-cap feedback. Each entry
  // carries its own duration so a shorter new pick can land inside a longer
  // existing pick's span (and vice versa).
  const pickList = useMemo<PickWithDuration[]>(() => {
    if (bookingMode === "multiple") return multiplePicks;
    if (bookingMode === "recurring") return plannedStartsAt;
    return [];
  }, [bookingMode, multiplePicks, plannedStartsAt]);

  const pickStartsSet = useMemo<Set<string>>(
    () => new Set(pickList.map((pick) => pick.startsAt)),
    [pickList],
  );

  const plannedSet = useMemo<Set<string>>(() => {
    if (bookingMode === "recurring") return new Set(plannedStartsAt.map((p) => p.startsAt));
    return new Set();
  }, [bookingMode, plannedStartsAt]);

  const maxDailyLessonMinutes = weekData?.maxDailyLessonMinutes ?? 240;

  // Per-week pick count across the booking window. Feeds the WeekNav dots so
  // parents can see at a glance which weeks already have their picks.
  const pickCountByMonday = useMemo(() => {
    const map = new Map<string, number>();
    for (const pick of pickList) {
      const monday = getMondayOfWeek(laDateFromIso(pick.startsAt));
      map.set(monday, (map.get(monday) ?? 0) + 1);
    }
    return map;
  }, [pickList]);

  const weekDots = useMemo<WeekNavDot[]>(() => {
    return weekMondays.map((weekMonday) => {
      const hasOpenValue = weekPrefetch.hasOpenByMonday.get(weekMonday);
      const pickCount = pickCountByMonday.get(weekMonday) ?? 0;
      return {
        mondayStr: weekMonday,
        ...(hasOpenValue !== undefined && { hasOpen: hasOpenValue }),
        pickCount,
      };
    });
  }, [weekMondays, weekPrefetch.hasOpenByMonday, pickCountByMonday]);

  // Pre-compute the within-span and taken-by-picks sets for every slot in
  // the currently-visible week. Running once per week-fetch avoids repeating
  // the span check inside every cell render. The current duration chip is
  // the length a NEW pick would use if tapped, so overlap and daily-cap use
  // it as the new slot's own length while each existing pick keeps its own.
  const pickSpanSet = useMemo<Set<string>>(() => {
    const result = new Set<string>();
    if (weekData === null || pickList.length === 0) return result;
    for (const day of weekData.days) {
      for (const slot of day.slots) {
        if (isWithinAnyPickSpan(slot.startsAt, pickList)) {
          result.add(slot.startsAt);
        }
      }
    }
    return result;
  }, [weekData, pickList]);

  const takenByPicksSet = useMemo<Set<string>>(() => {
    const result = new Set<string>();
    if (weekData === null || pickList.length === 0) return result;
    for (const day of weekData.days) {
      for (const slot of day.slots) {
        if (pickStartsSet.has(slot.startsAt)) continue;
        if (isWithinAnyPickSpan(slot.startsAt, pickList)) continue;
        const overlaps = doesSlotOverlapAnyPick(slot.startsAt, pickList, durationMinutes);
        const capBlocked = wouldExceedDailyCap(
          slot.startsAt,
          pickList,
          durationMinutes,
          maxDailyLessonMinutes,
        );
        if (overlaps || capBlocked) result.add(slot.startsAt);
      }
    }
    return result;
  }, [weekData, pickList, pickStartsSet, durationMinutes, maxDailyLessonMinutes]);

  // Map a pick's startsAt to the human-readable reason the server flagged
  // it. Only the pick's HEAD cell renders in red; within-span cells stay
  // highlighted as part of the pick. Skipped/removed picks drop out.
  const flagReasonByStart = useMemo<Map<string, string>>(() => {
    const result = new Map<string, string>();
    if (bookingMode === "single") return result;
    for (const pick of previewPicks) {
      if (pick.state === "available") continue;
      if (skippedIndexes.has(pick.index)) continue;
      if (removedIndexes.has(pick.index)) continue;
      const copy = pickReasonCopy(pick.state, bookingMinAdvanceHours);
      if (copy !== "") result.set(pick.startsAt, copy);
    }
    return result;
  }, [bookingMode, previewPicks, skippedIndexes, removedIndexes, bookingMinAdvanceHours]);

  // Count flagged picks for the bottom bar.
  const flaggedPickCount = flagReasonByStart.size;

  // Build body for preview/submit from current state. Each pick / pattern
  // pair carries its own durationMinutes so the server validates lengths
  // independently.
  const buildBatchBody = useCallback((): BatchPreviewBody | null => {
    if (!locationId || householdId === null) return null;
    if (bookingMode === "multiple") {
      if (multiplePicks.length < BATCH_LESSON_MIN) return null;
      // Every pick carries its own swimmerIds — the server validates each
      // pick independently and derives private vs family per lesson.
      if (multiplePicks.some((pick) => pick.swimmerIds.length === 0)) return null;
      return {
        mode: "manual",
        householdId,
        locationId,
        picks: multiplePicks.map((pick) => ({
          startsAt: pick.startsAt,
          durationMinutes: pick.durationMinutes,
          swimmerIds: pick.swimmerIds,
        })),
      };
    }
    if (bookingMode === "recurring") {
      if (pattern.length === 0 || recurringWeeks < 1) return null;
      if (pattern.some((pair) => pair.swimmerIds.length === 0)) return null;
      return {
        mode: "weekly",
        householdId,
        locationId,
        pattern,
        startDate: recurringStartDate,
        weeks: recurringWeeks,
      };
    }
    return null;
  }, [
    householdId,
    locationId,
    bookingMode,
    multiplePicks,
    pattern,
    recurringStartDate,
    recurringWeeks,
  ]);

  // Debounced preview that runs on every batch-input change (picks, pattern,
  // weeks, duration, pool, swimmers). The flagged picks it returns feed the
  // live red cells on the calendar, so the parent sees conflicts without
  // opening the review sheet. The sheet re-uses the same previewPicks when
  // open.
  useEffect(() => {
    if (bookingMode === "single") return;
    const body = buildBatchBody();
    if (body === null) {
      // Not enough picks to preview yet; clear any stale flags.
      setPreviewPicks([]);
      setPreviewError(null);
      return;
    }
    const handle = setTimeout(() => {
      setPreviewError(null);
      startPreviewLoading(async () => {
        const result = await previewBatchAction(body);
        if (result.kind === "ok") {
          setPreviewPicks(result.data.picks);
          setPreviewNeedsApproval(result.data.needsApproval);
        } else if (result.kind === "forbidden") {
          setPreviewError(
            "You do not have permission to book lessons. Ask the household owner for access.",
          );
        } else {
          setPreviewError(result.message);
        }
      });
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [bookingMode, buildBatchBody]);

  // Keep overrides/skips bounded to the current expansion. Recurring: trim
  // indexes beyond the newly-expanded list length.
  useEffect(() => {
    const total =
      bookingMode === "recurring" ? plannedStartsAt.length : multiplePicks.length;
    setSkippedIndexes((current) => {
      const next = new Set<number>();
      for (const index of current) if (index < total) next.add(index);
      return next;
    });
    setRemovedIndexes((current) => {
      const next = new Set<number>();
      for (const index of current) if (index < total) next.add(index);
      return next;
    });
    setOverridesMap((current) => {
      const next = new Map<number, string>();
      for (const [index, value] of current.entries()) {
        if (index < total) next.set(index, value);
      }
      return next;
    });
  }, [bookingMode, plannedStartsAt.length, multiplePicks.length]);

  // When the recurring pattern itself changes (pair added/removed, length
  // changed), the stable indexes from the previous pattern no longer refer to
  // the same lessons. Drop skips, overrides, removed, and stale preview
  // results so the new pattern starts from a clean slate.
  const patternKey = useMemo(
    () =>
      bookingMode === "recurring"
        ? pattern.map((pair) => `${pair.weekday}@${pair.timeOfDay}@${pair.durationMinutes}`).join(",")
        : "",
    [bookingMode, pattern],
  );
  useEffect(() => {
    if (bookingMode !== "recurring") return;
    setSkippedIndexes(new Set());
    setRemovedIndexes(new Set());
    setOverridesMap(new Map());
    setPreviewPicks([]);
    setPreviewNeedsApproval(false);
    setPreviewError(null);
    setSubmitError(null);
  }, [bookingMode, patternKey]);

  // ── Mode-switch handling ───────────────────────────────────────────────────

  const hasInProgressWork =
    (bookingMode === "multiple" && multiplePicks.length > 0) ||
    (bookingMode === "recurring" && pattern.length > 0);

  function requestModeChange(next: BookingMode) {
    if (next === bookingMode) return;
    if (hasInProgressWork) {
      setPendingMode(next);
      return;
    }
    applyModeChange(next);
  }

  function applyModeChange(next: BookingMode) {
    setBookingMode(next);
    setMultiplePicks([]);
    setPattern([]);
    setSkippedIndexes(new Set());
    setRemovedIndexes(new Set());
    setOverridesMap(new Map());
    setPreviewPicks([]);
    setSelectedStartsAt(null);
    setShowPickList(false);
    setPendingMode(null);
    // Switching modes is a "start over" gesture — the resume stash
    // belonged to the picks the parent is now discarding.
    clearPendingBooking();
    // Reset recurring start to today so a fresh pattern starts "from now."
    if (next === "recurring") setRecurringStartDate(todayLaDateStr());
  }

  function cancelModeChange() {
    setPendingMode(null);
  }

  // ── Slot click (mode-aware) ────────────────────────────────────────────────

  function handleSlotClick(slot: { startsAt: string; state: string }) {
    if (bookingMode === "single") {
      if (slot.state === "available") {
        setSelectedStartsAt(slot.startsAt);
        setTooSoon(false);
      } else if (slot.state === "too_soon") {
        setSelectedStartsAt(null);
        setTooSoon(true);
      }
      return;
    }
    if (bookingMode === "multiple") {
      // A click anywhere inside a pick's duration span removes that pick,
      // matching Single mode's "tap anywhere in the span" affordance.
      const containing = findPickContainingSlot(slot.startsAt, multiplePicks);
      if (containing !== null) {
        setMultiplePicks((current) =>
          current.filter((pick) => pick.startsAt !== containing.startsAt),
        );
        return;
      }
      if (slot.state !== "available") return;
      // Block clicks on slots already blocked by our own picks (overlap or
      // daily-cap). The visual is already non-interactive but keep the guard.
      if (takenByPicksSet.has(slot.startsAt)) return;
      // The current chips (length AND swimmers) only apply to NEW picks.
      // Existing picks keep their own lengths and swimmer sets, so one batch
      // can mix 30/45/60-min lessons AND different kids across picks.
      if (swimmerIds.length === 0) {
        flagMissingSwimmer();
        return;
      }
      const pickSwimmerIds = [...swimmerIds];
      setMultiplePicks((current) => {
        if (current.length >= BATCH_LESSON_MAX) return current;
        const next: MultiplePick[] = [
          ...current,
          { startsAt: slot.startsAt, durationMinutes, swimmerIds: pickSwimmerIds },
        ];
        return next.sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0));
      });
      return;
    }
    if (bookingMode === "recurring") {
      // Tap inside a planned slot's span removes that (weekday, time) pair
      // from the pattern. Lengths are per-pair, so the match is still by
      // (weekday, timeOfDay) since no two pairs can share both.
      const containing = findPickContainingSlot(slot.startsAt, plannedStartsAt);
      if (containing !== null) {
        const containingWeekday = laIsoWeekday(containing.startsAt);
        const containingTime = laTimeOfDay(containing.startsAt);
        setPattern((current) =>
          current.filter(
            (pair) =>
              !(pair.weekday === containingWeekday && pair.timeOfDay === containingTime),
          ),
        );
        return;
      }
      if (slot.state !== "available") return;
      if (takenByPicksSet.has(slot.startsAt)) return;
      const weekday = laIsoWeekday(slot.startsAt);
      const timeOfDay = laTimeOfDay(slot.startsAt);
      const key = `${weekday}@${timeOfDay}`;
      const laDate = laDateFromIso(slot.startsAt);
      setRecurringStartDate((currentStart) =>
        currentStart === "" || currentStart > laDate ? laDate : currentStart,
      );
      // Pattern entries pick up the length AND swimmer set from the current
      // chips. Each pattern entry carries its own swimmers so one series can
      // run different kids on different (weekday, time) slots.
      if (swimmerIds.length === 0) {
        flagMissingSwimmer();
        return;
      }
      const entrySwimmerIds = [...swimmerIds];
      setPattern((current) => {
        const existingIndex = current.findIndex(
          (pair) => `${pair.weekday}@${pair.timeOfDay}` === key,
        );
        if (existingIndex >= 0) {
          return current.filter((_unused, index) => index !== existingIndex);
        }
        return [...current, { weekday, timeOfDay, durationMinutes, swimmerIds: entrySwimmerIds }];
      });
    }
  }

  // ── Review flow ────────────────────────────────────────────────────────────

  function openReview() {
    // Tapping Review with no swimmer selected should always replay the
    // scroll + highlight (ADR 030 phase 2) — the chip governs new picks, so
    // if it's empty the parent can't add any more. This fires regardless of
    // pick count so repeated taps always get fresh feedback.
    if (swimmerIds.length === 0) {
      flagMissingSwimmer();
      return;
    }
    const hasPicks = multiplePicks.length > 0 || pattern.length > 0;
    if (!hasPicks) {
      // Don't open the sheet, but bump the nonce so the "Add at least one
      // lesson" reason under the Review button re-announces via aria-live.
      // Repeated taps always re-fire so a screen-reader user hears it each
      // time, not just once.
      setEmptyPicksNonce((prev) => prev + 1);
      return;
    }
    setSubmitError(null);
    setSuccess(null);
    setReviewOpen(true);
  }

  function closeReview() {
    setReviewOpen(false);
    setSubmitError(null);
    if (success !== null) {
      // After a successful booking, exiting the sheet clears state so the
      // calendar starts fresh.
      applyModeChange("single");
    }
  }

  function handleApplySuggestion(index: number, startsAt: string) {
    if (bookingMode === "multiple") {
      setMultiplePicks((current) => {
        const next = [...current];
        const existing = next[index];
        if (existing !== undefined) {
          // A suggestion only moves a pick to a different time; its own
          // length AND swimmer set stay the same.
          next[index] = {
            startsAt,
            durationMinutes: existing.durationMinutes,
            swimmerIds: existing.swimmerIds,
          };
        }
        return next.sort((a, b) =>
          a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0,
        );
      });
    } else {
      setOverridesMap((current) => {
        const next = new Map(current);
        next.set(index, startsAt);
        return next;
      });
      setPreviewPicks((current) =>
        current.map((pick) =>
          pick.index === index
            ? {
                ...pick,
                startsAt,
                state: "available" as const,
                suggestions: undefined,
                reason: undefined,
              }
            : pick,
        ),
      );
    }
  }

  function handleSkipIndex(index: number) {
    setSkippedIndexes((current) => {
      const next = new Set(current);
      next.add(index);
      return next;
    });
  }

  function handleUnskipIndex(index: number) {
    setSkippedIndexes((current) => {
      const next = new Set(current);
      next.delete(index);
      return next;
    });
  }

  function handleRemoveIndex(index: number) {
    if (bookingMode === "multiple") {
      setMultiplePicks((current) => {
        if (current.length <= BATCH_LESSON_MIN) {
          // Keep the removal visible in the sheet so the parent sees why Book
          // is disabled; the pattern below merges removedIndexes.
          setRemovedIndexes((prev) => {
            const next = new Set(prev);
            next.add(index);
            return next;
          });
          return current;
        }
        const next = [...current];
        if (index >= 0 && index < next.length) next.splice(index, 1);
        return next;
      });
    }
  }

  function removeMultiplePick(startsAt: string) {
    setMultiplePicks((current) => current.filter((pick) => pick.startsAt !== startsAt));
  }

  function changeMultiplePickDuration(startsAt: string, nextDuration: LessonDurationMinutes) {
    setMultiplePicks((current) =>
      current.map((pick) =>
        pick.startsAt === startsAt ? { ...pick, durationMinutes: nextDuration } : pick,
      ),
    );
  }

  function toggleMultiplePickSwimmer(startsAt: string, swimmerId: string) {
    setMultiplePicks((current) =>
      current.map((pick) => {
        if (pick.startsAt !== startsAt) return pick;
        const has = pick.swimmerIds.includes(swimmerId);
        if (has && pick.swimmerIds.length === 1) {
          // Guardrail: every pick must keep at least one swimmer. The chip
          // acts as a toggle but refuses to clear the final swimmer; the
          // Remove button is the escape hatch to drop the pick entirely.
          return pick;
        }
        return {
          ...pick,
          swimmerIds: has
            ? pick.swimmerIds.filter((id) => id !== swimmerId)
            : [...pick.swimmerIds, swimmerId],
        };
      }),
    );
  }

  function changePatternPairDuration(pair: BatchPatternPair, nextDuration: LessonDurationMinutes) {
    setPattern((current) =>
      current.map((existing) =>
        existing.weekday === pair.weekday && existing.timeOfDay === pair.timeOfDay
          ? { ...existing, durationMinutes: nextDuration }
          : existing,
      ),
    );
  }

  function togglePatternPairSwimmer(pair: BatchPatternPair, swimmerId: string) {
    setPattern((current) =>
      current.map((existing) => {
        if (existing.weekday !== pair.weekday || existing.timeOfDay !== pair.timeOfDay) {
          return existing;
        }
        const has = existing.swimmerIds.includes(swimmerId);
        if (has && existing.swimmerIds.length === 1) {
          return existing;
        }
        return {
          ...existing,
          swimmerIds: has
            ? existing.swimmerIds.filter((id) => id !== swimmerId)
            : [...existing.swimmerIds, swimmerId],
        };
      }),
    );
  }

  function removePatternPair(pair: BatchPatternPair) {
    setPattern((current) =>
      current.filter(
        (existing) =>
          existing.weekday !== pair.weekday || existing.timeOfDay !== pair.timeOfDay,
      ),
    );
  }

  function changeRecurringWeeks(next: number) {
    const clamped = Math.max(1, Math.min(maxRecurringWeeks, Math.floor(next)));
    setRecurringWeeks(clamped);
  }

  const unresolvedCount = useMemo(() => {
    return previewPicks.filter((pick) => {
      if (skippedIndexes.has(pick.index)) return false;
      if (removedIndexes.has(pick.index)) return false;
      return pick.state !== "available";
    }).length;
  }, [previewPicks, skippedIndexes, removedIndexes]);

  const effectiveFinalCount = useMemo(() => {
    return previewPicks.filter(
      (pick) => !skippedIndexes.has(pick.index) && !removedIndexes.has(pick.index),
    ).length;
  }, [previewPicks, skippedIndexes, removedIndexes]);

  const canSubmitReview =
    reviewOpen &&
    !isPreviewLoading &&
    previewPicks.length > 0 &&
    unresolvedCount === 0 &&
    effectiveFinalCount >= BATCH_LESSON_MIN &&
    effectiveFinalCount <= BATCH_LESSON_MAX;

  // Short reason the review sheet shows under its Book button when disabled.
  // "Pick who's swimming" is still a soft hint — the parent already blocks
  // Review from opening when no swimmer is picked.
  const bookDisabledReason: string | null = (() => {
    if (!reviewOpen || isSubmitting) return null;
    if (isPreviewLoading) return "Checking availability.";
    if (previewPicks.length === 0) return "Add lessons on the calendar.";
    if (unresolvedCount > 0) {
      return `Fix ${unresolvedCount} flagged ${unresolvedCount === 1 ? "lesson" : "lessons"} first.`;
    }
    if (effectiveFinalCount > BATCH_LESSON_MAX) {
      return `Over the ${BATCH_LESSON_MAX} lesson cap.`;
    }
    if (effectiveFinalCount < BATCH_LESSON_MIN) {
      return `Need at least ${BATCH_LESSON_MIN} ${BATCH_LESSON_MIN === 1 ? "lesson" : "lessons"}.`;
    }
    return null;
  })();

  function buildBatchSubmitBody(): BatchSubmitBody | null {
    const base = buildBatchBody();
    if (base === null) return null;
    if (base.mode === "manual") return base;
    return {
      ...base,
      overrides: [...overridesMap.entries()].map(([index, startsAt]) => ({ index, startsAt })),
      skips: [...skippedIndexes],
    };
  }

  function handleBookBatch() {
    if (!canSubmitReview) return;
    const body = buildBatchSubmitBody();
    if (body === null) return;
    setSubmitError(null);
    startSubmitting(async () => {
      const result = await submitBatchAction(body);
      if (result.kind === "ok") {
        // Single mode navigates away on success so the calendar remounts
        // fresh. Batch stays on the calendar, so we have to actively
        // invalidate what the calendar has in state: refetch the visible
        // range here (navigation to any other touched week already bumps
        // fetchSpec.key, which refetches from the server). Clear the
        // picks + preview so the calendar underneath does not keep stale
        // highlights once the sheet is dismissed.
        refetchVisibleRange();
        setMultiplePicks([]);
        setPattern([]);
        setPreviewPicks([]);
        setSkippedIndexes(new Set());
        setRemovedIndexes(new Set());
        setOverridesMap(new Map());
        // The resume stash is one-shot — a successful batch means the
        // parent won't be coming back to this snapshot.
        clearPendingBooking();
        buildSuccessView(result.data);
      } else if (result.kind === "conflict") {
        setPreviewPicks((current) =>
          current.map((pick) => {
            const conflict = result.data.conflicts.find((c) => c.index === pick.index);
            if (!conflict) return { ...pick, state: "available" as const, reason: undefined };
            return {
              ...pick,
              state: conflict.state,
              startsAt: conflict.startsAt,
              ...(conflict.reason !== undefined && { reason: conflict.reason }),
            };
          }),
        );
        setSubmitError("Some lessons are no longer available. Review and try again.");
      } else if (result.kind === "insufficient_balance") {
        // Race between preview and submit — the server is authoritative, so
        // snap the review sheet into its insufficient-funds view with the
        // numbers the server returned.
        setBatchShortfall({
          balanceCents: result.balanceCents,
          priceCents: result.priceCents,
          shortfallCents: result.shortfallCents,
        });
      } else if (result.kind === "forbidden") {
        setSubmitError(
          "You do not have permission to book lessons. Ask the household owner for access.",
        );
      } else if (result.kind === "policy_acceptance_required") {
        redirectToPolicyUpdated();
      } else {
        setSubmitError(result.message);
      }
    });
  }

  // Capture everything the resume effect needs to put the parent back where
  // they were before the Stripe hop: mode, pool, and every pick/pattern
  // with its own length and swimmers. Falls back to `null` when there is
  // nothing to resume (e.g. Single mode with no selection — that path
  // stashes a single-lesson attempt separately).
  function buildBatchStashSnapshot():
    | Extract<
        ReturnType<typeof readPendingBooking>,
        { mode: "multiple" | "recurring" }
      >
    | null {
    if (locationId === null) return null;
    if (bookingMode === "multiple") {
      if (multiplePicks.length === 0) return null;
      return {
        mode: "multiple",
        stashedAt: new Date().toISOString(),
        locationId,
        picks: multiplePicks.map((pick) => ({
          startsAt: pick.startsAt,
          durationMinutes: pick.durationMinutes,
          swimmerIds: [...pick.swimmerIds],
        })),
      };
    }
    if (bookingMode === "recurring") {
      if (pattern.length === 0 || recurringWeeks < 1) return null;
      return {
        mode: "recurring",
        stashedAt: new Date().toISOString(),
        locationId,
        pattern: pattern.map((pair) => ({
          weekday: pair.weekday,
          timeOfDay: pair.timeOfDay,
          durationMinutes: pair.durationMinutes,
          swimmerIds: [...pair.swimmerIds],
        })),
        startDate: recurringStartDate,
        weeks: recurringWeeks,
      };
    }
    return null;
  }

  // "Add $N of credit" button on the batch review sheet. The top-up API
  // takes a single (duration, swimmerCount) pair, so we pick the most
  // expensive configuration in the batch — this guarantees one top-up
  // click covers at least one of the batch's lessons.
  const addCreditUnit = useMemo<
    { durationMinutes: LessonDurationMinutes; swimmerCount: SwimmerCount } | null
  >(() => {
    const candidates: Array<{
      durationMinutes: LessonDurationMinutes;
      swimmerCount: SwimmerCount;
    }> = [];
    if (bookingMode === "multiple") {
      for (const pick of multiplePicks) {
        if (pick.swimmerIds.length === 0) continue;
        candidates.push({
          durationMinutes: pick.durationMinutes,
          swimmerCount: clampSwimmerCount(pick.swimmerIds.length),
        });
      }
    } else if (bookingMode === "recurring") {
      for (const pair of pattern) {
        if (pair.swimmerIds.length === 0) continue;
        candidates.push({
          durationMinutes: pair.durationMinutes,
          swimmerCount: clampSwimmerCount(pair.swimmerIds.length),
        });
      }
    }
    if (candidates.length === 0) return null;
    return candidates.reduce((best, candidate) =>
      priceForLesson(candidate.durationMinutes, candidate.swimmerCount) >
      priceForLesson(best.durationMinutes, best.swimmerCount)
        ? candidate
        : best,
    );
  }, [bookingMode, multiplePicks, pattern]);
  const addCreditCents =
    addCreditUnit !== null
      ? priceForLesson(addCreditUnit.durationMinutes, addCreditUnit.swimmerCount)
      : null;

  function handleBatchBuyPackage() {
    const snapshot = buildBatchStashSnapshot();
    if (snapshot !== null) stashPendingBooking(snapshot);
    window.location.href = "/account/balance?resume=book";
  }

  // ADR 036 Phase 8 Part B Stop 3 piece 4: bottom-bar "Add funds" link
  // stashes the parent's current picks so they can come back to the
  // same picks after paying, then sends them to /account/balance. Same
  // destination as the "Buy a package" path in the insufficient-funds
  // modal.
  function handleAddFundsFromBottomBar() {
    if (bookingMode === "single") {
      if (
        locationId !== null &&
        selectedStartsAt !== null &&
        swimmerIds.length > 0
      ) {
        stashPendingBooking({
          startsAt: selectedStartsAt,
          durationMinutes,
          locationId,
          swimmerIds: [...swimmerIds],
        });
      }
    } else {
      const snapshot = buildBatchStashSnapshot();
      if (snapshot !== null) stashPendingBooking(snapshot);
    }
    window.location.href = "/account/balance?resume=book";
  }

  function handleBatchAddCredit() {
    if (addCreditUnit === null) return;
    const snapshot = buildBatchStashSnapshot();
    if (snapshot !== null) stashPendingBooking(snapshot);
    setIsAddingCredit(true);
    void (async () => {
      const result = await startBookingShortfallTopupAction(
        addCreditUnit.durationMinutes,
        addCreditUnit.swimmerCount,
        "/dashboard/book?resume=1",
      );
      setIsAddingCredit(false);
      if (result.kind === "redirect") {
        window.location.href = result.url;
        return;
      }
      if (result.kind === "policy_acceptance_required") {
        redirectToPolicyUpdated();
        return;
      }
      setSubmitError(result.message);
    })();
  }

  function buildSuccessView(data: BatchSubmitSuccessResponse) {
    const visible = previewPicks.filter(
      (pick) => !skippedIndexes.has(pick.index) && !removedIndexes.has(pick.index),
    );
    const sorted = [...visible].sort((a, b) =>
      a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0,
    );
    const lessons = sorted.map((pick, index) => ({
      startsAt: pick.startsAt,
      durationMinutes: pick.durationMinutes,
      status: index < data.confirmedCount ? ("approved" as const) : ("pending" as const),
    }));
    setSuccess({
      confirmedCount: data.confirmedCount,
      pendingCount: data.pendingCount,
      lessons,
    });
  }

  function handleBackToCalendar() {
    router.refresh();
    setReviewOpen(false);
    setSuccess(null);
    applyModeChange("single");
  }

  // ── Nav handlers ───────────────────────────────────────────────────────────

  // Pins the next fetch to the currently viewed range (week or month) and
  // bumps the key so the useEffect refires. Length and pool changes use
  // this so the view stays on the current week instead of searching for
  // the first available one. If the current week has no bookable days
  // under the new settings, the user stays on it and sees empty days.
  function refetchVisibleRange() {
    setFetchSpec((prev) =>
      calendarView === "month"
        ? { mode: "month", monthStr, key: prev.key + 1 }
        : { mode: "week", monday: mondayStr, key: prev.key + 1 },
    );
  }

  function handleLocationChange(id: string) {
    weekPrefetch.reset();
    setLocationId(id);
    setSelectedStartsAt(null);
    setTooSoon(false);
    refetchVisibleRange();
  }

  function handleDurationChange(d: 30 | 45 | 60) {
    weekPrefetch.reset();
    setDurationMinutes(d);
    setSelectedStartsAt(null);
    setTooSoon(false);
    refetchVisibleRange();
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

  function jumpToMonday(monday: string) {
    if (monday === mondayStr) return;
    setCurrentDate(monday);
    setSelectedStartsAt(null);
    setTooSoon(false);
    setFetchSpec((prev) => ({ mode: "week", monday, key: prev.key + 1 }));
  }

  function handleMonthDayClick(date: string) {
    setCurrentDate(date);
    setCalendarView("week");
    setSelectedStartsAt(null);
    setTooSoon(false);
    setFetchSpec((prev) => ({ mode: "week", monday: getMondayOfWeek(date), key: prev.key + 1 }));
  }

  function handleSwimmersChange(ids: string[]) {
    setSwimmerIds(ids);
  }

  function handleConfirmSingle() {
    if (!selectedStartsAt || !locationId) return;
    if (swimmerIds.length === 0) {
      flagMissingSwimmer();
      return;
    }
    // Pre-submit shortfall guard — surface the insufficient-funds modal
    // without the round-trip when the balance is already known to be
    // short. The server still has the final word; a race there lands on
    // the same modal via the existing 422 insufficient_balance handler.
    if (balanceCents !== null) {
      const priceCents = priceForLesson(
        durationMinutes,
        clampSwimmerCount(swimmerIds.length),
      );
      if (priceCents > balanceCents) {
        setShortfall({
          status: "insufficient_balance",
          balanceCents,
          priceCents,
          shortfallCents: priceCents - balanceCents,
          attempt: {
            startsAt: selectedStartsAt,
            durationMinutes,
            locationId,
            swimmerIds: [...swimmerIds],
          },
        });
        return;
      }
    }
    const form = new FormData();
    form.append("startsAt", selectedStartsAt);
    form.append("durationMinutes", String(durationMinutes));
    form.append("locationId", locationId);
    for (const id of swimmerIds) form.append("swimmerIds", id);
    startTransition(() => bookingFormAction(form));
  }

  const errorMessage =
    bookingState.status === "error" ? bookingState.message : fetchError;

  const selectedPhoneDayData =
    weekData?.days.find((day) => day.date === selectedPhoneDay) ?? null;

  const VIEW_TOGGLE_BASE =
    "min-h-[36px] px-4 rounded-full border text-sm font-semibold transition-colors duration-150 motion-reduce:transition-none";
  const VIEW_TOGGLE_ACTIVE = "bg-heading text-background border-heading";
  const VIEW_TOGGLE_INACTIVE = "border-border text-text hover:bg-surface-soft";

  // ── Early returns ──────────────────────────────────────────────────────────

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
      {/* Resume banner for the parent returning from a Stripe top-up
          that was started mid-booking (ADR 036 Phase 5). Reads its
          state from sessionStorage + the URL; renders nothing when
          not resuming. */}
      <BookResumeBanner
        onBooked={(state) => {
          router.push(`/dashboard?booked=${state.lessonId}`);
        }}
        onInsufficient={(state) => {
          setShortfall(state);
        }}
      />
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

      <ModeSwitch mode={bookingMode} onChange={requestModeChange} />

      <CalendarConfigRow
        locations={locations}
        swimmers={swimmers}
        locationId={locationId}
        durationMinutes={durationMinutes}
        swimmerIds={swimmerIds}
        isLoading={isFetching}
        swimmerErrorNonce={swimmerErrorNonce}
        swimmerLabel={
          bookingMode === "single"
            ? "Who\u2019s swimming"
            : "Who\u2019s swimming in new picks"
        }
        durationLabel={bookingMode === "single" ? "Length" : "Length for new picks"}
        onLocationChange={handleLocationChange}
        onDurationChange={handleDurationChange}
        onSwimmersChange={handleSwimmersChange}
      />

      {calendarView === "week" ? (
        <WeekNav
          mondayStr={mondayStr}
          onPrev={prevWeek}
          onNext={nextWeek}
          onToday={goToday}
          todayStr={today}
          disablePrev={disablePrevWeek}
          disableNext={disableNextWeek}
          dots={{ weeks: weekDots, onJump: jumpToMonday }}
        />
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={prevMonth}
            aria-label="Previous month"
            disabled={disablePrevMonth}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-button border border-border text-text hover:bg-surface-soft transition-colors duration-150 disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent"
          >
            &lsaquo;
          </button>
          <button
            type="button"
            onClick={nextMonth}
            aria-label="Next month"
            disabled={disableNextMonth}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-button border border-border text-text hover:bg-surface-soft transition-colors duration-150 disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent"
          >
            &rsaquo;
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

      {calendarView === "month" && !isFetching && fetchError === null && monthData !== null && (
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

      {calendarView === "week" && !isFetching && fetchError === null && weekData !== null && !noAvailability && (
        <>
          <div className="hidden tablet:block">
            <WeekGrid
              days={weekData.days}
              durationMinutes={durationMinutes}
              selectedStartsAt={bookingMode === "single" ? selectedStartsAt : null}
              pickStartsSet={pickStartsSet}
              pickSpanSet={pickSpanSet}
              plannedStartsAtSet={plannedSet}
              flagReasonByStart={flagReasonByStart}
              takenByPicksSet={takenByPicksSet}
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
              selectedStartsAt={bookingMode === "single" ? selectedStartsAt : null}
              pickStartsSet={pickStartsSet}
              pickSpanSet={pickSpanSet}
              plannedStartsAtSet={plannedSet}
              flagReasonByStart={flagReasonByStart}
              takenByPicksSet={takenByPicksSet}
              onSlotClick={handleSlotClick}
            />
          </div>
        </>
      )}

      {calendarView === "week" && (
        <>
          {errorMessage !== null && (
            <p role="alert" className="text-sm text-danger text-center">
              {errorMessage}
            </p>
          )}
          {bookingMode === "single" && (
            <BottomBar
              selectedStartsAt={selectedStartsAt}
              tooSoon={tooSoon}
              durationMinutes={durationMinutes}
              swimmerIds={swimmerIds}
              needsApproval={weekData?.needsApproval ?? false}
              bookingMinAdvanceHours={bookingMinAdvanceHours}
              balanceCents={balanceCents}
              totalPriceCents={totalPriceCents}
              onConfirm={handleConfirmSingle}
              isConfirming={isBooking}
              onAddFunds={handleAddFundsFromBottomBar}
            />
          )}
          {bookingMode === "multiple" && (
            <MultipleBottomBar
              picks={multiplePicks}
              totalMinutes={totalPickMinutes}
              swimmerCount={swimmerIds.length}
              swimmers={swimmers}
              needsApproval={previewNeedsApproval || (weekData?.needsApproval ?? false)}
              flaggedCount={flaggedPickCount}
              expanded={showPickList}
              onToggleExpanded={() => setShowPickList((prev) => !prev)}
              onRemove={removeMultiplePick}
              onChangePickDuration={changeMultiplePickDuration}
              onTogglePickSwimmer={toggleMultiplePickSwimmer}
              onReview={openReview}
              overCap={overCap}
              emptyPicksNonce={emptyPicksNonce}
              balanceCents={balanceCents}
              totalPriceCents={totalPriceCents}
              onAddFunds={handleAddFundsFromBottomBar}
            />
          )}
          {bookingMode === "recurring" && (
            <RecurringBottomBar
              pattern={pattern}
              weeks={recurringWeeks}
              maxWeeks={maxRecurringWeeks}
              totalLessons={totalLessons}
              totalMinutes={totalPickMinutes}
              totalPrice={
                swimmerIds.length > 0
                  ? plannedStartsAt.reduce(
                      (sum, planned) =>
                        sum + lessonPrice(planned.durationMinutes, swimmerIds.length),
                      0,
                    )
                  : null
              }
              swimmerCount={swimmerIds.length}
              swimmers={swimmers}
              needsApproval={previewNeedsApproval || (weekData?.needsApproval ?? false)}
              flaggedCount={flaggedPickCount}
              expanded={showPickList}
              onToggleExpanded={() => setShowPickList((prev) => !prev)}
              onChangeWeeks={changeRecurringWeeks}
              onRemovePair={removePatternPair}
              onChangePairDuration={changePatternPairDuration}
              onTogglePairSwimmer={togglePatternPairSwimmer}
              onReview={openReview}
              overCap={overCap}
              emptyPicksNonce={emptyPicksNonce}
              balanceCents={balanceCents}
              totalPriceCents={totalPriceCents}
              onAddFunds={handleAddFundsFromBottomBar}
            />
          )}
        </>
      )}

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

      <ReviewSheet
        open={reviewOpen}
        mode={bookingMode === "recurring" ? "recurring" : "multiple"}
        previewPicks={previewPicks}
        swimmers={swimmers}
        skippedIndexes={skippedIndexes}
        removedIndexes={removedIndexes}
        isLoading={isPreviewLoading}
        previewError={previewError}
        submitError={submitError}
        canSubmit={canSubmitReview && batchShortBy === 0 && batchShortfall === null}
        isSubmitting={isSubmitting}
        needsApproval={previewNeedsApproval}
        bookingMinAdvanceHours={bookingMinAdvanceHours}
        success={success}
        balanceCents={balanceCents}
        totalPriceCents={totalPriceCents}
        serverShortfall={batchShortfall}
        {...(bookDisabledReason !== null && { bookDisabledReason })}
        onClose={closeReview}
        onApplySuggestion={handleApplySuggestion}
        onSkip={handleSkipIndex}
        onRemove={handleRemoveIndex}
        onUnskip={handleUnskipIndex}
        onBook={handleBookBatch}
        onBackToCalendar={handleBackToCalendar}
        onBuyPackage={handleBatchBuyPackage}
        onAddCredit={handleBatchAddCredit}
        addCreditCents={addCreditCents}
        isAddingCredit={isAddingCredit}
      />

      <ConfirmDiscardDialog
        open={pendingMode !== null}
        message="Your current picks will be cleared when you switch modes."
        confirmLabel="Switch and clear"
        cancelLabel="Keep editing"
        onConfirm={() => pendingMode && applyModeChange(pendingMode)}
        onCancel={cancelModeChange}
      />

      {shortfall ? (
        <InsufficientBalanceModal
          open={shortfall !== null}
          balanceCents={shortfall.balanceCents}
          priceCents={shortfall.priceCents}
          shortfallCents={shortfall.shortfallCents}
          attempt={shortfall.attempt}
          onClose={() => setShortfall(null)}
        />
      ) : null}
    </div>
  );
}

// ── Mode switch ──────────────────────────────────────────────────────────────

interface ModeSwitchProps {
  mode: BookingMode;
  onChange: (mode: BookingMode) => void;
}

const MODE_BUTTON_BASE =
  "relative z-[2] flex-1 min-h-[44px] px-3 text-sm font-semibold transition-colors duration-150 motion-reduce:transition-none active:scale-[0.97] motion-reduce:transform-none";
const MODE_ACTIVE_TEXT = "text-background";
const MODE_INACTIVE_TEXT = "text-text hover:bg-surface-soft";

function ModeSwitch({ mode, onChange }: ModeSwitchProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Booking mode"
      data-testid="mode-switch"
      className={`${modeStyles.modeTrack} flex rounded-full border border-border overflow-hidden`}
    >
      {/* Clipped active layer sits under the real buttons and slides between
          the three thirds. Buttons stay as the accessible controls. */}
      <div
        aria-hidden="true"
        data-mode={mode}
        className={modeStyles.modeActiveLayer}
      >
        <span className={modeStyles.modeActiveItem}>Single</span>
        <span className={modeStyles.modeActiveItem}>Multiple</span>
        <span className={modeStyles.modeActiveItem}>Recurring</span>
      </div>
      <button
        type="button"
        role="radio"
        aria-checked={mode === "single"}
        onClick={() => onChange("single")}
        data-testid="mode-single"
        className={`${MODE_BUTTON_BASE} ${mode === "single" ? MODE_ACTIVE_TEXT : MODE_INACTIVE_TEXT}`}
      >
        Single
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={mode === "multiple"}
        onClick={() => onChange("multiple")}
        data-testid="mode-multiple"
        className={`${MODE_BUTTON_BASE} border-l border-border ${mode === "multiple" ? MODE_ACTIVE_TEXT : MODE_INACTIVE_TEXT}`}
      >
        Multiple
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={mode === "recurring"}
        onClick={() => onChange("recurring")}
        data-testid="mode-recurring"
        className={`${MODE_BUTTON_BASE} border-l border-border ${mode === "recurring" ? MODE_ACTIVE_TEXT : MODE_INACTIVE_TEXT}`}
      >
        Recurring
      </button>
    </div>
  );
}

// ── Shared bar primitives ────────────────────────────────────────────────────

const BAR_SHELL_CLASS =
  "sticky bottom-[calc(var(--tab-bar-height)_+_env(safe-area-inset-bottom,_0px)_+_1rem)] tablet:bottom-4 z-10 mx-4 tablet:mx-0";
const BAR_CARD_CLASS =
  "bg-heading text-background rounded-[16px] px-5 py-4 flex flex-col gap-3 transition-colors duration-200 motion-reduce:transition-none shadow-lg";
const BAR_PRIMARY_BUTTON_CLASS =
  "min-h-[44px] px-5 rounded-button bg-button-primary-background text-button-primary-text text-sm font-semibold transition-opacity hover:opacity-90 active:scale-[0.97] transition-[opacity,transform] motion-reduce:transform-none disabled:opacity-40 disabled:cursor-default flex-shrink-0";

function formatHoursMinutes(totalMinutes: number): string {
  if (totalMinutes <= 0) return "0 min";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} hr`;
  return `${hours} hr ${minutes} min`;
}


// Inline length picker that lives inside each pick / pattern row. Each row
// owns its own length so a batch can mix 30, 45, and 60-min lessons; changing
// one row's length re-flags only that pick (the server rechecks on preview).
const PICK_DURATIONS = LESSON_DURATION_MINUTES;

interface PickDurationChipsProps {
  value: LessonDurationMinutes;
  ariaLabel: string;
  onChange: (next: LessonDurationMinutes) => void;
}

function PickDurationChips({ value, ariaLabel, onChange }: PickDurationChipsProps) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex gap-1"
      data-testid="pick-duration-chips"
    >
      {PICK_DURATIONS.map((minutes) => {
        const isActive = minutes === value;
        return (
          <button
            key={minutes}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(minutes)}
            className={[
              "min-h-[32px] px-2.5 rounded-full text-xs font-semibold border transition-colors duration-150 motion-reduce:transition-none",
              isActive
                ? "border-background bg-background text-heading"
                : "border-background/40 text-background/80 hover:bg-background/10",
            ].join(" ")}
          >
            {minutes}
          </button>
        );
      })}
    </div>
  );
}

// Per-row swimmer chips (ADR 030 phase 2). Each pick / pattern entry owns
// its own swimmer set; tapping a chip here flips that swimmer on this row
// only and never touches sibling rows or the top-level "new picks" chip.
interface PickSwimmerChipsProps {
  swimmers: readonly { id: string; firstName: string }[];
  selectedIds: readonly string[];
  ariaLabel: string;
  onToggle: (swimmerId: string) => void;
}

function PickSwimmerChips({
  swimmers,
  selectedIds,
  ariaLabel,
  onToggle,
}: PickSwimmerChipsProps) {
  if (swimmers.length <= 1) return null;
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex flex-wrap gap-1"
      data-testid="pick-swimmer-chips"
    >
      {swimmers.map((swimmer) => {
        const isActive = selectedIds.includes(swimmer.id);
        return (
          <button
            key={swimmer.id}
            type="button"
            aria-pressed={isActive}
            onClick={() => onToggle(swimmer.id)}
            className={[
              "min-h-[32px] px-2.5 rounded-full text-xs font-semibold border transition-colors duration-150 motion-reduce:transition-none",
              isActive
                ? "border-background bg-background text-heading"
                : "border-background/40 text-background/80 hover:bg-background/10",
            ].join(" ")}
          >
            {swimmer.firstName}
          </button>
        );
      })}
    </div>
  );
}

// ── Multiple bottom bar ──────────────────────────────────────────────────────

interface MultipleBottomBarProps {
  picks: MultiplePick[];
  totalMinutes: number;
  swimmerCount: number;
  swimmers: readonly { id: string; firstName: string }[];
  needsApproval: boolean;
  flaggedCount: number;
  expanded: boolean;
  onToggleExpanded: () => void;
  onRemove: (startsAt: string) => void;
  onChangePickDuration: (startsAt: string, duration: LessonDurationMinutes) => void;
  onTogglePickSwimmer: (startsAt: string, swimmerId: string) => void;
  onReview: () => void;
  overCap: boolean;
  emptyPicksNonce: number;
  balanceCents: number | null;
  totalPriceCents: number;
  onAddFunds?: () => void;
}

function MultipleBottomBar({
  picks,
  totalMinutes,
  swimmerCount,
  swimmers,
  needsApproval,
  flaggedCount,
  expanded,
  onToggleExpanded,
  onRemove,
  onChangePickDuration,
  onTogglePickSwimmer,
  onReview,
  overCap,
  emptyPicksNonce,
  balanceCents,
  totalPriceCents,
  onAddFunds,
}: MultipleBottomBarProps) {
  const firstNameById = new Map(swimmers.map((swimmer) => [swimmer.id, swimmer.firstName]));
  const atCap = picks.length >= BATCH_LESSON_MAX;
  const totalPrice =
    swimmerCount > 0
      ? picks.reduce(
          (sum, pick) => sum + lessonPrice(pick.durationMinutes, swimmerCount),
          0,
        )
      : null;
  const hasPicks = picks.length > 0;
  // Review stays clickable even without picks so the swimmer-check scroll
  // can fire from the Review tap (ADR 030 phase 2). overCap still blocks it
  // because there is no path for the parent to proceed with too many picks.
  const canReview = !overCap;

  // Short reason shown under the Review button. Priority: structural (no
  // picks / over cap) first, then needs-attention from the live preview, then
  // "pick who's swimming" (soft — click still scrolls to the picker).
  const reviewReason: string | null = (() => {
    if (!hasPicks) return "Add at least one lesson.";
    if (overCap) return `Over the ${BATCH_LESSON_MAX} lesson cap.`;
    if (flaggedCount > 0) {
      return `${flaggedCount} ${flaggedCount === 1 ? "needs" : "need"} attention.`;
    }
    if (swimmerCount === 0) return "Pick who's swimming first.";
    return null;
  })();

  return (
    <div role="region" aria-label="Booking selection" className={BAR_SHELL_CLASS}>
      <div className={BAR_CARD_CLASS}>
        <div className="flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold tabular-nums">
              {hasPicks ? `${picks.length} ${picks.length === 1 ? "lesson" : "lessons"}` : "No lessons picked yet"}
              {hasPicks && (
                <span className="text-xs font-normal opacity-70 ml-2">
                  of {BATCH_LESSON_MAX}
                </span>
              )}
            </p>
            {hasPicks && (
              <p className="text-xs opacity-70 mt-0.5" data-testid="multiple-totals">
                {formatHoursMinutes(totalMinutes)}
                {totalPrice !== null && ` \u00b7 $${totalPrice}`}
                {" \u00b7 "}
                mixed lengths welcome
              </p>
            )}
            {hasPicks && balanceCents !== null && (
              <p
                className="text-xs opacity-70 mt-0.5"
                data-testid="multiple-balance-line"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                Balance: {formatDollars(balanceCents)}
                {totalPriceCents > balanceCents && (
                  <>
                    {" · "}
                    <span className="font-semibold">
                      Short by {formatDollars(totalPriceCents - balanceCents)}
                    </span>
                  </>
                )}
                {onAddFunds !== undefined && (
                  <>
                    {" · "}
                    <button
                      type="button"
                      onClick={onAddFunds}
                      data-testid="multiple-add-funds"
                      className="underline hover:opacity-80 font-semibold"
                    >
                      Add funds
                    </button>
                  </>
                )}
              </p>
            )}
            {needsApproval && hasPicks && (
              <p className="text-xs opacity-70 mt-0.5">Jason will confirm each one.</p>
            )}
            {atCap && !overCap && (
              <p className="text-xs opacity-70 mt-0.5">
                Max {BATCH_LESSON_MAX} lessons at a time.
              </p>
            )}
          </div>

          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <button
              type="button"
              onClick={onReview}
              disabled={!canReview}
              data-testid="review-multiple"
              className={BAR_PRIMARY_BUTTON_CLASS}
            >
              Review
            </button>
            {reviewReason !== null && (
              <p
                // Re-mount the aria-live region on every empty-picks Review
                // tap so screen readers announce the reason again — the sheet
                // doesn't open, so without this the tap would feel silent.
                key={!hasPicks ? `empty-${emptyPicksNonce}` : "static"}
                className="text-[11px] text-background/70 text-right max-w-[12rem]"
                data-testid="multiple-disabled-reason"
                role={flaggedCount > 0 || overCap || !hasPicks ? "status" : undefined}
                aria-live={!hasPicks ? "polite" : undefined}
              >
                {reviewReason}
              </p>
            )}
          </div>
        </div>

        {hasPicks && (
          <>
            <button
              type="button"
              onClick={onToggleExpanded}
              aria-expanded={expanded}
              data-testid="multiple-count-toggle"
              className="flex items-center gap-2 text-xs font-semibold opacity-80 hover:opacity-100 self-start transition-opacity duration-150 motion-reduce:transition-none"
            >
              <span>{expanded ? "Hide picks" : "Show picks"}</span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                aria-hidden="true"
                className="transition-transform duration-150 ease-out motion-reduce:transition-none"
                style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
              >
                <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {expanded && (
              <ul
                className="max-h-[40vh] overflow-y-auto flex flex-col border-t border-background/20"
                data-testid="multiple-pick-list"
              >
                {picks.map((pick) => {
                  const pickLabel = formatSlotRangeWithDate(pick.startsAt, pick.durationMinutes);
                  const pickSwimmerNames = pick.swimmerIds
                    .map((id) => firstNameById.get(id))
                    .filter((name): name is string => name !== undefined);
                  return (
                    <li
                      key={pick.startsAt}
                      className="flex flex-col gap-2 py-3 border-b border-background/20 last:border-b-0"
                      data-testid="multiple-pick-row"
                    >
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <span className="text-sm flex-1 min-w-0">{pickLabel}</span>
                        <PickDurationChips
                          value={pick.durationMinutes}
                          ariaLabel={`Length for ${pickLabel}`}
                          onChange={(next) => onChangePickDuration(pick.startsAt, next)}
                        />
                        <button
                          type="button"
                          onClick={() => onRemove(pick.startsAt)}
                          aria-label={`Remove ${pickLabel}`}
                          className="min-h-[36px] px-2 rounded-full text-xs font-semibold opacity-80 hover:opacity-100 active:scale-[0.97] motion-reduce:transform-none transition-opacity duration-150"
                        >
                          Remove
                        </button>
                      </div>
                      {swimmers.length > 1 ? (
                        <PickSwimmerChips
                          swimmers={swimmers}
                          selectedIds={pick.swimmerIds}
                          ariaLabel={`Swimmers for ${pickLabel}`}
                          onToggle={(swimmerId) => onTogglePickSwimmer(pick.startsAt, swimmerId)}
                        />
                      ) : (
                        pickSwimmerNames.length > 0 && (
                          <p
                            className="text-xs opacity-70"
                            data-testid="multiple-pick-swimmers"
                          >
                            Who's swimming: {pickSwimmerNames.join(", ")}
                          </p>
                        )
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Recurring bottom bar ─────────────────────────────────────────────────────

interface RecurringBottomBarProps {
  pattern: BatchPatternPair[];
  weeks: number;
  maxWeeks: number;
  totalLessons: number;
  totalMinutes: number;
  totalPrice: number | null;
  swimmerCount: number;
  swimmers: readonly { id: string; firstName: string }[];
  needsApproval: boolean;
  flaggedCount: number;
  expanded: boolean;
  onToggleExpanded: () => void;
  onChangeWeeks: (next: number) => void;
  onRemovePair: (pair: BatchPatternPair) => void;
  onChangePairDuration: (pair: BatchPatternPair, next: LessonDurationMinutes) => void;
  onTogglePairSwimmer: (pair: BatchPatternPair, swimmerId: string) => void;
  onReview: () => void;
  overCap: boolean;
  emptyPicksNonce: number;
  balanceCents: number | null;
  totalPriceCents: number;
  onAddFunds?: () => void;
}

function RecurringBottomBar({
  pattern,
  weeks,
  maxWeeks,
  totalLessons,
  totalMinutes,
  totalPrice,
  swimmerCount,
  swimmers,
  needsApproval,
  flaggedCount,
  expanded,
  onToggleExpanded,
  onChangeWeeks,
  onRemovePair,
  onChangePairDuration,
  onTogglePairSwimmer,
  onReview,
  overCap,
  emptyPicksNonce,
  balanceCents,
  totalPriceCents,
  onAddFunds,
}: RecurringBottomBarProps) {
  const firstNameById = new Map(swimmers.map((swimmer) => [swimmer.id, swimmer.firstName]));
  const hasPattern = pattern.length > 0;
  const patternLabel = hasPattern
    ? pattern.map(formatPatternRangeAndLength).join(" + ")
    : "No pattern yet";
  // Review stays clickable even without a pattern so the swimmer-check
  // scroll fires from the Review tap (ADR 030 phase 2); overCap blocks it.
  const canReview = !overCap;

  // Reason shown under the Review button. Match MultipleBottomBar's priority
  // so the first blocker surfaces first; "pick who's swimming" is a soft hint
  // that keeps Review clickable and relies on the click handler to scroll.
  const reviewReason: string | null = (() => {
    if (!hasPattern) return "Add at least one lesson.";
    if (overCap) return `Over the ${BATCH_LESSON_MAX} lesson cap.`;
    if (flaggedCount > 0) {
      return `${flaggedCount} ${flaggedCount === 1 ? "needs" : "need"} attention.`;
    }
    if (swimmerCount === 0) return "Pick who's swimming first.";
    return null;
  })();

  return (
    <div role="region" aria-label="Booking selection" className={BAR_SHELL_CLASS}>
      <div className={BAR_CARD_CLASS}>
        <div className="flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <p
              className="text-sm font-semibold truncate"
              data-testid="recurring-pattern-label"
            >
              {patternLabel}
            </p>
            <p className="text-xs opacity-70 mt-0.5" data-testid="recurring-total">
              {hasPattern ? (
                overCap
                  ? `${totalLessons} lessons, over the ${BATCH_LESSON_MAX} cap`
                  : `${totalLessons} ${totalLessons === 1 ? "lesson" : "lessons"} \u00b7 ${formatHoursMinutes(totalMinutes)}`
              ) : (
                "Tap open times to build a pattern."
              )}
              {hasPattern && !overCap && totalPrice !== null && ` \u00b7 $${totalPrice}`}
            </p>
            {hasPattern && !overCap && balanceCents !== null && (
              <p
                className="text-xs opacity-70 mt-0.5"
                data-testid="recurring-balance-line"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                Balance: {formatDollars(balanceCents)}
                {totalPriceCents > balanceCents && (
                  <>
                    {" · "}
                    <span className="font-semibold">
                      Short by {formatDollars(totalPriceCents - balanceCents)}
                    </span>
                  </>
                )}
                {onAddFunds !== undefined && (
                  <>
                    {" · "}
                    <button
                      type="button"
                      onClick={onAddFunds}
                      data-testid="recurring-add-funds"
                      className="underline hover:opacity-80 font-semibold"
                    >
                      Add funds
                    </button>
                  </>
                )}
              </p>
            )}
            {needsApproval && hasPattern && !overCap && (
              <p className="text-xs opacity-70 mt-0.5">Jason will confirm each one.</p>
            )}
          </div>

          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <button
              type="button"
              onClick={onReview}
              disabled={!canReview}
              data-testid="review-recurring"
              className={BAR_PRIMARY_BUTTON_CLASS}
            >
              Review
            </button>
            {reviewReason !== null && (
              <p
                // Re-mount the aria-live region on every empty-pattern
                // Review tap so screen readers re-announce the reason — the
                // sheet doesn't open, so the tap would feel silent otherwise.
                key={!hasPattern ? `empty-${emptyPicksNonce}` : "static"}
                className="text-[11px] text-background/70 text-right max-w-[12rem]"
                data-testid="recurring-disabled-reason"
                role={flaggedCount > 0 || overCap || !hasPattern ? "status" : undefined}
                aria-live={!hasPattern ? "polite" : undefined}
              >
                {reviewReason}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div
            className="flex items-center gap-1 bg-background/10 rounded-full px-1 py-1"
            aria-label="Weeks"
          >
            <button
              type="button"
              onClick={() => onChangeWeeks(weeks - 1)}
              disabled={weeks <= 1}
              aria-label="Fewer weeks"
              data-testid="recurring-weeks-minus"
              className="min-h-[36px] min-w-[36px] rounded-full hover:bg-background/10 active:scale-[0.97] motion-reduce:transform-none transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              &minus;
            </button>
            <span
              className="min-w-[3.5rem] text-center text-xs font-semibold tabular-nums"
              data-testid="recurring-weeks-value"
              aria-live="polite"
            >
              {weeks} {weeks === 1 ? "wk" : "wks"}
            </span>
            <button
              type="button"
              onClick={() => onChangeWeeks(weeks + 1)}
              disabled={weeks >= maxWeeks}
              aria-label="More weeks"
              data-testid="recurring-weeks-plus"
              className="min-h-[36px] min-w-[36px] rounded-full hover:bg-background/10 active:scale-[0.97] motion-reduce:transform-none transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              +
            </button>
          </div>

          {hasPattern && (
            <button
              type="button"
              onClick={onToggleExpanded}
              aria-expanded={expanded}
              data-testid="recurring-pattern-toggle"
              className="flex items-center gap-2 text-xs font-semibold opacity-80 hover:opacity-100 transition-opacity duration-150 motion-reduce:transition-none"
            >
              <span>{expanded ? "Hide pattern" : "Show pattern"}</span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                aria-hidden="true"
                className="transition-transform duration-150 ease-out motion-reduce:transition-none"
                style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
              >
                <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>

        {hasPattern && expanded && (
          <ul
            className="flex flex-col border-t border-background/20"
            data-testid="recurring-pattern-list"
          >
            {pattern.map((pair) => {
              const pairLabel = formatPatternRangeAndLength(pair);
              const pairSwimmerNames = pair.swimmerIds
                .map((id) => firstNameById.get(id))
                .filter((name): name is string => name !== undefined);
              return (
                <li
                  key={`${pair.weekday}-${pair.timeOfDay}`}
                  className="flex flex-col gap-2 py-3 border-b border-background/20 last:border-b-0"
                  data-testid="recurring-pattern-row"
                >
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <span className="text-xs font-semibold flex-1 min-w-0">{pairLabel}</span>
                    <PickDurationChips
                      value={pair.durationMinutes}
                      ariaLabel={`Length for ${pairLabel}`}
                      onChange={(next) => onChangePairDuration(pair, next)}
                    />
                    <button
                      type="button"
                      onClick={() => onRemovePair(pair)}
                      aria-label={`Remove ${pairLabel}`}
                      className="min-h-[36px] px-2 rounded-full text-xs font-semibold opacity-80 hover:opacity-100 active:scale-[0.97] motion-reduce:transform-none transition-opacity duration-150"
                    >
                      Remove
                    </button>
                  </div>
                  {swimmers.length > 1 ? (
                    <PickSwimmerChips
                      swimmers={swimmers}
                      selectedIds={pair.swimmerIds}
                      ariaLabel={`Swimmers for ${pairLabel}`}
                      onToggle={(swimmerId) => onTogglePairSwimmer(pair, swimmerId)}
                    />
                  ) : (
                    pairSwimmerNames.length > 0 && (
                      <p
                        className="text-xs opacity-70"
                        data-testid="recurring-pair-swimmers"
                      >
                        Who's swimming: {pairSwimmerNames.join(", ")}
                      </p>
                    )
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
