const steps = [
  {
    number: "01",
    title: "[Step title]",
    description: "[Brief description of this step in the process]",
  },
  {
    number: "02",
    title: "[Step title]",
    description: "[Brief description of this step in the process]",
  },
  {
    number: "03",
    title: "[Step title]",
    description: "[Brief description of this step in the process]",
  },
  {
    number: "04",
    title: "[Step title]",
    description: "[Brief description of this step in the process]",
  },
];

export default function HowItWorksSection() {
  return (
    <section className="bg-section">
      <div className="mx-auto max-w-content px-page py-16 tablet:py-24">
        <div className="flex flex-col gap-3 mb-10 tablet:mb-14">
          <p className="text-eyebrow text-accent font-bold uppercase tracking-[0.08em]">
            How It Works
          </p>
          <h2 className="text-text-on-section">
            [How it works heading]
          </h2>
        </div>

        <div className="grid gap-8 tablet:grid-cols-2 desktop:grid-cols-4">
          {steps.map((step) => (
            <div key={step.number} className="flex flex-col gap-3">
              <span className="text-accent font-heading font-extrabold italic text-5xl leading-none font-stretch-expanded">
                {step.number}
              </span>
              <h3 className="text-text-on-section text-lg font-bold">
                {step.title}
              </h3>
              <p className="text-text-secondary-on-section text-sm">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
