"use client";

import "@/styles/globals.css";

import Button from "@/components/Button";

// When the root layout itself throws, Next.js unmounts it and renders this
// boundary instead, so it must own <html> and <body>. Keep this file
// dependency-free of data fetching and env reads (no @/lib/env, no server
// data) — if the layout crashed, those code paths are suspect. The Button
// component is pure UI (no data, no env), so it's safe to import here and
// keeps the Try-again control consistent with the other error boundaries.
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
        <Button onClick={reset}>Try again</Button>
      </body>
    </html>
  );
}
