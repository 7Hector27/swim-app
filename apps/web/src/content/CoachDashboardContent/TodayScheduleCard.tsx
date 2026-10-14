import type { ScheduleItem } from "@swim-app/shared";

interface Props {
  items: ScheduleItem[];
}

export default function TodayScheduleCard({ items }: Props) {
  return (
    <div className="rounded-card border border-border p-5 tablet:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl text-heading">Today&apos;s schedule</h2>
        <a
          href="/coach/schedule"
          className="text-sm font-semibold text-link hover:text-link-hover transition-colors duration-150"
        >
          Full calendar
        </a>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-text-secondary py-4">No lessons scheduled today.</p>
      ) : (
        <div className="divide-y divide-border">
          {items.map((item) => {
            if (item.type === "lesson") {
              return <LessonRow key={item.lesson.id} item={item} />;
            }
            if (item.type === "travel_buffer") {
              return <TravelBufferRow key={`travel_buffer-${item.startsAt}`} item={item} />;
            }
            return <OpenSlotRow key={`open_slot-${item.startsAt}`} item={item} />;
          })}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function formatTime(isoString: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(isoString));
}

function LessonRow({ item }: { item: Extract<ScheduleItem, { type: "lesson" }> }) {
  const time = formatTime(item.lesson.startsAt);
  const swimmerNames = item.lesson.swimmers.map((swimmer) => swimmer.firstName).join(", ");

  return (
    <div className="flex items-center gap-4 py-4">
      <div className="flex-shrink-0 w-[68px]">
        <p className="text-xs font-semibold text-text-secondary tabular-nums">{time}</p>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text">
          {swimmerNames || "No swimmers"}, {item.lesson.durationMinutes} min
        </p>
        <p className="text-xs text-text-secondary mt-0.5">
          {item.lesson.type === "private" ? "Private" : "Family"} lesson &middot; {item.locationName}
        </p>
      </div>
      <button
        type="button"
        className="flex-shrink-0 text-sm font-semibold text-link hover:text-link-hover transition-colors duration-150 min-h-[44px] flex items-center"
      >
        Open swimmer
      </button>
    </div>
  );
}

function TravelBufferRow({ item }: { item: Extract<ScheduleItem, { type: "travel_buffer" }> }) {
  const time = formatTime(item.startsAt);
  const durationMs = new Date(item.endsAt).getTime() - new Date(item.startsAt).getTime();
  const durationMin = Math.round(durationMs / 60_000);

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
          <p className="text-sm font-semibold text-text">
            Travel buffer, {durationMin} min
          </p>
          <p className="text-xs text-text-secondary mt-0.5">
            Blocked automatically. Not bookable.
          </p>
        </div>
      </div>
    </div>
  );
}

function OpenSlotRow({ item }: { item: Extract<ScheduleItem, { type: "open_slot" }> }) {
  const time = formatTime(item.startsAt);
  const until = formatTime(item.endsAt);

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
