"use client";

import Button from "@/components/Button";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-page gap-6 text-center">
      <h1 className="text-heading">Something went wrong</h1>
      <p className="text-text-secondary">
        We hit an unexpected error. Try refreshing the page.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
