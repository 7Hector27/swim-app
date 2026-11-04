"use client";

import "@/styles/globals.css";

// When the root layout itself throws, Next.js unmounts it and renders this
// boundary instead, so it must own <html> and <body>. Keep this file
// dependency-free (no @/lib/env, no server data fetching, no nav chrome) — if
// the layout crashed, those code paths are suspect.
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-text antialiased flex flex-col items-center justify-center px-page gap-5 text-center">
        <p className="text-eyebrow uppercase tracking-wide text-text-secondary">
          Something went wrong
        </p>
        <h1 className="font-heading text-4xl tablet:text-5xl text-heading">
          Axiom Aquatics
        </h1>
        <p className="text-text-secondary max-w-md">
          We hit an unexpected error loading the app. Try reloading.
        </p>
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center justify-center rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm min-h-[52px] px-7 active:scale-[0.97] transition-colors duration-200"
        >
          Try again
        </button>
      </body>
    </html>
  );
}
