// Email backup to the coach when a parent submits a BATCH booking request
// and the coach has zero active push subscriptions (ADR 031). One summary
// email per batch — not one per lesson. See
// docs/plans/coach-alerts.md for the no-batch-per-lesson rule.

import { Heading, Text } from "@react-email/components";

import type { BookingRequestBatchPayload } from "../../notifications/types";
import EmailLayout from "./shared/EmailLayout";
import CtaButton from "./shared/CtaButton";
import { emailTheme } from "./shared/theme";

interface Props {
  payload: BookingRequestBatchPayload;
  siteUrl: string;
  replyToEmail?: string | null;
}

export default function CoachBookingBatchRequest({ payload, siteUrl, replyToEmail }: Props) {
  const totalLessons = payload.lessonCount;
  const lessonsWord = totalLessons === 1 ? "lesson" : "lessons";
  const previewText =
    `New batch request: ${totalLessons} ${lessonsWord} at ${payload.locationName}, ` +
    `first ${payload.firstStartsAtLocalDisplay}.`;
  const deepLink = `${siteUrl.replace(/\/+$/, "")}/coach/lessons?batch=${payload.batchId}`;
  const summarySentence =
    totalLessons === 1
      ? `A parent requested 1 lesson at ${payload.locationName} on ${payload.firstStartsAtLocalDisplay}.`
      : `A parent requested ${totalLessons} ${lessonsWord} at ${payload.locationName}, ` +
        `starting ${payload.firstStartsAtLocalDisplay} and running through ${payload.lastStartsAtLocalDisplay}.`;
  const mixSentence =
    payload.pendingCount > 0 && payload.approvedCount > 0
      ? `${payload.approvedCount} auto-approved, ${payload.pendingCount} waiting for you.`
      : payload.pendingCount > 0
        ? `All ${payload.pendingCount} waiting for you to approve or decline.`
        : `All ${payload.approvedCount} were auto-approved — this is a heads-up.`;
  return (
    <EmailLayout
      siteUrl={siteUrl}
      previewText={previewText}
      coachFirstName="Coach"
      replyToEmail={replyToEmail ?? null}
    >
      <Heading style={headingStyle}>New batch request.</Heading>
      <Text style={bodyStyle}>{summarySentence}</Text>
      <Text style={bodyStyle}>{mixSentence}</Text>
      <Text style={bodyStyle}>
        This email landed because push notifications are not currently enabled on any of your
        devices. Enable push notifications under Account to stop these backup emails.
      </Text>
      <CtaButton href={deepLink} label="Review the batch" />
    </EmailLayout>
  );
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
