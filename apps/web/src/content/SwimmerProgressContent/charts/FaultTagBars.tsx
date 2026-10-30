"use client";

interface FaultTagBarsProps {
  tags: Array<{ tag: string; count: number; skills: string[] }>;
}

// Coach-only. Horizontal bars with the longest run normalized to 100%, so the
// relative frequency reads at a glance.
export default function FaultTagBars({ tags }: FaultTagBarsProps) {
  if (tags.length === 0) {
    return <p className="text-xs text-text-secondary italic">No fault tags logged yet.</p>;
  }
  const maxCount = Math.max(...tags.map((tag) => tag.count), 1);

  return (
    <ul className="flex flex-col gap-2">
      {tags.map((tag) => {
        const percent = (tag.count / maxCount) * 100;
        return (
          <li
            key={tag.tag}
            className="grid items-center gap-3 min-h-[32px]"
            style={{ gridTemplateColumns: "minmax(0, 11rem) 1fr auto" }}
          >
            <span className="text-sm text-text truncate" title={tag.skills.join(", ")}>
              {tag.tag}
            </span>
            <div className="relative h-2 rounded-full" style={{ backgroundColor: "var(--color-border)" }}>
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${percent}%`,
                  backgroundColor: "var(--color-danger)",
                  opacity: 0.85,
                  transition: "width 320ms cubic-bezier(0.23, 1, 0.32, 1)",
                }}
              />
            </div>
            <span className="text-xs tabular-nums text-text-secondary">{tag.count}</span>
          </li>
        );
      })}
    </ul>
  );
}
