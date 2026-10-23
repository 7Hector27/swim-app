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

export default function LessonConfirmed({ payload, siteUrl, replyToEmail }: Props) {
  const coach = coachDisplay(payload.coachFirstName);
  const swimmers = formatSwimmerList(payload.swimmerFirstNames);
  const isCoachInitiated = payload.initiatedBy === "coach";
  const previewText = isCoachInitiated
    ? `${coach} scheduled a lesson for ${swimmers} on ${payload.startsAtLocalDisplay}.`
    : `Confirmed for ${swimmers} on ${payload.startsAtLocalDisplay}.`;
  return (
    <EmailLayout
      siteUrl={siteUrl}
      previewText={previewText}
      coachFirstName={coach}
      replyToEmail={replyToEmail ?? null}
    >
      <Heading style={headingStyle}>
        {isCoachInitiated ? `${coach} booked a lesson for you.` : "You\u2019re on the schedule."}
      </Heading>
      <Text style={bodyStyle}>
        {isCoachInitiated ? (
          <>
            {coach} scheduled a lesson for {swimmers} on{" "}
            <strong>{payload.startsAtLocalDisplay}</strong> at{" "}
            <strong>{payload.location.name}</strong>. A calendar invite is attached. Tap it to add
            this lesson to your calendar.
          </>
        ) : (
          <>
            Confirmed for {swimmers} on <strong>{payload.startsAtLocalDisplay}</strong> at{" "}
            <strong>{payload.location.name}</strong>. A calendar invite is attached. Tap it to add
            this lesson to your calendar.
          </>
        )}
      </Text>
      <LessonCard
        swimmerListDisplay={swimmers}
        whenDisplay={payload.startsAtLocalDisplay}
        location={payload.location}
      />
      <CtaButton href={payload.deepLink} label="View lesson in app" />
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
