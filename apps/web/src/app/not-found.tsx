import Link from "next/link";

import { fetchMe } from "@/lib/api/me";

export default async function NotFound() {
  const meResult = await fetchMe();
  const role = meResult.ok ? meResult.profile.role : null;
  const backHref = role === "coach" ? "/coach" : role === "parent" ? "/dashboard" : "/";
  const backLabel = role === "coach" || role === "parent" ? "Back to dashboard" : "Back to home";

  return (
    <main className="flex flex-col items-center justify-center flex-1 px-page py-16 gap-5 text-center">
      <p className="text-eyebrow uppercase tracking-wide text-text-secondary">Not found</p>
      <h1 className="text-heading font-heading text-4xl tablet:text-5xl text-heading">
        We couldn&apos;t find that page
      </h1>
      <p className="text-text-secondary max-w-md">
        The link may be stale, or the page may have moved. Head back to pick up where you left off.
      </p>
      <Link
        href={backHref}
        className="inline-flex items-center justify-center rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm min-h-[52px] px-7 active:scale-[0.97] transition-colors duration-200"
      >
        {backLabel}
      </Link>
    </main>
  );
}
