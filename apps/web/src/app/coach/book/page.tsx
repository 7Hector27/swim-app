import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/requireAuth";
import { fetchCoachHouseholds, fetchCoachLocations } from "@/lib/api/coachBooking";
import { fetchAvailabilityConfig } from "@/lib/api/coachAvailability";
import CoachBookLessonContent from "@/content/CoachBookLessonContent";
import { computeInitialSwimmerIds } from "@/content/CoachBookLessonContent/helpers";

// Fallback used when the config fetch fails. Matches the current prod
// default; the UI only uses the number to render warning copy, so a stale
// fallback here is a UI-only drift (the server authoritative check still
// uses the live config).
const DEFAULT_BOOKING_MAX_ADVANCE_WEEKS = 10;

export const dynamic = "force-dynamic";

interface SearchParams {
  household?: string;
  swimmer?: string;
}

interface Props {
  searchParams: Promise<SearchParams>;
}

export default async function CoachBookPage({ searchParams }: Props) {
  const auth = await requireAuth();
  if (!auth) return null;

  // Coach-only entry point. Non-coach users bounce to their dashboard.
  if (auth.profile.role !== "coach") {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const [coachLocationsResult, prefilledResult, availabilityConfigResult] = await Promise.all([
    fetchCoachLocations(auth.accessToken),
    params.household
      ? fetchCoachHouseholds(auth.accessToken, { householdId: params.household })
      : Promise.resolve(null),
    fetchAvailabilityConfig(auth.accessToken),
  ]);
  // Write page — the coach picks a pool and a household here. Throw on load
  // failure so the route error boundary renders instead of a form that can't
  // submit.
  if (!coachLocationsResult.ok) {
    throw new Error(`Failed to load pools (${coachLocationsResult.reason})`);
  }
  // Prefilled household lookup is optional (only runs when ?household= is
  // present). If the lookup 5xx'd, throw so the route error boundary renders
  // — a silent fall-through would send the coach into an empty picker and
  // look like "household not found" when the server is actually broken.
  if (prefilledResult !== null && !prefilledResult.ok) {
    throw new Error(`Failed to load household (${prefilledResult.reason})`);
  }
  const prefilled = prefilledResult === null ? null : prefilledResult.data;
  // Config is a secondary read — the booking page only uses one number from
  // it for warning copy; the server does the authoritative check at submit.
  // Fall back to the hardcoded default on any load failure.
  const bookingMaxAdvanceWeeks = availabilityConfigResult.ok
    ? availabilityConfigResult.data.bookingMaxAdvanceWeeks
    : DEFAULT_BOOKING_MAX_ADVANCE_WEEKS;

  const initialHousehold = prefilled?.[0] ?? null;
  const initialSwimmerIds = computeInitialSwimmerIds(initialHousehold, params.swimmer);

  // /coach/locations returns every named pool (including deactivated ones).
  // Drop inactive pools here — the coach's availability editor hides them
  // from the booking flow once set inactive.
  const namedPools = coachLocationsResult.data.filter((pool) => pool.isActive);

  return (
    <div className="flex flex-col flex-1 bg-background">
      <main id="main-content" className="flex-1">
        <div className="mx-auto max-w-content px-page pt-8 pb-20 tablet:pt-12 tablet:pb-32">
          <CoachBookLessonContent
            initialHousehold={initialHousehold}
            initialSwimmerIds={initialSwimmerIds}
            namedPools={namedPools}
            bookingMaxAdvanceWeeks={bookingMaxAdvanceWeeks}
          />
        </div>
      </main>
    </div>
  );
}
