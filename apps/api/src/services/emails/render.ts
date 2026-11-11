// Phase 2 renderer: dispatches on the outbox event to a React Email
// template, calls @react-email/render to produce HTML + plain-text, and
// returns both along with the subject line. The templates live in
// ./templates/; this file is the only entry point the sender uses.
//
// Subject format: "<Status>: <Weekday>, <Mon D>, <Time>" — colon, no em
// dash, matching docs/plans/parent-booking-emails.md.

import { render as renderReactEmail } from "@react-email/render";
import type { ReactElement } from "react";
import { getEnv } from "../../lib/env";
import type {
  BookingRequestBatchPayload,
  BookingRequestLessonPayload,
} from "../notifications/types";
import type { LessonEmailEvent, LessonEmailPayload } from "./types";
import BookingRequested from "./templates/BookingRequested";
import CoachBookingBatchRequest from "./templates/CoachBookingBatchRequest";
import CoachBookingRequest from "./templates/CoachBookingRequest";
import LessonCanceled from "./templates/LessonCanceled";
import LessonConfirmed from "./templates/LessonConfirmed";
import LessonRescheduled from "./templates/LessonRescheduled";
import RequestDeclined from "./templates/RequestDeclined";
import RequestExpired from "./templates/RequestExpired";

export interface RenderedEmail {
  subject: string;
  text: string;
  html?: string;
}

const SUBJECT_PREFIX: Record<LessonEmailEvent, string> = {
  booking_requested: "Request received",
  lesson_confirmed: "Lesson confirmed",
  request_declined: "Request not booked",
  request_expired: "Request expired",
  lesson_canceled: "Lesson canceled",
  lesson_rescheduled: "Lesson rescheduled",
  coach_booking_request: "New booking request",
  // Bulk-cancel rows render through a dedicated sender path, not through
  // this file. Entry present so the Record stays exhaustive.
  coach_bulk_cancel: "Lessons canceled",
  // Coach-side account-deleted email renders through its dedicated
  // sender path with a flat subject (no "<prefix>: <when>" shape), so
  // this entry is never used. Present so the Record stays exhaustive.
  coach_account_deleted: "A family deleted their account",
  // ADR 036 Phase 7 balance-triggered emails render through their own
  // sender paths (no "<prefix>: <when>" shape — the subject is derived
  // from the payload amount). Entries present so the Record stays
  // exhaustive.
  balance_funded: "Balance added",
  balance_adjusted: "Balance updated",
  // ADR 036 Phase 8 Part B cash-out email — same pattern: rendered by
  // its own sender path, entry present to keep the Record exhaustive.
  balance_cashed_out: "Balance cashed out",
};

type CoachBackupPayload = BookingRequestLessonPayload | BookingRequestBatchPayload;
type AnyEmailPayload = LessonEmailPayload | CoachBackupPayload;

export async function renderEmail(
  event: LessonEmailEvent,
  payload: AnyEmailPayload,
): Promise<RenderedEmail> {
  // Subject assembly varies by payload shape: parent/lesson rows carry
  // `startsAtLocalDisplay`; batch coach-backup rows carry
  // `firstStartsAtLocalDisplay`. The dispatch below picks the right one.
  const subject = `${SUBJECT_PREFIX[event]}: ${pickSubjectWhen(payload)}`;
  // SITE_URL is required by env.ts (defaulted to localhost in local, pinned
  // to a non-localhost URL in dev/prod), so getEnv() either returns a usable
  // siteUrl or throws at boot. No silent fallback here — a misconfigured
  // env should surface at the sender's catch, not get buried behind a
  // hardcoded production URL baked into email bodies.
  const env = getEnv();
  const siteUrl = env.siteUrl;
  const replyToEmail = env.email?.replyTo ?? null;
  const element = selectTemplate(event, payload, siteUrl, replyToEmail);
  const [html, text] = await Promise.all([
    renderReactEmail(element),
    renderReactEmail(element, { plainText: true }),
  ]);
  return { subject, text, html };
}

function pickSubjectWhen(payload: AnyEmailPayload): string {
  // Batch coach-backup rows carry firstStartsAtLocalDisplay; everything
  // else uses startsAtLocalDisplay. Branch on the discriminated kind.
  if ("kind" in payload && payload.kind === "booking_request_batch") {
    return payload.firstStartsAtLocalDisplay;
  }
  return (payload as LessonEmailPayload | BookingRequestLessonPayload).startsAtLocalDisplay;
}

function selectTemplate(
  event: LessonEmailEvent,
  payload: AnyEmailPayload,
  siteUrl: string,
  replyToEmail: string | null,
): ReactElement {
  if (event === "coach_booking_request") {
    if ("kind" in payload && payload.kind === "booking_request_batch") {
      return CoachBookingBatchRequest({ payload, siteUrl, replyToEmail });
    }
    return CoachBookingRequest({
      payload: payload as BookingRequestLessonPayload,
      siteUrl,
      replyToEmail,
    });
  }
  const lessonPayload = payload as LessonEmailPayload;
  switch (event) {
    case "booking_requested":
      return BookingRequested({ payload: lessonPayload, siteUrl, replyToEmail });
    case "lesson_confirmed":
      return LessonConfirmed({ payload: lessonPayload, siteUrl, replyToEmail });
    case "request_declined":
      return RequestDeclined({ payload: lessonPayload, siteUrl, replyToEmail });
    case "request_expired":
      return RequestExpired({ payload: lessonPayload, siteUrl, replyToEmail });
    case "lesson_canceled":
      return LessonCanceled({ payload: lessonPayload, siteUrl, replyToEmail });
    case "lesson_rescheduled":
      return LessonRescheduled({ payload: lessonPayload, siteUrl, replyToEmail });
    case "coach_bulk_cancel":
      // Rendered by sendBulkCancelInner, not through this dispatcher.
      throw new Error("coach_bulk_cancel rendered through sendBulkCancelInner, not renderEmail");
    case "coach_account_deleted":
      // Rendered by sendCoachAccountDeletedInner, not through this
      // dispatcher — its payload shape (AccountDeletedEmailPayload) does
      // not match LessonEmailPayload.
      throw new Error(
        "coach_account_deleted rendered through sendCoachAccountDeletedInner, not renderEmail",
      );
    case "balance_funded":
      throw new Error(
        "balance_funded rendered through sendBalanceFundedInner, not renderEmail",
      );
    case "balance_adjusted":
      throw new Error(
        "balance_adjusted rendered through sendBalanceAdjustedInner, not renderEmail",
      );
    case "balance_cashed_out":
      throw new Error(
        "balance_cashed_out rendered through sendBalanceCashedOutInner, not renderEmail",
      );
  }
}
