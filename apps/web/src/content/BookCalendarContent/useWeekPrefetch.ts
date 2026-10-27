"use client";

// Small per-component cache + prefetch for the week-nav. When the current
// week settles, the hook stores it and kicks off fire-and-forget fetches for
// the previous and next Monday so a tap on prev / next or a swipe commits
// against already-warm data. Callers hand it their fetcher so it can be
// reused for parent booking, coach booking, parent reschedule, and coach
// reschedule (each has slightly different params).
//
// Reset the hook when location / duration / excludeLessonId change — the
// cached data belongs to the previous combination and would be wrong. An
// epoch counter also drops any in-flight prefetches that straddled the
// reset so they don't write stale data back into the cache.

import { useCallback, useRef, useState } from "react";
import type { WeekAvailabilityResponse } from "@swim-app/shared";

import { addDaysToDateStr } from "./helpers";

type FetchWeek = (monday: string) => Promise<WeekAvailabilityResponse | null>;

export interface UseWeekPrefetch {
  readFromCache: (monday: string) => WeekAvailabilityResponse | null;
  onWeekFetched: (monday: string, weekData: WeekAvailabilityResponse) => void;
  reset: () => void;
  hasOpenByMonday: Map<string, boolean>;
}

interface Config {
  windowStart: string;
  windowEnd: string;
  fetchWeek: FetchWeek;
}

export function useWeekPrefetch({ windowStart, windowEnd, fetchWeek }: Config): UseWeekPrefetch {
  const cacheRef = useRef<Map<string, WeekAvailabilityResponse>>(new Map());
  const epochRef = useRef(0);
  const fetchWeekRef = useRef(fetchWeek);
  fetchWeekRef.current = fetchWeek;
  const [hasOpenByMonday, setHasOpenByMonday] = useState<Map<string, boolean>>(new Map());

  const readFromCache = useCallback(
    (monday: string) => cacheRef.current.get(monday) ?? null,
    [],
  );

  const reset = useCallback(() => {
    epochRef.current += 1;
    cacheRef.current = new Map();
    setHasOpenByMonday(new Map());
  }, []);

  const storeOpen = useCallback((monday: string, weekData: WeekAvailabilityResponse) => {
    const anyOpen = weekData.days.some((day) => day.openCount > 0);
    setHasOpenByMonday((prev) => {
      if (prev.get(monday) === anyOpen) return prev;
      const next = new Map(prev);
      next.set(monday, anyOpen);
      return next;
    });
  }, []);

  const prefetchOne = useCallback(
    async (monday: string, windowStartSnapshot: string, windowEndSnapshot: string) => {
      if (monday < windowStartSnapshot || monday > windowEndSnapshot) return;
      if (cacheRef.current.has(monday)) return;
      const epoch = epochRef.current;
      const result = await fetchWeekRef.current(monday);
      if (result === null) return;
      if (epochRef.current !== epoch) return;
      cacheRef.current.set(monday, result);
      storeOpen(monday, result);
    },
    [storeOpen],
  );

  const onWeekFetched = useCallback(
    (monday: string, weekData: WeekAvailabilityResponse) => {
      cacheRef.current.set(monday, weekData);
      storeOpen(monday, weekData);
      void prefetchOne(addDaysToDateStr(monday, -7), windowStart, windowEnd);
      void prefetchOne(addDaysToDateStr(monday, 7), windowStart, windowEnd);
    },
    [prefetchOne, storeOpen, windowStart, windowEnd],
  );

  return { readFromCache, onWeekFetched, reset, hasOpenByMonday };
}
