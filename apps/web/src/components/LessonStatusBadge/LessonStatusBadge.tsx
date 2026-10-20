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

  // expired or other
  return (
    <span className="inline-flex items-center rounded-full text-xs font-semibold px-2.5 py-1 bg-surface-soft text-text-secondary border border-border">
      Expired
    </span>
  );
}
