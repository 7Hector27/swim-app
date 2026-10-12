"use client";

import { useActionState, useRef } from "react";

import type { HouseholdMember, HouseholdRole } from "@swim-app/shared";

import ConfirmDialog from "@/components/ConfirmDialog";
import { leaveHouseholdAction } from "./actions";
import MemberRow from "./MemberRow";

interface Props {
  members: HouseholdMember[];
  householdName: string;
  myRole: HouseholdRole;
}

export default function MemberList({ members, householdName, myRole }: Props) {
  const isOwner = myRole === "owner";
  const leaveDialogRef = useRef<HTMLDialogElement>(null);
  const leaveFormId = "leave-household";

  const [leaveState, leaveAction, isLeaving] = useActionState(leaveHouseholdAction, { status: "idle" });

  const ownerMember = members.find((member) => member.role === "owner");
  const currentProfileId = ownerMember?.profileId ?? "";

  function handleLeaveClick() {
    leaveDialogRef.current?.showModal();
  }

  function handleLeaveCancel() {
    leaveDialogRef.current?.close();
  }

  return (
    <div className="flex flex-col">
      {/* Hidden leave form — always mounted */}
      <form id={leaveFormId} action={leaveAction} className="hidden" />

      <div className="rounded-card border border-border divide-y divide-border overflow-hidden">
        {members.map((member) => {
          const isSelf = isOwner
            ? member.role === "owner"
            : member.profileId === currentProfileId;

          return (
            <div key={member.profileId ?? member.fullName ?? member.joinedAt} className="px-4">
              <MemberRow
                member={member}
                isOwnerView={isOwner}
                isSelf={isSelf}
                householdName={householdName}
              />
            </div>
          );
        })}
      </div>

      {leaveState.status === "error" && (
        <p role="alert" aria-live="polite" className="mt-3 text-sm text-danger">
          {leaveState.message}
        </p>
      )}

      {/* Leave button — not shown to owners (must transfer first) */}
      {!isOwner && (
        <div className="mt-4">
          <button
            type="button"
            onClick={handleLeaveClick}
            className="inline-flex items-center justify-center rounded-button border border-danger text-danger font-semibold text-sm px-5 h-11 transition-opacity hover:opacity-80"
          >
            Leave household
          </button>
        </div>
      )}

      <ConfirmDialog
        dialogRef={leaveDialogRef}
        title="Leave household?"
        description={`Leave the ${householdName} household? You'll be placed in a new household of your own.`}
        formId={leaveFormId}
        confirmLabel="Leave"
        confirmDanger
        isPending={isLeaving}
        {...(leaveState.status === "error" && { errorMessage: leaveState.message })}
        onCancel={handleLeaveCancel}
      />
    </div>
  );
}
