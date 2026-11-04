import Link from "next/link";
import type { CoachBatchDetail, CoachBatchLesson } from "@swim-app/shared";

import LessonStatusBadge from "@/components/LessonStatusBadge";

interface Props {
  batch: CoachBatchDetail;
}

const LA_TZ = "America/Los_Angeles";

export default function CoachBatchDetailContent({ batch }: Props) {
  const modeLabel = batch.mode === "weekly" ? "Recurring" : "Multiple";
  const createdAtLabel = formatDateTime(batch.createdAt);
  const familyLabel = batch.householdName ?? "This family";
  const bookedByLabel = batch.createdByName ?? "A household member";
  const lessonCount = batch.lessons.length;

  return (
    <div className="flex flex-col flex-1 bg-background">
      <main id="main-content" className="flex-1">
        <div className="mx-auto max-w-content px-page pt-10 pb-20 tablet:pt-14 tablet:pb-32">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-link hover:text-link-hover transition-colors duration-150 mb-6"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M10 12L6 8l4-4"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Back to dashboard
          </Link>

          <h1 className="text-3xl tablet:text-4xl text-heading mb-2">{modeLabel} booking</h1>
          <p className="text-sm text-text-secondary mb-8">
            {lessonCount} {lessonCount === 1 ? "lesson" : "lessons"}
          </p>

          <div className="flex flex-col gap-6 desktop:max-w-[720px]">
            <section
              aria-labelledby="batch-summary-heading"
              className="rounded-card border border-border p-5 tablet:p-6"
            >
              <h2 id="batch-summary-heading" className="text-xl text-heading mb-4">
                Summary
              </h2>
              <dl className="flex flex-col gap-3">
                <Row label="Family">{familyLabel}</Row>
                <Row label="Booked by">{bookedByLabel}</Row>
                <Row label="When">{createdAtLabel}</Row>
                <Row label="Lessons">{lessonCount}</Row>
              </dl>
            </section>

            <section aria-labelledby="batch-lessons-heading" className="flex flex-col gap-3">
              <h2 id="batch-lessons-heading" className="text-xl text-heading">
                Lessons
              </h2>
              {batch.lessons.length === 0 ? (
                <p className="text-sm text-text-secondary">
                  This batch has no lessons on record.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {batch.lessons.map((lesson) => (
                    <li key={lesson.id}>
                      <BatchLessonRow lesson={lesson} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

function BatchLessonRow({ lesson }: { lesson: CoachBatchLesson }) {
  const startsAt = new Date(lesson.startsAt);
  const swimmerNames =
    lesson.swimmers.length > 0
      ? lesson.swimmers.map((swimmer) => swimmer.firstName).join(", ")
      : "—";

  return (
    <Link
      href={`/coach/lessons/${lesson.id}`}
      className="block rounded-card border border-border p-4 tablet:p-5 hover:bg-surface-soft transition-colors duration-150 active:scale-[0.995] motion-reduce:transform-none"
    >
      <div className="flex flex-col gap-2 tablet:flex-row tablet:items-center tablet:justify-between tablet:gap-4">
        <div className="flex flex-col gap-1 min-w-0">
          <p className="text-sm font-semibold text-text">
            {formatDateLabel(startsAt)} <span className="text-text-secondary">·</span>{" "}
            {formatTime(startsAt)}
          </p>
          <p className="text-xs text-text-secondary truncate">
            {lesson.locationName} <span className="opacity-60">·</span> {lesson.durationMinutes} min{" "}
            <span className="opacity-60">·</span> {swimmerNames}
          </p>
        </div>
        <div className="flex-shrink-0">
          <LessonStatusBadge status={lesson.status} viewer="coach" />
        </div>
      </div>
    </Link>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <dt className="text-sm text-text-secondary w-24 flex-shrink-0">{label}</dt>
      <dd className="text-sm text-text">{children}</dd>
    </div>
  );
}

function formatDateLabel(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: LA_TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: LA_TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: LA_TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}
