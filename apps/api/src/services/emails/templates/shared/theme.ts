// Email-side theme. Hex values are COPIED (not referenced) from
// apps/web/src/styles/tokens.css. Emails have no runtime access to CSS
// variables; the renderer inlines these as hard-coded colors in style="".
// Only the light-theme palette is used — many email clients ignore
// prefers-color-scheme and the lockup is tuned for light surfaces.

export const emailTheme = {
  color: {
    background: "#F5F7FA",
    card: "#FFFFFF",
    cardBorder: "#DDE3EC",
    heading: "#141A2E",
    text: "#1E2433",
    textSecondary: "#4A5468",
    accent: "#1440F0",
    buttonBg: "#1440F0",
    buttonText: "#FFFFFF",
    link: "#1440F0",
    divider: "#DDE3EC",
  },
  font: {
    body: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Figtree", Helvetica, Arial, sans-serif',
    heading: 'Georgia, "Fraunces", "Segoe UI", serif',
  },
  radius: {
    card: "18px",
    button: "999px",
  },
  spacing: {
    pagePadding: "24px",
    cardPadding: "20px",
  },
  maxWidth: "560px",
} as const;
