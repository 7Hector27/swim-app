import "@/styles/globals.css";
import type { Metadata, Viewport } from "next";
import { Figtree, Saira } from "next/font/google";

const saira = Saira({
  subsets: ["latin"],
  axes: ["wdth"],
  style: ["normal", "italic"],
  variable: "--font-saira",
});

const figtree = Figtree({
  subsets: ["latin"],
  variable: "--font-figtree",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: "JG Swim",
  description: "Private swim coaching",
  icons: {
    icon: [
      { url: "/icons/favicon.ico" },
      { url: "/icons/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/icons/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  manifest: "/icons/site.webmanifest",
  openGraph: {
    images: ["/social/og-image.png"],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/social/og-image.png"],
  },
};

export const viewport: Viewport = {
  // <meta name="theme-color"> requires static strings — CSS variables don't work here.
  // These match --color-section (light) and --color-background (dark) in tokens.css.
  // Update both if those token values change.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#082C4F" },
    { media: "(prefers-color-scheme: dark)", color: "#04182C" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${saira.variable} ${figtree.variable}`}>
      <body className="min-h-screen bg-background text-text antialiased">
        {children}
      </body>
    </html>
  );
}
