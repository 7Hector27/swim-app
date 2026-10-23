import { Button, Section } from "@react-email/components";
import { emailTheme } from "./theme";

interface CtaButtonProps {
  href: string;
  label: string;
}

const theme = emailTheme;

// Rounded primary button. Centered inside its own Section so the surrounding
// template doesn't need to worry about alignment.
export default function CtaButton({ href, label }: CtaButtonProps) {
  return (
    <Section style={{ textAlign: "center", margin: "24px 0 8px" }}>
      <Button
        href={href}
        style={{
          backgroundColor: theme.color.buttonBg,
          color: theme.color.buttonText,
          borderRadius: theme.radius.button,
          padding: "12px 24px",
          fontSize: "15px",
          fontWeight: 600,
          textDecoration: "none",
          display: "inline-block",
        }}
      >
        {label}
      </Button>
    </Section>
  );
}
