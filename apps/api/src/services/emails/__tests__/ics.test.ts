// .ics builder unit tests. Covers the body contract that calendar
// clients depend on: UID stability across REQUEST/CANCEL, SEQUENCE
// propagation (first REQUEST ships 0), METHOD + STATUS pairing, UTC
// DTSTART/DTEND with Z suffix (no VTIMEZONE needed), SUMMARY format.

import { describe, expect, it } from "vitest";
import { buildIcs, ICS_UID_DOMAIN } from "../ics";
import type { LessonEmailPayload } from "../types";

const basePayload: LessonEmailPayload = {
  lessonId: "11111111-2222-3333-4444-555555555555",
  startsAtUtc: "2026-11-01T17:30:00.000Z",
  endsAtUtc: "2026-11-01T18:00:00.000Z",
  durationMinutes: 30,
  startsAtLocalDisplay: "Sat, Nov 1, 2026 at 10:30 AM",
  endsAtLocalDisplay: "Sat, Nov 1, 2026 at 11:00 AM",
  swimmerFirstNames: ["Alex"],
  location: {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    name: "Northwood Pool",
    address: "123 Example St",
    city: "Irvine",
    state: "CA",
    zip: "92602",
    isHomePool: false,
  },
  deepLink: "https://app.example.com/dashboard/lessons/11111111-2222-3333-4444-555555555555",
  actorRole: "parent",
  previousStartsAtUtc: null,
  previousStartsAtLocalDisplay: null,
  declineReason: null,
  expiresAtLocalDisplay: null,
  coachFirstName: "Jason",
};

const fixedNow = new Date("2026-10-20T15:00:00.000Z");

describe("buildIcs — REQUEST", () => {
  const built = buildIcs({ method: "REQUEST", sequence: 0, payload: basePayload, now: fixedNow });
  const body = built.body;

  it("sets METHOD:REQUEST and STATUS:CONFIRMED", () => {
    expect(body).toContain("METHOD:REQUEST");
    expect(body).toContain("STATUS:CONFIRMED");
  });

  it("uses a deterministic UID keyed on the lesson id", () => {
    expect(built.uid).toBe(`${basePayload.lessonId}@${ICS_UID_DOMAIN}`);
    expect(body).toContain(`UID:${built.uid}`);
  });

  it("sets SEQUENCE from the input (first invite ships 0)", () => {
    expect(body).toContain("SEQUENCE:0");
  });

  it("writes DTSTART/DTEND in UTC with the Z suffix and no VTIMEZONE block", () => {
    expect(body).toContain("DTSTART:20261101T173000Z");
    expect(body).toContain("DTEND:20261101T180000Z");
    expect(body).not.toContain("BEGIN:VTIMEZONE");
    expect(body).not.toContain("TZID=");
  });

  it("writes DTSTAMP in UTC from the injected now", () => {
    expect(body).toContain("DTSTAMP:20261020T150000Z");
  });

  it("SUMMARY matches 'Swim lesson: <first names>' exactly", () => {
    expect(body).toContain("SUMMARY:Swim lesson: Alex");
  });

  it("filename is invite.ics", () => {
    expect(built.filename).toBe("invite.ics");
  });

  it("body is CRLF-terminated per RFC 5545", () => {
    expect(body.endsWith("\r\n")).toBe(true);
    expect(body.split("\r\n").length).toBeGreaterThan(5);
  });
});

describe("buildIcs — CANCEL", () => {
  const built = buildIcs({ method: "CANCEL", sequence: 2, payload: basePayload, now: fixedNow });
  const body = built.body;

  it("sets METHOD:CANCEL and STATUS:CANCELLED", () => {
    expect(body).toContain("METHOD:CANCEL");
    expect(body).toContain("STATUS:CANCELLED");
  });

  it("preserves the same UID as the earlier REQUEST", () => {
    expect(built.uid).toBe(`${basePayload.lessonId}@${ICS_UID_DOMAIN}`);
  });

  it("carries the strictly-higher SEQUENCE", () => {
    expect(body).toContain("SEQUENCE:2");
  });

  it("filename is cancel.ics", () => {
    expect(built.filename).toBe("cancel.ics");
  });
});

describe("buildIcs — SUMMARY with multiple swimmers", () => {
  it("joins two swimmers with an ampersand (matches ADR 027 title format)", () => {
    const { body } = buildIcs({
      method: "REQUEST",
      sequence: 0,
      payload: { ...basePayload, swimmerFirstNames: ["Alex", "Mia"] },
      now: fixedNow,
    });
    expect(body).toContain("SUMMARY:Swim lesson: Alex & Mia");
  });

  it("joins three swimmers with commas and a final ampersand", () => {
    const { body } = buildIcs({
      method: "REQUEST",
      sequence: 0,
      payload: { ...basePayload, swimmerFirstNames: ["Alex", "Mia", "Sam"] },
      now: fixedNow,
    });
    // Commas inside TEXT values are escaped per RFC 5545.
    expect(body).toContain("SUMMARY:Swim lesson: Alex\\, Mia & Sam");
  });
});

describe("buildIcs — escaping", () => {
  it("escapes commas and semicolons in LOCATION values", () => {
    const { body } = buildIcs({
      method: "REQUEST",
      sequence: 0,
      payload: {
        ...basePayload,
        location: { ...basePayload.location, address: "123 Example St; Apt 2, Rear" },
      },
      now: fixedNow,
    });
    expect(body).toContain("LOCATION:");
    expect(body).toContain("123 Example St\\; Apt 2\\, Rear");
  });
});
