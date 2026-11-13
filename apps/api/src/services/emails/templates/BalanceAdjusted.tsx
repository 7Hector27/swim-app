// ADR 036 Phase 7 — email the parent receives after Jason adjusts the
// family's balance. Pure function of the frozen payload; the reason
// line is rendered verbatim (the adjust-modal warns Jason that it is
// shown).

import { Heading, Text } from "@react-email/components";
import type { BalanceAdjustedEmailPayload } from "../balanceAdjustedTypes";
import EmailLayout from "./shared/EmailLayout";
import CtaButton from "./shared/CtaButton";
import { emailTheme } from "./shared/theme";
import { coachDisplay, formatMoneyCents } from "./shared/copyHelpers";

interface Props {
  payload: BalanceAdjustedEmailPayload;
  siteUrl: string;
  replyToEmail?: string | null;
}

export default function BalanceAdjusted({ payload, siteUrl, replyToEmail }: Props) {
  const coach = coachDisplay(payload.coachFirstName);
  const isCredit = payload.amountCents > 0;
  const absAmount = Math.abs(payload.amountCents);
  const heading = isCredit ? "Balance credit." : "Balance adjustment.";
  const previewText = isCredit
    ? `${coach} added ${formatMoneyCents(absAmount)} to your balance.`
    : `${coach} removed ${formatMoneyCents(absAmount)} from your balance.`;
  return (
    <EmailLayout
      siteUrl={siteUrl}
      previewText={previewText}
      coachFirstName={coach}
      replyToEmail={replyToEmail ?? null}
    >
      <Heading style={headingStyle}>{heading}</Heading>
      <Text style={bodyStyle} data-testid="amount-line">
        {isCredit ? `${coach} added ` : `${coach} removed `}
        <span style={{ fontWeight: 600 }}>{formatMoneyCents(absAmount)}</span>
        {isCredit ? " to your balance." : " from your balance."}
      </Text>
      <Text style={bodyStyle} data-testid="new-balance-line">
        New balance:{" "}
        <span style={{ fontWeight: 600 }}>
          {formatMoneyCents(payload.newBalanceCents)}
        </span>
        .
      </Text>
      <Text style={reasonSectionLabel}>Reason</Text>
      <Text style={reasonStyle} data-testid="reason-line">
        {payload.reason}
      </Text>
      <CtaButton href={payload.deepLink} label="View balance" />
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
  margin: "0 0 8px",
  fontVariantNumeric: "tabular-nums",
};

const reasonSectionLabel = {
  fontSize: "13px",
  lineHeight: "18px",
  color: emailTheme.color.textSecondary,
  textTransform: "uppercase" as const,
  letterSpacing: "0.04em",
  margin: "16px 0 4px",
};

const reasonStyle = {
  fontSize: "15px",
  lineHeight: "22px",
  color: emailTheme.color.text,
  margin: "0 0 16px",
  whiteSpace: "pre-wrap" as const,
};
