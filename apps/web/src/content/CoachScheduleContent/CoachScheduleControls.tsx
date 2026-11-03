"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type MouseEvent, type ReactNode } from "react";

import { dayViewLabel, weekRangeLabel } from "@/lib/calendarDate";

interface Props {
  date: string;
  view: "day" | "week";
  today: string;
  weekMonday: string;
  todayMonday: string;
  prevDay: string;
  nextDay: string;
  prevWeekMonday: string;
  nextWeekMonday: string;
  children: ReactNode;
}

export default function CoachScheduleControls({
  date,
  view,
  today,
  weekMonday,
  todayMonday,
  prevDay,
  nextDay,
  prevWeekMonday,
  nextWeekMonday,
  children,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [optimisticView, setOptimisticView] = useState<"day" | "week">(view);
  const [optimisticDate, setOptimisticDate] = useState(date);
  const [optimisticWeekMonday, setOptimisticWeekMonday] = useState(weekMonday);

  useEffect(() => {
    setOptimisticView(view);
    setOptimisticDate(date);
    setOptimisticWeekMonday(weekMonday);
  }, [view, date, weekMonday]);

  useEffect(() => {
    const siblingHref =
      view === "day"
        ? `/coach/schedule?view=week&date=${weekMonday}`
        : `/coach/schedule?view=day&date=${date}`;
    router.prefetch(siblingHref);
    if (view === "day") {
      router.prefetch(`/coach/schedule?view=day&date=${prevDay}`);
      router.prefetch(`/coach/schedule?view=day&date=${nextDay}`);
    } else {
      router.prefetch(`/coach/schedule?view=week&date=${prevWeekMonday}`);
      router.prefetch(`/coach/schedule?view=week&date=${nextWeekMonday}`);
    }
  }, [router, view, date, weekMonday, prevDay, nextDay, prevWeekMonday, nextWeekMonday]);

  function navigate(nextView: "day" | "week", nextDate: string, href: string) {
    setOptimisticView(nextView);
    setOptimisticDate(nextDate);
    if (nextView === "week") setOptimisticWeekMonday(nextDate);
    startTransition(() => router.push(href));
  }

  function onLinkClick(
    event: MouseEvent<HTMLAnchorElement>,
    nextView: "day" | "week",
    nextDate: string,
    href: string,
  ) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    navigate(nextView, nextDate, href);
  }

  const dayToggleHref = `?view=day&date=${optimisticView === "day" ? optimisticDate : date}`;
  const weekToggleHref = `?view=week&date=${optimisticWeekMonday}`;
  const todayDayHref = `?view=day&date=${today}`;
  const todayWeekHref = `?view=week&date=${todayMonday}`;

  // Bulk cancel pre-fills the date range from the current view. Day view
  // seeds start=end=current date; week view seeds start=end=the first
  // upcoming day of the viewed week (clamped to `today` if the week has
  // already started, falling back to `today` for a fully-past week). The
  // form itself clamps against today, so a stale URL still lands on an
  // editable, non-past default.
  const bulkCancelAnchor =
    optimisticView === "day"
      ? optimisticDate
      : firstUpcomingOfWeek(optimisticWeekMonday, today);
  const bulkCancelHref = `/coach/schedule/bulk-cancel?startDate=${bulkCancelAnchor}&endDate=${bulkCancelAnchor}`;

  // Compute labels from optimistic state so the day/week heading matches the
  // just-clicked state instantly, instead of lagging until the server renders
  // the new URL. Both helpers are pure.
  const dayLabel = dayViewLabel(optimisticDate, today);
  const weekLabel = weekRangeLabel(optimisticWeekMonday);

  return (
    <>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-3xl tablet:text-4xl text-heading">Schedule</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <Link
            href="/coach/book"
            className="inline-flex items-center justify-center min-h-[44px] px-5 rounded-button bg-button-primary-background text-button-primary-text text-sm font-bold transition-opacity duration-150 motion-reduce:transition-none hover:opacity-90 active:scale-[0.97]"
          >
            Book lesson
          </Link>
          <Link
            href={bulkCancelHref}
            className="inline-flex items-center justify-center min-h-[44px] px-5 rounded-button border border-border text-text-secondary text-sm font-semibold transition-colors duration-150 motion-reduce:transition-none hover:bg-surface-soft active:scale-[0.97]"
          >
            Cancel lessons
          </Link>
          <div
            className="flex rounded-button border border-border overflow-hidden flex-shrink-0"
            role="group"
            aria-label="Schedule view"
          >
            <Link
              href={dayToggleHref}
              aria-current={optimisticView === "day" ? "page" : undefined}
              onClick={(event) => onLinkClick(event, "day", date, dayToggleHref)}
              className={`px-4 h-11 inline-flex items-center text-sm font-semibold transition-colors duration-100 ${
                optimisticView === "day"
                  ? "bg-accent text-on-accent"
                  : "text-text-secondary hover:bg-surface-soft"
              }`}
            >
              Day
            </Link>
            <Link
              href={weekToggleHref}
              aria-current={optimisticView === "week" ? "page" : undefined}
              onClick={(event) => onLinkClick(event, "week", optimisticWeekMonday, weekToggleHref)}
              className={`px-4 h-11 inline-flex items-center text-sm font-semibold border-l border-border transition-colors duration-100 ${
                optimisticView === "week"
                  ? "bg-accent text-on-accent"
                  : "text-text-secondary hover:bg-surface-soft"
              }`}
            >
              Week
            </Link>
          </div>
        </div>
      </div>

      {optimisticView === "day" ? (
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href={`?view=day&date=${prevDay}`}
            aria-label="Previous day"
            onClick={(event) => onLinkClick(event, "day", prevDay, `?view=day&date=${prevDay}`)}
            className="inline-flex items-center justify-center w-11 h-11 rounded-button border border-border text-text-secondary hover:bg-surface-soft transition-colors duration-100"
          >
            <ChevronLeftIcon />
          </Link>
          <Link
            href={`?view=day&date=${nextDay}`}
            aria-label="Next day"
            onClick={(event) => onLinkClick(event, "day", nextDay, `?view=day&date=${nextDay}`)}
            className="inline-flex items-center justify-center w-11 h-11 rounded-button border border-border text-text-secondary hover:bg-surface-soft transition-colors duration-100"
          >
            <ChevronRightIcon />
          </Link>
          <span className="font-semibold text-heading text-base">{dayLabel}</span>
          {optimisticDate !== today && (
            <Link
              href={todayDayHref}
              onClick={(event) => onLinkClick(event, "day", today, todayDayHref)}
              className="inline-flex items-center justify-center h-11 px-4 rounded-button border border-border text-text-secondary text-sm font-semibold hover:bg-surface-soft transition-colors duration-100"
            >
              Today
            </Link>
          )}
          <input
            type="date"
            value={optimisticDate}
            aria-label="Jump to date"
            onChange={(event) => {
              const next = event.target.value;
              if (!next) return;
              navigate("day", next, `?view=day&date=${next}`);
            }}
            className="h-11 px-3 rounded-button border border-border bg-background text-text text-sm focus:outline focus:outline-2 focus:outline-focus-ring"
          />
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href={`?view=week&date=${prevWeekMonday}`}
            aria-label="Previous week"
            onClick={(event) =>
              onLinkClick(event, "week", prevWeekMonday, `?view=week&date=${prevWeekMonday}`)
            }
            className="inline-flex items-center justify-center w-11 h-11 rounded-button border border-border text-text-secondary hover:bg-surface-soft transition-colors duration-100"
          >
            <ChevronLeftIcon />
          </Link>
          <Link
            href={`?view=week&date=${nextWeekMonday}`}
            aria-label="Next week"
            onClick={(event) =>
              onLinkClick(event, "week", nextWeekMonday, `?view=week&date=${nextWeekMonday}`)
            }
            className="inline-flex items-center justify-center w-11 h-11 rounded-button border border-border text-text-secondary hover:bg-surface-soft transition-colors duration-100"
          >
            <ChevronRightIcon />
          </Link>
          <span className="font-semibold text-heading text-base">{weekLabel}</span>
          {optimisticWeekMonday !== todayMonday && (
            <Link
              href={todayWeekHref}
              onClick={(event) => onLinkClick(event, "week", todayMonday, todayWeekHref)}
              className="inline-flex items-center justify-center h-11 px-4 rounded-button border border-border text-text-secondary text-sm font-semibold hover:bg-surface-soft transition-colors duration-100"
            >
              Today
            </Link>
          )}
        </div>
      )}

      <div
        data-pending={isPending ? "true" : undefined}
        aria-busy={isPending || undefined}
        className={`transition-opacity duration-150 motion-reduce:transition-none ${
          isPending ? "opacity-60" : "opacity-100"
        }`}
      >
        {children}
      </div>
    </>
  );
}

// Returns the first LA calendar date in the viewed week that is `today` or
// later. If the entire week is in the past, falls back to `today` so the
// bulk-cancel form opens on an editable, non-past default.
function firstUpcomingOfWeek(weekMonday: string, today: string): string {
  // Future week → the week's Monday. Current or past week → today. (For a
  // past week this falls back to today so the form opens on an editable,
  // non-past date; the form input also enforces min={today}.)
  return today <= weekMonday ? weekMonday : today;
}

function ChevronLeftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M13 4l-6 6 6 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M7 4l6 6-6 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
