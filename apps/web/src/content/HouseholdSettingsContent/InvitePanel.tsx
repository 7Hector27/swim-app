"use client";

import { useActionState, useRef, useState } from "react";

import type { PendingInvite } from "@swim-app/shared";

import ConfirmDialog from "@/components/ConfirmDialog";
import { generateInviteAction, revokeInviteAction } from "./actions";

interface Props {
  pendingInvite: PendingInvite | null;
}

export default function InvitePanel({ pendingInvite }: Props) {
  const [generateState, generateFormAction, isGenerating] = useActionState(generateInviteAction, { status: "idle" });

  const generatedUrl = generateState.status === "success" ? generateState.url : null;
  const generatedExpiresAt = generateState.status === "success" ? generateState.expiresAt : null;

  function formatExpiry(iso: string) {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Pending invite info */}
      {pendingInvite && <ActiveInvite invite={pendingInvite} />}

      {/* Generated URL display */}
      {generatedUrl && (
        <div className="rounded-card border border-border p-4 flex flex-col gap-3">
          <p className="text-sm font-semibold text-text">
            New invite link{generatedExpiresAt ? ` · expires ${formatExpiry(generatedExpiresAt)}` : ""}
          </p>
          <CopyField url={generatedUrl} />
        </div>
      )}

      {generateState.status === "error" && (
        <p role="alert" aria-live="polite" className="text-sm text-danger">
          {generateState.message}
        </p>
      )}

      {/* Generate form */}
      <form action={generateFormAction}>
        <button
          type="submit"
          disabled={isGenerating}
          className="inline-flex items-center justify-center rounded-button border-2 border-button-outline text-button-outline font-bold text-sm px-5 h-11 transition-opacity hover:opacity-80 disabled:opacity-60"
        >
          {isGenerating ? "Generating…" : "Generate new link"}
        </button>
      </form>
    </div>
  );
}

function ActiveInvite({ invite }: { invite: NonNullable<PendingInvite> }) {
  const formId = `revoke-invite-${invite.id}`;
  const revokeDialogRef = useRef<HTMLDialogElement>(null);

  const boundRevoke = revokeInviteAction.bind(null, invite.id);
  const [revokeState, revokeAction, isRevoking] = useActionState(boundRevoke, { status: "idle" });

  function formatExpiry(iso: string) {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function handleRevokeClick() {
    revokeDialogRef.current?.showModal();
  }

  function handleRevokeCancel() {
    revokeDialogRef.current?.close();
  }

  return (
    <>
      <form id={formId} action={revokeAction} className="hidden" />

      <div className="rounded-card border border-border p-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-text">Active invite link</p>
          <p className="text-xs text-text-secondary mt-0.5">
            Expires {formatExpiry(invite.expiresAt)}
          </p>
        </div>
        <button
          type="button"
          onClick={handleRevokeClick}
          className="flex-shrink-0 inline-flex items-center justify-center rounded-button border border-danger text-danger font-semibold text-sm px-4 h-9 transition-opacity hover:opacity-80"
        >
          Revoke
        </button>
      </div>

      <ConfirmDialog
        dialogRef={revokeDialogRef}
        title="Revoke invite link?"
        description="Anyone with the link will no longer be able to use it."
        formId={formId}
        confirmLabel="Revoke"
        isPending={isRevoking}
        {...(revokeState.status === "error" && { errorMessage: revokeState.message })}
        onCancel={handleRevokeCancel}
      />
    </>
  );
}

function CopyField({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex gap-2">
      <input
        readOnly
        value={url}
        className="flex-1 min-w-0 rounded-button border border-border bg-surface-soft text-text-secondary text-xs px-3 h-9 focus:outline-none focus:ring-2 focus:ring-accent/50"
        onFocus={(event) => event.currentTarget.select()}
      />
      <button
        type="button"
        onClick={handleCopy}
        className="flex-shrink-0 inline-flex items-center justify-center rounded-button bg-button-primary-background text-button-primary-text font-bold text-xs px-4 h-9 transition-opacity hover:opacity-90"
      >
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}
