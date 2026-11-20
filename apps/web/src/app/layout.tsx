import "@/styles/globals.css";
import type { Metadata, Viewport } from "next";
import { Fraunces, Figtree } from "next/font/google";

import Providers from "@/components/Providers";
import NavController from "@/components/NavController";
import SiteFooter from "@/components/SiteFooter";
import { BookGateProvider } from "@/components/BookGate";
import { publicEnv } from "@/lib/env";
import { fetchMe } from "@/lib/api/me";
import { fetchHousehold } from "@/lib/api/households";
import { fetchSwimmers } from "@/lib/api/swimmers";
import { fetchBalance } from "@/lib/api/balance";
import { fetchLeaderboardSummary } from "@/lib/api/leaderboard";

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
  metadataBase: new URL(publicEnv.siteUrl),
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
  viewportFit: "cover",
  // <meta name="theme-color"> requires static strings — CSS variables don't work here.
  // These match --color-background in tokens.css. Update both if those token values change.
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
  const meResult = await fetchMe();
  const isSignedIn = meResult.ok;
  const userName = meResult.ok ? (meResult.profile.fullName ?? meResult.profile.email) : null;
  const role = meResult.ok ? meResult.profile.role : null;

  let isViewer = false;
  let gateSwimmerCount = 0;
  let gateBalanceCents: number | null = null;
  if (meResult.ok && meResult.profile.role === "parent") {
    const householdResult = await fetchHousehold(meResult.accessToken);
    // Nav uses isViewer to hide the Book link. Treat any state we can't
    // confirm as viewer (hide the link) — load failure, no household yet,
    // or an actual viewer role. Same fail-safe rule as the dashboard and
    // lesson-detail pages. The API still enforces the booking route
    // server-side if someone navigates there directly.
    isViewer = !(
      householdResult.ok &&
      householdResult.household !== null &&
      (householdResult.household.myRole === "owner" ||
        householdResult.household.myRole === "manager")
    );
    // BookGate inputs: non-viewer parents. We skip the two fetches when
    // the parent is a viewer since the gate ignores them anyway, and
    // when no household exists since the viewer check already caught it.
    if (!isViewer) {
      const [swimmersResult, balanceResult] = await Promise.all([
        fetchSwimmers(meResult.accessToken),
        fetchBalance(meResult.accessToken),
      ]);
      gateSwimmerCount = swimmersResult.ok ? swimmersResult.data.length : 0;
      gateBalanceCents = balanceResult !== null ? balanceResult.balanceCents : null;
    }
  }

  const showsTabBar = isSignedIn && (role === "parent" || role === "coach");
  const needsBookGate = isSignedIn && role === "parent";

  // Leaderboards nav links hide themselves when no board qualifies — the
  // same summary endpoint the homepage and landing page use. Fetched once at
  // the root so NavController + SiteFooter + HomepageContent share one cached
  // round-trip (revalidate 60s via the fetch helper).
  const leaderboardSummary = await fetchLeaderboardSummary();
  const hasAnyBoard = (leaderboardSummary?.qualifying ?? []).length > 0;

  return (
    <html lang="en" className={`${fraunces.variable} ${figtree.variable}`} suppressHydrationWarning data-scroll-behavior="smooth">
      <body className="min-h-screen flex flex-col bg-background text-text antialiased">
        <Providers isSignedIn={isSignedIn} userName={userName} role={role} isViewer={isViewer}>
          {needsBookGate ? (
            <BookGateProvider
              swimmerCount={gateSwimmerCount}
              balanceCents={gateBalanceCents}
              isViewer={isViewer}
            >
              <NavController hasAnyBoard={hasAnyBoard} />
              <div className="flex-1 flex flex-col">
                {children}
              </div>
              <SiteFooter />
              {showsTabBar && <div className="pb-tab-safe tablet:hidden" aria-hidden="true" />}
            </BookGateProvider>
          ) : (
            <>
              <NavController hasAnyBoard={hasAnyBoard} />
              <div className="flex-1 flex flex-col">
                {children}
              </div>
              <SiteFooter />
              {showsTabBar && <div className="pb-tab-safe tablet:hidden" aria-hidden="true" />}
            </>
          )}
        </Providers>
      </body>
    </html>
  );
}
