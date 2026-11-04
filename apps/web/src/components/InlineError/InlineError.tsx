"use client";

interface InlineErrorProps {
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export default function InlineError({
  message = "We couldn't load this. Try again in a moment.",
  onRetry,
  retryLabel = "Try again",
  className = "",
}: InlineErrorProps) {
  return (
    <div
      role="alert"
      className={`rounded-card border border-border bg-background px-4 py-5 flex flex-col tablet:flex-row tablet:items-center gap-3 tablet:gap-4 ${className}`}
    >
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="shrink-0 w-5 h-5 mt-0.5 text-danger"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <p className="text-sm text-text">{message}</p>
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="self-start tablet:self-auto inline-flex items-center justify-center rounded-button border-2 border-button-outline text-button-outline font-bold text-xs min-h-[36px] px-4 active:scale-[0.97] transition-colors duration-200"
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
