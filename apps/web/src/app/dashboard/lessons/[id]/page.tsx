import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";

import type { LessonLocation, UpcomingLesson } from "@swim-app/shared";

import { requireAuth } from "@/lib/requireAuth";
import { fetchHousehold } from "@/lib/api/households";
import { fetchBatchCancelableLessons, fetchLesson, fetchLocations } from "@/lib/api/lessons";
import LessonDetailContent from "@/content/LessonDetailContent";

export const metadata: Metadata = {
  title: "Lesson Details · Axiom Aquatics",
};

export default async function LessonDetailPage({ params }: { params: Promise<{ id: string }> }) {
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

  // Household drives isViewer, which gates the Cancel and Reschedule
  // actions on this page. We can't claim the parent is an owner/manager
  // unless we actually read that back from the server — on load failure
  // (and on the no-household branch) default to viewer mode so we hide
  // actions we can't verify permission for. The API enforces the same
  // rule via requireHouseholdRole("manager") on DELETE/PATCH /lessons/:id,
  // so this is defense in depth: fail-safe client-side, hard-reject
  // server-side.
  const isViewer = !(
    householdResult.ok &&
    householdResult.household !== null &&
    (householdResult.household.myRole === "owner" ||
      householdResult.household.myRole === "manager")
  );
  const isCoach = auth.profile.role === "coach";

  // Locations are secondary — used for address/map-link display, fall back to
  // an empty list so the lesson detail still renders.
  const locations: LessonLocation[] = locationsResult.ok ? locationsResult.data : [];

  // When the lesson is part of a batch, load the exact set of lessons the
  // cancel-remaining DELETE endpoint would cancel so the confirm dialog
  // shows a 1:1 preview of what will be removed. Owners / managers only;
  // viewers and coaches never see the dialog. Secondary: on load failure,
  // the dialog hides (canCancelBatch becomes false because length ≤ 1).
  let batchSiblings: UpcomingLesson[] = [];
  if (lesson.batchId !== null && !isViewer && !isCoach) {
    const siblingsResult = await fetchBatchCancelableLessons(accessToken, lesson.batchId);
    if (siblingsResult.ok) batchSiblings = siblingsResult.data;
  }

  return (
    <LessonDetailContent
      lesson={lesson}
      locations={locations}
      isViewer={isViewer}
      isCoach={isCoach}
      batchSiblings={batchSiblings}
    />
  );
}
