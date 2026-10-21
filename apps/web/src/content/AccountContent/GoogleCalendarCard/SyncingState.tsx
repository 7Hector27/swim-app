"use client";

import { useEffect, useState } from "react";

import type { GoogleCalendarStatusResponse } from "@swim-app/shared";

import Button from "@/components/Button";

import { retryAllFailedGoogleCalendarSync } from "../actions";

interface SyncingStateProps {
  initial: GoogleCalendarStatusResponse;
}

/**
 * The counts portion of the active calendar card: syncing banner (poll
 * every 3s only while the server reports a run in progress, stop when
 * done per ADR 027) and the failed chip with a Retry button. Everything
 * else on the card is server-rendered — this is the one piece that needs
 * to react in real time during backfill without a page reload.
 *
 * The banner is driven by status.syncRunInProgress (server-authoritative),
 * NOT by pendingSyncCount. If a run crashed mid-flight, pending lessons
 * stay at not_synced forever and would pin the banner; the server marks
 * the run finished after 2 minutes of no progress so the UI recovers.
 */
export default function SyncingState({ initial }: SyncingStateProps) {
  const [status, setStatus] = useState(initial);
  const isSyncing = status.syncRunInProgress;

  useEffect(() => {
    if (!isSyncing) return;
    let cancelled = false;
    const tick = async (): Promise<void> => {
      try {
        const response = await fetch("/api/google-calendar/status", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as GoogleCalendarStatusResponse;
        if (!cancelled) setStatus(body);
      } catch {
        // Transient fetch error — next tick will catch up.
      }
    };
    const timer = window.setInterval(() => {
      void tick();
    }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isSyncing]);

  const totalDone = status.syncedCount + status.failedLessonCount;

  return (
    <>
      {isSyncing && (
        <p
          role="status"
          aria-live="polite"
          className="text-sm text-text-secondary"
        >
          Syncing {totalDone} of {status.upcomingLessonCount}&hellip;
        </p>
      )}
      {status.failedLessonCount > 0 && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-danger">
            {status.failedLessonCount}{" "}
            {status.failedLessonCount === 1 ? "lesson" : "lessons"} failed to sync
          </p>
          <form action={retryAllFailedGoogleCalendarSync}>
            <Button type="submit" variant="outline">
              Retry
            </Button>
          </form>
        </div>
      )}
    </>
  );
}
