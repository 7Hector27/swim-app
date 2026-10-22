import { Heading, Text } from "@react-email/components";
import type { LessonEmailPayload } from "../types";
import EmailLayout from "./shared/EmailLayout";
import LessonCard from "./shared/LessonCard";
import CtaButton from "./shared/CtaButton";
import { emailTheme } from "./shared/theme";
import { coachDisplay, formatSwimmerList } from "./shared/copyHelpers";

interface Props {
  payload: LessonEmailPayload;
  siteUrl: string;
  replyToEmail?: string | null;
}

export default function RequestDeclined({ payload, siteUrl, replyToEmail }: Props) {
  const coach = coachDisplay(payload.coachFirstName);
  const swimmers = formatSwimmerList(payload.swimmerFirstNames);
  const previewText = `${coach} was not able to confirm this request.`;
  const sentence = payload.declineReason
    ? `${coach} was not able to confirm this one: ${payload.declineReason}.`
    : `${coach} was not able to confirm this one.`;
  return (
    <EmailLayout
      siteUrl={siteUrl}
      previewText={previewText}
      coachFirstName={coach}
      replyToEmail={replyToEmail ?? null}
    >
      <Heading style={headingStyle}>This request was not booked.</Heading>
      <Text style={bodyStyle}>
        {sentence} You are welcome to try another slot. Availability updates in real time in the app.
      </Text>
      <LessonCard
        swimmerListDisplay={swimmers}
        whenDisplay={payload.startsAtLocalDisplay}
        location={payload.location}
        hideAddress
      />
      <CtaButton href={payload.deepLink} label="Browse open slots" />
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
  margin: 0,
};
