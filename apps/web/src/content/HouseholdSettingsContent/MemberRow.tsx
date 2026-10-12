"use client";

import { useActionState, useRef } from "react";

import type { HouseholdMember } from "@swim-app/shared";

import ConfirmDialog from "@/components/ConfirmDialog";
import { changeMemberRoleAction, removeMemberAction } from "./actions";
import TransferOwnershipDialog from "./TransferOwnershipDialog";

interface Props {
  member: HouseholdMember;
  isOwnerView: boolean;
  isSelf: boolean;
  householdName: string;
}

export default function MemberRow({ member, isOwnerView, isSelf, householdName }: Props) {
  const profileId = member.profileId ?? "";
  const displayName = member.fullName ?? "Unknown member";

  const removeFormId = `remove-member-${profileId}`;
  const removeDialogRef = useRef<HTMLDialogElement>(null);
  const transferDialogRef = useRef<HTMLDialogElement>(null);

  const boundRemove = removeMemberAction.bind(null, profileId);
  const [removeState, removeAction, isRemoving] = useActionState(boundRemove, { status: "idle" });

  const boundChangeRole = changeMemberRoleAction.bind(null, profileId);
  const [roleState, roleAction, isChangingRole] = useActionState(boundChangeRole, { status: "idle" });

  function handleRemoveClick() {
    removeDialogRef.current?.showModal();
  }

  function handleRemoveCancel() {
    removeDialogRef.current?.close();
  }

  function handleTransferClick() {
    transferDialogRef.current?.showModal();
  }

  function handleTransferClose() {
    transferDialogRef.current?.close();
  }

  const roleLabel: Record<string, string> = { owner: "Owner", manager: "Manager", viewer: "Viewer" };

  return (
    <div className="flex flex-col gap-3 py-4 border-b border-border last:border-0">
      {/* Hidden forms — always mounted */}
      <form id={removeFormId} action={removeAction} className="hidden" />

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-text">{displayName}</p>
          <p className="text-xs text-text-secondary mt-0.5">
            {isSelf ? `${roleLabel[member.role] ?? member.role} · You` : (roleLabel[member.role] ?? member.role)}
          </p>
        </div>

        {/* Owner controls for non-self members */}
        {isOwnerView && !isSelf && profileId && (
          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
            {/* Role change form */}
            <form action={roleAction} className="flex items-center gap-2">
              {member.role !== "owner" && (
                <>
                  <label htmlFor={`role-${profileId}`} className="sr-only">
                    Role for {displayName}
                  </label>
                  <select
                    id={`role-${profileId}`}
                    name="role"
                    defaultValue={member.role}
                    className="rounded-button border border-border bg-background text-text text-xs px-3 h-9 focus:outline-none focus:ring-2 focus:ring-accent/50"
                  >
                    <option value="manager">Manager</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <button
                    type="submit"
                    disabled={isChangingRole}
                    className="inline-flex items-center justify-center rounded-button border border-border text-text font-semibold text-xs px-3 h-9 transition-colors hover:bg-surface-soft disabled:opacity-60"
                  >
                    {isChangingRole ? "Saving…" : "Save role"}
                  </button>
                </>
              )}
            </form>

            <button
              type="button"
              onClick={handleRemoveClick}
              className="inline-flex items-center justify-center rounded-button border border-danger text-danger font-semibold text-xs px-3 h-9 transition-opacity hover:opacity-80"
            >
              Remove
            </button>
            <button
              type="button"
              onClick={handleTransferClick}
              className="inline-flex items-center justify-center rounded-button border border-border text-text font-semibold text-xs px-3 h-9 transition-colors hover:bg-surface-soft"
            >
              Make owner
            </button>
          </div>
        )}
      </div>

      {roleState.status === "error" && (
        <p role="alert" aria-live="polite" className="text-xs text-danger">
          {roleState.message}
        </p>
      )}
      {removeState.status === "error" && (
        <p role="alert" aria-live="polite" className="text-xs text-danger">
          {removeState.message}
        </p>
      )}

      {/* Dialogs — always mounted when owner views non-self */}
      {isOwnerView && !isSelf && profileId && (
        <>
          <ConfirmDialog
            dialogRef={removeDialogRef}
            title={`Remove ${displayName}?`}
            description={`Remove ${displayName} from the ${householdName} household? They'll be placed in a new household of their own.`}
            formId={removeFormId}
            confirmLabel="Remove"
            confirmDanger
            isPending={isRemoving}
            {...(removeState.status === "error" && { errorMessage: removeState.message })}
            onCancel={handleRemoveCancel}
          />
          <TransferOwnershipDialog
            profileId={profileId}
            memberName={displayName}
            dialogRef={transferDialogRef}
            onClose={handleTransferClose}
          />
        </>
      )}
    </div>
  );
}
