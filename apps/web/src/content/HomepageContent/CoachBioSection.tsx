export default function CoachBioSection() {
  return (
    <section className="bg-surface-soft">
      <div className="mx-auto max-w-content px-page py-16 tablet:py-24">
        <div className="flex flex-col gap-12 tablet:flex-row tablet:gap-16 tablet:items-start">
          <div className="flex flex-col gap-6 tablet:flex-1 tablet:sticky tablet:top-24">
            <div className="flex flex-col gap-3">
              <p className="text-eyebrow text-accent font-bold uppercase tracking-[0.08em]">
                Meet the Coach
              </p>
              <h2 className="text-heading">
                [Coach name]
              </h2>
            </div>

            <div className="aspect-[3/4] rounded-media border-2 border-dashed border-placeholder-border bg-surface-soft flex items-center justify-center text-text-secondary text-sm w-full tablet:max-w-xs">
              [Coach photo]
            </div>
          </div>

          <div className="flex flex-col gap-4 tablet:flex-1">
            <p className="text-text leading-relaxed">[Bio paragraph — background, certifications, coaching philosophy, and what makes this coaching program special]</p>
            <p className="text-text-secondary leading-relaxed">[Second bio paragraph — additional context about experience, achievements, or approach]</p>
            <div className="mt-4">
              <a
                href="/about"
                className="inline-flex items-center justify-center rounded-pill bg-button-primary-background text-button-primary-text font-bold text-sm px-6 h-[44px] transition-colors duration-200 active:scale-97"
              >
                Learn more
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
