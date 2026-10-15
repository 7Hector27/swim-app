import SiteFooter from "@/components/SiteFooter";

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

export default function LessonsContent() {
  return (
    <div className="flex flex-col min-h-screen">
      <main className="flex-1">
        <section className="bg-background">
          <div className="mx-auto max-w-content px-page py-16 tablet:py-24">
            <h1 className="text-heading mb-4">Lessons</h1>
            <p className="text-text-secondary text-lg max-w-xl mb-12 tablet:mb-16">
              Every lesson is private — one swimmer, one coach. No groups, no distractions.
            </p>

            <div className="grid gap-6 tablet:grid-cols-3">
              {lessonTypes.map((lesson, index) => (
                <article
                  key={index}
                  className="rounded-card border border-border p-6 flex flex-col gap-4 transition-colors duration-200 hover:border-accent"
                >
                  <h2 className="text-heading font-bold text-xl font-body">{lesson.title}</h2>
                  <p className="text-text-secondary flex-1">{lesson.description}</p>
                  <div className="flex flex-col gap-4 mt-2">
                    <p className="text-heading font-bold text-lg">{lesson.price}</p>
                    <a
                      href="/book"
                      className="inline-flex items-center justify-center rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm px-6 h-[44px] transition-opacity duration-200 hover:opacity-90 active:scale-[0.97]"
                    >
                      Book a lesson
                    </a>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
