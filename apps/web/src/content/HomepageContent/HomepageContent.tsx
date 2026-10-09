import SiteFooter from "@/components/SiteFooter";
import SiteNav from "@/components/SiteNav";
import WaveDivider from "@/components/WaveDivider";

import CtaBandSection from "./CtaBandSection";
import CoachBioSection from "./CoachBioSection";
import FaqSection from "./FaqSection";
import HeroSection from "./HeroSection";
import HowItWorksSection from "./HowItWorksSection";
import LeaderboardSection from "./LeaderboardSection";
import LessonsSection from "./LessonsSection";
import TestimonialsSection from "./TestimonialsSection";

export default function HomepageContent() {
  return (
    <>
      <SiteNav />
      <main>
        <HeroSection />
        <WaveDivider from="section" to="background" />
        <LessonsSection />
        <WaveDivider from="background" to="section" />
        <HowItWorksSection />
        <WaveDivider from="section" to="background" />
        <LeaderboardSection />
        <WaveDivider from="background" to="surface-soft" />
        <CoachBioSection />
        <WaveDivider from="surface-soft" to="background" />
        <TestimonialsSection />
        <WaveDivider from="background" to="surface-soft" />
        <FaqSection />
        <WaveDivider from="surface-soft" to="section" />
        <CtaBandSection />
        <WaveDivider from="section" to="background" />
      </main>
      <SiteFooter />
    </>
  );
}
