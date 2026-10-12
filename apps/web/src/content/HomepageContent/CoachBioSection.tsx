"use client";

import { useEffect, useRef } from "react";

import { siteLinks } from "@/lib/siteLinks";

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
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          section.dataset.visible = "true";
          observer.disconnect();
        }
      },
      { rootMargin: "-100px" },
    );

    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  return (
    <section id="coach" ref={sectionRef} className="scroll-mt-16 bg-background">
      <div className="mx-auto max-w-content px-page py-16 tablet:py-24">
        <div className={styles.layout}>
          <div className={styles.deckColumn}>
            <CoachPhotoDeck photos={coachPhotos} />
          </div>

          <div className={styles.contentColumn}>
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
          </div>
        </div>
      </div>
    </section>
  );
}
