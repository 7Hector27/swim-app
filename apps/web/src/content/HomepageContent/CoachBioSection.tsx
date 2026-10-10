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
          <div className={styles.deckColumn}>
            <CoachPhotoDeck photos={coachPhotos} />
          </div>

          <div className={styles.contentColumn}>
            <h2 className={styles.pullQuote}>
              &ldquo;[Pull quote placeholder — a line from Jason about what
              makes swimming special or his coaching philosophy]&rdquo;
            </h2>

            <p className="text-text leading-relaxed">
              [Bio paragraph — background, certifications, coaching philosophy,
              and what makes this coaching program special]
            </p>

            <p className="text-text-secondary leading-relaxed">
              [Second bio paragraph — additional context about experience,
              achievements, or approach]
            </p>

            <div>
              <a
                href="/book"
                className="inline-flex items-center justify-center rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm px-6 h-[52px] transition-opacity duration-200 hover:opacity-90 active:scale-[0.97]"
              >
                Book a lesson
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
