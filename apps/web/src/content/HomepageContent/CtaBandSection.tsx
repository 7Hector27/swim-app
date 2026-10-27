export type CtaVariant = "signed-out" | "parent-active" | "parent-viewer" | "coach";

interface CtaCopy {
  heading: string;
  body: string;
  buttonLabel: string;
  href: string;
}

const COPY: Record<CtaVariant, CtaCopy> = {
  "signed-out": {
    heading: "Ready to get in the water?",
    body: "Create a parent account and book your first lesson.",
    buttonLabel: "Create an account",
    href: "/signup",
  },
  "parent-active": {
    heading: "Ready for your next lesson?",
    body: "Pick a time that works and we'll see you in the water.",
    buttonLabel: "Book a lesson",
    href: "/dashboard/book",
  },
  "parent-viewer": {
    heading: "See what's coming up",
    body: "Check your family's upcoming lessons.",
    buttonLabel: "View lessons",
    href: "/dashboard/lessons",
  },
  coach: {
    heading: "Ready for the week?",
    body: "Your schedule and booking requests are one tap away.",
    buttonLabel: "Open schedule",
    href: "/coach/schedule",
  },
};

interface Props {
  variant?: CtaVariant;
}

export default function CtaBandSection({ variant = "signed-out" }: Props) {
  const copy = COPY[variant];
  return (
    <section className="bg-section text-text-on-section">
      <div className="mx-auto max-w-content px-page py-16 tablet:py-24 text-center">
        <div className="flex flex-col items-center gap-6">
          <h2 className="text-text-on-section max-w-xl">{copy.heading}</h2>
          <p className="text-text-secondary-on-section max-w-md">{copy.body}</p>
          <a
            href={copy.href}
            className="inline-flex items-center justify-center rounded-button bg-accent-on-section text-on-accent font-bold px-8 h-[52px] transition-opacity duration-200 hover:opacity-90 active:scale-[0.97]"
          >
            {copy.buttonLabel}
          </a>
        </div>
      </div>
    </section>
  );
}
