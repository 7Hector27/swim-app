"use client";

export default function Legend() {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-text-secondary">
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-4 h-4 rounded bg-surface-soft border border-border" />
        Available
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-4 h-4 rounded bg-background border border-border" />
        <span className="line-through">Unavailable</span>
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-4 h-4 rounded bg-button-primary-background" />
        Your pick
      </span>
      <span className="flex items-center gap-1.5 opacity-50">
        <span className="inline-block w-4 h-4 rounded bg-surface-soft border border-border" />
        Past
      </span>
    </div>
  );
}
