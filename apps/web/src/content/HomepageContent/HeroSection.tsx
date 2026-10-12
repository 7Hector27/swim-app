import { siteLinks } from "@/lib/siteLinks";

import HeroBubbleBg from "./HeroBubbleBg";
import styles from "./HeroSection.module.css";

const SHOW_HERO_PHOTO = false;

export default function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-background">
      <HeroBubbleBg />
      <div className="relative mx-auto max-w-content px-page pt-20 pb-20 tablet:pt-28 tablet:pb-28 desktop:pt-36 desktop:pb-36">
        <div
          className={
            SHOW_HERO_PHOTO
              ? "flex flex-col desktop:flex-row desktop:items-center desktop:gap-16"
              : "mx-auto max-w-2xl flex flex-col items-center text-center"
          }
        >
          <div
            className={[
              "flex flex-col gap-5",
              SHOW_HERO_PHOTO ? "desktop:flex-1" : "",
            ].join(" ")}
          >
            <p
              className={`text-accent font-semibold text-sm tracking-wide uppercase ${styles.eyebrow}`}
            >
              Private swim lessons in Irvine
            </p>
            <h1 className={`text-heading ${styles.heading}`}>
              Every skill rated. Every swimmer progressing.
            </h1>
            <p
              className={`text-text-secondary text-base tablet:text-lg max-w-lg ${SHOW_HERO_PHOTO ? "" : "mx-auto"} ${styles.body}`}
            >
              Coach Jason comes to your pool and works one on one with your
              child. He rates every skill from 1 to 5, so you always know what
              has been mastered and what comes next.
            </p>
            <div
              className={[
                "flex flex-col tablet:flex-row gap-3 mt-1 w-full tablet:w-auto",
                SHOW_HERO_PHOTO ? "" : "justify-center",
                styles.ctas,
              ].join(" ")}
            >
              <a
                href={siteLinks.booking}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-button bg-button-primary-background text-button-primary-text font-bold px-8 h-[52px] w-full tablet:w-auto transition-[transform,opacity] duration-150 hover:opacity-90 active:scale-[0.97]"
              >
                Book a lesson
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
              <a
                href="#faq"
                className="inline-flex items-center justify-center rounded-button border-2 border-button-outline text-button-outline font-bold px-8 h-[52px] w-full tablet:w-auto transition-[transform,opacity] duration-150 hover:opacity-75 active:scale-[0.97]"
              >
                See pricing
              </a>
            </div>
            <div
              className={[
                "flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-secondary",
                SHOW_HERO_PHOTO ? "" : "justify-center",
                styles.trustLine,
              ].join(" ")}
            >
              <span>9 years coaching</span>
              <span aria-hidden="true">·</span>
              <span>Head coach, Stonegate Seahawks</span>
              <span aria-hidden="true">·</span>
              <span>Beginners to competitive</span>
            </div>
          </div>
          {SHOW_HERO_PHOTO && (
            <div
              className={`mt-10 desktop:mt-0 w-full desktop:w-[340px] desktop:flex-shrink-0 ${styles.photoSlot}`}
            >
              <div className="aspect-[3/4] rounded-media bg-surface-soft border-2 border-dashed border-placeholder-border flex items-center justify-center">
                <span className="text-text-secondary text-sm text-center px-4">
                  [Underwater action shot]
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
