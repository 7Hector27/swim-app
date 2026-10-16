import type { Metadata } from "next";

import ClubBoardContent from "@/content/ClubBoardContent";
import { fetchClubBoard } from "@/lib/api/leaderboard";

export const metadata: Metadata = { title: "Club Leaderboard · Axiom Aquatics" };

export default async function ClubBoardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const rawParams = await searchParams;
  const params: Record<string, string | undefined> = Object.fromEntries(
    Object.entries(rawParams).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  );
  const data = await fetchClubBoard(params);
  return <ClubBoardContent rows={data?.rows ?? []} loadFailed={data === null} />;
}
