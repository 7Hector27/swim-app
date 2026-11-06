// Pure body renderer for coach push notifications. Composes the final
// `title` + `body` from the frozen payload plus the coach's lock-screen
// detail preference. Separate module (and separate test file) because the
// composition is the exact point of the "minimum useful signal on the
// lock screen" rule in docs/accounts.md.

import type { CoachNotificationPayload } from "./types";

export type LockScreenDetail = "first_initial" | "full_name";

export interface RenderedPushBody {
  title: string;
  body: string;
}

export function renderPushBody(
  payload: CoachNotificationPayload,
  lockScreenDetail: LockScreenDetail,
): RenderedPushBody {
  switch (payload.kind) {
    case "booking_request_lesson": {
      const names = chooseNames(payload, lockScreenDetail);
      return {
        title: "New booking request",
        body: `${joinNames(names)}, ${payload.startsAtLocalDisplay} at ${payload.locationName}`,
      };
    }
    case "booking_request_batch": {
      const prefix =
        payload.pendingCount > 0
          ? `${payload.lessonCount} lessons requested`
          : `${payload.lessonCount} lessons auto-approved`;
      return {
        title: "New batch request",
        body: `${prefix} at ${payload.locationName}, first ${payload.firstStartsAtLocalDisplay}`,
      };
    }
    case "parent_change_lesson": {
      const names = chooseNames(payload, lockScreenDetail);
      const verb = payload.changeKind === "canceled" ? "canceled" : "moved";
      const extra =
        payload.changeKind === "rescheduled" && payload.previousStartsAtLocalDisplay
          ? ` (was ${payload.previousStartsAtLocalDisplay})`
          : "";
      return {
        title:
          payload.changeKind === "canceled"
            ? "Lesson canceled by parent"
            : "Lesson moved by parent",
        body: `${joinNames(names)}, ${payload.startsAtLocalDisplay} at ${payload.locationName} ${verb}${extra}`,
      };
    }
    case "parent_change_batch": {
      return {
        title: "Batch canceled by parent",
        body: `${payload.lessonCount} ${payload.lessonCount === 1 ? "lesson" : "lessons"} at ${payload.locationName} canceled`,
      };
    }
    case "request_expiring_soon": {
      const names = chooseNames(payload, lockScreenDetail);
      return {
        title: "Request expiring soon",
        body: `${joinNames(names)}, ${payload.startsAtLocalDisplay} at ${payload.locationName}, expires ${payload.expiresAtLocalDisplay}`,
      };
    }
    case "auto_approved": {
      const names = chooseNames(payload, lockScreenDetail);
      return {
        title: "Booking auto-approved",
        body: `${joinNames(names)}, ${payload.startsAtLocalDisplay} at ${payload.locationName}`,
      };
    }
    case "calendar_disconnected": {
      return {
        title: "Google Calendar disconnected",
        body: "Open the app to reconnect.",
      };
    }
    case "daily_summary": {
      const parts: string[] = [];
      if (payload.lessonCount === 0) {
        parts.push("No lessons today.");
      } else {
        const first =
          payload.firstLessonTimeLocal && payload.firstLessonPoolName
            ? `, first at ${payload.firstLessonTimeLocal} at ${payload.firstLessonPoolName}`
            : "";
        parts.push(
          `Today: ${payload.lessonCount} ${payload.lessonCount === 1 ? "lesson" : "lessons"}${first}.`,
        );
      }
      if (payload.pendingRequestCount > 0) {
        parts.push(
          `${payload.pendingRequestCount} ${payload.pendingRequestCount === 1 ? "request" : "requests"} waiting.`,
        );
      }
      if (payload.heldAlertCount > 0) {
        parts.push(
          `${payload.heldAlertCount} overnight ${payload.heldAlertCount === 1 ? "update" : "updates"}.`,
        );
      }
      return { title: "Daily summary", body: parts.join(" ") };
    }
    case "account_deleted": {
      // ADR 034. No family name or swimmer names — the row is here so
      // Jason knows a slot freed up, not whose. Display strings are
      // pre-computed at enqueue time (LA wall time) so the renderer
      // stays pure.
      const times = payload.cancelledLessonTimesLocalDisplay;
      const body =
        times.length === 0
          ? "A family deleted their account."
          : times.length === 1
            ? `Freed up: ${times[0]}.`
            : `Freed up ${times.length} lessons: ${times.join(", ")}.`;
      return { title: "A family deleted their account", body };
    }
  }
}

function chooseNames(
  payload: {
    swimmerFirstNamesWithInitial: string[];
    swimmerFullNames: string[];
  },
  lockScreenDetail: LockScreenDetail,
): string[] {
  return lockScreenDetail === "full_name"
    ? payload.swimmerFullNames
    : payload.swimmerFirstNamesWithInitial;
}

function joinNames(names: string[]): string {
  if (names.length === 0) return "A swimmer";
  if (names.length === 1) return names[0] ?? "A swimmer";
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}
