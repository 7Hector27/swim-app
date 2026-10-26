import type { Metadata } from "next";
import { redirect } from "next/navigation";

import BookCalendarContent from "@/content/BookCalendarContent";
import { requireAuth } from "@/lib/requireAuth";
import { fetchHousehold } from "@/lib/api/households";
import { fetchLocations } from "@/lib/api/lessons";
import { fetchSwimmers } from "@/lib/api/swimmers";

export const metadata: Metadata = { title: "Book a lesson · Axiom Aquatics" };

export default async function BookPage(props: {
  searchParams: Promise<Record<string, string>>;
}) {
  const searchParams = await props.searchParams;
  const initialView =
    searchParams["view"] === "month" ? ("month" as const) : ("week" as const);
  const initialDate = /^\d{4}-\d{2}-\d{2}$/.test(searchParams["date"] ?? "")
    ? searchParams["date"]
    : undefined;

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
  const householdId = householdFailed ? null : household.id;
  const locations = rawLocations.map(({ id, name, isHomePool }) => ({ id, name, isHomePool }));

  return (
    <div className="flex flex-col flex-1 bg-background">
      <main id="main-content" className="flex-1">
        <div className="mx-auto max-w-content px-page pt-10 pb-tab-safe tablet:pt-14 tablet:pb-32">
          <BookCalendarContent
            householdId={householdId}
            locations={locations}
            swimmers={swimmers}
            isViewer={isViewer}
            householdFailed={householdFailed}
            initialView={initialView}
            {...(initialDate !== undefined && { initialDate })}
          />
        </div>
      </main>
    </div>
  );
}
