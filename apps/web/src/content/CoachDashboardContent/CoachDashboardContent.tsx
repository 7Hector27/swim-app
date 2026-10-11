import type { MeResponse } from "@swim-app/shared";

import SiteFooter from "@/components/SiteFooter";
import SiteNav from "@/components/SiteNav";
import { fetchCoachSwimmers } from "@/lib/api/coachSwimmers";

interface CoachDashboardContentProps {
  profile: MeResponse;
  accessToken: string;
}

export default async function CoachDashboardContent({ profile, accessToken }: CoachDashboardContentProps) {
  const displayName = profile.fullName ?? "Coach";

  const swimmers = await fetchCoachSwimmers(accessToken);

  return (
    <div className="flex flex-col min-h-screen">
      <SiteNav />
      <main className="flex-1 px-page py-16">
        <div className="mx-auto max-w-content flex flex-col gap-8">
          <h1 className="text-heading">Welcome, {displayName}</h1>

          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-heading">Swimmers</h2>
              <a
                href="/coach/swimmers"
                className="inline-flex items-center justify-center rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm px-5 min-h-[44px] transition-opacity hover:opacity-90 active:scale-[0.97]"
              >
                View all
              </a>
            </div>
            <p className="text-text-secondary text-sm">
              {swimmers.length === 0
                ? "No active swimmers."
                : `${swimmers.length} active swimmer${swimmers.length === 1 ? "" : "s"}`}
            </p>
          </section>

          <p className="text-sm text-text-secondary">
            <a href="/account" className="text-link underline hover:text-link-hover">
              Account settings
            </a>
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
