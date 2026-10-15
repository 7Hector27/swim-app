import Link from "next/link";

import type { UpcomingLesson } from "@swim-app/shared";

import ParentNav from "@/components/ParentNav";
import SiteFooter from "@/components/SiteFooter";

interface Props {
  upcoming: UpcomingLesson[];
  past: UpcomingLesson[];
}

export default function ParentLessonsContent({ upcoming, past }: Props) {
  return (
    <div className="flex flex-col min-h-screen bg-background">
      <ParentNav />
      <main id="main-content" className="flex-1">
        <div className="mx-auto max-w-content px-page pt-10 pb-tab-safe tablet:pt-14 tablet:pb-32">
          <h1 className="text-3xl tablet:text-4xl text-heading mb-8">Lessons</h1>

          <section className="mb-10">
            <h2 className="text-xl text-heading mb-4">Upcoming</h2>
            {upcoming.length === 0 ? (
              <p className="text-sm text-text-secondary">No upcoming lessons booked.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {upcoming.map((lesson) => (
                  <LessonRow key={lesson.id} lesson={lesson} />
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="text-xl text-heading mb-4">Past</h2>
            {past.length === 0 ? (
              <p className="text-sm text-text-secondary">No past lessons yet.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {past.map((lesson) => (
                  <LessonRow key={lesson.id} lesson={lesson} />
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function LessonRow({ lesson }: { lesson: UpcomingLesson }) {
  const startsAt = new Date(lesson.startsAt);
  const swimmerNames = lesson.swimmers.map((swimmer) => swimmer.firstName).join(", ");

  return (
    <li>
      <Link
        href={`/dashboard/lessons/${lesson.id}`}
        className="flex items-center justify-between rounded-card border border-border px-5 py-4 hover:border-accent transition-colors duration-150"
      >
        <div className="min-w-0">
          <p className="font-semibold text-text">{formatDateLabel(startsAt)}</p>
          <p className="text-sm text-text-secondary mt-0.5 truncate">
            {formatTime(startsAt)} · {lesson.durationMinutes} min
            {swimmerNames ? ` · ${swimmerNames}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0 ml-4">
          <StatusBadge status={lesson.status} />
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M6 4l4 4-4 4"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </Link>
    </li>
  );
}

function StatusBadge({ status }: { status: UpcomingLesson["status"] }) {
  if (status === "approved") {
    return (
      <span className="inline-flex items-center rounded-full text-xs font-semibold px-2.5 py-1 bg-success/10 text-success">
        Confirmed
      </span>
    );
  }
  if (status === "canceled" || status === "declined" || status === "expired" || status === "no_show") {
    return (
      <span className="inline-flex items-center rounded-full text-xs font-semibold px-2.5 py-1 bg-danger/10 text-danger">
        {status === "canceled" ? "Canceled" : status === "declined" ? "Declined" : status === "no_show" ? "No show" : "Expired"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full text-xs font-semibold px-2.5 py-1 bg-surface-soft text-text-secondary border border-border">
      Pending
    </span>
  );
}

function formatDateLabel(date: Date): string {
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
