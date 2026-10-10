import CoachPhotoDeck from "./CoachPhotoDeck";
import type { CoachPhoto } from "./CoachPhotoDeck";

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
        <h2 className="text-heading mb-10 tablet:mb-14">Meet Coach Jason</h2>

        <div className="flex flex-col gap-10 tablet:flex-row tablet:gap-16 tablet:items-start">
          {/* Photo deck */}
          <div className="flex-shrink-0 flex justify-center tablet:block">
            <CoachPhotoDeck photos={coachPhotos} />
          </div>

          {/* Bio */}
          <div className="flex flex-col gap-6 flex-1">
            <p className="text-text leading-relaxed">
              [Bio paragraph — background, certifications, coaching philosophy, and what makes this coaching program special]
            </p>
            <p className="text-text-secondary leading-relaxed">
              [Second bio paragraph — additional context about experience, achievements, or approach]
            </p>
            <div className="mt-2">
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
