import { Section, Text } from "@react-email/components";
import { emailTheme } from "./theme";
import { LESSON_TIME_ZONE } from "../../format";
import type { LessonEmailLocation } from "../../types";

// Parent-facing label for the lesson time zone. The internal constant is an
// IANA zone id ("America/Los_Angeles") — kept here so a future zone change
// updates both the server-side format and the email copy together. Shown
// to parents as "Pacific Time" since the IANA name reads as jargon.
const LESSON_TIME_ZONE_LABEL =
  LESSON_TIME_ZONE === "America/Los_Angeles" ? "Pacific Time" : LESSON_TIME_ZONE;

interface LessonCardProps {
  swimmerListDisplay: string;
  whenDisplay: string;
  location: LessonEmailLocation;
  // When true, show only the location name (no address). Used for pending
  // bookings so the address isn't revealed until the lesson is confirmed.
  hideAddress?: boolean;
}

const theme = emailTheme;

// Inline summary of a lesson: swimmer(s), time, location. Lives inside the
// EmailLayout's card body.
export default function LessonCard({
  swimmerListDisplay,
  whenDisplay,
  location,
  hideAddress = false,
}: LessonCardProps) {
  const addressLine = hideAddress
    ? location.name
    : `${location.name}, ${location.address}, ${location.city}, ${location.state} ${location.zip}`;
  return (
    <Section
      style={{
        borderTop: `1px solid ${theme.color.cardBorder}`,
        borderBottom: `1px solid ${theme.color.cardBorder}`,
        padding: "16px 0",
        margin: "20px 0",
      }}
    >
      <Row label="Swimmer" value={swimmerListDisplay} />
      <Row label="When" value={`${whenDisplay} (${LESSON_TIME_ZONE_LABEL})`} />
      <Row label="Location" value={addressLine} />
    </Section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Text style={{ margin: "6px 0", fontSize: "15px", lineHeight: "22px" }}>
      <span
        style={{
          color: theme.color.textSecondary,
          display: "inline-block",
          minWidth: "80px",
        }}
      >
        {label}:
      </span>
      <span style={{ color: theme.color.text }}>{value}</span>
    </Text>
  );
}
