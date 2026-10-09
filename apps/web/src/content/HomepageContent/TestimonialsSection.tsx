const testimonials = [
  {
    quote: "[Testimonial quote — what a parent said about the coaching experience]",
    author: "[Parent name]",
  },
  {
    quote: "[Testimonial quote — what a parent said about the coaching experience]",
    author: "[Parent name]",
  },
  {
    quote: "[Testimonial quote — what a parent said about the coaching experience]",
    author: "[Parent name]",
  },
];

export default function TestimonialsSection() {
  return (
    <section className="bg-background">
      <div className="mx-auto max-w-content px-page py-16 tablet:py-24">
        <div className="flex flex-col gap-3 mb-10 tablet:mb-14">
          <p className="text-eyebrow text-accent font-bold uppercase tracking-[0.08em]">
            What Parents Say
          </p>
          <h2 className="text-heading">
            [Testimonials heading]
          </h2>
        </div>

        <div className="grid gap-6 tablet:grid-cols-3">
          {testimonials.map((testimonial, index) => (
            <blockquote
              key={index}
              className="rounded-card border border-border p-6 flex flex-col gap-4"
            >
              <p className="text-text leading-relaxed flex-1">
                &ldquo;{testimonial.quote}&rdquo;
              </p>
              <footer className="text-text-secondary font-semibold text-sm">
                &mdash; {testimonial.author}
              </footer>
            </blockquote>
          ))}
        </div>
      </div>
    </section>
  );
}
