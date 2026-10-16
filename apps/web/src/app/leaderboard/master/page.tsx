import type { Metadata } from "next";

import MasterBoardContent from "@/content/MasterBoardContent";
import { fetchMasterBoard } from "@/lib/api/leaderboard";

export const metadata: Metadata = { title: "Master Leaderboard · Axiom Aquatics" };

export default async function MasterBoardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const rawParams = await searchParams;
  const params: Record<string, string | undefined> = Object.fromEntries(
    Object.entries(rawParams).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  );
  const data = await fetchMasterBoard(params);
  return (
    <MasterBoardContent
      standardsAvailable={data?.standardsAvailable ?? false}
      rows={data?.rows ?? []}
      loadFailed={data === null}
    />
  );
}
