import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";
import { emailTheme } from "./theme";

interface EmailLayoutProps {
  siteUrl: string;
  previewText: string;
  coachFirstName: string;
  replyToEmail?: string | null;
  children: ReactNode;
}

const theme = emailTheme;

// Shared skeleton: header lockup, body container, footer. Every event's
// template wraps its content block in this.
export default function EmailLayout({
  siteUrl,
  previewText,
  coachFirstName,
  replyToEmail,
  children,
}: EmailLayoutProps) {
  const logoUrl = `${siteUrl.replace(/\/+$/, "")}/logos/axiom-aquatics-lockup.png`;
  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body
        style={{
          backgroundColor: theme.color.background,
          fontFamily: theme.font.body,
          color: theme.color.text,
          margin: 0,
          padding: `${theme.spacing.pagePadding} 0`,
        }}
      >
        <Container
          style={{
            backgroundColor: theme.color.background,
            maxWidth: theme.maxWidth,
            margin: "0 auto",
            padding: `0 ${theme.spacing.pagePadding}`,
          }}
        >
          <Section style={{ textAlign: "center", paddingBottom: "24px" }}>
            <Img
              src={logoUrl}
              alt="Axiom Aquatics"
              width="200"
              height="60"
              style={{ display: "inline-block", border: 0 }}
            />
          </Section>
          <Section
            style={{
              backgroundColor: theme.color.card,
              border: `1px solid ${theme.color.cardBorder}`,
              borderRadius: theme.radius.card,
              padding: theme.spacing.cardPadding,
            }}
          >
            {children}
          </Section>
          <Hr
            style={{
              border: "none",
              borderTop: `1px solid ${theme.color.divider}`,
              margin: "32px 0 16px",
            }}
          />
          <Section>
            <Text
              style={{
                fontSize: "13px",
                color: theme.color.textSecondary,
                lineHeight: "20px",
                margin: 0,
              }}
            >
              Sent by {coachFirstName} at Axiom Aquatics.
              {replyToEmail ? ` Reply to this email to reach ${coachFirstName} directly.` : ""}
            </Text>
            <Text
              style={{
                fontSize: "13px",
                color: theme.color.textSecondary,
                lineHeight: "20px",
                margin: "8px 0 0",
              }}
            >
              <Link
                href={siteUrl}
                style={{ color: theme.color.link, textDecoration: "underline" }}
              >
                Open the Axiom Aquatics app
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
