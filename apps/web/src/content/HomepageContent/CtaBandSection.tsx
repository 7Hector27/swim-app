export default function CtaBandSection() {
  return (
    <section className="bg-section">
      <div className="mx-auto max-w-content px-page py-16 tablet:py-24 text-center">
        <div className="flex flex-col items-center gap-6">
          <h2 className="text-text-on-section max-w-xl">
            [Ready to swim?]
          </h2>
          <p className="text-text-secondary-on-section max-w-md">
            [CTA subtext — brief motivating sentence]
          </p>
          <a
            href="/book"
            className="inline-flex items-center justify-center rounded-pill bg-accent text-on-accent font-bold px-8 h-[52px] transition-colors duration-200 active:scale-97"
          >
            Book a lesson
          </a>
        </div>
      </div>
    </section>
  );
}
