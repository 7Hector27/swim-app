"use client";

export default function RescheduleLegend() {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-text-secondary">
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-4 h-4 rounded-[4px] bg-surface-soft border border-border" />
        Available
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-4 h-4 rounded-[4px]" />
        <span className="line-through">Booked</span>
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-4 h-4 rounded-[4px] bg-heading" />
        Your pick
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-4 h-4 rounded-[4px] border-2 border-dashed border-accent" />
        Current
      </span>
      <span className="flex items-center gap-1.5 opacity-40">
        <span className="inline-block w-4 h-4 rounded-[4px] bg-surface-soft" />
        Past
      </span>
    </div>
  );
}
