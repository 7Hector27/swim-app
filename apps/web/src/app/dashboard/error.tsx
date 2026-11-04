"use client";

import Button from "@/components/Button";

export default function DashboardRouteError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex flex-col items-center justify-center flex-1 px-page py-16 gap-5 text-center">
      <p className="text-eyebrow uppercase tracking-wide text-text-secondary">Something went wrong</p>
      <h1 className="font-heading text-3xl tablet:text-4xl text-heading">
        We couldn&apos;t load this page
      </h1>
      <p className="text-text-secondary max-w-md">
        The server didn&apos;t respond as expected. Try again — the rest of your dashboard is still available from the nav.
      </p>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
