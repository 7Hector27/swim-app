"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import ConfirmDialog from "@/components/ConfirmDialog";
import Placeholder from "@/components/Placeholder";
import type { RemoveSwimmerState } from "./actions";
import styles from "./SwimmerCard.module.css";

interface SwimmerCardProps {
  id: string;
  firstName: string;
  lastName: string;
  age: number;
  isPublic: boolean;
  removeAction: (_prevState: RemoveSwimmerState, _formData: FormData) => Promise<RemoveSwimmerState>;
}

export default function SwimmerCard({
  id,
  firstName,
  lastName,
  age,
  isPublic,
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
    <div className="rounded-card border border-border p-5 flex flex-col gap-5">
      {/* Persistent remove form — stays mounted when the confirm dialog closes */}
      <form id={formId} action={removeFormAction} className="hidden" />

      {/* Header: avatar + name/age + overflow trigger */}
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
          <p className="text-sm font-semibold text-text">
            {firstName} {lastName}
          </p>
          <p className="text-xs text-text-secondary mt-0.5">Age {age}</p>
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

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-x-4">
        <div>
          <p className="text-[11px] text-text-secondary mb-0.5">Best 50 Free</p>
          <Placeholder>
            <span className="text-sm font-semibold text-text">[0:00.00]</span>
          </Placeholder>
        </div>
        <div>
          <p className="text-[11px] text-text-secondary mb-0.5">Profile</p>
          <p className="text-sm font-semibold text-text">{isPublic ? "Public" : "Private"}</p>
        </div>
      </div>

      {/* Action buttons */}
      <div className="mt-auto flex flex-col gap-2">
        <a
          href={`/dashboard/swimmers/${id}/progress`}
          className="rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm h-11 flex items-center justify-center transition-opacity hover:opacity-90"
        >
          View progress
        </a>
        <a
          href={`/dashboard/swimmers/${id}`}
          className="rounded-button border-2 border-button-outline text-button-outline font-bold text-sm h-11 flex items-center justify-center transition-opacity hover:opacity-90"
        >
          View profile
        </a>
        <Placeholder block>
          <button
            type="button"
            className="w-full rounded-button border border-border text-text-secondary font-semibold text-sm h-11 flex items-center justify-center"
          >
            Share stats
          </button>
        </Placeholder>
      </div>

      {/* Confirm remove dialog — always mounted so form is never disconnected */}
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
