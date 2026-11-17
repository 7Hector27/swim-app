"use client";

// Interception layer for every parent-side Book entry point. Centralizes
// the two pre-booking gates so no call site has to re-implement them:
//
//   1. No swimmers on the account   → "Add your swimmer first" modal
//   2. Balance below one lesson ($60) → "Add funds before booking" modal
//
// Both apply → swimmer modal wins (if there's nobody on the lesson,
// topping up credit doesn't unblock anything). Viewers bypass both (the
// Book link is already hidden for them in the nav; if some surface still
// renders a link we don't double-gate).
//
// Direct-URL defense lives on /dashboard/book itself — the page shows
// the same "Add your swimmer first" state when swimmers.length === 0,
// so this provider is not the only line of defense.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useState } from "react";

// $60 = cheapest private lesson (30 min × 1 swimmer). Matches the
// threshold used by the balance page and the booking low-funds banner.
const MIN_LESSON_PRICE_CENTS = 6_000;

type GateReason = "no_swimmers" | "low_funds" | null;

interface BookGateValue {
  // null when fetch failed; treat as "no gate" so we don't block booking
  // on a transient read error (the real booking flow still enforces
  // insufficient-balance at Review).
  swimmerCount: number;
  balanceCents: number | null;
  isViewer: boolean;
  // Returns the reason the parent should NOT proceed directly, or null
  // if they can navigate straight to /dashboard/book.
  evaluate: () => GateReason;
  openGate: (reason: Exclude<GateReason, null>) => void;
}

const BookGateContext = createContext<BookGateValue>({
  swimmerCount: 0,
  balanceCents: null,
  isViewer: false,
  evaluate: () => null,
  openGate: () => {},
});

export function useBookGate(): BookGateValue {
  return useContext(BookGateContext);
}

interface BookGateProviderProps {
  swimmerCount: number;
  balanceCents: number | null;
  isViewer: boolean;
  children: React.ReactNode;
}

export function BookGateProvider({
  swimmerCount,
  balanceCents,
  isViewer,
  children,
}: BookGateProviderProps) {
  const [openReason, setOpenReason] = useState<GateReason>(null);

  const evaluate = useCallback((): GateReason => {
    if (isViewer) return null;
    if (swimmerCount === 0) return "no_swimmers";
    if (balanceCents !== null && balanceCents < MIN_LESSON_PRICE_CENTS) {
      return "low_funds";
    }
    return null;
  }, [isViewer, swimmerCount, balanceCents]);

  const openGate = useCallback((reason: Exclude<GateReason, null>) => {
    setOpenReason(reason);
  }, []);

  return (
    <BookGateContext.Provider
      value={{
        swimmerCount,
        balanceCents,
        isViewer,
        evaluate,
        openGate,
      }}
    >
      {children}
      {openReason === "no_swimmers" && (
        <NoSwimmersModal onClose={() => setOpenReason(null)} />
      )}
      {openReason === "low_funds" && (
        <LowFundsModal onClose={() => setOpenReason(null)} />
      )}
    </BookGateContext.Provider>
  );
}

// ── BookLink — drop-in <Link>/<a> replacement that runs the gate ──────────
//
// Renders the same markup as a next/link anchor. On click we evaluate
// the gate: if it returns a reason, we preventDefault + open the modal;
// otherwise the link navigates normally. Non-primary buttons (middle
// click, ctrl/cmd click) are left alone so power-user affordances work.

interface BookLinkProps {
  href?: string;
  prefetch?: boolean;
  className?: string;
  "aria-label"?: string;
  "data-testid"?: string;
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  children: React.ReactNode;
}

export function BookLink({
  href = "/dashboard/book",
  prefetch = false,
  className,
  "aria-label": ariaLabel,
  "data-testid": dataTestId,
  onClick,
  children,
}: BookLinkProps) {
  const { evaluate, openGate } = useBookGate();

  function handleClick(event: React.MouseEvent<HTMLAnchorElement>) {
    if (onClick) onClick(event);
    if (event.defaultPrevented) return;
    // Let modified clicks (new tab / new window) through untouched —
    // if they hit the gate on landing, /dashboard/book shows the
    // no-swimmers state anyway.
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    const reason = evaluate();
    if (reason === null) return;
    event.preventDefault();
    openGate(reason);
  }

  return (
    <Link
      href={href}
      prefetch={prefetch}
      onClick={handleClick}
      {...(className !== undefined && { className })}
      {...(ariaLabel !== undefined && { "aria-label": ariaLabel })}
      {...(dataTestId !== undefined && { "data-testid": dataTestId })}
    >
      {children}
    </Link>
  );
}

