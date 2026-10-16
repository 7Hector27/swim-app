import type { Metadata } from "next";
import { redirect } from "next/navigation";

import BookCalendarContent from "@/content/BookCalendarContent";
import SiteFooter from "@/components/SiteFooter";
import { requireAuth } from "@/lib/requireAuth";
import { fetchHousehold } from "@/lib/api/households";
import { fetchLocations } from "@/lib/api/lessons";
import { fetchSwimmers } from "@/lib/api/swimmers";

export const metadata: Metadata = { title: "Book a lesson · Axiom Aquatics" };

export default async function BookPage() {
  const auth = await requireAuth();
  if (!auth) redirect("/login");
  const { profile, accessToken } = auth;
  if (profile.role !== "parent") redirect("/dashboard");

  const [household, rawLocations, swimmers] = await Promise.all([
    fetchHousehold(accessToken),
    fetchLocations(accessToken),
    fetchSwimmers(accessToken),
  ]);

  const householdFailed = household === null;
  const isViewer = !householdFailed && household.myRole === "viewer";
  const locations = rawLocations.map(({ id, name, isHomePool }) => ({ id, name, isHomePool }));

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <main id="main-content" className="flex-1">
        <div className="mx-auto max-w-content px-page pt-10 pb-20 tablet:pt-14 tablet:pb-32">
          <BookCalendarContent
            locations={locations}
            swimmers={swimmers}
            isViewer={isViewer}
            householdFailed={householdFailed}
          />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
