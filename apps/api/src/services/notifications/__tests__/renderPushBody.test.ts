import { describe, expect, it } from "vitest";

import { renderPushBody } from "../renderPushBody";
import type { CoachNotificationPayload } from "../types";

describe("renderPushBody", () => {
  it("first_initial renders swimmer initial, not full last name", () => {
    const payload: CoachNotificationPayload = {
      kind: "booking_request_lesson",
      listTitle: "New booking request",
      lessonId: "lesson-1",
      swimmerFirstNamesWithInitial: ["Alex R."],
      swimmerFullNames: ["Alex Rodriguez"],
      startsAtLocalDisplay: "Tue, Oct 27 at 4:30 PM",
      locationName: "Egret Park",
    };
    const result = renderPushBody(payload, "first_initial");
    expect(result.body).toContain("Alex R.");
    expect(result.body).not.toContain("Rodriguez");
  });

  it("full_name renders the full swimmer name", () => {
    const payload: CoachNotificationPayload = {
      kind: "booking_request_lesson",
      listTitle: "New booking request",
      lessonId: "lesson-1",
      swimmerFirstNamesWithInitial: ["Alex R."],
      swimmerFullNames: ["Alex Rodriguez"],
      startsAtLocalDisplay: "Tue, Oct 27 at 4:30 PM",
      locationName: "Egret Park",
    };
    const result = renderPushBody(payload, "full_name");
    expect(result.body).toContain("Alex Rodriguez");
  });

  it("batch payload renders lesson count + first time", () => {
    const payload: CoachNotificationPayload = {
      kind: "booking_request_batch",
      listTitle: "New batch request",
      batchId: "batch-1",
      lessonCount: 3,
      pendingCount: 3,
      approvedCount: 0,
      firstStartsAtLocalDisplay: "Tue, Oct 27 at 4:30 PM",
      lastStartsAtLocalDisplay: "Thu, Oct 29 at 5:30 PM",
      locationName: "Egret Park",
    };
    const result = renderPushBody(payload, "first_initial");
    expect(result.body).toContain("3 lessons");
    expect(result.body).toContain("Egret Park");
    expect(result.body).toContain("4:30 PM");
  });

  it("daily summary includes lesson + pending counts", () => {
    const payload: CoachNotificationPayload = {
      kind: "daily_summary",
      listTitle: "Daily summary",
      dateLocal: "2026-10-27",
      lessonCount: 4,
      firstLessonTimeLocal: "7:30 AM",
      firstLessonPoolName: "Egret Park",
      pendingRequestCount: 2,
      heldAlertCount: 0,
    };
    const result = renderPushBody(payload, "first_initial");
    expect(result.body).toContain("4 lessons");
    expect(result.body).toContain("Egret Park");
    expect(result.body).toContain("2 requests waiting");
  });

  it("calendar disconnected is a short actionable string", () => {
    const payload: CoachNotificationPayload = {
      kind: "calendar_disconnected",
      listTitle: "Google Calendar disconnected",
      needsReconnectSinceUtc: "2026-10-27T15:00:00Z",
    };
    const result = renderPushBody(payload, "first_initial");
    expect(result.title).toBe("Google Calendar disconnected");
    expect(result.body.toLowerCase()).toContain("reconnect");
  });

  it("parent_change reschedule includes previous time when available", () => {
    const payload: CoachNotificationPayload = {
      kind: "parent_change_lesson",
      listTitle: "Lesson moved",
      lessonId: "lesson-1",
      changeKind: "rescheduled",
      swimmerFirstNamesWithInitial: ["Jamie K."],
      swimmerFullNames: ["Jamie Kim"],
      startsAtLocalDisplay: "Tue, Oct 27 at 5:30 PM",
      previousStartsAtLocalDisplay: "Tue, Oct 27 at 4:30 PM",
      locationName: "Egret Park",
    };
    const result = renderPushBody(payload, "first_initial");
    expect(result.body).toContain("4:30 PM");
    expect(result.body).toContain("5:30 PM");
  });

  // ADR 034. account_deleted carries no family or swimmer identity —
  // just pre-formatted LA wall-time strings for the freed lessons. The
  // renderer reads cancelledLessonTimesLocalDisplay directly so the
  // body is identical across every lock-screen-detail setting.
  it("account_deleted with no cancelled lessons renders the plain title", () => {
    const payload: CoachNotificationPayload = {
      kind: "account_deleted",
      listTitle: "A family deleted their account",
      cancelledLessonTimesUtc: [],
      cancelledLessonTimesLocalDisplay: [],
      deletedAtUtc: "2026-10-27T15:00:00Z",
    };
    const result = renderPushBody(payload, "first_initial");
    expect(result.title).toBe("A family deleted their account");
    expect(result.body).toBe("A family deleted their account.");
  });

  it("account_deleted with one cancelled lesson includes the single time", () => {
    const payload: CoachNotificationPayload = {
      kind: "account_deleted",
      listTitle: "A family deleted their account",
      cancelledLessonTimesUtc: ["2026-10-28T23:30:00Z"],
      cancelledLessonTimesLocalDisplay: ["Tue, Oct 28 at 4:30 PM"],
      deletedAtUtc: "2026-10-27T15:00:00Z",
    };
    const result = renderPushBody(payload, "first_initial");
    expect(result.title).toBe("A family deleted their account");
    expect(result.body).toBe("Freed up: Tue, Oct 28 at 4:30 PM.");
  });

  it("account_deleted with multiple cancelled lessons lists the count and all times", () => {
    const payload: CoachNotificationPayload = {
      kind: "account_deleted",
      listTitle: "A family deleted their account",
      cancelledLessonTimesUtc: [
        "2026-10-28T23:30:00Z",
        "2026-10-29T23:30:00Z",
        "2026-10-30T23:30:00Z",
      ],
      cancelledLessonTimesLocalDisplay: [
        "Tue, Oct 28 at 4:30 PM",
        "Wed, Oct 29 at 4:30 PM",
        "Thu, Oct 30 at 4:30 PM",
      ],
      deletedAtUtc: "2026-10-27T15:00:00Z",
    };
    const result = renderPushBody(payload, "full_name");
    expect(result.body).toContain("Freed up 3 lessons");
    expect(result.body).toContain("Tue, Oct 28 at 4:30 PM");
    expect(result.body).toContain("Wed, Oct 29 at 4:30 PM");
    expect(result.body).toContain("Thu, Oct 30 at 4:30 PM");
  });
});
