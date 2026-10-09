import type { MeResponse } from "@swim-app/shared";

import SiteFooter from "@/components/SiteFooter";
import SiteNav from "@/components/SiteNav";
import { createClient } from "@/lib/supabase/server";

interface CoachDashboardContentProps {
  profile: MeResponse;
}

export default async function CoachDashboardContent({ profile: _profile }: CoachDashboardContentProps) {
  const supabase = await createClient();
  // getSession is called only to extract the raw access token for forwarding to
  // the API. The API's requireUser middleware verifies the token independently.
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  let pingOk = false;
  if (token) {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/ping`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      pingOk = response.ok;
    } catch {
      // ping failed
    }
  }

  return (
    <div className="flex flex-col min-h-screen">
      <SiteNav />
      <main className="flex-1 px-page py-16">
        <div className="mx-auto max-w-content">
          <h1 className="text-heading mb-4">Coach dashboard</h1>
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
