const steps = [
  {
    numeral: "1",
    title: "Create a parent account",
    description:
      "Parents sign up and manage everything in one place. Swimmers 18 and over can sign up on their own.",
  },
  {
    numeral: "2",
    title: "Add your swimmers",
    description:
      "Add as many kids as you need. Teens can get their own login through your invite.",
  },
  {
    numeral: "3",
    title: "Book a private lesson",
    description:
      "Pick an open time on Jason's schedule. Every lesson is one on one.",
  },
];

export default function HowItWorksSection() {
  return (
    <section id="lessons" className="scroll-mt-16 bg-section">
      <div className="mx-auto max-w-content px-page py-16 tablet:py-24">
        <h2 className="text-text-on-section mb-10 tablet:mb-14">
          How lessons work
        </h2>

        <div className="grid gap-10 tablet:grid-cols-3 tablet:gap-8">
          {steps.map((step) => (
            <div key={step.numeral} className="flex flex-col gap-4">
              <span
                className="font-heading font-bold text-5xl leading-none tracking-[0.01em] text-accent-on-section"
                aria-hidden="true"
              >
                {step.numeral}
              </span>
              <h3 className="text-text-on-section text-lg font-bold font-body">
                {step.title}
              </h3>
              <p className="text-text-secondary-on-section text-sm leading-relaxed">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
