export default function CtaBandSection() {
  return (
    <section className="bg-surface-soft">
      <div className="mx-auto max-w-content px-page py-16 tablet:py-24 text-center">
        <div className="flex flex-col items-center gap-6">
          <h2 className="text-heading max-w-xl">
            Ready to get in the water?
          </h2>
          <p className="text-text-secondary max-w-md">
            Create a parent account and book your first lesson.
          </p>
          <a
            href="/signup"
            className="inline-flex items-center justify-center rounded-button bg-button-primary-background text-button-primary-text font-bold px-8 h-[52px] transition-opacity duration-200 hover:opacity-90 active:scale-[0.97]"
          >
            Create an account
          </a>
        </div>
      </div>
    </section>
  );
}
