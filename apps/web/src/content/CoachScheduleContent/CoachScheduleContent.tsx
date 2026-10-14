import SiteNav from "@/components/SiteNav";
import SiteFooter from "@/components/SiteFooter";
import { fetchCoachSchedule } from "@/lib/api/lessons";
import type { ScheduleItem } from "@swim-app/shared";
import Link from "next/link";

interface Props {
  accessToken: string;
  date: string;
}

export default async function CoachScheduleContent({ accessToken, date }: Props) {
  const schedule = await fetchCoachSchedule(accessToken, date);
  const items = schedule?.items ?? [];

  const dateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(date + "T12:00:00Z"));

  const prevDate = offsetDate(date, -1);
  const nextDate = offsetDate(date, 1);

  const lessonCount = items.filter((item) => item.type === "lesson").length;

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <SiteNav />

      <main id="main-content" className="flex-1">
        <div className="mx-auto max-w-content px-page pt-10 pb-20 tablet:pt-14 tablet:pb-32">
          <div className="flex items-center gap-4 mb-8">
            <Link
              href="/coach/dashboard"
              className="flex items-center gap-1.5 text-sm font-semibold text-link hover:text-link-hover transition-colors duration-150"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Dashboard
            </Link>
          </div>

          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl tablet:text-4xl text-heading">{dateLabel}</h1>
              <p className="mt-1 text-sm text-text-secondary">
                {lessonCount} lesson{lessonCount !== 1 ? "s" : ""} scheduled
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href={`/coach/schedule?date=${prevDate}`}
                className="inline-flex items-center justify-center w-10 h-10 rounded-card border border-border text-text-secondary hover:text-text hover:border-heading transition-colors duration-150"
                aria-label="Previous day"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
              <Link
                href={`/coach/schedule?date=${nextDate}`}
                className="inline-flex items-center justify-center w-10 h-10 rounded-card border border-border text-text-secondary hover:text-text hover:border-heading transition-colors duration-150"
                aria-label="Next day"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            </div>
          </div>

          <div className="rounded-card border border-border overflow-hidden">
            {items.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <p className="text-sm text-text-secondary">No lessons or open slots on this day.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {items.map((item, index) => (
                  <ScheduleItemRow key={index} item={item} />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

function ScheduleItemRow({ item }: { item: ScheduleItem }) {
  if (item.type === "lesson") {
    const startsAt = new Date(item.lesson.startsAt);
    const endsAt = new Date(startsAt.getTime() + item.lesson.durationMinutes * 60 * 1000);
    const swimmerNames = item.lesson.swimmers
      .map((swimmer) => swimmer.firstName + " " + swimmer.lastName)
      .join(", ");
    return (
      <div className="flex items-start gap-4 px-6 py-5">
        <div className="flex-shrink-0 w-20">
          <p className="text-xs font-semibold text-text-secondary tabular-nums">
            {formatTime(startsAt)}
          </p>
          <p className="text-xs text-text-secondary mt-0.5 tabular-nums">
            {formatTime(endsAt)}
          </p>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-text">{swimmerNames}</p>
          <p className="text-xs text-text-secondary mt-0.5">
            {item.lesson.durationMinutes} min · {item.lesson.type === "private" ? "Private" : "Family"} · {item.lesson.locationName}
          </p>
        </div>
        <div className="flex-shrink-0">
          {item.lesson.status === "approved" ? (
            <span className="inline-flex items-center rounded-full text-xs font-semibold px-2.5 py-1 bg-success/10 text-success">
              Confirmed
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full text-xs font-semibold px-2.5 py-1 bg-surface-soft text-text-secondary border border-border">
              Pending
            </span>
          )}
        </div>
      </div>
    );
  }

  if (item.type === "travel_buffer") {
    return (
      <div className="flex items-center gap-4 px-6 py-4 bg-surface-soft">
        <div className="flex-shrink-0 w-20">
          <p className="text-xs font-semibold text-text-secondary tabular-nums">
            {formatTime(new Date(item.startsAt))}
          </p>
        </div>
        <div className="flex-1 min-w-0 flex items-center gap-2">
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
          <div>
            <p className="text-xs font-semibold text-text-secondary">
              Travel buffer · {item.bufferMinutes} min
            </p>
            <p className="text-xs text-text-secondary mt-0.5">
              {item.fromLocationName} → {item.toLocationName}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4 px-6 py-4">
      <div className="flex-shrink-0 w-20">
        <p className="text-xs font-semibold text-text-secondary tabular-nums">
          {formatTime(new Date(item.startsAt))}
        </p>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-text-secondary">
          Open · until {formatTime(new Date(item.endsAt))}
        </p>
      </div>
    </div>
  );
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function offsetDate(dateStr: string, days: number): string {
  const date = new Date(dateStr + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
