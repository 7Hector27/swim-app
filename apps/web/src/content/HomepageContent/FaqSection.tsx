const faqs = [
  {
    question: "[Question]",
    answer: "[Answer — a clear, helpful response to this frequently asked question]",
  },
  {
    question: "[Question]",
    answer: "[Answer — a clear, helpful response to this frequently asked question]",
  },
  {
    question: "[Question]",
    answer: "[Answer — a clear, helpful response to this frequently asked question]",
  },
  {
    question: "[Question]",
    answer: "[Answer — a clear, helpful response to this frequently asked question]",
  },
  {
    question: "[Question]",
    answer: "[Answer — a clear, helpful response to this frequently asked question]",
  },
];

export default function FaqSection() {
  return (
    <section className="bg-surface-soft">
      <div className="mx-auto max-w-content px-page py-16 tablet:py-24">
        <div className="flex flex-col gap-0 tablet:flex-row tablet:gap-16">
          <div className="flex flex-col gap-3 mb-10 tablet:mb-0 tablet:w-72 tablet:sticky tablet:top-24 tablet:self-start">
            <p
              className="text-accent font-bold uppercase tracking-[0.08em]"
              style={{ fontSize: "0.8125rem" }}
            >
              FAQ
            </p>
            <h2
              className="text-heading"
              style={{ fontSize: "clamp(2rem, 1.68rem + 1.37vw, 2.75rem)" }}
            >
              [Frequently asked questions]
            </h2>
          </div>

          <div className="flex-1 border-t border-border">
            {faqs.map((faq, index) => (
              <div
                key={index}
                className="py-6 border-b border-border"
              >
                <h3 className="text-heading font-bold text-base mb-3">
                  {faq.question}
                </h3>
                <p className="text-text-secondary leading-relaxed text-sm">
                  {faq.answer}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
