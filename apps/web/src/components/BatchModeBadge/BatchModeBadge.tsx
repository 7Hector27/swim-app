import type { BatchMode } from "@swim-app/shared";

interface Props {
  mode: BatchMode | null;
}

// Small pill rendered on dashboard lesson rows + lesson detail header to flag
// that a lesson was booked as part of a multi-lesson batch. Weekly vs manual
// uses different copy ("Weekly" vs "Multi-booking"). Returns null when the
// lesson wasn't part of a batch so callers can mount it unconditionally.
export default function BatchModeBadge({ mode }: Props) {
  if (mode === null) return null;
  const label = mode === "weekly" ? "Weekly" : "Multi-booking";
  return (
    <span
      className="inline-flex items-center h-[22px] px-2 rounded-full border border-accent/50 bg-accent/10 text-[11px] font-semibold text-accent uppercase tracking-wide"
      aria-label={`Part of a ${label} batch`}
    >
      {label}
    </span>
  );
}
