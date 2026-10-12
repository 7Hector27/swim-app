"use client";

import { useActionState, useEffect, useState } from "react";

import styles from "@/components/ConfirmDialog/ConfirmDialog.module.css";
import { transferOwnershipAction } from "./actions";

interface Props {
  profileId: string;
  memberName: string;
  onClose: () => void;
  dialogRef: React.RefObject<HTMLDialogElement | null>;
}

export default function TransferOwnershipDialog({ profileId, memberName, onClose, dialogRef }: Props) {
  const [phase, setPhase] = useState<1 | 2>(1);
  const formId = `transfer-ownership-${profileId}`;

  const boundAction = transferOwnershipAction.bind(null, profileId);
  const [state, formAction, isPending] = useActionState(boundAction, { status: "idle" });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    function handleClose() {
      setPhase(1);
    }
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, [dialogRef]);

  function handleBackdropClick(event: React.MouseEvent<HTMLDialogElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    ) {
      onClose();
    }
  }

  return (
    <dialog ref={dialogRef} onClick={handleBackdropClick} className={styles.dialog}>
      {/* Hidden form — always mounted */}
      <form id={formId} action={formAction} className="hidden" />

      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <h2
            className="text-lg font-heading font-semibold text-text-on-section leading-tight"
            style={{ fontVariationSettings: '"SOFT" 100, "WONK" 0' }}
          >
            {phase === 1 ? `Transfer ownership to ${memberName}?` : "Are you sure?"}
          </h2>
          <p className="text-sm text-text-secondary-on-section leading-relaxed">
            {phase === 1
              ? `You'll become a manager of this household.`
              : "This can't be undone. You'll lose owner access immediately."}
          </p>
        </div>

        {state.status === "error" && (
          <p role="alert" aria-live="polite" className="text-sm text-danger">
            {state.message}
          </p>
        )}

        <div className="flex gap-3 justify-end">
          {phase === 1 ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center justify-center rounded-button border border-divider-section text-text-on-section font-semibold text-sm px-5 h-11 transition-colors duration-150 hover:border-text-secondary-on-section"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => setPhase(2)}
                className="inline-flex items-center justify-center rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm px-5 h-11 transition-opacity hover:opacity-90"
              >
                Continue
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setPhase(1)}
                className="inline-flex items-center justify-center rounded-button border border-divider-section text-text-on-section font-semibold text-sm px-5 h-11 transition-colors duration-150 hover:border-text-secondary-on-section"
              >
                Back
              </button>
              <button
                type="submit"
                form={formId}
                disabled={isPending}
                className="inline-flex items-center justify-center rounded-button bg-danger text-text-on-section font-bold text-sm px-5 h-11 transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {isPending ? "Transferring…" : "Transfer ownership"}
              </button>
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}
