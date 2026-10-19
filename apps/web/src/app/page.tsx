import { fetchMe } from "@/lib/api/me";
import HomepageContent from "@/content/HomepageContent";
export default async function HomePage() {
  const me = await fetchMe();
  const isParent = me.ok && me.profile.role === "parent";
  return <HomepageContent isAuthenticatedParent={isParent} />;
}
