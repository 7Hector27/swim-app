import type { TimelineItem, TimelineResponse } from "@swim-app/shared";

const TYPE_LABELS: Record<TimelineItem["type"], string> = {
  note: "Note",
  rating_note: "Rating note",
  coaching_priority: "Priority",
};

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

interface SwimmerTimelineProps {
  items: TimelineResponse;
}

export default function SwimmerTimeline({ items }: SwimmerTimelineProps) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-bold text-text">Timeline</h2>
      {items.length === 0 ? (
        <p className="text-sm text-text-secondary">No timeline entries yet.</p>
      ) : (
        <ul className="flex flex-col">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-1.5 py-3 border-t border-border first:border-0 first:pt-0"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`text-xs font-semibold rounded-full px-2 py-0.5 border ${
                    item.type === "coaching_priority"
                      ? "text-accent border-accent"
                      : "text-text-secondary border-border"
                  }`}
                >
                  {TYPE_LABELS[item.type]}
                </span>
                <time
                  className="text-xs text-text-secondary"
                  dateTime={item.createdAt}
                >
                  {formatDate(item.createdAt)}
                </time>
              </div>
              <p className="text-sm text-text">{item.body}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
