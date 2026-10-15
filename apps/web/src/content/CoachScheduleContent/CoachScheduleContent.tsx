import Link from "next/link";

import { todayLA } from "@swim-app/shared";
import type { ScheduleItem } from "@swim-app/shared";

import SiteFooter from "@/components/SiteFooter";
import { fetchCoachSchedule } from "@/lib/api/lessons";

interface Props {
  accessToken: string;
  date?: string;
}

export default async function CoachScheduleContent({ accessToken, date }: Props) {
  const scheduleDate = date ?? todayLA();
  const items = await fetchCoachSchedule(accessToken, scheduleDate);

  const dateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${scheduleDate}T12:00:00`));

  return (
    <div className="flex flex-col min-h-screen bg-background">

      <main id="main-content" className="flex-1">
        <div className="mx-auto max-w-content px-page pt-10 pb-20 tablet:pt-14 tablet:pb-32">
          <div className="flex flex-col gap-4 mb-8 tablet:flex-row tablet:items-center tablet:justify-between">
            <h1 className="text-3xl tablet:text-4xl text-heading">{dateLabel}</h1>
            <Link
              href="/coach"
              className="text-sm font-semibold text-link hover:text-link-hover transition-colors duration-150"
            >
              Back to dashboard
            </Link>
          </div>

          <div className="rounded-card border border-border overflow-hidden">
            {items.length === 0 ? (
              <p className="px-5 py-10 text-sm text-text-secondary text-center">
                No lessons or open slots for this day.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {items.map((item) => (
                  <ScheduleRow
                    key={item.type === "lesson" ? item.lesson.id : `${item.type}-${item.startsAt}`}
                    item={item}
                  />
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

// ── Sub-components ─────────────────────────────────────────────────────────────

function ScheduleRow({ item }: { item: ScheduleItem }) {
  if (item.type === "lesson") {
    const startLabel = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(item.lesson.startsAt));

    const swimmerNames = item.lesson.swimmers
      .map((swimmer) => swimmer.firstName)
      .join(", ");

    return (
      <div className="flex items-center gap-4 px-5 py-4">
        <div className="flex-shrink-0 w-[72px]">
          <p className="text-xs font-semibold text-text-secondary tabular-nums">{startLabel}</p>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-text">
            {swimmerNames || "No swimmers"}, {item.lesson.durationMinutes} min
          </p>
          <p className="text-xs text-text-secondary mt-0.5">
            {item.locationName} &middot; {item.lesson.type === "private" ? "Private" : "Family"} lesson
          </p>
        </div>
        <span
          className={`inline-flex items-center rounded-full text-xs font-semibold px-2.5 py-1 ${
            item.lesson.status === "approved"
              ? "bg-success/10 text-success"
              : "bg-surface-soft text-text-secondary border border-border"
          }`}
        >
          {item.lesson.status === "approved" ? "Confirmed" : "Pending"}
        </span>
      </div>
    );
  }

  if (item.type === "travel_buffer") {
    const startLabel = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(item.startsAt));

    const durationMs = new Date(item.endsAt).getTime() - new Date(item.startsAt).getTime();
    const durationMin = Math.round(durationMs / 60_000);

    return (
      <div className="flex items-center gap-4 px-5 py-4 bg-surface-soft">
        <div className="flex-shrink-0 w-[72px]">
          <p className="text-xs font-semibold text-text-secondary tabular-nums">{startLabel}</p>
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
            <p className="text-sm font-semibold text-text">
              Travel buffer, {durationMin} min
            </p>
            <p className="text-xs text-text-secondary mt-0.5">
              {item.fromLocationName} &rarr; {item.toLocationName}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // open_slot
  const startLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(item.startsAt));

  const endLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(item.endsAt));

  return (
    <div className="flex items-center gap-4 px-5 py-4">
      <div className="flex-shrink-0 w-[72px]">
        <p className="text-xs font-semibold text-text-secondary tabular-nums">{startLabel}</p>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text-secondary">
          Open until {endLabel}
        </p>
      </div>
    </div>
  );
}
