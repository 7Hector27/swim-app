import HeroWaterBg from "./HeroWaterBg";

export default function HeroSection() {
  return (
    <section className="relative bg-section overflow-hidden">
      <HeroWaterBg />
      <div className="relative z-10 mx-auto max-w-content px-page py-20 tablet:py-28 desktop:py-36">
        <div className="max-w-2xl flex flex-col gap-6">
          <p
            className="text-accent font-bold uppercase tracking-[0.08em]"
            style={{ fontSize: "0.8125rem" }}
          >
            Private Swim Coaching
          </p>
          <h1
            className="text-text-on-section"
            style={{
              fontSize: "clamp(2.5rem, 1.64rem + 3.67vw, 4.5rem)",
            }}
          >
            [Hero heading — one strong line]
          </h1>
          <p className="text-text-secondary-on-section text-base tablet:text-lg max-w-lg">
            [Hero subtext — a sentence or two about the coaching program]
          </p>
          <div className="flex flex-col gap-3 tablet:flex-row tablet:gap-4 mt-2">
            <a
              href="/book"
              className="inline-flex items-center justify-center rounded-pill bg-accent text-on-accent font-bold px-8 h-[52px] transition-colors duration-200 active:scale-97"
            >
              Book a lesson
            </a>
            <a
              href="/lessons"
              className="inline-flex items-center justify-center rounded-pill border-2 border-button-outline text-button-outline font-bold px-8 h-[52px] transition-colors duration-200 active:scale-97"
              style={{ borderColor: "var(--color-text-on-section)", color: "var(--color-text-on-section)" }}
            >
              See lessons
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
