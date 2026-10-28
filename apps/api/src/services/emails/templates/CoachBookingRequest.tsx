// Email backup to the coach when a new booking request lands and the
// coach has zero active push subscriptions (ADR 031). The payload here is
// a CoachNotificationPayload BookingRequestLessonPayload, NOT a
// LessonEmailPayload — this template renders the exact fields that live
// in that shape.

import { Heading, Text } from "@react-email/components";

import type { BookingRequestLessonPayload } from "../../notifications/types";
import EmailLayout from "./shared/EmailLayout";
import CtaButton from "./shared/CtaButton";
import { emailTheme } from "./shared/theme";

interface Props {
  payload: BookingRequestLessonPayload;
  siteUrl: string;
  replyToEmail?: string | null;
}

export default function CoachBookingRequest({ payload, siteUrl, replyToEmail }: Props) {
  const swimmers = joinSwimmerNames(payload.swimmerFirstNamesWithInitial);
  const previewText = `New booking request from ${swimmers} on ${payload.startsAtLocalDisplay}.`;
  const deepLink = `${siteUrl.replace(/\/+$/, "")}/coach/lessons/${payload.lessonId}`;
  return (
    <EmailLayout
      siteUrl={siteUrl}
      previewText={previewText}
      coachFirstName="Coach"
      replyToEmail={replyToEmail ?? null}
    >
      <Heading style={headingStyle}>New booking request.</Heading>
      <Text style={bodyStyle}>
        {swimmers} is requesting a lesson on <strong>{payload.startsAtLocalDisplay}</strong>{" "}
        at <strong>{payload.locationName}</strong>. This email landed because push
        notifications are not currently enabled on any of your devices.
      </Text>
      <Text style={bodyStyle}>
        Enable push notifications under Account to stop these backup emails.
      </Text>
      <CtaButton href={deepLink} label="Review the request" />
    </EmailLayout>
  );
}

function joinSwimmerNames(names: readonly string[]): string {
  if (names.length === 0) return "A swimmer";
  if (names.length === 1) return names[0] ?? "A swimmer";
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

const headingStyle = {
  fontFamily: emailTheme.font.heading,
  fontSize: "22px",
  lineHeight: "28px",
  color: emailTheme.color.heading,
  margin: "0 0 12px",
};

const bodyStyle = {
  fontSize: "15px",
  lineHeight: "22px",
  color: emailTheme.color.text,
  margin: "0 0 12px",
};
