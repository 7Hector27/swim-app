import SiteFooter from "@/components/SiteFooter";
import SiteNav from "@/components/SiteNav";

import CoachBioSection from "./CoachBioSection";
import CtaBandSection from "./CtaBandSection";
import HeroSection from "./HeroSection";
import HowItWorksSection from "./HowItWorksSection";
import LeaderboardSection from "./LeaderboardSection";

export default function HomepageContent() {
  return (
    <>
      <SiteNav />
      <main id="main">
        <HeroSection />
        <HowItWorksSection />
        <LeaderboardSection />
        <CoachBioSection />
        <CtaBandSection />
      </main>
      <SiteFooter />
    </>
  );
}
