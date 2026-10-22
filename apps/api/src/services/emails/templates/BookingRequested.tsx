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

export default function BookingRequested({ payload, siteUrl, replyToEmail }: Props) {
  const coach = coachDisplay(payload.coachFirstName);
  const swimmers = formatSwimmerList(payload.swimmerFirstNames);
  const previewText = `Request received for ${swimmers} on ${payload.startsAtLocalDisplay}.`;
  const expiresNote = payload.expiresAtLocalDisplay
    ? `If we do not confirm by ${payload.expiresAtLocalDisplay}, this request will expire and you will need to book again.`
    : `${coach} will respond soon.`;
  return (
    <EmailLayout
      siteUrl={siteUrl}
      previewText={previewText}
      coachFirstName={coach}
      replyToEmail={replyToEmail ?? null}
    >
      <Heading style={headingStyle}>We got your request.</Heading>
      <Text style={bodyStyle}>
        Thanks for booking with Axiom Aquatics. {coach} will review and get back to you soon.
        {" "}If this is your household&apos;s first time at {payload.location.name}, approval can
        take up to 16 hours. {expiresNote}
      </Text>
      <LessonCard
        swimmerListDisplay={swimmers}
        whenDisplay={payload.startsAtLocalDisplay}
        location={payload.location}
        hideAddress
      />
      <CtaButton href={payload.deepLink} label="View request" />
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
