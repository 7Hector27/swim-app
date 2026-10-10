import SiteFooter from "@/components/SiteFooter";
import SiteNav from "@/components/SiteNav";
import WaveDivider from "@/components/WaveDivider";

import CoachBioSection from "./CoachBioSection";
import CtaBandSection from "./CtaBandSection";
import FaqSection from "./FaqSection";
import HeroSection from "./HeroSection";
import HowItWorksSection from "./HowItWorksSection";
import LeaderboardSection from "./LeaderboardSection";

export default function HomepageContent() {
  return (
    <>
      <SiteNav />
      <main id="main">
        <HeroSection />
        <WaveDivider from="background" to="section" />
        <HowItWorksSection />
        <LeaderboardSection />
        <WaveDivider from="section" to="background" />
        <CoachBioSection />
        <FaqSection />
        <WaveDivider from="background" to="section" />
        <CtaBandSection />
      </main>
      <SiteFooter />
    </>
  );
}
