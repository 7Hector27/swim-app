import type { Metadata } from "next";

import LeaderboardLandingContent from "@/content/LeaderboardLandingContent";
import { fetchLeaderboardSummary } from "@/lib/api/leaderboard";

export const metadata: Metadata = { title: "Leaderboards · Axiom Aquatics" };

export default async function LeaderboardPage() {
  const summary = await fetchLeaderboardSummary();
  return <LeaderboardLandingContent qualifying={summary?.qualifying ?? []} />;
}
