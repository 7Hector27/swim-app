// Shared React Email template for the three batch events (batch_booked,
// batch_approved, batch_canceled). Subject + header copy branch on event;
// the body renders two or three per-lesson sublists depending on the
// snapshotted status of each lesson. See ADR 030.

import { Heading, Section, Text } from "@react-email/components";
import { LESSON_TIME_ZONE } from "../format";
import type { BatchEmailEvent, BatchEmailLesson, BatchEmailPayload } from "../batchTypes";
import EmailLayout from "./shared/EmailLayout";
import CtaButton from "./shared/CtaButton";
import { emailTheme } from "./shared/theme";
import { coachDisplay, formatSwimmerList } from "./shared/copyHelpers";

const LESSON_TIME_ZONE_LABEL =
  LESSON_TIME_ZONE === "America/Los_Angeles" ? "Pacific Time" : LESSON_TIME_ZONE;

interface BatchTemplateProps {
  event: BatchEmailEvent;
  payload: BatchEmailPayload;
  siteUrl: string;
  replyToEmail?: string | null;
  // The sender's send-time filter identifies which lessons were "changed
  // since the batch was written." Those are listed in a notice at the top
  // instead of in the main lists.
  changedLessonIds: string[];
  // The sender optionally passes coach first name. Nullable because the
  // batch rows don't snapshot it at write time (unlike per-lesson rows);
  // the renderer resolves it live via the shared helper if needed.
  coachFirstName: string | null;
}

export default function Batch({
  event,
  payload,
  siteUrl,
  replyToEmail,
  changedLessonIds,
  coachFirstName,
}: BatchTemplateProps) {
  const coach = coachDisplay(coachFirstName);
  const swimmers = formatSwimmerList(payload.swimmerFirstNames);
  const changedSet = new Set(changedLessonIds);
  const visibleLessons = payload.lessons.filter((lesson) => !changedSet.has(lesson.lessonId));

  const approvedLessons = visibleLessons.filter((l) => l.status === "approved");
  const pendingLessons = visibleLessons.filter((l) => l.status === "pending");
  const canceledLessons = visibleLessons.filter((l) => l.status === "canceled");

  const { heading, intro, previewText, deepLinkPath } = buildCopy(event, {
    coach,
    swimmers,
    payload,
    approvedCount: approvedLessons.length,
    pendingCount: pendingLessons.length,
    canceledCount: canceledLessons.length,
  });

  const deepLink = `${siteUrl.replace(/\/+$/, "")}${deepLinkPath}`;

  return (
    <EmailLayout
      siteUrl={siteUrl}
      previewText={previewText}
      coachFirstName={coach}
      replyToEmail={replyToEmail ?? null}
    >
      <Heading style={headingStyle}>{heading}</Heading>
      <Text style={bodyStyle}>{intro}</Text>

      {approvedLessons.length > 0 && event !== "batch_canceled" && (
        <LessonList label="Confirmed lessons" lessons={approvedLessons} payload={payload} />
      )}
      {pendingLessons.length > 0 && event === "batch_booked" && (
        <LessonList
          label="Waiting for Jason"
          lessons={pendingLessons}
          payload={payload}
          secondary
        />
      )}
      {canceledLessons.length > 0 && event === "batch_canceled" && (
        <LessonList
          label="Canceled lessons"
          lessons={canceledLessons}
          payload={payload}
        />
      )}

      {changedLessonIds.length > 0 && (
        <Text style={noteStyle}>
          Note: {changedLessonIds.length}{" "}
          {changedLessonIds.length === 1 ? "lesson" : "lessons"} changed before this email went
          out. You will receive a separate update for{" "}
          {changedLessonIds.length === 1 ? "it" : "them"}.
        </Text>
      )}

      <CtaButton href={deepLink} label="View your lessons" />
    </EmailLayout>
  );
}

interface LessonListProps {
  label: string;
  lessons: BatchEmailLesson[];
  payload: BatchEmailPayload;
  secondary?: boolean;
}

function LessonList({ label, lessons, payload, secondary = false }: LessonListProps) {
  // If every lesson in the batch has the same swimmer set, the intro line
  // already names everyone; skip the per-row swimmer suffix to keep the
  // table tight. When sets differ (ADR 030 phase 2), surface each row's
  // kids inline so the parent can tell which lesson is for which swimmer.
  const perLessonSets = new Set(
    lessons.map((lesson) => [...lesson.swimmerFirstNames].sort().join("|")),
  );
  const showPerLessonSwimmers = perLessonSets.size > 1;

  return (
    <Section
      style={{
        borderTop: `1px solid ${emailTheme.color.cardBorder}`,
        borderBottom: `1px solid ${emailTheme.color.cardBorder}`,
        padding: "16px 0",
        margin: "20px 0",
      }}
    >
      <Text style={listLabelStyle(secondary)}>{label}</Text>
      {lessons.map((lesson) => (
        <Text key={lesson.lessonId} style={listRowStyle}>
          <span style={{ color: emailTheme.color.text }}>
            {formatLocalDisplay(lesson.startsAtUtc)}
          </span>
          <span style={{ color: emailTheme.color.textSecondary, marginLeft: 8 }}>
            {lesson.durationMinutes} min · {payload.location.name}
          </span>
          {showPerLessonSwimmers && lesson.swimmerFirstNames.length > 0 && (
            <span style={{ color: emailTheme.color.textSecondary, marginLeft: 8 }}>
              · {formatSwimmerList(lesson.swimmerFirstNames)}
            </span>
          )}
        </Text>
      ))}
    </Section>
  );
}

