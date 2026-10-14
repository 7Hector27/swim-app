import type { ScheduleItem } from "@swim-app/shared";
import Link from "next/link";

interface Props {
  items: ScheduleItem[];
}

export default function TodayScheduleCard({ items }: Props) {
  return (
    <div className="rounded-card border border-border p-5 tablet:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl text-heading">Today&apos;s schedule</h2>
        <Link
          href="/coach/schedule"
          className="text-sm font-semibold text-link hover:text-link-hover transition-colors duration-150"
        >
          Full calendar
        </Link>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-text-secondary py-4">No lessons scheduled for today.</p>
      ) : (
        <div className="divide-y divide-border">
          {items.map((item, index) => {
            if (item.type === "lesson") {
              const startsAt = new Date(item.lesson.startsAt);
              const swimmerNames = item.lesson.swimmers.map((swimmer) => swimmer.firstName).join(", ");
              return (
                <ScheduleRow
                  key={item.lesson.id}
                  time={formatTime(startsAt)}
                  title={`${swimmerNames}, ${item.lesson.durationMinutes} min`}
                  detail={`${item.lesson.type === "private" ? "Private" : "Family"} lesson at ${item.lesson.locationName}`}
                  badge={item.lesson.status === "approved" ? "confirmed" : "pending"}
                />
              );
            }
            if (item.type === "travel_buffer") {
              return (
                <TravelBufferRow
                  key={`buffer-${index}`}
                  time={formatTime(new Date(item.startsAt))}
                  duration={`${item.bufferMinutes} min`}
                  fromTo={`${item.fromLocationName} → ${item.toLocationName}`}
                />
              );
            }
            return (
              <OpenSlotRow
                key={`open-${item.startsAt}`}
                time={formatTime(new Date(item.startsAt))}
                until={formatTime(new Date(item.endsAt))}
              />
            );
          })}
        </div>
      )}
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

function ScheduleRow({
  time,
  title,
  detail,
  badge,
}: {
  time: string;
  title: string;
  detail: string;
  badge?: "confirmed" | "pending";
}) {
  return (
    <div className="flex items-center gap-4 py-4">
      <div className="flex-shrink-0 w-[68px]">
        <p className="text-xs font-semibold text-text-secondary tabular-nums">{time}</p>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text">{title}</p>
        <p className="text-xs text-text-secondary mt-0.5">{detail}</p>
      </div>
      {badge && (
        <div className="flex-shrink-0">
          {badge === "confirmed" ? (
            <span className="inline-flex items-center rounded-full text-xs font-semibold px-2.5 py-1 bg-success/10 text-success">
              Confirmed
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full text-xs font-semibold px-2.5 py-1 bg-surface-soft text-text-secondary border border-border">
              Pending
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function TravelBufferRow({ time, duration, fromTo }: { time: string; duration: string; fromTo: string }) {
  return (
    <div className="flex items-center gap-4 py-4">
      <div className="flex-shrink-0 w-[68px]">
        <p className="text-xs font-semibold text-text-secondary tabular-nums">{time}</p>
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
          <p className="text-sm font-semibold text-text">Travel buffer, {duration}</p>
          <p className="text-xs text-text-secondary mt-0.5">{fromTo}</p>
        </div>
      </div>
    </div>
  );
}

function OpenSlotRow({ time, until }: { time: string; until: string }) {
  return (
    <div className="flex items-center gap-4 py-4">
      <div className="flex-shrink-0 w-[68px]">
        <p className="text-xs font-semibold text-text-secondary tabular-nums">{time}</p>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text-secondary">
          Open until {until}
        </p>
      </div>
    </div>
  );
}
