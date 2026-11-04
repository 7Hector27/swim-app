import { fetchHousehold } from "@/lib/api/households";
import { fetchMe } from "@/lib/api/me";
import HomepageContent from "@/content/HomepageContent";
import type { CtaVariant } from "@/content/HomepageContent/CtaBandSection";

export default async function HomePage() {
  const me = await fetchMe();
  const isParent = me.ok && me.profile.role === "parent";

  let ctaVariant: CtaVariant = "signed-out";
  if (me.ok) {
    if (me.profile.role === "coach") {
      ctaVariant = "coach";
    } else if (me.profile.role === "parent") {
      // fetchHousehold is memoized with React cache(); the root layout already
      // fetches it for parents, so this is a no-op second call that reuses the
      // same result. The homepage was already dynamic (reads session cookies),
      // so this does not change caching posture.
      const householdResult = await fetchHousehold(me.accessToken);
      // Fail-safe — same pattern as /dashboard, /dashboard/lessons/[id], and
      // the parent layout. We only render the `parent-active` CTA (which
      // links to Book) when we've confirmed an owner/manager role from the
      // server. Load failure, null household, or a viewer role all fall
      // through to the `parent-viewer` CTA, so a transient outage never
      // surfaces a Book link we can't honor.
      const canBook =
        householdResult.ok &&
        householdResult.household !== null &&
        (householdResult.household.myRole === "owner" ||
          householdResult.household.myRole === "manager");
      ctaVariant = canBook ? "parent-active" : "parent-viewer";
    }
  }

  return <HomepageContent isAuthenticatedParent={isParent} ctaVariant={ctaVariant} />;
}
