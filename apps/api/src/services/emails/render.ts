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
import type { BookingRequestLessonPayload } from "../notifications/types";
import type { LessonEmailEvent, LessonEmailPayload } from "./types";
import BookingRequested from "./templates/BookingRequested";
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
};

export async function renderEmail(
  event: LessonEmailEvent,
  payload: LessonEmailPayload | BookingRequestLessonPayload,
): Promise<RenderedEmail> {
  // Both payload shapes carry `startsAtLocalDisplay` as a string, so the
  // subject assembly is uniform. Templates branch on the event below.
  const subject = `${SUBJECT_PREFIX[event]}: ${payload.startsAtLocalDisplay}`;
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

function selectTemplate(
  event: LessonEmailEvent,
  payload: LessonEmailPayload | BookingRequestLessonPayload,
  siteUrl: string,
  replyToEmail: string | null,
): ReactElement {
  if (event === "coach_booking_request") {
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
  }
}
