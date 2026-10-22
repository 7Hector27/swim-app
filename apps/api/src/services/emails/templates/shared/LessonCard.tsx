import { Section, Text } from "@react-email/components";
import { emailTheme } from "./theme";
import type { LessonEmailLocation } from "../../types";

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
      <Row label="When" value={`${whenDisplay} (America/Los_Angeles)`} />
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
