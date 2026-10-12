import { siteLinks } from "@/lib/siteLinks";
import ScrollReveal from "@/components/ScrollReveal";

import { COACH_BIO } from "./coachBioCopy";
import CoachPhotoDeck from "./CoachPhotoDeck";
import type { CoachPhoto } from "./CoachPhotoDeck";
import styles from "./CoachBioSection.module.css";

const coachPhotos: CoachPhoto[] = [
  { src: "/images/coach/Jason-1.jpg", alt: "[describe photo 1]" },
  { src: "/images/coach/Jason-2.jpg", alt: "[describe photo 2]" },
  { src: "/images/coach/Jason-3.jpg", alt: "[describe photo 3]" },
  { src: "/images/coach/Jason-4.jpg", alt: "[describe photo 4]" },
];

export default function CoachBioSection() {
  return (
    <section id="coach" className="scroll-mt-16 bg-background">
      <div className="mx-auto max-w-content px-page py-16 tablet:py-24">
        <div className={styles.layout}>
          <ScrollReveal delay={0} className={styles.deckColumn}>
            <CoachPhotoDeck photos={coachPhotos} />
          </ScrollReveal>

          <ScrollReveal delay={60} className={styles.contentColumn}>
            <p className="text-text leading-relaxed">
              {COACH_BIO.paragraphs[0]}
            </p>

            <p className="text-text-secondary leading-relaxed">
              {COACH_BIO.paragraphs[1]}
            </p>

            <div>
              <a
                href={siteLinks.booking ?? "/signup"}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm px-6 h-[52px] transition-opacity duration-200 hover:opacity-90 active:scale-[0.97]"
              >
                Book a lesson
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </div>
          </ScrollReveal>
        </div>
      </div>
    </section>
  );
}
