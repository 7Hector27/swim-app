import type { Metadata } from "next";

import ISLBoardContent from "@/content/ISLBoardContent";
import { fetchISLBoard } from "@/lib/api/leaderboard";

export const metadata: Metadata = { title: "ISL Leaderboard · Axiom Aquatics" };

export default async function ISLBoardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const rawParams = await searchParams;
  const params: Record<string, string | undefined> = Object.fromEntries(
    Object.entries(rawParams).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  );
  const data = await fetchISLBoard(params);
  return <ISLBoardContent rows={data?.rows ?? []} />;
}
