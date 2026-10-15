"use client";

import { useSession } from "@/components/Providers";
import CoachNav from "@/components/CoachNav";
import ParentNav from "@/components/ParentNav";
import SiteNav from "@/components/SiteNav";

export default function NavController() {
  const { isSignedIn, role } = useSession();
  if (!isSignedIn) return <SiteNav />;
  if (role === "parent") return <ParentNav />;
  if (role === "coach") return <CoachNav />;
  return <SiteNav />;
}
