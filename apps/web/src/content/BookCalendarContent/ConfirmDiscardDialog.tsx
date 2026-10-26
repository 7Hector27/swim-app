"use client";

import { useEffect, useRef } from "react";

interface Props {
  open: boolean;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDiscardDialog({
  open,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      onClose={onCancel}
      aria-labelledby="confirm-discard-heading"
      className="max-w-sm w-[calc(100%-2rem)] p-5 rounded-card bg-background text-text backdrop:bg-heading/40"
      data-testid="confirm-discard-dialog"
    >
      <h2
        id="confirm-discard-heading"
        className="font-heading text-lg text-heading mb-1"
      >
        Switch booking mode?
      </h2>
      <p className="text-sm text-text-secondary mb-4">{message}</p>
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-[44px] px-4 rounded-button border border-border text-text text-sm font-semibold hover:bg-surface-soft active:scale-[0.97] motion-reduce:transform-none transition-colors duration-150"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          data-testid="confirm-discard-ok"
          className="min-h-[44px] px-4 rounded-button bg-button-primary-background text-button-primary-text text-sm font-bold hover:opacity-90 active:scale-[0.97] motion-reduce:transform-none transition-opacity duration-150"
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
