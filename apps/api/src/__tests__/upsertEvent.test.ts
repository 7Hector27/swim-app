// Direct unit test for the real upsertEvent wrapper. The service-level
// integration tests mock this function wholesale, so they would mask the
// request-body details that matter here — specifically that every write
// to Google carries `status: "confirmed"`. Google soft-deletes events
// (`status: "cancelled"`) rather than removing them, so a hand-deleted
// event's id lingers; the fix is to always set status on both insert and
// the 409-fallback patch so a cancelled event is restored to visible.

import { beforeEach, describe, expect, it, vi } from "vitest";

const insertMock = vi.fn();
const patchMock = vi.fn();

// Mock the two modules upsertEvent uses. `calendar` is called as a factory
// (`calendar({ version, auth })`) that returns an object with an `events`
// namespace. `auth.OAuth2` is a constructor whose instances have
// `setCredentials`.
vi.mock("@googleapis/calendar", () => {
  class OAuth2 {
    setCredentials() {}
  }
  return {
    calendar: () => ({ events: { insert: insertMock, patch: patchMock } }),
    auth: { OAuth2 },
  };
});

import { upsertEvent, type CalendarEventBody } from "../services/googleCalendarClient";
import type { GoogleOAuthEnv } from "../lib/env";

const env: GoogleOAuthEnv = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "http://localhost/callback",
  tokenEncryptionKey: Buffer.alloc(32, 7),
  stateSecret: "x".repeat(32),
};

const body: CalendarEventBody = {
  summary: "Swim lesson: Alex",
  description: "https://example.com/coach/lessons/abc",
  location: "Pool A",
  startIso: "2026-01-01T18:00:00.000Z",
  endIso: "2026-01-01T18:30:00.000Z",
  timeZone: "America/Los_Angeles",
};

beforeEach(() => {
  insertMock.mockReset();
  patchMock.mockReset();
});

describe("upsertEvent: insert path", () => {
  it("creates the event with status: 'confirmed' so a freshly-created event is visible", async () => {
    insertMock.mockResolvedValueOnce({});

    await upsertEvent(env, "access-token", "cal-id", "event-id", body);

    expect(insertMock).toHaveBeenCalledTimes(1);
    const call = insertMock.mock.calls[0]![0];
    expect(call.calendarId).toBe("cal-id");
    expect(call.requestBody.id).toBe("event-id");
    expect(call.requestBody.status).toBe("confirmed");
    expect(call.requestBody.summary).toBe(body.summary);
    expect(call.requestBody.start).toEqual({ dateTime: body.startIso, timeZone: body.timeZone });
    expect(call.requestBody.end).toEqual({ dateTime: body.endIso, timeZone: body.timeZone });
    expect(patchMock).not.toHaveBeenCalled();
  });
});

describe("upsertEvent: 409 fallback restores a hand-deleted (cancelled) event", () => {
  it("falls through to patch with status: 'confirmed' so a cancelled event is un-cancelled", async () => {
    // Realistic Google behavior: insert on a soft-deleted event id returns
    // 409 (the id is still bound to the cancelled event). Our fallback
    // patch must include status:"confirmed" or Google keeps the event
    // hidden.
    insertMock.mockRejectedValueOnce(Object.assign(new Error("Conflict"), { code: 409 }));
    patchMock.mockResolvedValueOnce({});

    await upsertEvent(env, "access-token", "cal-id", "event-id", body);

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(patchMock).toHaveBeenCalledTimes(1);
    const call = patchMock.mock.calls[0]![0];
    expect(call.calendarId).toBe("cal-id");
    expect(call.eventId).toBe("event-id");
    expect(call.requestBody.status).toBe("confirmed");
    expect(call.requestBody.summary).toBe(body.summary);
    expect(call.requestBody.start).toEqual({ dateTime: body.startIso, timeZone: body.timeZone });
    expect(call.requestBody.end).toEqual({ dateTime: body.endIso, timeZone: body.timeZone });
    // Patch must not re-send `id` — Google rejects attempts to change id.
    expect(call.requestBody.id).toBeUndefined();
  });

  it("propagates non-409 errors from insert without calling patch", async () => {
    insertMock.mockRejectedValueOnce(Object.assign(new Error("Server error"), { code: 500 }));

    await expect(
      upsertEvent(env, "access-token", "cal-id", "event-id", body),
    ).rejects.toThrow("Server error");
    expect(patchMock).not.toHaveBeenCalled();
  });
});

describe("upsertEvent: both call paths that end up at upsertEvent carry status:'confirmed'", () => {
  // Two call paths lead here from the service:
  //   1. Full pass on connect/reconnect/24h-promotion (every in-window
  //      approved/completed lesson reconciled).
  //   2. A normal reschedule's reconcile.
  // Both end up at upsertEvent with the same body shape. If the Google
  // event for this id is cancelled, insert returns 409 and we patch with
  // status:"confirmed" — restoring the event in both scenarios. These
  // tests document that behavior at the module boundary.
  it("full-pass style call restores a cancelled event", async () => {
    insertMock.mockRejectedValueOnce(Object.assign(new Error("Conflict"), { code: 409 }));
    patchMock.mockResolvedValueOnce({});

    await upsertEvent(env, "access-token", "cal-id", "event-id", body);

    expect(patchMock).toHaveBeenCalledTimes(1);
    expect(patchMock.mock.calls[0]![0].requestBody.status).toBe("confirmed");
  });

  it("reschedule style call restores a cancelled event with the new time", async () => {
    insertMock.mockRejectedValueOnce(Object.assign(new Error("Conflict"), { code: 409 }));
    patchMock.mockResolvedValueOnce({});

    const rescheduled: CalendarEventBody = {
      ...body,
      startIso: "2026-01-08T18:00:00.000Z",
      endIso: "2026-01-08T18:30:00.000Z",
    };
    await upsertEvent(env, "access-token", "cal-id", "event-id", rescheduled);

    expect(patchMock).toHaveBeenCalledTimes(1);
    const patchCall = patchMock.mock.calls[0]![0];
    expect(patchCall.requestBody.status).toBe("confirmed");
    expect(patchCall.requestBody.start.dateTime).toBe(rescheduled.startIso);
    expect(patchCall.requestBody.end.dateTime).toBe(rescheduled.endIso);
  });
});
