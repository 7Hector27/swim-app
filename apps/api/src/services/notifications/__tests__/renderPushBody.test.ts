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
});
