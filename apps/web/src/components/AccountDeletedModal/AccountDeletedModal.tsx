"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { formatDollars } from "@/content/AccountBalanceContent/formatters";

import styles from "./AccountDeletedModal.module.css";

const PARAM_NAME = "account-deleted";
const PARAM_VALUE = "1";
const PARAM_REFUNDED = "refunded";
const PARAM_FORFEITED = "forfeited";

function parsePositiveCents(raw: string | null): number {
  if (raw === null) return 0;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed;
}

// Post-deletion confirmation modal. Mounts on the public landing page
// and opens when the URL carries ?account-deleted=1 (ADR 034 handoff
// from POST /me/deletion/confirm). Closing the modal strips the param
// via router.replace so a reload or back nav doesn't re-show it.
//
// Why a modal + query param instead of a dedicated route: the previous
// /account/deleted page sat inside the /account layout which runs
// requireAuth(). After the server action signs the user out, the
// layout's auth check failed and rendered the inactive screen in place
// of the confirmation. The landing page is already public, so the
// modal piggybacks on it without a second public route.
export default function AccountDeletedModal() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (params.get(PARAM_NAME) === PARAM_VALUE) {
      setVisible(true);
    }
  }, [params]);

  useEffect(() => {
    if (visible) {
      dialogRef.current?.showModal();
    }
  }, [visible]);

  function handleClose(): void {
    dialogRef.current?.close();
    setVisible(false);
    // Strip the one-time params so a reload doesn't re-open the modal.
    // Preserve other params if any — there won't be any on the landing
    // page in practice but this keeps the helper honest.
    const next = new URLSearchParams(params.toString());
    next.delete(PARAM_NAME);
    next.delete(PARAM_REFUNDED);
    next.delete(PARAM_FORFEITED);
    const query = next.toString();
    router.replace(query.length > 0 ? `${pathname}?${query}` : pathname);
  }

  const refundedCents = parsePositiveCents(params.get(PARAM_REFUNDED));
  const forfeitedCents = parsePositiveCents(params.get(PARAM_FORFEITED));
  const showCashOutLine = refundedCents > 0 || forfeitedCents > 0;

  function handleBackdropClick(event: React.MouseEvent<HTMLDialogElement>): void {
    const rect = event.currentTarget.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    ) {
      handleClose();
    }
  }

  if (!visible) return null;

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onClick={handleBackdropClick}
      onClose={handleClose}
      data-testid="account-deleted-modal"
      aria-labelledby="account-deleted-modal-title"
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <h2
            id="account-deleted-modal-title"
            className="text-xl font-heading font-semibold text-heading leading-tight"
            style={{ fontVariationSettings: '"SOFT" 100, "WONK" 0' }}
          >
            Your account has been deleted
          </h2>
          <p className="text-sm text-text-secondary leading-relaxed">
            We removed your profile, your household, your swimmers, and every
            evaluation we had for them. Upcoming lessons were cancelled and
            Coach Jason was notified. Past lessons stay on his records with no
            names attached.
          </p>
          {showCashOutLine && (
            <p
              className="text-sm text-text-secondary leading-relaxed"
              data-testid="account-deleted-cashout-line"
            >
              {refundedCents > 0 && (
                <>
                  We&apos;ve started a{" "}
                  <strong data-testid="account-deleted-refunded">
                    {formatDollars(refundedCents)}
                  </strong>{" "}
                  refund to your card.{" "}
                </>
              )}
              {forfeitedCents > 0 && (
                <>
                  <strong data-testid="account-deleted-forfeited">
                    {formatDollars(forfeitedCents)}
                  </strong>{" "}
                  of unused bonus credit was forfeited.{" "}
                </>
              )}
              {refundedCents > 0 && (
                <>Refunds typically appear in a few business days.</>
              )}
            </p>
          )}
          <p className="text-sm text-text-secondary leading-relaxed">
            If you change your mind later, you can sign up again from here.
          </p>
        </div>

        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleClose}
            data-testid="account-deleted-modal-close"
            className="inline-flex items-center justify-center rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm px-5 h-11 transition-opacity duration-150 hover:opacity-90 active:scale-[0.97]"
          >
            Got it
          </button>
        </div>
      </div>
    </dialog>
  );
}
