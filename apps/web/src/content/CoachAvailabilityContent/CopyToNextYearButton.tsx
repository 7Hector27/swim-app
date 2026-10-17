"use client";

import { useEffect, useRef, useState } from "react";

import styles from "./CoachAvailabilityContent.module.css";

interface Props {
  nextYearLabel: string;
  onConfirm: () => Promise<{ insertedCount: number } | { error: string }>;
}

export default function CopyToNextYearButton({ nextYearLabel, onConfirm }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [result, setResult] = useState<{
    kind: "success";
    insertedCount: number;
  } | { kind: "error"; message: string } | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  async function handleConfirm() {
    setIsPending(true);
    const outcome = await onConfirm();
    setIsPending(false);
    if ("error" in outcome) {
      setResult({ kind: "error", message: outcome.error });
    } else {
      setResult({ kind: "success", insertedCount: outcome.insertedCount });
      setOpen(false);
    }
  }

  function handleCancel() {
    if (isPending) return;
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setResult(null);
          setOpen(true);
        }}
        className="inline-flex items-center justify-center h-11 px-5 rounded-button border-2 border-button-outline text-button-outline font-bold text-sm transition-opacity duration-150 hover:opacity-80 active:scale-[0.98]"
      >
        Copy to {nextYearLabel}
      </button>

      {result?.kind === "success" && (
        <p
          role="status"
          aria-live="polite"
          className="text-sm text-success inline-flex items-center h-11"
        >
          Added {result.insertedCount} season{result.insertedCount === 1 ? "" : "s"} for {nextYearLabel}.
        </p>
      )}

      <dialog
        ref={dialogRef}
        className={styles.dialog}
        onCancel={handleCancel}
        aria-labelledby="copy-year-title"
      >
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <h2
              id="copy-year-title"
              className="text-lg font-heading font-semibold text-text-on-section leading-tight"
              style={{ fontVariationSettings: '"SOFT" 100, "WONK" 0' }}
            >
              Copy seasons to {nextYearLabel}?
            </h2>
            <p className="text-sm text-text-secondary-on-section leading-relaxed">
              This duplicates your current cycle one year forward. You can edit or delete the new seasons after.
            </p>
          </div>

          {result?.kind === "error" && (
            <p role="alert" aria-live="polite" className="text-sm text-danger">
              {result.message}
            </p>
          )}

          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={handleCancel}
              disabled={isPending}
              className="inline-flex items-center justify-center h-11 px-5 rounded-button border border-divider-section text-text-on-section font-semibold text-sm transition-colors duration-150 hover:border-text-secondary-on-section"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isPending}
              className="inline-flex items-center justify-center h-11 px-5 rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm transition-opacity duration-150 disabled:opacity-60 hover:opacity-90 active:scale-[0.97]"
            >
              {isPending ? "Copying…" : "Copy seasons"}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
