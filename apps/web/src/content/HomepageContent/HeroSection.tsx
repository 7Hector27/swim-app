import styles from "./HeroSection.module.css";
import RippleAnimation from "./RippleAnimation";

export default function HeroSection() {
  return (
    <section className="bg-background">
      <div className="mx-auto max-w-content px-page pt-16 pb-0 tablet:pt-24 desktop:pt-32">
        <div className="flex flex-col gap-12 desktop:flex-row desktop:items-start desktop:gap-16">
          {/* Left: copy + CTAs */}
          <div className="flex flex-col gap-6 desktop:flex-1">
            <h1 className={`text-heading ${styles.heading}`}>
              Private swim lessons, one swimmer at a time.
            </h1>
            <p className={`text-text-secondary text-base tablet:text-lg max-w-lg ${styles.body}`}>
              Coach Jason teaches every lesson himself, one on one. Swimmers
              learning to float and club swimmers chasing a best time get the
              same full attention.
            </p>
            <div className={`flex flex-col gap-3 tablet:flex-row tablet:gap-4 mt-2 ${styles.ctas}`}>
              <a
                href="/signup"
                className="inline-flex items-center justify-center rounded-button bg-button-primary-background text-button-primary-text font-bold px-8 h-[52px] transition-opacity duration-200 hover:opacity-90 active:scale-[0.97]"
              >
                Create an account
              </a>
              <a
                href="/leaderboard"
                className="inline-flex items-center justify-center rounded-button border-2 border-button-outline text-button-outline font-bold px-8 h-[52px] transition-opacity duration-200 hover:opacity-70 active:scale-[0.97]"
              >
                See the leaderboards
              </a>
            </div>
          </div>

          {/* Right: photo placeholder */}
          <div className={`desktop:w-80 desktop:flex-shrink-0 ${styles.photo}`}>
            <div
              className="w-full rounded-card bg-surface-soft border-2 border-dashed border-placeholder-border flex items-center justify-center text-text-secondary text-sm"
              style={{ aspectRatio: "3/4" }}
            >
              [Coach Jason in the pool]
            </div>
          </div>
        </div>
      </div>

      {/* Ripple band — full-width below the content grid */}
      <div className="mt-10 tablet:mt-14 desktop:mt-16 px-page pb-10 tablet:pb-14 desktop:pb-16">
        <RippleAnimation />
      </div>
    </section>
  );
}
