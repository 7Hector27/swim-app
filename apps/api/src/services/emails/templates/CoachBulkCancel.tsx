import { Heading, Section, Text } from "@react-email/components";
import type { BulkCancelEmailPayload } from "../bulkCancelTypes";
import EmailLayout from "./shared/EmailLayout";
import CtaButton from "./shared/CtaButton";
import { emailTheme } from "./shared/theme";
import { coachDisplay, formatSwimmerList } from "./shared/copyHelpers";
import { LESSON_TIME_ZONE } from "../format";

const LESSON_TIME_ZONE_LABEL =
  LESSON_TIME_ZONE === "America/Los_Angeles" ? "Pacific Time" : LESSON_TIME_ZONE;

interface Props {
  payload: BulkCancelEmailPayload;
  siteUrl: string;
  replyToEmail?: string | null;
}

export default function CoachBulkCancel({ payload, siteUrl, replyToEmail }: Props) {
  const coach = coachDisplay(payload.coachFirstName);
  const cancelledCount = payload.cancelledLessons.length;
  const declinedCount = payload.declinedRequests.length;
  const total = cancelledCount + declinedCount;
  const noun = total === 1 ? "lesson" : "lessons";
  const previewText =
    cancelledCount > 0 && declinedCount > 0
      ? `${cancelledCount} canceled, ${declinedCount} request${declinedCount === 1 ? "" : "s"} not booked.`
      : cancelledCount > 0
        ? `${cancelledCount} ${cancelledCount === 1 ? "lesson" : "lessons"} canceled.`
        : `${declinedCount} ${declinedCount === 1 ? "request" : "requests"} not booked.`;

  const headingText =
    cancelledCount > 0 && declinedCount > 0
      ? `${coach} canceled ${total} ${noun}.`
      : cancelledCount > 0
        ? `${coach} canceled ${cancelledCount} ${noun}.`
        : `${coach} couldn't book ${declinedCount} ${declinedCount === 1 ? "request" : "requests"}.`;

  const introSentence = formatIntro(payload);

  return (
    <EmailLayout
      siteUrl={siteUrl}
      previewText={previewText}
      coachFirstName={coach}
      replyToEmail={replyToEmail ?? null}
    >
      <Heading style={headingStyle}>{headingText}</Heading>
      <Text style={bodyStyle}>{introSentence}</Text>
      {payload.message !== null && payload.message.length > 0 && (
        <Section style={messageSectionStyle}>
          <Text style={messageLabelStyle}>Note from {coach}</Text>
          <Text style={messageBodyStyle}>{payload.message}</Text>
        </Section>
      )}
      {cancelledCount > 0 && (
        <Section style={groupSectionStyle}>
          <Text style={groupHeadingStyle}>Canceled lessons</Text>
          {payload.cancelledLessons.map((lesson) => (
            <LessonLine
              key={lesson.lessonId}
              whenDisplay={lesson.startsAtLocalDisplay}
              durationMinutes={lesson.durationMinutes}
              swimmers={formatSwimmerList(lesson.swimmerFirstNames)}
              locationName={lesson.location.name}
            />
          ))}
        </Section>
      )}
      {declinedCount > 0 && (
        <Section style={groupSectionStyle}>
          <Text style={groupHeadingStyle}>Requests that couldn't be confirmed</Text>
          {payload.declinedRequests.map((request) => (
            <LessonLine
              key={request.lessonId}
              whenDisplay={request.startsAtLocalDisplay}
              durationMinutes={request.durationMinutes}
              swimmers={formatSwimmerList(request.swimmerFirstNames)}
              locationName={request.location.name}
            />
          ))}
        </Section>
      )}
      <Text style={bodyStyle}>
        Times shown are {LESSON_TIME_ZONE_LABEL}. If any of these should still happen,
        please rebook from the dashboard.
      </Text>
      <CtaButton href={payload.deepLink} label="Open your lessons" />
    </EmailLayout>
  );
}

function LessonLine({
  whenDisplay,
  durationMinutes,
  swimmers,
  locationName,
}: {
  whenDisplay: string;
  durationMinutes: number;
  swimmers: string;
  locationName: string;
}) {
  return (
    <Text style={lineStyle}>
      <span style={lineWhenStyle}>{whenDisplay}</span>
      <span style={lineMetaStyle}>
        {" "}
        · {durationMinutes} min · {swimmers} · {locationName}
      </span>
    </Text>
  );
}

function formatIntro(payload: BulkCancelEmailPayload): string {
  const sameDay = payload.startDateLocal === payload.endDateLocal;
  const windowed =
    payload.startTimeLocal !== null && payload.endTimeLocal !== null;
  const timeClause = windowed
    ? `${payload.startTimeLocal} to ${payload.endTimeLocal}`
    : null;
  const whenClause = sameDay
    ? windowed
      ? `${payload.startDateLocal}, ${timeClause}`
      : payload.startDateLocal
    : windowed
      ? `${payload.startDateLocal} through ${payload.endDateLocal}, ${timeClause} each day`
      : `${payload.startDateLocal} through ${payload.endDateLocal}`;
  const location = payload.locationName !== null ? ` at ${payload.locationName}` : "";
  return `All affected lessons for ${whenClause}${location} are listed below.`;
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

const messageSectionStyle = {
  borderLeft: `3px solid ${emailTheme.color.cardBorder}`,
  padding: "4px 0 4px 12px",
  margin: "12px 0 20px",
};

const messageLabelStyle = {
  fontSize: "13px",
  lineHeight: "18px",
  color: emailTheme.color.textSecondary,
  margin: "0 0 4px",
  textTransform: "uppercase" as const,
  letterSpacing: "0.04em",
};

const messageBodyStyle = {
  fontSize: "15px",
  lineHeight: "22px",
  color: emailTheme.color.text,
  margin: 0,
  whiteSpace: "pre-wrap" as const,
};

const groupSectionStyle = {
  margin: "16px 0",
};

const groupHeadingStyle = {
  fontFamily: emailTheme.font.heading,
  fontSize: "16px",
  lineHeight: "22px",
  color: emailTheme.color.heading,
  margin: "0 0 8px",
};

const lineStyle = {
  fontSize: "15px",
  lineHeight: "22px",
  color: emailTheme.color.text,
  margin: "4px 0",
};

const lineWhenStyle = {
  color: emailTheme.color.text,
  fontWeight: 600 as const,
};

const lineMetaStyle = {
  color: emailTheme.color.textSecondary,
};
