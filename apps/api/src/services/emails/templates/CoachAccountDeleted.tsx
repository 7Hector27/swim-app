// Coach-side email fired when a family deletes their account (solo
// case). No family name, no swimmer names, no pool addresses — just
// freed-slot summaries so Jason knows what opened up. ADR 034.

import { Heading, Text } from "@react-email/components";

import type { AccountDeletedEmailPayload } from "../accountDeletedTypes";
import EmailLayout from "./shared/EmailLayout";
import CtaButton from "./shared/CtaButton";
import { emailTheme } from "./shared/theme";

interface Props {
  payload: AccountDeletedEmailPayload;
  siteUrl: string;
  replyToEmail?: string | null;
}

export default function CoachAccountDeleted({ payload, siteUrl, replyToEmail }: Props) {
  const previewText =
    payload.cancelledLessons.length === 0
      ? "A family deleted their account. No upcoming lessons were affected."
      : `A family deleted their account. ${payload.cancelledLessons.length} ${
          payload.cancelledLessons.length === 1 ? "lesson" : "lessons"
        } freed up.`;
  return (
    <EmailLayout
      siteUrl={siteUrl}
      previewText={previewText}
      coachFirstName="Coach"
      replyToEmail={replyToEmail ?? null}
    >
      <Heading style={headingStyle}>A family deleted their account.</Heading>
      {payload.cancelledLessons.length === 0 ? (
        <Text style={bodyStyle}>No upcoming lessons were affected.</Text>
      ) : (
        <>
          <Text style={bodyStyle}>These upcoming lessons were canceled:</Text>
          {payload.cancelledLessons.map((lesson, index) => (
            <Text key={`${lesson.startsAtUtc}-${index}`} style={lineItemStyle}>
              {lesson.startsAtLocalDisplay} · {lesson.poolLabel}
            </Text>
          ))}
        </>
      )}
      <CtaButton href={payload.scheduleUrl} label="Open your schedule" />
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

const lineItemStyle = {
  fontSize: "15px",
  lineHeight: "22px",
  color: emailTheme.color.text,
  margin: "0 0 6px",
};
