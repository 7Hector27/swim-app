import type { MeResponse } from "@swim-app/shared";

import SiteFooter from "@/components/SiteFooter";
import SiteNav from "@/components/SiteNav";

interface ParentDashboardContentProps {
  profile: MeResponse;
}

export default function ParentDashboardContent({ profile }: ParentDashboardContentProps) {
  const displayName = profile.fullName ?? "there";

  return (
    <div className="flex flex-col min-h-screen">
      <SiteNav />
      <main className="flex-1 px-page py-16">
        <div className="mx-auto max-w-sm flex flex-col gap-8">
          <h1 className="text-heading">Welcome, {displayName}</h1>

          <section>
            <h2 className="text-lg font-bold text-text mb-2">Your swimmers</h2>
            <p className="text-text-secondary">Your swimmers will appear here.</p>
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
