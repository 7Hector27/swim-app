import { describe, it, expect } from "vitest";
import { laDateTimeToUtcIso } from "../content/CoachBookLessonContent/helpers";

// laDateTimeToUtcIso converts (YYYY-MM-DD, HH:MM) in America/Los_Angeles to
// a UTC ISO string. Previously the function hand-rolled an offset probe
// with a raw +7h shift; this file is the regression guard against DST
// edges once the implementation switched to date-fns-tz.

describe("laDateTimeToUtcIso — normal days", () => {
  it("summer (PDT, UTC-7): 2026-07-15 16:00 LA → 2026-07-15T23:00:00Z", () => {
    expect(laDateTimeToUtcIso("2026-07-15", "16:00")).toBe("2026-07-15T23:00:00.000Z");
  });

  it("winter (PST, UTC-8): 2026-01-15 16:00 LA → 2026-01-16T00:00:00Z", () => {
    expect(laDateTimeToUtcIso("2026-01-15", "16:00")).toBe("2026-01-16T00:00:00.000Z");
  });
});

describe("laDateTimeToUtcIso — DST transitions", () => {
  // US DST in 2026: spring-forward Sun 2026-03-08 02:00 LA → 03:00 LA.
  // The wall-clock interval 02:00–02:59 does not exist on that date.
  // date-fns-tz maps those minutes forward into PDT (UTC-7), the next
  // real local instant. The coach picker never offers 02:00–02:59 as a
  // selectable time, so the mapping is defined-for-safety only.
  it("spring-forward gap (2026-03-08 02:30 LA): maps forward into PDT", () => {
    const iso = laDateTimeToUtcIso("2026-03-08", "02:30");
    // 02:30 PDT = 09:30 UTC. If the earlier (now-defunct) code had
    // guessed PST, it would have produced 10:30 UTC.
    expect(iso).toBe("2026-03-08T09:30:00.000Z");
  });

  // US DST in 2026: fall-back Sun 2026-11-01 02:00 LA → 01:00 LA. The
  // wall-clock interval 01:00–01:59 happens twice: first as PDT (UTC-7),
  // then as PST (UTC-8). We resolve the ambiguity to the first (earlier,
  // PDT) occurrence — matches the coach picker's "the time I just typed"
  // intent and keeps the function reversible against the earliest instant
  // the user could plausibly mean.
  it("fall-back ambiguous hour (2026-11-01 01:30 LA): resolves to the earlier PDT occurrence", () => {
    const iso = laDateTimeToUtcIso("2026-11-01", "01:30");
    // 01:30 PDT = 08:30 UTC (earlier). 01:30 PST = 09:30 UTC (later).
    expect(iso).toBe("2026-11-01T08:30:00.000Z");
  });

  it("unambiguous instant just before fall-back (2026-11-01 00:45 LA still PDT)", () => {
    expect(laDateTimeToUtcIso("2026-11-01", "00:45")).toBe("2026-11-01T07:45:00.000Z");
  });

  it("unambiguous instant just after fall-back (2026-11-01 03:00 LA now PST)", () => {
    expect(laDateTimeToUtcIso("2026-11-01", "03:00")).toBe("2026-11-01T11:00:00.000Z");
  });
});

describe("laDateTimeToUtcIso — input guards", () => {
  it("returns empty string for an unparseable date", () => {
    expect(laDateTimeToUtcIso("not-a-date", "16:00")).toBe("");
  });

  it("returns empty string for an unparseable time", () => {
    expect(laDateTimeToUtcIso("2026-07-15", "not-a-time")).toBe("");
  });
});
