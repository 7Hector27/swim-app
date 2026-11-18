// Security alert email fired after a successful password reset or
// change. Body copy is identical for both sources — the recipient only
// needs to know the password changed and what to do if they didn't do it.

import { Heading, Text } from "@react-email/components";

import type { PasswordChangedEmailPayload } from "../passwordChangedTypes";
import EmailLayout from "./shared/EmailLayout";
import CtaButton from "./shared/CtaButton";
import { emailTheme } from "./shared/theme";

interface Props {
  payload: PasswordChangedEmailPayload;
  siteUrl: string;
  replyToEmail?: string | null;
  coachFirstName: string | null;
}

export default function PasswordChanged({
  payload,
  siteUrl,
  replyToEmail,
  coachFirstName,
}: Props) {
  return (
    <EmailLayout
      siteUrl={siteUrl}
      previewText="Your Axiom Aquatics password was changed."
      coachFirstName={coachFirstName ?? "Axiom Aquatics"}
      replyToEmail={replyToEmail ?? null}
    >
      <Heading style={headingStyle}>Your password was changed.</Heading>
      <Text style={bodyStyle}>
        The password on your Axiom Aquatics account was just changed. If
        this was you, there&apos;s nothing else to do.
      </Text>
      <Text style={bodyStyle}>
        If this wasn&apos;t you, reset your password now and then reach out
        so we can secure the account.
      </Text>
      <CtaButton href={payload.resetPasswordUrl} label="Reset your password" />
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
  margin: "0 0 12px",
};
