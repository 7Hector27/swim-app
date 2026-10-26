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
      const household = await fetchHousehold(me.accessToken);
      ctaVariant = household?.myRole === "viewer" ? "parent-viewer" : "parent-active";
    }
  }

  return <HomepageContent isAuthenticatedParent={isParent} ctaVariant={ctaVariant} />;
}
