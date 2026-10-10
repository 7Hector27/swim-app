import "@/styles/globals.css";
import type { Metadata, Viewport } from "next";
import { Fraunces, Figtree } from "next/font/google";

import Providers from "@/components/Providers";
import { createClient } from "@/lib/supabase/server";

const fraunces = Fraunces({
  subsets: ["latin"],
  axes: ["SOFT", "WONK", "opsz"],
  variable: "--font-fraunces",
});

const figtree = Figtree({
  subsets: ["latin"],
  variable: "--font-figtree",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: "Axiom Aquatics",
  description: "Private swim lessons with Coach Jason",
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
  // These match --color-background (light) and --color-background (dark) in tokens.css.
  // Update both if those token values change.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F5F7FA" },
    { media: "(prefers-color-scheme: dark)", color: "#10131C" },
  ],
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const userName =
    (claims?.user_metadata?.["full_name"] as string | undefined) ??
    claims?.email ??
    null;

  return (
    <html lang="en" className={`${fraunces.variable} ${figtree.variable}`} suppressHydrationWarning>
      <body className="min-h-screen bg-background text-text antialiased">
        <Providers isSignedIn={!!data} userName={userName}>{children}</Providers>
      </body>
    </html>
  );
}
