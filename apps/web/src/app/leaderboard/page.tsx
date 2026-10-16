import type { Metadata } from "next";

import LeaderboardLandingContent from "@/content/LeaderboardLandingContent";

export const metadata: Metadata = { title: "Leaderboards · Axiom Aquatics" };

export default function LeaderboardPage() {
  return <LeaderboardLandingContent />;
}
