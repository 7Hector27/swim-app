"use client";

import { useSession } from "@/components/Providers";
import CoachNav from "@/components/CoachNav";
import ParentNav from "@/components/ParentNav";
import SiteNav from "@/components/SiteNav";

interface NavControllerProps {
  // Whether at least one public leaderboard qualifies today. When false,
  // every nav surface drops its "Leaderboards" link so the public never
  // lands on an empty board. Fetched at the root layout.
  hasAnyBoard: boolean;
}

export default function NavController({ hasAnyBoard }: NavControllerProps) {
  const { isSignedIn, role } = useSession();
  if (!isSignedIn) return <SiteNav />;
  if (role === "parent") return <ParentNav hasAnyBoard={hasAnyBoard} />;
  if (role === "coach") return <CoachNav hasAnyBoard={hasAnyBoard} />;
  return <SiteNav />;
}