interface CopyInput {
  coach: string;
  swimmers: string;
  payload: BatchEmailPayload;
  approvedCount: number;
  pendingCount: number;
  canceledCount: number;
}

function buildCopy(
  event: BatchEmailEvent,
  input: CopyInput,
): { heading: string; intro: string; previewText: string; deepLinkPath: string } {
  const { coach, swimmers, payload, approvedCount, pendingCount, canceledCount } = input;
  const poolName = payload.location.name;
  const modeWord = payload.mode === "weekly" ? "weekly " : "";
  const total = approvedCount + pendingCount + canceledCount;
  if (event === "batch_booked") {
    if (pendingCount === 0) {
      return {
        heading: `Your ${modeWord}lessons at ${poolName} are booked.`,
        intro: `${swimmers} are set for ${approvedCount} ${modeWord}${
          approvedCount === 1 ? "lesson" : "lessons"
        } at ${poolName}. The calendar invite is attached.`,
        previewText: `${approvedCount} ${modeWord}${
          approvedCount === 1 ? "lesson" : "lessons"
        } booked at ${poolName}.`,
        deepLinkPath: "/dashboard",
      };
    }
    if (approvedCount === 0) {
      return {
        heading: `${coach} will confirm your ${modeWord}lessons.`,
        intro: `Your request for ${pendingCount} ${modeWord}${
          pendingCount === 1 ? "lesson" : "lessons"
        } at ${poolName} is in. ${coach} will approve each one.`,
        previewText: `${pendingCount} ${modeWord}${
          pendingCount === 1 ? "lesson" : "lessons"
        } waiting for ${coach}.`,
        deepLinkPath: "/dashboard",
      };
    }
    return {
      heading: `Your lessons at ${poolName}: ${approvedCount} confirmed, ${pendingCount} waiting.`,
      intro: `${approvedCount} ${modeWord}${
        approvedCount === 1 ? "lesson is" : "lessons are"
      } confirmed; ${pendingCount} ${
        pendingCount === 1 ? "needs" : "need"
      } ${coach}'s approval. The confirmed ${
        approvedCount === 1 ? "lesson has an invite" : "lessons have invites"
      } attached.`,
      previewText: `${total} lessons at ${poolName}: ${approvedCount} confirmed, ${pendingCount} waiting.`,
      deepLinkPath: "/dashboard",
    };
  }
  if (event === "batch_approved") {
    return {
      heading: `${coach} confirmed ${approvedCount} ${
        approvedCount === 1 ? "lesson" : "more lessons"
      } at ${poolName}.`,
      intro: `${swimmers} are set. ${
        approvedCount === 1 ? "A calendar invite is" : "Calendar invites are"
      } attached.`,
      previewText: `${coach} confirmed ${approvedCount} ${
        approvedCount === 1 ? "lesson" : "lessons"
      } at ${poolName}.`,
      deepLinkPath: "/dashboard",
    };
  }
  // batch_canceled
  return {
    heading: `${canceledCount} ${
      canceledCount === 1 ? "lesson" : "lessons"
    } at ${poolName} canceled.`,
    intro:
      `We canceled ${canceledCount} ${
        canceledCount === 1 ? "upcoming lesson" : "upcoming lessons"
      } for ${swimmers}. ${
        canceledCount === 1 ? "A cancellation is" : "Cancellations are"
      } attached so your calendar stays in sync.`,
    previewText: `${canceledCount} ${
      canceledCount === 1 ? "lesson" : "lessons"
    } canceled at ${poolName}.`,
    deepLinkPath: "/dashboard",
  };
}

function formatLocalDisplay(startsAtUtc: string): string {
  const date = new Date(startsAtUtc);
  const datePart = new Intl.DateTimeFormat("en-US", {
    timeZone: LESSON_TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
  const timePart = new Intl.DateTimeFormat("en-US", {
    timeZone: LESSON_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  return `${datePart} at ${timePart} (${LESSON_TIME_ZONE_LABEL})`;
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

const noteStyle = {
  fontSize: "13px",
  lineHeight: "20px",
  color: emailTheme.color.textSecondary,
  margin: "12px 0",
  fontStyle: "italic",
} as const;

function listLabelStyle(secondary: boolean) {
  return {
    fontFamily: emailTheme.font.heading,
    fontSize: "14px",
    lineHeight: "18px",
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    color: secondary ? emailTheme.color.textSecondary : emailTheme.color.heading,
    margin: "0 0 8px",
  };
}

const listRowStyle = {
  fontSize: "15px",
  lineHeight: "22px",
  margin: "4px 0",
};
