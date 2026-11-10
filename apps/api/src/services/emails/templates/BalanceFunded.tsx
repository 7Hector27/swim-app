// ADR 036 Phase 7 — email the parent receives after a Stripe top-up or
// package purchase credits the balance. Payload is frozen at outbox
// write time inside the webhook's transaction; the template is a pure
// function of it.

import { Heading, Text } from "@react-email/components";
import type { BalanceFundedEmailPayload } from "../balanceFundedTypes";
import EmailLayout from "./shared/EmailLayout";
import CtaButton from "./shared/CtaButton";
import { emailTheme } from "./shared/theme";
import { coachDisplay, formatMoneyCents } from "./shared/copyHelpers";

interface Props {
  payload: BalanceFundedEmailPayload;
  siteUrl: string;
  replyToEmail?: string | null;
}

export default function BalanceFunded({ payload, siteUrl, replyToEmail }: Props) {
  const coach = coachDisplay(payload.coachFirstName);
  const isPackage = payload.type === "package";
  const totalAddedCents = payload.amountPaidCents + payload.bonusCents;
  const previewText = `Added ${formatMoneyCents(totalAddedCents)} to your balance.`;
  const heading = isPackage ? "Package added." : "Credit added.";
  return (
    <EmailLayout
      siteUrl={siteUrl}
      previewText={previewText}
      coachFirstName={coach}
      replyToEmail={replyToEmail ?? null}
    >
      <Heading style={headingStyle}>{heading}</Heading>
      <Text style={bodyStyle} data-testid="paid-line">
        You paid{" "}
        <span style={{ fontWeight: 600 }}>
          {formatMoneyCents(payload.amountPaidCents)}
        </span>
        .
      </Text>
      {isPackage && payload.bonusCents > 0 && (
        <Text style={bodyStyle} data-testid="bonus-line">
          Bonus credit:{" "}
          <span style={{ fontWeight: 600 }}>
            {formatMoneyCents(payload.bonusCents)}
          </span>
          .
        </Text>
      )}
      <Text style={balanceStyle} data-testid="new-balance-line">
        New balance:{" "}
        <span style={{ fontWeight: 600 }}>
          {formatMoneyCents(payload.newBalanceCents)}
        </span>
        .
      </Text>
      <Text style={bodyStyle}>
        Credit never expires. Each lesson draws from your balance at the price
        for the swimmers in it.
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

const balanceStyle = {
  fontSize: "15px",
  lineHeight: "22px",
  color: emailTheme.color.text,
  margin: "12px 0",
  fontVariantNumeric: "tabular-nums",
};