// ── Modals ───────────────────────────────────────────────────────────────

interface ModalProps {
  onClose: () => void;
}

function NoSwimmersModal({ onClose }: ModalProps) {
  return (
    <ModalShell titleId="book-gate-no-swimmers-title" onClose={onClose}>
      <ModalIcon>
        <svg width="22" height="22" viewBox="0 0 20 20" fill="none">
          <circle cx="7.5" cy="6.5" r="2.75" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M2 15.5c0-2.761 2.462-5 5.5-5s5.5 2.239 5.5 5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path
            d="M15 4v5M12.5 6.5h5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </ModalIcon>
      <h2
        id="book-gate-no-swimmers-title"
        className="font-heading text-2xl text-heading leading-tight text-center"
      >
        Add your swimmer first
      </h2>
      <p className="text-sm text-text-secondary text-center max-w-xs mx-auto">
        Booking needs someone on the lesson. Add their name and birthday — it
        takes a minute.
      </p>
      <div className="flex flex-col gap-2">
        <Link
          href="/dashboard/swimmers/new"
          onClick={onClose}
          data-testid="book-gate-add-swimmer"
          className="min-h-[48px] inline-flex items-center justify-center px-6 rounded-full bg-accent text-on-accent font-bold text-sm transition-opacity hover:opacity-90 active:scale-[0.97] motion-reduce:transform-none"
        >
          Add a swimmer
        </Link>
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] text-sm font-semibold text-text-secondary hover:text-text"
        >
          Cancel
        </button>
      </div>
    </ModalShell>
  );
}

function LowFundsModal({ onClose }: ModalProps) {
  const router = useRouter();
  function handleBrowseAnyway() {
    onClose();
    // router.push instead of a Link so we can close the modal in the
    // same frame; prefetch isn't valuable here (landing on book fires
    // its own data fetch).
    router.push("/dashboard/book");
  }
  return (
    <ModalShell titleId="book-gate-low-funds-title" onClose={onClose}>
      <ModalIcon>
        <svg width="22" height="22" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M10 6v5M10 13.5v.01"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </ModalIcon>
      <h2
        id="book-gate-low-funds-title"
        className="font-heading text-2xl text-heading leading-tight text-center"
      >
        Add funds before booking
      </h2>
      <p className="text-sm text-text-secondary text-center max-w-xs mx-auto">
        Your balance is below one lesson. You can still browse available times
        — you&apos;ll need credit when you Confirm.
      </p>
      <div className="flex flex-col gap-2">
        <Link
          href="/account/balance"
          onClick={onClose}
          data-testid="book-gate-add-funds"
          className="min-h-[48px] inline-flex items-center justify-center px-6 rounded-full bg-accent text-on-accent font-bold text-sm transition-opacity hover:opacity-90 active:scale-[0.97] motion-reduce:transform-none"
        >
          Add funds
        </Link>
        <button
          type="button"
          onClick={handleBrowseAnyway}
          data-testid="book-gate-browse-anyway"
          className="min-h-[44px] rounded-full border-2 border-button-outline text-button-outline font-bold text-sm transition-opacity hover:opacity-80 active:scale-[0.97] motion-reduce:transform-none"
        >
          Browse times anyway
        </button>
      </div>
    </ModalShell>
  );
}

// ── Shared modal shell ───────────────────────────────────────────────────

function ModalShell({
  titleId,
  onClose,
  children,
}: {
  titleId: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  function handleBackdrop(event: React.MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onClose();
  }
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="book-gate-modal"
      onClick={handleBackdrop}
      className="fixed inset-0 z-50 flex items-end tablet:items-center justify-center bg-ink/60 p-0 tablet:p-4"
    >
      <div className="w-full max-w-[420px] bg-background rounded-t-card tablet:rounded-card border border-border p-6 flex flex-col gap-4">
        {children}
      </div>
    </div>
  );
}

function ModalIcon({ children }: { children: React.ReactNode }) {
  return (
    <div
      aria-hidden="true"
      className="mx-auto w-12 h-12 rounded-full bg-surface-soft flex items-center justify-center text-heading"
    >
      {children}
    </div>
  );
}
