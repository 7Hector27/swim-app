// ADR 036 Phase 8 Part B — email the parent receives after a cash-out.
// Pure function of the frozen payload; the renderer never reads the
// live ledger.

import { Heading, Text } from "@react-email/components";
import type { BalanceCashedOutEmailPayload } from "../balanceCashedOutTypes";
import EmailLayout from "./shared/EmailLayout";
import CtaButton from "./shared/CtaButton";
import { emailTheme } from "./shared/theme";
import { coachDisplay, formatMoneyCents } from "./shared/copyHelpers";

interface Props {
  payload: BalanceCashedOutEmailPayload;
  siteUrl: string;
  replyToEmail?: string | null;
}

export default function BalanceCashedOut({
  payload,
  siteUrl,
  replyToEmail,
}: Props) {
  const coach = coachDisplay(payload.coachFirstName);
  const refundedBefore = payload.totalCashRefundedPriorCents > 0;
  const writtenOff = payload.writeOffCents > 0;
  const previewText =
    payload.refundableCents > 0
      ? `${formatMoneyCents(payload.refundableCents)} refunded to your card.`
      : "Your balance has been cashed out.";
  return (
    <EmailLayout
      siteUrl={siteUrl}
      previewText={previewText}
      coachFirstName={coach}
      replyToEmail={replyToEmail ?? null}
    >
      <Heading style={headingStyle}>Balance cashed out.</Heading>
      <Text style={bodyStyle} data-testid="paid-line">
        You paid{" "}
        <span style={{ fontWeight: 600 }}>
          {formatMoneyCents(payload.totalCardPaidCents)}
        </span>{" "}
        and used{" "}
        <span style={{ fontWeight: 600 }}>
          {formatMoneyCents(payload.netLessonSpendingCents)}
        </span>{" "}
        on lessons.
      </Text>
      {refundedBefore && (
        <Text style={bodyStyle} data-testid="prior-refund-line">
          Previously refunded:{" "}
          <span style={{ fontWeight: 600 }}>
            {formatMoneyCents(payload.totalCashRefundedPriorCents)}
          </span>
          .
        </Text>
      )}
      <Text style={bodyStyle} data-testid="refund-line">
        Refunded to your card:{" "}
        <span style={{ fontWeight: 600 }}>
          {formatMoneyCents(payload.refundableCents)}
        </span>
        .
      </Text>
      {writtenOff && (
        <Text style={bodyStyle} data-testid="writeoff-line">
          Written off (bonus credit and gifts):{" "}
          <span style={{ fontWeight: 600 }}>
            {formatMoneyCents(payload.writeOffCents)}
          </span>
          .
        </Text>
      )}
      <Text style={bodyStyle}>
        Your balance is now zero. Your refund is on its way to your card
        and can take a few business days to appear.
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
