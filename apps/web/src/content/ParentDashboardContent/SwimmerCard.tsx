"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import ConfirmDialog from "@/components/ConfirmDialog";
import type { RemoveSwimmerState } from "./actions";
import styles from "./SwimmerCard.module.css";

interface SwimmerCardProps {
  id: string;
  firstName: string;
  lastName: string;
  age: number;
  clubName: string | null;
  nextLessonLine: string | null;
  lastEvaluatedLabel: string | null;
  bestEvent: { label: string; timeString: string } | null;
  onLeaderboards: boolean;
  removeAction: (_prevState: RemoveSwimmerState, _formData: FormData) => Promise<RemoveSwimmerState>;
}

export default function SwimmerCard({
  id,
  firstName,
  lastName,
  age,
  clubName,
  nextLessonLine,
  lastEvaluatedLabel,
  bestEvent,
  onLeaderboards,
  removeAction,
}: SwimmerCardProps) {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [removeState, removeFormAction, isRemoving] = useActionState<RemoveSwimmerState, FormData>(
    removeAction,
    { status: "idle" },
  );

  const overflowTriggerRef = useRef<HTMLButtonElement>(null);
  const overflowMenuRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const formId = `remove-swimmer-${id}`;
  const initials = `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase();
  const subheader = clubName ? `Age ${age} \u00B7 ${clubName}` : `Age ${age}`;

  useEffect(() => {
    if (!overflowOpen) return;
    function handlePointerDown(event: PointerEvent) {
      if (
        overflowMenuRef.current &&
        !overflowMenuRef.current.contains(event.target as Node) &&
        overflowTriggerRef.current &&
        !overflowTriggerRef.current.contains(event.target as Node)
      ) {
        setOverflowOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [overflowOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    function handleClose() {
      overflowTriggerRef.current?.focus();
    }
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, []);

  function handleOverflowKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      setOverflowOpen(false);
      overflowTriggerRef.current?.focus();
    }
  }

  function handleRemoveClick() {
    setOverflowOpen(false);
    dialogRef.current?.showModal();
  }

  function handleDialogCancel() {
    dialogRef.current?.close();
  }

  return (
    <div className="rounded-card border border-border p-5 flex flex-col gap-4">
      {/* Persistent remove form so the submit button inside the dialog stays
          wired to a form that is always in the DOM, even when the dialog is
          closed. */}
      <form id={formId} action={removeFormAction} className="hidden" />

      <div className="flex items-start gap-3">
        <div
          className="flex-shrink-0 w-10 h-10 rounded-full bg-surface-soft flex items-center justify-center"
          aria-hidden="true"
        >
          <span className="text-sm font-semibold text-text-secondary select-none">
            {initials}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-text">
              {firstName} {lastName}
            </p>
            {onLeaderboards && (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-accent text-accent text-[10px] font-semibold px-2 h-5 leading-none"
                aria-label={`${firstName} appears on public leaderboards`}
              >
                <TrophyIcon />
                On leaderboards
              </span>
            )}
          </div>
          <p className="text-xs text-text-secondary mt-0.5 truncate">{subheader}</p>
        </div>

        <div className="relative flex-shrink-0">
          <button
            ref={overflowTriggerRef}
            type="button"
            aria-label={`More options for ${firstName}`}
            aria-haspopup="menu"
            aria-expanded={overflowOpen}
            onClick={() => setOverflowOpen((open) => !open)}
            className="flex items-center justify-center w-10 h-10 rounded-button text-text-secondary hover:bg-surface-soft transition-colors duration-150 -mt-1 -mr-1"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <circle cx="8" cy="3" r="1.4" />
              <circle cx="8" cy="8" r="1.4" />
              <circle cx="8" cy="13" r="1.4" />
            </svg>
          </button>

          {overflowOpen && (
            <div
              ref={overflowMenuRef}
              role="menu"
              aria-label={`Options for ${firstName}`}
              onKeyDown={handleOverflowKeyDown}
              className={`absolute right-0 top-full mt-1 w-44 rounded-[10px] bg-surface-soft border border-border z-10 overflow-hidden py-1 ${styles.overflowMenu}`}
            >
              <button
                type="button"
                role="menuitem"
                onClick={handleRemoveClick}
                className="w-full text-left flex items-center px-4 h-11 text-sm font-semibold text-danger hover:bg-border/40 transition-colors duration-100 focus-visible:outline-none focus-visible:bg-border/60"
              >
                Remove {firstName}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5 text-xs text-text-secondary">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-text-secondary flex-shrink-0" aria-hidden="true">
            <CalendarIcon />
          </span>
          {nextLessonLine ? (
            <span className="truncate">
              <span className="text-text font-semibold">Next lesson</span> {nextLessonLine}
            </span>
          ) : (
            <span>No upcoming lessons</span>
          )}
        </div>
        {lastEvaluatedLabel && (
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-text-secondary flex-shrink-0" aria-hidden="true">
              <ClipboardIcon />
            </span>
            <span className="truncate">Last evaluated {lastEvaluatedLabel}</span>
          </div>
        )}
        {bestEvent && (
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-text-secondary flex-shrink-0" aria-hidden="true">
              <TrophyIcon />
            </span>
            <span className="truncate">
              <span className="text-text font-semibold">Best {bestEvent.label}</span>{" "}
              <span className="tabular-nums">{bestEvent.timeString}</span>
            </span>
          </div>
        )}
      </div>

      <div className="mt-auto flex flex-col gap-2">
        <a
          href={`/dashboard/swimmers/${id}/progress`}
          className="w-full rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm h-11 flex items-center justify-center transition-opacity hover:opacity-90 motion-safe:transition-transform motion-safe:duration-100 active:scale-[0.98]"
        >
          View progress
        </a>
        <a
          href={`/dashboard/swimmers/${id}`}
          className="w-full rounded-button border-2 border-button-outline text-button-outline font-bold text-sm h-11 flex items-center justify-center transition-opacity hover:opacity-90 motion-safe:transition-transform motion-safe:duration-100 active:scale-[0.98]"
        >
          View profile
        </a>
      </div>

      <ConfirmDialog
        dialogRef={dialogRef}
        title={`Remove ${firstName}?`}
        description="This will permanently remove this swimmer and all their data from your account."
        formId={formId}
        confirmLabel="Remove"
        confirmDanger
        isPending={isRemoving}
        {...(removeState.status === "error" && { errorMessage: removeState.message })}
        onCancel={handleDialogCancel}
      />
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
      <path d="M2.5 6.5h11" />
      <path d="M5.5 2v3" />
      <path d="M10.5 2v3" />
    </svg>
  );
}

function ClipboardIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="3" width="8" height="11" rx="1.5" />
      <path d="M6 3v-.5A1.5 1.5 0 0 1 7.5 1h1A1.5 1.5 0 0 1 10 2.5V3" />
      <path d="M6.5 7.5h3" />
      <path d="M6.5 10.5h3" />
    </svg>
  );
}

function TrophyIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 3h6v3a3 3 0 0 1-6 0V3Z" />
      <path d="M5 4H3.5a1 1 0 0 0-1 1v1a2 2 0 0 0 2 2h.5" />
      <path d="M11 4h1.5a1 1 0 0 1 1 1v1a2 2 0 0 1-2 2H11" />
      <path d="M8 9v2.5" />
      <path d="M6 13.5h4" />
    </svg>
  );
}
