import Link from "next/link";
import type { CoachScheduleItem, CoachWeekScheduleDay } from "@swim-app/shared";
import { fetchCoachSchedule, fetchCoachWeekSchedule } from "@/lib/api/lessons";
import {
  addDays,
  dayViewLabel,
  mondayOf,
  shortDayLabel,
  weekDates,
  weekRangeLabel,
} from "@/lib/calendarDate";
import CoachLessonRow from "@/components/CoachLessonRow";
import CoachWeekLessonCard from "@/components/CoachWeekLessonCard";
import DatePickerInput from "./DatePickerInput";

interface Props {
  accessToken: string;
  date: string;
  view: "day" | "week";
  today: string;
}

export default async function CoachScheduleContent({ accessToken, date, view, today }: Props) {
  const [dayItems, weekResponse] = await Promise.all([
    view === "day" ? fetchCoachSchedule(accessToken, date) : Promise.resolve([]),
    view === "week" ? fetchCoachWeekSchedule(accessToken, date) : Promise.resolve(null),
  ]);

  const weekMonday = view === "week" ? date : mondayOf(date);
  const prevDay = addDays(date, -1);
  const nextDay = addDays(date, 1);
  const prevWeekMonday = addDays(weekMonday, -7);
  const nextWeekMonday = addDays(weekMonday, 7);
  const todayMonday = mondayOf(today);

  const weekDays: CoachWeekScheduleDay[] = weekResponse
    ? weekResponse.days
    : weekDates(weekMonday).map((d) => ({ date: d, items: [] }));

  return (
    <div className="flex flex-col flex-1 bg-background">
      <main id="main-content" className="flex-1">
        <div className="mx-auto max-w-content px-page pt-8 pb-20 tablet:pt-12 tablet:pb-32 flex flex-col gap-6">
          {/* ── Header + toggle ─────────────────────────────────────────── */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <h1 className="text-3xl tablet:text-4xl text-heading">Schedule</h1>
            <div className="flex items-center gap-3 flex-wrap">
              <Link
                href="/coach/book"
                className="inline-flex items-center justify-center min-h-[44px] px-5 rounded-button bg-button-primary-background text-button-primary-text text-sm font-bold transition-opacity duration-150 motion-reduce:transition-none hover:opacity-90 active:scale-[0.97]"
              >
                Book lesson
              </Link>
              <div className="flex rounded-button border border-border overflow-hidden flex-shrink-0">
                <Link
                  href={`?view=day&date=${date}`}
                  aria-current={view === "day" ? "page" : undefined}
                  className={`px-4 h-11 inline-flex items-center text-sm font-semibold transition-colors duration-100 ${
                    view === "day"
                      ? "bg-accent text-on-accent"
                      : "text-text-secondary hover:bg-surface-soft"
                  }`}
                >
                  Day
                </Link>
                <Link
                  href={`?view=week&date=${weekMonday}`}
                  aria-current={view === "week" ? "page" : undefined}
                  className={`px-4 h-11 inline-flex items-center text-sm font-semibold border-l border-border transition-colors duration-100 ${
                    view === "week"
                      ? "bg-accent text-on-accent"
                      : "text-text-secondary hover:bg-surface-soft"
                  }`}
                >
                  Week
                </Link>
              </div>
            </div>
          </div>

          {/* ── Navigation bar ─────────────────────────────────────────── */}
          {view === "day" ? (
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                href={`?view=day&date=${prevDay}`}
                aria-label="Previous day"
                className="inline-flex items-center justify-center w-11 h-11 rounded-button border border-border text-text-secondary hover:bg-surface-soft transition-colors duration-100"
              >
                <ChevronLeftIcon />
              </Link>
              <Link
                href={`?view=day&date=${nextDay}`}
                aria-label="Next day"
                className="inline-flex items-center justify-center w-11 h-11 rounded-button border border-border text-text-secondary hover:bg-surface-soft transition-colors duration-100"
              >
                <ChevronRightIcon />
              </Link>
              <span className="font-semibold text-heading text-base">{dayViewLabel(date, today)}</span>
              {date !== today && (
                <Link
                  href={`?view=day&date=${today}`}
                  className="inline-flex items-center justify-center h-11 px-4 rounded-button border border-border text-text-secondary text-sm font-semibold hover:bg-surface-soft transition-colors duration-100"
                >
                  Today
                </Link>
              )}
              <DatePickerInput date={date} />
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                href={`?view=week&date=${prevWeekMonday}`}
                aria-label="Previous week"
                className="inline-flex items-center justify-center w-11 h-11 rounded-button border border-border text-text-secondary hover:bg-surface-soft transition-colors duration-100"
              >
                <ChevronLeftIcon />
              </Link>
              <Link
                href={`?view=week&date=${nextWeekMonday}`}
                aria-label="Next week"
                className="inline-flex items-center justify-center w-11 h-11 rounded-button border border-border text-text-secondary hover:bg-surface-soft transition-colors duration-100"
              >
                <ChevronRightIcon />
              </Link>
              <span className="font-semibold text-heading text-base">{weekRangeLabel(weekMonday)}</span>
              {weekMonday !== todayMonday && (
                <Link
                  href={`?view=week&date=${todayMonday}`}
                  className="inline-flex items-center justify-center h-11 px-4 rounded-button border border-border text-text-secondary text-sm font-semibold hover:bg-surface-soft transition-colors duration-100"
                >
                  Today
                </Link>
              )}
            </div>
          )}

          {/* ── Content ────────────────────────────────────────────────── */}
          {view === "day" ? (
            <DayContent items={dayItems} />
          ) : (
            <WeekContent days={weekDays} today={today} />
          )}
        </div>
      </main>
    </div>
  );
}

// ── Day view ──────────────────────────────────────────────────────────────────

function DayContent({ items }: { items: CoachScheduleItem[] }) {
  const visibleItems = items.filter((item) => item.type !== "open_slot");
  if (visibleItems.length === 0) {
    return (
      <div className="rounded-card border border-border">
        <p className="px-5 py-10 text-sm text-text-secondary text-center">
          No lessons for this day.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {visibleItems.map((item) => (
        <ScheduleRow
          key={item.type === "lesson" ? item.lesson.id : `${item.type}-${item.startsAt}`}
          item={item}
        />
      ))}
    </div>
  );
}

function ScheduleRow({ item }: { item: CoachScheduleItem }) {
  if (item.type === "lesson") {
    return <CoachLessonRow item={item} />;
  }

  if (item.type === "travel_buffer") {
    const startLabel = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(item.startsAt));
    const durationMin = Math.round(
      (new Date(item.endsAt).getTime() - new Date(item.startsAt).getTime()) / 60_000,
    );
    return (
      <div className="rounded-card border border-border overflow-hidden">
        <div className="flex items-center gap-4 px-5 py-4 bg-surface-soft">
          <div className="flex-shrink-0 w-[72px]">
            <p className="text-xs font-semibold text-text-secondary tabular-nums">{startLabel}</p>
          </div>
          <div className="flex-1 min-w-0 flex items-center gap-2">
            <TravelIcon />
            <div>
              <p className="text-sm font-semibold text-text">Travel buffer, {durationMin} min</p>
              <p className="text-xs text-text-secondary mt-0.5">
                {item.fromLocationName} &rarr; {item.toLocationName}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// ── Week view ─────────────────────────────────────────────────────────────────

function WeekContent({ days, today }: { days: CoachWeekScheduleDay[]; today: string }) {
  return (
    <>
      {/* Desktop: 7-column grid */}
      <div className="hidden tablet:grid tablet:grid-cols-7 border border-border rounded-card overflow-hidden">
        {days.map((day) => (
          <DayColumn key={day.date} day={day} today={today} />
        ))}
      </div>

      {/* Phone: stacked sections */}
      <div className="tablet:hidden flex flex-col gap-4">
        {days.map((day) => (
          <DaySection key={day.date} day={day} today={today} />
        ))}
      </div>
    </>
  );
}

function DayColumn({ day, today }: { day: CoachWeekScheduleDay; today: string }) {
  const isToday = day.date === today;
  return (
    <div className="flex flex-col border-r border-border last:border-r-0">
      {/* Column header */}
      <Link
        href={`?view=day&date=${day.date}`}
        className={`px-2 py-3 text-center text-xs font-semibold border-b border-border hover:bg-surface-soft transition-colors duration-100 ${
          isToday ? "text-accent bg-accent/5" : "text-text-secondary"
        }`}
      >
        {shortDayLabel(day.date)}
        {isToday && <span className="sr-only"> (today)</span>}
      </Link>
      {/* Lessons (tablet+ week columns use the compact week card, not the day-view row) */}
      <div className="flex-1 flex flex-col gap-1.5 p-1.5">
        {day.items.length === 0 ? (
          <p className="text-xs italic text-text-secondary/70 text-center py-4">No lessons.</p>
        ) : (
          day.items.map((item) => (
            <CoachWeekLessonCard key={item.lesson.id} item={item} />
          ))
        )}
      </div>
    </div>
  );
}

function DaySection({ day, today }: { day: CoachWeekScheduleDay; today: string }) {
  const isToday = day.date === today;
  return (
    <section aria-labelledby={`day-heading-${day.date}`}>
      <Link
        href={`?view=day&date=${day.date}`}
        id={`day-heading-${day.date}`}
        className={`block text-sm font-semibold mb-2 hover:underline ${
          isToday ? "text-accent" : "text-heading"
        }`}
      >
        {shortDayLabel(day.date)}
        {isToday && <span className="sr-only"> (today)</span>}
      </Link>
      <div className="flex flex-col gap-2">
        {day.items.length === 0 ? (
          <div className="rounded-card border border-border">
            <p className="px-5 py-4 text-sm text-text-secondary">No lessons.</p>
          </div>
        ) : (
          day.items.map((item) => (
            <CoachLessonRow key={item.lesson.id} item={item} />
          ))
        )}
      </div>
    </section>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

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

function TravelIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-shrink-0 text-text-secondary"
      aria-hidden="true"
    >
      <rect x="1" y="3" width="15" height="13" rx="2" />
      <path d="M16 8h4l3 3v5h-7V8z" />
      <circle cx="5.5" cy="18.5" r="2.5" />
      <circle cx="18.5" cy="18.5" r="2.5" />
    </svg>
  );
}
