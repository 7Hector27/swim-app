const lessonTypes = [
  {
    title: "[Lesson type]",
    description: "[Brief description of this lesson format and who it's best suited for]",
    price: "[Price]",
  },
  {
    title: "[Lesson type]",
    description: "[Brief description of this lesson format and who it's best suited for]",
    price: "[Price]",
  },
  {
    title: "[Lesson type]",
    description: "[Brief description of this lesson format and who it's best suited for]",
    price: "[Price]",
  },
];

export default function LessonsSection() {
  return (
    <section className="bg-background">
      <div className="mx-auto max-w-content px-page py-16 tablet:py-24">
        <div className="flex flex-col gap-3 mb-10 tablet:mb-14">
          <p className="text-eyebrow text-accent font-bold uppercase tracking-[0.08em]">
            Private Lessons
          </p>
          <h2 className="text-heading">
            [Lesson types heading]
          </h2>
        </div>

        <div className="grid gap-6 tablet:grid-cols-3">
          {lessonTypes.map((lesson, index) => (
            <article
              key={index}
              className="rounded-card border border-border p-6 flex flex-col gap-4 transition-colors duration-200 hover:border-accent"
            >
              <h3 className="text-heading font-bold text-xl">{lesson.title}</h3>
              <p className="text-text-secondary flex-1">{lesson.description}</p>
              <div className="flex flex-col gap-4 mt-2">
                <p className="text-heading font-bold text-lg">{lesson.price}</p>
                <a
                  href="/book"
                  className="inline-flex items-center justify-center rounded-pill bg-button-primary-background text-button-primary-text font-bold text-sm px-6 h-[44px] transition-colors duration-200 active:scale-97"
                >
                  Book a lesson
                </a>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
