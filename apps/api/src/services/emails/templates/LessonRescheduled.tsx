import { Heading, Section, Text } from "@react-email/components";
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

export default function LessonRescheduled({ payload, siteUrl, replyToEmail }: Props) {
  const coach = coachDisplay(payload.coachFirstName);
  const swimmers = formatSwimmerList(payload.swimmerFirstNames);
  const previewText = `This lesson moved to ${payload.startsAtLocalDisplay}.`;
  const sentence =
    payload.actorRole === "coach"
      ? `${coach} moved this lesson.`
      : `A household member rescheduled this lesson. Everyone in your household is getting this email so your calendars stay in sync.`;
  return (
    <EmailLayout
      siteUrl={siteUrl}
      previewText={previewText}
      coachFirstName={coach}
      replyToEmail={replyToEmail ?? null}
    >
      <Heading style={headingStyle}>This lesson moved.</Heading>
      <Text style={bodyStyle}>{sentence}</Text>
      {payload.previousStartsAtLocalDisplay ? (
        <Section style={{ margin: "16px 0" }}>
          <Text style={labelStyle}>Was</Text>
          <Text style={valueStyle}>{payload.previousStartsAtLocalDisplay}</Text>
          <Text style={{ ...labelStyle, marginTop: "12px" }}>Now</Text>
          <Text style={valueStyle}>{payload.startsAtLocalDisplay}</Text>
        </Section>
      ) : null}
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

const labelStyle = {
  fontSize: "13px",
  lineHeight: "18px",
  color: emailTheme.color.textSecondary,
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  margin: 0,
};

const valueStyle = {
  fontSize: "16px",
  lineHeight: "22px",
  color: emailTheme.color.text,
  margin: "2px 0 0",
  fontWeight: 600,
};
