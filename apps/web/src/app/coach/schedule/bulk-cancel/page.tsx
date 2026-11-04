import { redirect } from "next/navigation";
import { todayLA } from "@swim-app/shared";
import { requireAuth } from "@/lib/requireAuth";
import { fetchCoachLocations } from "@/lib/api/coachBooking";
import CoachBulkCancelContent from "@/content/CoachBulkCancelContent";

export const dynamic = "force-dynamic";

interface SearchParams {
  startDate?: string;
  endDate?: string;
  locationId?: string;
}

interface Props {
  searchParams: Promise<SearchParams>;
}

export default async function CoachBulkCancelPage({ searchParams }: Props) {
  const auth = await requireAuth();
  if (!auth) return null;
  if (auth.profile.role !== "coach") redirect("/dashboard");

  const params = await searchParams;
  const today = todayLA();
  // Clamp any URL-supplied dates to today-or-later. The input itself also
  // enforces min={today}, this keeps the first paint consistent.
  const requestedStart = isValidLaDate(params.startDate) ? params.startDate! : today;
  const requestedEnd = isValidLaDate(params.endDate) ? params.endDate! : requestedStart;
  const initialStartDate = requestedStart < today ? today : requestedStart;
  const initialEndDate =
    requestedEnd < initialStartDate ? initialStartDate : requestedEnd;
  const initialLocationId = isValidUuid(params.locationId) ? params.locationId! : null;

  // Write page — the coach picks a pool to bulk-cancel. Throw on load failure
  // so the route error boundary renders instead of a form with no choices.
  const coachLocationsResult = await fetchCoachLocations(auth.accessToken);
  if (!coachLocationsResult.ok) {
    throw new Error(`Failed to load pools (${coachLocationsResult.reason})`);
  }
  const namedPools = coachLocationsResult.data.filter((pool) => pool.isActive);

  return (
    <div className="flex flex-col flex-1 bg-background">
      <main id="main-content" className="flex-1">
        <div className="mx-auto max-w-content px-page pt-8 pb-20 tablet:pt-12 tablet:pb-32">
          <CoachBulkCancelContent
            accessToken={auth.accessToken}
            namedPools={namedPools}
            today={today}
            initialStartDate={initialStartDate}
            initialEndDate={initialEndDate}
            initialLocationId={initialLocationId}
          />
        </div>
      </main>
    </div>
  );
}

function isValidLaDate(value: string | undefined): boolean {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidUuid(value: string | undefined): boolean {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
}
