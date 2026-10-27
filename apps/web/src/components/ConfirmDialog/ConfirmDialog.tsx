"use client";

import type { RefObject } from "react";

import PendingLabel from "@/components/PendingLabel";

import styles from "./ConfirmDialog.module.css";

interface ConfirmDialogProps {
  dialogRef: RefObject<HTMLDialogElement | null>;
  title: string;
  description: string;
  // Confirm must be either a form submit (formId) or a direct callback
  // (onConfirm). Callers that need a server action route through formId;
  // simple client-side confirmations use onConfirm.
  formId?: string;
  onConfirm?: () => void;
  confirmLabel?: string;
  confirmPendingLabel?: string;
  confirmDanger?: boolean;
  cancelLabel?: string;
  isPending?: boolean;
  errorMessage?: string;
  children?: React.ReactNode;
  onCancel: () => void;
}

export default function ConfirmDialog({
  dialogRef,
  title,
  description,
  formId,
  onConfirm,
  confirmLabel = "Confirm",
  confirmPendingLabel,
  confirmDanger = false,
  cancelLabel = "Cancel",
  isPending = false,
  errorMessage,
  children,
  onCancel,
}: ConfirmDialogProps) {
  function handleBackdropClick(event: React.MouseEvent<HTMLDialogElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    ) {
      onCancel();
    }
  }

  const confirmBase =
    "inline-flex items-center justify-center rounded-button font-bold text-sm px-5 h-11 transition-opacity duration-150 disabled:opacity-60 hover:opacity-90 active:scale-[0.97]";

  return (
    <dialog ref={dialogRef} onClick={handleBackdropClick} className={styles.dialog}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <h2
            className="text-lg font-heading font-semibold text-text-on-section leading-tight"
            style={{ fontVariationSettings: '"SOFT" 100, "WONK" 0' }}
          >
            {title}
          </h2>
          <p className="text-sm text-text-secondary-on-section leading-relaxed">{description}</p>
        </div>

        {children && <div>{children}</div>}

        {errorMessage && (
          <p role="alert" aria-live="polite" className="text-sm text-danger">
            {errorMessage}
          </p>
        )}

        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center justify-center rounded-button border border-divider-section text-text-on-section font-semibold text-sm px-5 h-11 transition-colors duration-150 hover:border-text-secondary-on-section"
          >
            {cancelLabel}
          </button>
          <button
            type={formId !== undefined ? "submit" : "button"}
            {...(formId !== undefined ? { form: formId } : {})}
            {...(formId === undefined && onConfirm !== undefined ? { onClick: onConfirm } : {})}
            disabled={isPending}
            className={`${confirmBase} ${confirmDanger ? "bg-danger text-text-on-section" : "bg-button-primary-background text-button-primary-text"}`}
          >
            <PendingLabel
              isPending={isPending}
              label={confirmLabel}
              pendingLabel={confirmPendingLabel ?? `${confirmLabel}…`}
            />
          </button>
        </div>
      </div>
    </dialog>
  );
}
