import { ThemeLogo } from "@/components/ThemeLogo";

export default function DesignTestPage() {
  return (
    <main>
      <section className="min-h-screen bg-background px-(--page-padding) py-16">
        <div className="mx-auto max-w-(--content-max-width) flex flex-col gap-10">
          <ThemeLogo width={120} height={48} />

          <div className="flex flex-col gap-3">
            <h1 className="text-[2.5rem] tablet:text-[4.5rem] text-heading">
              Swim Better Every Day
            </h1>
            <p className="text-base tablet:text-[1.0625rem] text-text max-w-xl">
              Private swim coaching tailored to every skill level. Book a lesson
              and start making progress in the water today.
            </p>
            <p className="text-sm text-text-secondary">
              Supporting text sits here — lighter, smaller, secondary.
            </p>
          </div>

          <div className="flex flex-wrap gap-4">
            <button className="font-bold text-button-primary-text bg-button-primary-background rounded-pill min-h-[52px] px-8">
              Book a lesson
            </button>
            <button className="font-bold text-button-outline border-2 border-button-outline rounded-pill min-h-[52px] px-8 bg-transparent">
              Create an account
            </button>
          </div>
        </div>
      </section>

      <section className="bg-section px-(--page-padding) py-16">
        <div className="mx-auto max-w-(--content-max-width)">
          <h2 className="text-[2rem] tablet:text-[2.75rem] text-text-on-section mb-8">
            Featured Swimmers
          </h2>

          <div className="rounded-card bg-card border border-border p-6 max-w-sm flex flex-col gap-3">
            <p className="font-bold text-text-on-section">Maya R.</p>
            <p className="text-sm text-text-secondary-on-section">
              50m freestyle — 28.4s
            </p>
            <span
              className="font-heading font-extrabold italic text-accent text-2xl leading-none"
              style={{ fontStretch: "125%" }}
            >
              #1
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}
