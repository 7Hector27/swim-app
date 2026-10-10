import styles from "./FaqSection.module.css";

const faqs = [
  {
    question: "How long are lessons, and what is the rate?",
    answer: "[Lesson length and rate]",
  },
  {
    question: "What ages and skill levels do you teach?",
    answer: "[Ages and skill levels Jason teaches]",
  },
  {
    question: "How do I book or cancel a lesson?",
    answer: "[How booking and cancellation work]",
  },
  {
    question: "Where do lessons take place?",
    answer: "[Pool location]",
  },
  {
    question: "What should swimmers bring?",
    answer: "[What to bring]",
  },
];

function ChevronIcon() {
  return (
    <svg
      className={styles.chevron}
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M5 7.5l5 5 5-5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function FaqSection() {
  return (
    <section id="faq" className="scroll-mt-16 bg-background">
      <div className="mx-auto max-w-content px-page py-16 tablet:py-24">
        <div className="flex flex-col gap-0 tablet:flex-row tablet:gap-16">
          {/* Sticky heading column */}
          <div className="flex flex-col gap-3 mb-10 tablet:mb-0 tablet:w-72 tablet:sticky tablet:top-24 tablet:self-start">
            <p className="text-eyebrow text-accent font-bold uppercase tracking-[0.08em]">
              FAQ
            </p>
            <h2 className="text-heading">
              Frequently asked questions
            </h2>
          </div>

          {/* Accordion column */}
          <div className="flex-1 border-t border-border">
            {faqs.map((faq, index) => (
              <details key={index} className="group border-b border-border">
                <summary className="flex items-center justify-between gap-4 py-5 cursor-pointer list-none text-heading font-semibold text-base select-none hover:text-accent transition-colors duration-150 [&::-webkit-details-marker]:hidden">
                  {faq.question}
                  <ChevronIcon />
                </summary>
                <div className={`pb-5 ${styles.content}`}>
                  <p className="text-text-secondary leading-relaxed text-sm">
                    {faq.answer}
                  </p>
                </div>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
