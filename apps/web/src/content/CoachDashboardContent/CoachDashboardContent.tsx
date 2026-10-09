import type { MeResponse } from "@swim-app/shared";

import SiteFooter from "@/components/SiteFooter";
import SiteNav from "@/components/SiteNav";

interface CoachDashboardContentProps {
  profile: MeResponse;
  accessToken: string;
}

export default async function CoachDashboardContent({ profile, accessToken }: CoachDashboardContentProps) {
  const displayName = profile.fullName ?? "Coach";

  let pingOk = false;
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/ping`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    pingOk = response.ok;
  } catch {
    // ping failed
  }

  return (
    <div className="flex flex-col min-h-screen">
      <SiteNav />
      <main className="flex-1 px-page py-16">
        <div className="mx-auto max-w-content">
          <h1 className="text-heading mb-4">Welcome, {displayName}</h1>
          <p className="text-text-secondary">
            {pingOk
              ? "Coach area active. Swimmer management coming soon."
              : "Could not reach the API. Please try again."}
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
