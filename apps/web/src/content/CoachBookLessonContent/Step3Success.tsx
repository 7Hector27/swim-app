"use client";

import Link from "next/link";
import { formatLessonTimeDisplay } from "./helpers";

interface Props {
  lessonId: string;
  startsAtUtc: string;
  durationMinutes: 30 | 45 | 60;
  locationName: string;
  householdName: string;
  swimmerFirstNames: string[];
}

export default function Step3Success({
  lessonId,
  startsAtUtc,
  durationMinutes,
  locationName,
  householdName,
  swimmerFirstNames,
}: Props) {
  return (
    <div className="flex flex-col gap-6 max-w-lg mx-auto">
      <div className="flex flex-col items-center text-center gap-3">
        <span
          aria-hidden="true"
          className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-accent/10 text-accent"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12l5 5L20 7" />
          </svg>
        </span>
        <h1 className="text-heading font-heading text-3xl">Lesson booked</h1>
        <p className="text-text-secondary text-sm">
          The family will get a confirmation email with a calendar invite.
        </p>
      </div>

      <dl className="rounded-card border border-border p-4 flex flex-col gap-3 text-sm">
        <div>
          <dt className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
            Household
          </dt>
          <dd className="text-text font-semibold mt-0.5">{householdName}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
            Swimmer{swimmerFirstNames.length === 1 ? "" : "s"}
          </dt>
          <dd className="text-text mt-0.5">{swimmerFirstNames.join(", ")}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
            When
          </dt>
          <dd className="text-text mt-0.5">
            {formatLessonTimeDisplay(startsAtUtc)} · {durationMinutes} min
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
            Pool
          </dt>
          <dd className="text-text mt-0.5">{locationName}</dd>
        </div>
      </dl>

      <div className="flex flex-wrap gap-3 justify-center">
        <Link
          href={`/coach/lessons/${lessonId}`}
          className="inline-flex items-center justify-center min-h-[52px] px-6 rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm transition-opacity duration-150 motion-reduce:transition-none hover:opacity-90 active:scale-[0.97]"
        >
          View lesson
        </Link>
        <Link
          href="/coach/schedule"
          className="inline-flex items-center justify-center min-h-[52px] px-6 rounded-button border-2 border-button-outline text-button-outline font-bold text-sm transition-opacity duration-150 motion-reduce:transition-none hover:opacity-70 active:scale-[0.97]"
        >
          Back to schedule
        </Link>
      </div>
    </div>
  );
}
