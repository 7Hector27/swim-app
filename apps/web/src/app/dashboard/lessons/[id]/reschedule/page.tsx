import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";

import { requireAuth } from "@/lib/requireAuth";
import { fetchHousehold } from "@/lib/api/households";
import { fetchLesson, fetchLocations } from "@/lib/api/lessons";
import RescheduleContent from "@/content/RescheduleContent";

export const metadata: Metadata = {
  title: "Reschedule · Axiom Aquatics",
};

export default async function ReschedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAuth();
  if (!auth) redirect("/login");
  const { accessToken } = auth;

  const [lessonResult, locationsResult, householdResult] = await Promise.all([
    fetchLesson(accessToken, id),
    fetchLocations(accessToken),
    fetchHousehold(accessToken),
  ]);

  if (!lessonResult.ok) {
    if (lessonResult.status === 404) notFound();
    throw new Error(`Failed to load lesson (status ${lessonResult.status})`);
  }
  const lesson = lessonResult.lesson;

  // Write page — the reschedule form needs the pools list AND the viewer
  // flag (viewers can't reschedule). Throw on either load failure so the
  // route error boundary renders instead of a form the user can't submit
  // or a redirect that silently takes them back.
  if (!locationsResult.ok) {
    throw new Error(`Failed to load locations (${locationsResult.reason})`);
  }
  if (!householdResult.ok) {
    throw new Error(`Failed to load household (status ${householdResult.status})`);
  }

  // Fail-safe viewer check — same pattern as /dashboard, /dashboard/lessons/[id],
  // and the parent layout. Null household (unenrolled parent) must not render
  // the reschedule form; only a confirmed owner/manager role proceeds. The
  // API also enforces this via requireHouseholdRole("manager") on PATCH.
  const isViewer = !(
    householdResult.household?.myRole === "owner" ||
    householdResult.household?.myRole === "manager"
  );
  const lessonHasStarted = new Date() >= new Date(lesson.startsAt);

  if (isViewer || lessonHasStarted) redirect(`/dashboard/lessons/${id}`);

  return (
    <div className="flex flex-col flex-1 bg-background">
      <main id="main-content" className="flex-1">
        <div className="mx-auto max-w-content px-page pt-10 pb-tab-safe tablet:pt-14 tablet:pb-32">
          <RescheduleContent lesson={lesson} locations={locationsResult.data} />
        </div>
      </main>
    </div>
  );
}
