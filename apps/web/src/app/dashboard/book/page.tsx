import type { Metadata } from "next";
import { redirect } from "next/navigation";

import BookLessonContent from "@/content/BookLessonContent";
import SiteNav from "@/components/SiteNav";
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

  const [household, locations, swimmers] = await Promise.all([
    fetchHousehold(accessToken),
    fetchLocations(accessToken),
    fetchSwimmers(accessToken),
  ]);

  const isViewer = household?.myRole === "viewer";

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <SiteNav />
      <main id="main-content" className="flex-1">
        <div className="mx-auto max-w-content px-page pt-10 pb-20 tablet:pt-14 tablet:pb-32">
          <BookLessonContent
            locations={locations}
            swimmers={swimmers}
            isViewer={isViewer}
          />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
