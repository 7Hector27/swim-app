"use client";

// Pass 2b: visible autosave status line that sits next to the save bar on
// every screen width. Reflects the underlying `draftSaveState` without
// changing the autosave timing or the save flow itself. The "Save as
// draft" button keeps its fixed label — this component is the only place
// the state is surfaced to the coach.

interface AutosaveStatusProps {
  state: "idle" | "saving" | "saved" | "error";
  lastSavedAt: number | null;
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  }).format(new Date(timestamp));
}

export default function AutosaveStatus({ state, lastSavedAt }: AutosaveStatusProps) {
  if (state === "idle") return null;

  let text: string;
  let color: string;
  let role: "status" | "alert";
  if (state === "saving") {
    text = "Saving...";
    color = "var(--color-text-secondary)";
    role = "status";
  } else if (state === "saved") {
    text = lastSavedAt !== null ? `Saved ${formatTime(lastSavedAt)}` : "Saved";
    color = "var(--color-text-secondary)";
    role = "status";
  } else {
    text = "Couldn't save. Try again.";
    color = "var(--color-danger)";
    role = "alert";
  }

  return (
    <span
      data-testid="autosave-status"
      role={role}
      aria-live={state === "error" ? "assertive" : "polite"}
      className="text-xs"
      style={{ color }}
    >
      {text}
    </span>
  );
}
