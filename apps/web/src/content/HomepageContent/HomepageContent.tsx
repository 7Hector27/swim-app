import WaveDivider from "@/components/WaveDivider";

import CoachBioSection from "./CoachBioSection";
import CtaBandSection, { type CtaVariant } from "./CtaBandSection";
import FaqSection from "./FaqSection";
import HeroSection from "./HeroSection";
import HowItWorksSection from "./HowItWorksSection";
import LeaderboardSection from "./LeaderboardSection";

interface Props {
  isAuthenticatedParent: boolean;
  ctaVariant: CtaVariant;
}

export default function HomepageContent({ isAuthenticatedParent, ctaVariant }: Props) {
  return (
    <>
      <main id="main">
        <HeroSection isAuthenticatedParent={isAuthenticatedParent} />
        <WaveDivider from="background" to="section" />
        <HowItWorksSection />
        <LeaderboardSection />
        <WaveDivider from="section" to="background" />
        <CoachBioSection />
        <FaqSection />
        <WaveDivider from="background" to="section" />
        <CtaBandSection variant={ctaVariant} />
      </main>
    </>
  );
}
