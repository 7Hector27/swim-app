"use client";

import type { LessonStatus } from "@swim-app/shared";

interface Props {
  status: LessonStatus;
  viewer: "coach" | "parent";
}

export default function LessonStatusBadge({ status, viewer }: Props) {
  if (status === "approved") return null;

  if (status === "pending") {
    const label = viewer === "coach" ? "Waiting for approval" : "Waiting for Jason";
    return (
      <span className="inline-flex items-center rounded-full text-xs font-semibold px-2.5 py-1 bg-surface-soft text-text-secondary border border-border">
        {label}
      </span>
    );
  }

  if (status === "canceled") {
    return (
      <span className="inline-flex items-center rounded-full text-xs font-semibold px-2.5 py-1 bg-surface-soft text-text-secondary border border-border">
        Canceled
      </span>
    );
  }

  if (status === "declined") {
    return (
      <span className="inline-flex items-center rounded-full text-xs font-semibold px-2.5 py-1 bg-danger/10 text-danger border border-danger/20">
        Declined
      </span>
    );
  }

  if (status === "completed") {
    return (
      <span className="inline-flex items-center rounded-full text-xs font-semibold px-2.5 py-1 bg-success/10 text-success border border-success/20">
        Completed
      </span>
    );
  }

  if (status === "no_show") {
    // Parents see "Missed"; the coach view uses the operational "No-show"
    // label so the audit meaning stays precise on the schedule.
    const label = viewer === "coach" ? "No-show" : "Missed";
    return (
      <span className="inline-flex items-center rounded-full text-xs font-semibold px-2.5 py-1 bg-danger/10 text-danger border border-danger/20">
        {label}
      </span>
    );
  }

  // expired
  return (
    <span className="inline-flex items-center rounded-full text-xs font-semibold px-2.5 py-1 bg-surface-soft text-text-secondary border border-border">
      Expired
    </span>
  );
}
