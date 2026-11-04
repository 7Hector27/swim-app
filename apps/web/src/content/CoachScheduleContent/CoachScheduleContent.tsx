import Link from "next/link";
import type { CoachScheduleItem, CoachWeekScheduleDay } from "@swim-app/shared";
import { fetchCoachSchedule, fetchCoachWeekSchedule } from "@/lib/api/lessons";
import {
  addDays,
  mondayOf,
  shortDayLabel,
  weekDates,
} from "@/lib/calendarDate";
import CoachLessonRow from "@/components/CoachLessonRow";
import CoachWeekLessonCard from "@/components/CoachWeekLessonCard";
import CoachScheduleControls from "./CoachScheduleControls";

interface Props {
  accessToken: string;
  date: string;
  view: "day" | "week";
  today: string;
}

export default async function CoachScheduleContent({ accessToken, date, view, today }: Props) {
  const [dayResult, weekResult] = await Promise.all([
    view === "day" ? fetchCoachSchedule(accessToken, date) : Promise.resolve(null),
    view === "week" ? fetchCoachWeekSchedule(accessToken, date) : Promise.resolve(null),
  ]);

  // Primary — the schedule view is the coach's main data. If the fetch for
  // the current view fails, throw so the route error boundary renders.
  if (view === "day" && dayResult !== null && !dayResult.ok) {
    throw new Error(`Failed to load schedule (${dayResult.reason})`);
  }
  if (view === "week" && weekResult !== null && !weekResult.ok) {
    throw new Error(`Failed to load schedule (${weekResult.reason})`);
  }
  const dayItems: CoachScheduleItem[] = dayResult !== null && dayResult.ok ? dayResult.data : [];

  const weekMonday = view === "week" ? date : mondayOf(date);
  const prevDay = addDays(date, -1);
  const nextDay = addDays(date, 1);
  const prevWeekMonday = addDays(weekMonday, -7);
  const nextWeekMonday = addDays(weekMonday, 7);
  const todayMonday = mondayOf(today);

  const weekDays: CoachWeekScheduleDay[] =
    weekResult !== null && weekResult.ok
      ? weekResult.data.days
      : weekDates(weekMonday).map((d) => ({ date: d, items: [] }));

  return (
    <div className="flex flex-col flex-1 bg-background">
      <main id="main-content" className="flex-1">
        <div className="mx-auto max-w-content px-page pt-8 pb-20 tablet:pt-12 tablet:pb-32 flex flex-col gap-6">
          <CoachScheduleControls
            date={date}
            view={view}
            today={today}
            weekMonday={weekMonday}
            todayMonday={todayMonday}
            prevDay={prevDay}
            nextDay={nextDay}
            prevWeekMonday={prevWeekMonday}
            nextWeekMonday={nextWeekMonday}
          >
            {view === "day" ? (
              <DayContent items={dayItems} />
            ) : (
              <WeekContent days={weekDays} today={today} />
            )}
          </CoachScheduleControls>
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
