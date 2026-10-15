import Link from "next/link";

import type { ParentSwimmer } from "@swim-app/shared";

import ParentNav from "@/components/ParentNav";
import SiteFooter from "@/components/SiteFooter";

interface Props {
  swimmers: ParentSwimmer[];
}

export default function ParentProgressContent({ swimmers }: Props) {
  return (
    <div className="flex flex-col min-h-screen bg-background">
      <ParentNav />
      <main id="main-content" className="flex-1">
        <div className="mx-auto max-w-content px-page pt-10 pb-tab-safe tablet:pt-14 tablet:pb-32">
          <h1 className="text-3xl tablet:text-4xl text-heading mb-3">Progress</h1>
          <p className="text-text-secondary mb-8">Choose a swimmer.</p>
          <ul className="grid grid-cols-1 tablet:grid-cols-2 gap-4">
            {swimmers.map((swimmer) => (
              <li key={swimmer.id}>
                <Link
                  href={`/dashboard/swimmers/${swimmer.id}/progress`}
                  className="flex items-center gap-4 rounded-card border border-border p-5 hover:border-accent transition-colors duration-150"
                >
                  <div
                    className="flex items-center justify-center w-12 h-12 rounded-full bg-surface-soft text-heading font-heading text-xl flex-shrink-0"
                    aria-hidden="true"
                  >
                    {swimmer.firstName.charAt(0)}
                  </div>
                  <p className="font-semibold text-text">
                    {swimmer.firstName} {swimmer.lastName}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
